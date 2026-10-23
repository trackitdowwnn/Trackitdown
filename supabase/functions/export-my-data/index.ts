/**
 * WHAT:  Edge Function behind Profile's "Download your data" (UK GDPR Art. 15
 *        access / Art. 20 portability). Proves the caller from the JWT, then:
 *          1. a file made in the last 24 hours that still exists? Re-sign
 *             THAT (a lost link costs nothing; one build a day);
 *          2. otherwise gather every row about them with the service role,
 *             build the export (_shared/dataExport — what goes in, and what
 *             never does), store it privately at data-exports/<uid>/<random>,
 *             record it, and return a 15-minute signed download link.
 *        The app opens the link in the browser — no native share module.
 * WHY:   Owner, 2026-10-23. Until now the only route was emailing support.
 *
 *        NOTHING here is client-controlled: the body is ignored, the only
 *        input is the caller's own JWT, so this can't be aimed at anyone
 *        else. ⚠️ Every query below is filtered by that user id — the service
 *        role reads past RLS, so the filter IS the access control.
 *
 *        ANY gather error fails the whole export (EXPORT_FAILED): a file that
 *        silently lacks a section would tell someone we hold less than we do.
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
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

const BUCKET = 'data-exports';
/** How long the download link works. */
const LINK_SECONDS = 15 * 60;
/** How long links to private photos inside the file work. */
const PHOTO_LINK_SECONDS = 24 * 60 * 60;
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

type Admin = ReturnType<typeof createServiceRoleClient>;

class GatherError extends Error {}

/** A query's rows, or the whole export fails — never a partial file. */
async function rows(
  label: string,
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) {
    console.error('[profile] export gather failed', { label });
    throw new GatherError(label);
  }
  return (data as Row[] | null) ?? [];
}

/** Rows whose `column` is one of `ids` — none (no query) when there are none. */
function rowsIn(
  admin: Admin,
  label: string,
  table: string,
  cols: string,
  column: string,
  ids: unknown[],
): Promise<Row[]> {
  return ids.length === 0
    ? Promise.resolve([])
    : rows(
        label,
        admin
          .from(table)
          .select(cols)
          .in(column, ids as string[]),
      );
}

async function signAll(
  admin: Admin,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(paths, PHOTO_LINK_SECONDS);
  if (error) {
    console.error('[profile] export photo signing failed', { bucket });
    throw new GatherError(`sign:${bucket}`);
  }
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) out.set(entry.path, entry.signedUrl);
  }
  return out;
}

const SIGHTING_COLS =
  'id, post_id, spotter_id, status, area_label, locality, location_unavailable, context_flags, parked_likelihood, direction, people_presence, confirmed_feature_ids, damage_kinds, missing_parts, created_at';

const PAYMENT_COLS =
  'id, kind, status, amount_pence, transfer_amount_pence, platform_fee_pence, refunded_amount_pence, created_at, captured_at, released_at, refunded_at, term_ends_at';

