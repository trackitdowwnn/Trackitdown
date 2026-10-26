/**
 * WHAT:  Edge Function behind Profile's "Download your data" (UK GDPR Art. 15
 *        access / Art. 20 portability). Proves the caller from the JWT, then:
 *          1. a file made in the last 22 hours that still exists? Re-sign
 *             THAT (a lost link costs nothing; one build a day);
 *          2. otherwise gather every row about them with the service role,
 *             build the export (_shared/dataExport — what goes in, and what
 *             never does), store it privately as data-exports/<uid>/<random>
 *             .json (machine-readable, Art. 20) AND .pdf (readable — owner,
 *             2026-10-23: phones can't open JSON without another app; the PDF
 *             links to the JSON), record it, and return a 15-minute signed
 *             download link to the PDF.
 *        The app opens the link in the browser — no native share module.
 * WHY:   Owner, 2026-10-23. Until now the only route was emailing support.
 *
 *        NOTHING here is client-controlled: the body is ignored, the only
 *        input is the caller's own JWT, so this can't be aimed at anyone
 *        else. ⚠️ Every query below is filtered by that user id — the service
 *        role reads past RLS, so the filter IS the access control.
 *
 *        NEVER A PARTIAL FILE. Any gather error fails the whole export
 *        (EXPORT_FAILED), and every list is read in pages until a short page
 *        comes back — PostgREST caps a response at 1,000 rows even for the
 *        service role, so a single read would silently drop the rest of a busy
 *        account's messages (security review of #270). Id lists are queried in
 *        chunks so a long one can't overflow the URL.
 *
 *        Never logged: the URL, the payload, the email. Ids, counts and byte
 *        size only (docs/LOGGING.md).
 * LINKS: ../_shared/dataExport.ts (+ test);
 *        supabase/migrations/20261023150000_data_exports.sql;
 *        ../release-held-refunds/index.ts (removes files after 24h);
 *        ../delete-account/index.ts (the same JWT-only shape);
 *        src/features/profile/api/profileApi.ts (requestDataExport).
 */

import { createServiceRoleClient } from '../_shared/clients.ts';
import { buildDataExport, type DataExportRaw, type Row } from '../_shared/dataExport.ts';
import { renderDataExportPdf } from '../_shared/dataExportPdf.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { isOwnCleanPath } from '../_shared/storagePath.ts';

const BUCKET = 'data-exports';
/** How long the download link works. */
const LINK_SECONDS = 15 * 60;
/** How long links to private photos inside the file work. */
const PHOTO_LINK_SECONDS = 24 * 60 * 60;
/** Reuse a file this young — well inside the 24h sweep, so a re-signed link
 *  can't outlive the file it points at. */
const REUSE_WINDOW_MS = 22 * 60 * 60 * 1000;
/** PostgREST's max rows per response. */
const PAGE = 1000;
/** Ids per `.in()` — keeps the request URL short. */
const ID_CHUNK = 100;

type Admin = ReturnType<typeof createServiceRoleClient>;
type Result = { data: unknown; error: { message: string } | null };
// The PostgREST builder, loosely: only what paging needs.
type Query = {
  order: (column: string, options?: { ascending?: boolean }) => Query;
  range: (from: number, to: number) => PromiseLike<Result>;
};

class GatherError extends Error {}

/**
 * EVERY row a query matches, page by page — never the first 1,000. `query`
 * builds a fresh filtered select each time (a builder can't be re-ranged);
 * `orderBy` makes the pages stable (the last column should be unique-ish).
 */
async function all(
  label: string,
  query: () => Query,
  orderBy: readonly string[] = ['created_at'],
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let ordered = query();
    for (const column of orderBy) ordered = ordered.order(column, { ascending: true });
    const { data, error } = await ordered.range(from, from + PAGE - 1);
    if (error) {
      console.error('[profile] export gather failed', { label });
      throw new GatherError(label);
    }
    const page = (data as Row[] | null) ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Rows whose `column` is one of `ids`, in chunks — none when there are none. */
async function allIn(
  label: string,
  ids: unknown[],
  query: (chunk: string[]) => Query,
  orderBy?: readonly string[],
): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK) as string[];
    out.push(...(await all(label, () => query(chunk), orderBy)));
  }
  return out;
}