async function gather(admin: Admin, userId: string, email: string | null): Promise<DataExportRaw> {
  const [profile] = await rows(
    'profile',
    admin
      .from('profiles')
      .select(
        'first_name, display_name, created_at, avatar_path, sightings_reported, sightings_helpful, recoveries_credited',
      )
      .eq('id', userId),
  );
  const posts = await rows(
    'posts',
    admin
      .from('posts')
      .select(
        'id, status, plate, make, model, year, colour, colour_finish, body_type, bounty_amount_pence, listing_fee_pence, last_seen_at, last_seen_area, last_seen_locality, stolen_from, keys_taken, distinguishing_features, owner_note, desc_recognise, desc_drives, created_at, activated_at, expires_at, recovered_at, closed_at, archived_at',
      )
      .eq('owner_id', userId),
  );
  const postIds = posts.map((p) => p.id);
  const vehicles = await rows(
    'vehicles',
    admin
      .from('vehicles')
      .select(
        'id, plate, make, model, year, colour, colour_finish, colour_note, body_type, nickname, created_at, updated_at',
      )
      .eq('user_id', userId),
  );
  const vehicleIds = vehicles.map((v) => v.id);
  const mySightings = await rows(
    'my sightings',
    admin
      .from('sightings')
      .select(
        `${SIGHTING_COLS}, note, damage_note, missing_parts_note, withdraw_reason, withdraw_note, credited_at`,
      )
      .eq('spotter_id', userId),
  );
  const threads = await rows(
    'threads',
    admin
      .from('threads')
      .select('id, post_id, owner_id, spotter_id, created_at')
      .or(`owner_id.eq.${userId},spotter_id.eq.${userId}`),
  );
  const connected = await rows(
    'payout account',
    admin
      .from('stripe_connected_accounts')
      .select(
        'id, onboarding_complete, payouts_enabled, bank_last4, last_payout_status, last_payout_amount_pence, last_payout_arrival_date, created_at',
      )
      .eq('profile_id', userId),
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
    rowsIn(admin, 'post photos', 'post_photos', 'post_id, url, position', 'post_id', postIds),
    rowsIn(admin, 'post features', 'post_feature', 'post_id, feature_key', 'post_id', postIds),
    rowsIn(
      admin,
      'post distinctive',
      'post_distinctive_feature',
      'post_id, description, photo_url',
      'post_id',
      postIds,
    ),
    rowsIn(
      admin,
      'vehicle photos',
      'vehicle_photos',
      'vehicle_id, url, position',
      'vehicle_id',
      vehicleIds,
    ),
    rowsIn(
      admin,
      'vehicle distinctive',
      'vehicle_distinctive_feature',
      'vehicle_id, description, photo_url',
      'vehicle_id',
      vehicleIds,
    ),
    rowsIn(
      admin,
      'sighting photos',
      'sighting_photos',
      'sighting_id, path, lat, lng, accuracy_m, captured_at',
      'sighting_id',
      mySightings.map((s) => s.id),
    ),
    rowsIn(admin, 'sightings on listings', 'sightings', SIGHTING_COLS, 'post_id', postIds),
    rowsIn(
      admin,
      'messages',
      'messages',
      'thread_id, sender_id, kind, content, created_at',
      'thread_id',
      threads.map((t) => t.id),
    ),
    rows(
      'collections',
      admin.from('watchlist_collections').select('id, name, created_at').eq('user_id', userId),
    ),
    rows(
      'watchlist',
      admin
        .from('watchlist_items')
        .select('post_id, collection_id, created_at')
        .eq('user_id', userId),
    ),
    rows(
      'alert zones',
      admin
        .from('alert_zones')
        .select(
          'id, name, radius_m, enabled, approximate, make, model, colour, body_type, min_bounty_pence, recency_days, created_at',
        )
        .eq('user_id', userId),
    ),
    rows(
      'notifications',
      admin
        .from('notifications')
        .select('kind, title, body, created_at, read_at')
        .eq('user_id', userId),
    ),
    rows(
      'preferences',
      admin
        .from('notification_preferences')
        .select(
          'alerts_enabled, messages_enabled, my_sightings_enabled, money_enabled, watched_enabled, updated_at',
        )
        .eq('user_id', userId),
    ),
    rowsIn(admin, 'payments', 'payments', PAYMENT_COLS, 'post_id', postIds),
    // Listings already deleted keep their ledger detached, owner in the snapshot.
    rows(
      'payments (deleted listings)',
      admin.from('payments').select(PAYMENT_COLS).eq('post_snapshot->>owner_id', userId),
    ),
    rowsIn(
      admin,
      'payouts',
      'payments',
      PAYMENT_COLS,
      'payee_account_id',
      connected.map((c) => c.id),
    ),
    rows(
      'refund holds',
      admin
        .from('refund_holds')
        .select('post_id, exit_path, created_at, expires_at')
        .eq('owner_id', userId),
    ),
    rows(
      'my disputes',
      admin
        .from('refund_disputes')
        .select('post_id, status, statement, created_at, resolved_at')
        .eq('spotter_id', userId),
    ),
    rowsIn(
      admin,
      'disputes on listings',
      'refund_disputes',
      'post_id, status, created_at, resolved_at',
      'post_id',
      postIds,
    ),
    rows(
      'reports',
      admin.from('flags').select('target_type, reason, created_at').eq('reporter_id', userId),
    ),
    rows(
      'listing reports',
      admin.from('post_flags').select('post_id, reason, created_at').eq('reporter_id', userId),
    ),
    rows(
      'blocks',
      admin.from('user_blocks').select('blocked_id, created_at').eq('blocker_id', userId),
    ),
    rows(
      'bug reports',
      admin
        .from('bug_reports')
        .select(
          'id, message, expected, area, severity, frequency, app_version, platform, os_version, device_model, created_at, screenshot_paths',
        )
        .eq('reporter_id', userId),
    ),
    rows('devices', admin.from('push_tokens').select('platform, updated_at').eq('user_id', userId)),
    rowsIn(
      admin,
      'verification documents',
      'verification_documents',
      'post_id, created_at',
      'post_id',
      postIds,
    ),
  ]);

  // Blocked people: the first name the app already shows them, nothing more.
  const blockedNames = await rowsIn(
    admin,
    'blocked names',
    'profiles',
    'id, first_name',
    'id',
    blockRows.map((b) => b.blocked_id),
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
  const screenshotPaths = bugReports.flatMap((r) => (r.screenshot_paths as string[] | null) ?? []);
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
  // keep one per id, the "paid" side first.
  const seen = new Set<unknown>();
  const payments = [
    ...paidOnListings.map((p) => ({ ...p, role: 'paid' })),
    ...paidOnDeletedListings.map((p) => ({ ...p, role: 'paid' })),
    ...received.map((p) => ({ ...p, role: 'received' })),
  ].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return {
    email,
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

/** A 15-minute link that downloads (not just displays) the file. */
async function downloadLink(admin: Admin, path: string, createdAt: Date) {
  const filename = `trackitdown-data-${createdAt.toISOString().slice(0, 10)}.json`;
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, LINK_SECONDS, { download: filename });
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

  // 2 — build a new one.
  let json: string;
  try {
    const raw = await gather(admin, userId, userData.user.email ?? null);
    json = JSON.stringify(buildDataExport(raw, userId, new Date()), null, 2);
  } catch (error) {
    if (!(error instanceof GatherError)) {
      console.error('[profile] export build failed', (error as Error).message);
    }
    return failed();
  }

  const createdAt = new Date();
  const path = `${userId}/${crypto.randomUUID()}.json`;
  const bytes = new TextEncoder().encode(json);
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'application/json', upsert: false });
  if (uploadError) {
    console.error('[profile] export upload failed', uploadError.message);
    return failed();
  }
  const { data: recorded, error: recordError } = await admin
    .from('data_export_requests')
    .insert({
      user_id: userId,
      object_path: path,
      byte_size: bytes.byteLength,
      created_at: createdAt.toISOString(),
    })
    .select('id')
    .single();
  if (recordError) {
    // Unrecorded means the sweep would never remove it — take it back now.
    console.error('[profile] export record failed', recordError.message);
    await admin.storage.from(BUCKET).remove([path]);
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
    bytes: bytes.byteLength,
  });
  return jsonResponse({ ...link, reused: false });
});