async function signAll(
  admin: Admin,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += ID_CHUNK) {
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrls(paths.slice(i, i + ID_CHUNK), PHOTO_LINK_SECONDS);
    if (error) {
      console.error('[profile] export photo signing failed', { bucket });
      throw new GatherError(`sign:${bucket}`);
    }
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) out.set(entry.path, entry.signedUrl);
    }
  }
  return out;
}

const SIGHTING_COLS =
  'id, post_id, spotter_id, status, area_label, locality, location_unavailable, context_flags, parked_likelihood, direction, people_presence, confirmed_feature_ids, damage_kinds, missing_parts, created_at';

const PAYMENT_COLS =
  'id, kind, status, amount_pence, transfer_amount_pence, platform_fee_pence, refunded_amount_pence, created_at, captured_at, released_at, refunded_at, term_ends_at';

interface AuthUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  app_metadata?: { providers?: string[]; provider?: string };
}

async function gather(admin: Admin, user: AuthUser): Promise<DataExportRaw> {
  const userId = user.id;
  // deno-lint-ignore no-explicit-any -- the builder's generics, flattened for paging
  const from = (table: string, cols: string) => admin.from(table).select(cols) as any;

  const [profile] = await all('profile', () =>
    from(
      'profiles',
      'first_name, display_name, created_at, avatar_path, sightings_reported, sightings_helpful, recoveries_credited',
    ).eq('id', userId),
  );
  const posts = await all('posts', () =>
    from(
      'posts',
      'id, status, plate, make, model, year, colour, colour_finish, body_type, bounty_amount_pence, listing_fee_pence, last_seen_at, last_seen_area, last_seen_locality, stolen_from, keys_taken, distinguishing_features, owner_note, desc_recognise, desc_drives, created_at, activated_at, expires_at, recovered_at, closed_at, archived_at',
    ).eq('owner_id', userId),
  );
  const postIds = posts.map((p) => p.id);
  const vehicles = await all('vehicles', () =>
    from(
      'vehicles',
      'id, plate, make, model, year, colour, colour_finish, colour_note, body_type, nickname, created_at, updated_at',
    ).eq('user_id', userId),
  );
  const vehicleIds = vehicles.map((v) => v.id);
  const mySightings = await all('my sightings', () =>
    from(
      'sightings',
      `${SIGHTING_COLS}, note, damage_note, missing_parts_note, withdraw_reason, withdraw_note, credited_at`,
    ).eq('spotter_id', userId),
  );
  const threads = await all('threads', () =>
    from('threads', 'id, post_id, owner_id, spotter_id, created_at').or(
      `owner_id.eq.${userId},spotter_id.eq.${userId}`,
    ),
  );
  const connected = await all('payout account', () =>
    from(
      'stripe_connected_accounts',
      'id, onboarding_complete, payouts_enabled, bank_last4, last_payout_status, last_payout_amount_pence, last_payout_arrival_date, created_at',
    ).eq('profile_id', userId),
  );

  const [
    points,
    postPhotos,
    postFeatures,
    postDistinctive,
    vehiclePhotos,
    vehicleDistinctive,
    sightingPhotoRows,
    sightingsOnMyListings,
    messages,
    watchlistCollections,
    watchlistItems,
    alertZones,
    notifications,
    preferences,
    paidOnListings,
    paidOnDeletedListings,
    received,
    refundHolds,
    myDisputes,
    disputesOnMyListings,
    flagsFiled,
    listingReportsFiled,
    blockRows,
    bugReports,
    pushDevices,
    verificationDocuments,
  ] = await Promise.all([
    (async () => {
      const { data, error } = await admin.rpc('data_export_points', { p_user_id: userId });
      if (error) {
        console.error('[profile] export gather failed', { label: 'points' });
        throw new GatherError('points');
      }
      return (data ?? { posts: [], alert_zones: [] }) as { posts: Row[]; alert_zones: Row[] };
    })(),
    allIn('post photos', postIds, (ids) =>
      from('post_photos', 'post_id, url, position').in('post_id', ids),
    ),
    allIn(
      'post features',
      postIds,
      (ids) => from('post_feature', 'post_id, feature_key').in('post_id', ids),
      ['post_id', 'feature_key'],
    ),
    allIn('post distinctive', postIds, (ids) =>
      from('post_distinctive_feature', 'post_id, description, photo_url').in('post_id', ids),
    ),
    allIn('vehicle photos', vehicleIds, (ids) =>
      from('vehicle_photos', 'vehicle_id, url, position').in('vehicle_id', ids),
    ),
    allIn('vehicle distinctive', vehicleIds, (ids) =>
      from('vehicle_distinctive_feature', 'vehicle_id, description, photo_url').in(
        'vehicle_id',
        ids,
      ),
    ),
    allIn(
      'sighting photos',
      mySightings.map((s) => s.id),
      (ids) =>
        from('sighting_photos', 'sighting_id, path, lat, lng, accuracy_m, captured_at').in(
          'sighting_id',
          ids,
        ),
    ),
    // ⚠️ Not the withdrawn ones: a report the spotter took back disappears from
    // the owner's list (DOMAIN.md), and the export mustn't bring it back.
    allIn('sightings on listings', postIds, (ids) =>
      from('sightings', SIGHTING_COLS).in('post_id', ids).neq('status', 'withdrawn'),
    ),
    allIn(
      'messages',
      threads.map((t) => t.id),
      (ids) =>
        from('messages', 'id, thread_id, sender_id, kind, content, created_at').in(
          'thread_id',
          ids,
        ),
      ['created_at', 'id'],
    ),
    all('collections', () =>
      from('watchlist_collections', 'id, name, created_at').eq('user_id', userId),
    ),
    all('watchlist', () =>
      from('watchlist_items', 'post_id, collection_id, created_at').eq('user_id', userId),
    ),
    all('alert zones', () =>
      from(
        'alert_zones',
        'id, name, radius_m, enabled, approximate, make, model, colour, body_type, min_bounty_pence, recency_days, created_at',
      ).eq('user_id', userId),
    ),
    all(
      'notifications',
      () =>
        from('notifications', 'id, kind, title, body, created_at, read_at').eq('user_id', userId),
      ['created_at', 'id'],
    ),
    all(
      'preferences',
      () =>
        from(
          'notification_preferences',
          'alerts_enabled, messages_enabled, my_sightings_enabled, money_enabled, watched_enabled, updated_at',
        ).eq('user_id', userId),
      ['updated_at'],
    ),
    allIn('payments', postIds, (ids) => from('payments', PAYMENT_COLS).in('post_id', ids)),
    // Listings already deleted keep their ledger detached; the snapshot says
    // which car it was (their own listing).
    all('payments (deleted listings)', () =>
      from('payments', `${PAYMENT_COLS}, post_snapshot`).eq('post_snapshot->>owner_id', userId),
    ),
    allIn(
      'payouts',
      connected.map((c) => c.id),
      (ids) => from('payments', PAYMENT_COLS).in('payee_account_id', ids),
    ),
    all('refund holds', () =>
      from('refund_holds', 'post_id, exit_path, created_at, expires_at').eq('owner_id', userId),
    ),
    all('my disputes', () =>
      from('refund_disputes', 'post_id, status, statement, created_at, resolved_at').eq(
        'spotter_id',
        userId,
      ),
    ),
    allIn('disputes on listings', postIds, (ids) =>
      from('refund_disputes', 'post_id, status, created_at, resolved_at').in('post_id', ids),
    ),
    all('reports', () =>
      from('flags', 'target_type, reason, created_at').eq('reporter_id', userId),
    ),
    all('listing reports', () =>
      from('post_flags', 'post_id, reason, created_at').eq('reporter_id', userId),
    ),
    all('blocks', () => from('user_blocks', 'blocked_id, created_at').eq('blocker_id', userId)),
    all('bug reports', () =>
      from(
        'bug_reports',
        'id, message, expected, area, severity, frequency, app_version, platform, os_version, device_model, breadcrumbs, created_at, screenshot_paths',
      ).eq('reporter_id', userId),
    ),
    all('devices', () => from('push_tokens', 'platform, updated_at').eq('user_id', userId), [
      'updated_at',
    ]),
    allIn('verification documents', postIds, (ids) =>
      from('verification_documents', 'post_id, created_at').in('post_id', ids),
    ),
  ]);

  // Blocked people: the first name the app already shows them, nothing more.
  const blockedNames = await allIn(
    'blocked names',
    blockRows.map((b) => b.blocked_id),
    (ids) => from('profiles', 'id, first_name').in('id', ids),
  );
  const nameById = new Map(blockedNames.map((p) => [p.id, p.first_name]));
  const blocks = blockRows.map((b) => ({
    first_name: nameById.get(b.blocked_id) ?? null,
    created_at: b.created_at,
  }));

  // Photo links: their own sighting photos and bug screenshots are private.
  const sightingUrls = await signAll(
    admin,
    'sighting-photos',
    sightingPhotoRows.map((p) => String(p.path)),
  );
  const mySightingPhotos = sightingPhotoRows.map((p) => ({
    ...p,
    url: sightingUrls.get(String(p.path)) ?? null,
  }));
  // SAFETY (audit lead 10): sign only paths inside the requester's own folder.
  const screenshotPaths = bugReports
    .flatMap((r) => (r.screenshot_paths as string[] | null) ?? [])
    .filter((path) => isOwnCleanPath(path, userId));
  const screenshotUrls = await signAll(admin, 'bug-screenshots', screenshotPaths);
  const bugScreenshotUrls: Record<string, string[]> = {};
  for (const report of bugReports) {
    bugScreenshotUrls[String(report.id)] = ((report.screenshot_paths as string[] | null) ?? [])
      .map((path) => screenshotUrls.get(path))
      .filter((url): url is string => Boolean(url));
  }

  const avatarPath = profile?.avatar_path as string | null | undefined;
  const avatarUrl = avatarPath
    ? admin.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl
    : null;

  // A payment can match twice (paid on a listing they own AND received);
  // keep one per id, the "paid" side first. A deleted listing's payment says
  // which car it was, from its snapshot — their own listing's details.
  const seen = new Set<unknown>();
  const payments = [
    ...paidOnListings.map((p) => ({ ...p, role: 'paid' })),
    ...paidOnDeletedListings.map(({ post_snapshot: snapshot, ...p }) => {
      const s = (snapshot ?? {}) as Row;
      return {
        ...p,
        role: 'paid',
        listing: { plate: s.plate ?? null, make: s.make ?? null, model: s.model ?? null },
      };
    }),
    ...received.map((p) => ({ ...p, role: 'received' })),
  ].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return {
    email: user.email ?? null,
    signIn: {
      providers:
        user.app_metadata?.providers ??
        (user.app_metadata?.provider ? [user.app_metadata.provider] : []),
      phone: user.phone || null,
      account_created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
    },
    profile: profile ?? null,
    avatarUrl,
    posts,
    postPoints: points.posts,
    postPhotos,
    postFeatures,
    postDistinctive,
    vehicles,
    vehiclePhotos,
    vehicleDistinctive,
    mySightings,
    mySightingPhotos,
    sightingsOnMyListings,
    threads,
    messages,
    watchlistCollections,
    watchlistItems,
    alertZones,
    alertPoints: points.alert_zones,
    notifications,
    notificationPreferences: preferences[0] ?? null,
    payments,
    payoutAccount: connected[0] ?? null,
    refundHolds,
    myDisputes,
    disputesOnMyListings,
    flagsFiled,
    listingReportsFiled,
    blocks,
    bugReports,
    bugScreenshotUrls,
    pushDevices,
    verificationDocuments,
  };
}

/** The readable PDF beside an export's JSON (the request row names the JSON;
 *  the sweep removes both — 20261023160000). */
const pdfPathFor = (jsonPath: string) => jsonPath.replace(/\.json$/, '.pdf');

/** A 15-minute link that downloads the readable PDF. */
async function downloadLink(admin: Admin, jsonPath: string, createdAt: Date) {
  const filename = `trackitdown-data-${createdAt.toISOString().slice(0, 10)}.pdf`;
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(pdfPathFor(jsonPath), LINK_SECONDS, { download: filename });
  if (error || !data?.signedUrl) return null;
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + LINK_SECONDS * 1000).toISOString(),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  // The ONLY input. The body is never read.
  const jwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const admin = createServiceRoleClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const userId = userData.user.id;
  const failed = () =>
    errorResponse('EXPORT_FAILED', 'We couldn’t put your data together. Please try again.', 500);

  // 1 — today's file again, if there is one.
  const { data: recent, error: recentError } = await admin
    .from('data_export_requests')
    .select('id, object_path, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', new Date(Date.now() - REUSE_WINDOW_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentError) {
    console.error('[profile] export lookup failed', recentError.message);
    return failed();
  }
  if (recent) {
    const link = await downloadLink(
      admin,
      recent.object_path as string,
      new Date(recent.created_at as string),
    );
    if (link) {
      console.log('[profile] data export re-signed', { userId, requestId: recent.id });
      return jsonResponse({ ...link, reused: true });
    }
    // The file is gone (removed early?) — fall through and build a new one.
  }

  // 2 — build a new one: the machine-readable JSON (Art. 20), then the
  // readable PDF that links to it (owner, 2026-10-23: phones can't open JSON).
  let exported: Record<string, unknown>;
  try {
    const raw = await gather(admin, userData.user as AuthUser);
    exported = buildDataExport(raw, userId, new Date());
  } catch (error) {
    if (!(error instanceof GatherError)) {
      console.error('[profile] export build failed', (error as Error).message);
    }
    return failed();
  }

  const createdAt = new Date();
  const path = `${userId}/${crypto.randomUUID()}.json`;
  const pdfPath = pdfPathFor(path);
  const removeBoth = async () => {
    const { error: rollbackError } = await admin.storage.from(BUCKET).remove([path, pdfPath]);
    if (rollbackError) {
      console.error('[profile] export rollback failed — left for the sweep', { userId });
    }
  };

  const bytes = new TextEncoder().encode(JSON.stringify(exported, null, 2));
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'application/json', upsert: false });
  if (uploadError) {
    console.error('[profile] export upload failed', uploadError.message);
    return failed();
  }
  // The PDF carries a link to the JSON, good for as long as the files live.
  const { data: jsonLink, error: jsonLinkError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, PHOTO_LINK_SECONDS, {
      download: `trackitdown-data-${createdAt.toISOString().slice(0, 10)}.json`,
    });
  let pdf: Uint8Array;
  try {
    if (jsonLinkError || !jsonLink?.signedUrl) throw new Error('json link');
    pdf = renderDataExportPdf(exported, {
      url: jsonLink.signedUrl,
      // Signed just after createdAt, so this is never later than the real end.
      expiresAt: new Date(createdAt.getTime() + PHOTO_LINK_SECONDS * 1000).toISOString(),
    });
  } catch (error) {
    console.error('[profile] export pdf failed', (error as Error).message);
    await removeBoth();
    return failed();
  }
  const { error: pdfUploadError } = await admin.storage
    .from(BUCKET)
    .upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false });
  if (pdfUploadError) {
    console.error('[profile] export pdf upload failed', pdfUploadError.message);
    await removeBoth();
    return failed();
  }

  const { data: recorded, error: recordError } = await admin
    .from('data_export_requests')
    .insert({
      user_id: userId,
      object_path: path,
      byte_size: bytes.byteLength + pdf.byteLength,
      created_at: createdAt.toISOString(),
    })
    .select('id')
    .single();
  if (recordError) {
    // Unrecorded: take them back now. If that fails too, the hourly sweep
    // still finds them — it also removes old files no request row names.
    console.error('[profile] export record failed', recordError.message);
    await removeBoth();
    return failed();
  }

  const link = await downloadLink(admin, path, createdAt);
  if (!link) {
    console.error('[profile] export signing failed', { userId, requestId: recorded.id });
    return failed();
  }
  console.log('[profile] data export built', {
    userId,
    requestId: recorded.id,
    bytes: bytes.byteLength + pdf.byteLength,
  });
  return jsonResponse({ ...link, reused: false });
});
