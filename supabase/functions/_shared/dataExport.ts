/**
 * WHAT:  buildDataExport — turns the rows export-my-data gathered about ONE
 *        user into the file they download ("Download your data", UK GDPR
 *        Art. 15 / 20). Pure: no I/O, so what goes in — and what doesn't — is
 *        tested in Jest (./dataExport.test.ts).
 * WHY:   ⚠️ EVERY FIELD IS PICKED BY NAME. The gather reads with the service
 *        role, past RLS, and some rows are shared with other people (a chat,
 *        a sighting on their listing). Copying a row whole would carry the
 *        other person's id or words into this person's file; picking means a
 *        column nobody chose can never leak, even if a query starts selecting
 *        it. Owner's rules (2026-10-23):
 *          - chats: the whole conversation, the other person ANONYMISED —
 *            "you" / "other person", never their id or name;
 *          - sightings strangers reported on their listings: when, roughly
 *            where, and the structured answers — never the spotter, their
 *            photos or their free-text notes;
 *          - disputes on their listings: the outcome, not the spotter's
 *            statement (their own statement, as a spotter, is included).
 *        Left out on purpose (named in `about`): card details (held by the
 *        payment partner), other people's personal data, internal fraud and
 *        moderation signals, anonymous telemetry, push token values.
 * LINKS: ../export-my-data/index.ts (the gather);
 *        supabase/migrations/20261023150000_data_exports.sql;
 *        docs/RECORD_OF_PROCESSING.md §4.
 */

export type Row = Record<string, unknown>;

export interface DataExportRaw {
  /** From auth — the address they sign in with. */
  email: string | null;
  /** From auth — how they sign in (providers, phone, last sign-in). */
  signIn: Row | null;
  profile: Row | null;
  avatarUrl: string | null;
  posts: Row[];
  postPoints: Row[];
  postPhotos: Row[];
  postFeatures: Row[];
  postDistinctive: Row[];
  vehicles: Row[];
  vehiclePhotos: Row[];
  vehicleDistinctive: Row[];
  /** Sightings THEY reported. */
  mySightings: Row[];
  /** Photos on their own sightings, with `url` already signed. */
  mySightingPhotos: Row[];
  /** Sightings OTHER people reported on their listings (includes spotter_id,
   *  which is dropped here). */
  sightingsOnMyListings: Row[];
  threads: Row[];
  messages: Row[];
  watchlistCollections: Row[];
  watchlistItems: Row[];
  alertZones: Row[];
  alertPoints: Row[];
  notifications: Row[];
  notificationPreferences: Row | null;
  /** Payments on their listings (`role: 'paid'`) and paid to them
   *  (`role: 'received'`). */
  payments: Row[];
  payoutAccount: Row | null;
  refundHolds: Row[];
  /** Disputes they raised as a spotter (their statement included). */
  myDisputes: Row[];
  /** Disputes raised on their listings (includes spotter_id/statement,
   *  which are dropped here). */
  disputesOnMyListings: Row[];
  flagsFiled: Row[];
  listingReportsFiled: Row[];
  /** Their blocks, with the blocked person's first name (as the app shows). */
  blocks: Row[];
  bugReports: Row[];
  /** bug report id → signed screenshot URLs. */
  bugScreenshotUrls: Record<string, string[]>;
  pushDevices: Row[];
  verificationDocuments: Row[];
}

function pick(row: Row | null | undefined, keys: readonly string[]): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const key of keys) {
    if (key in row) out[key] = row[key] ?? null;
  }
  return out;
}

const picks = (rows: Row[], keys: readonly string[]): Row[] =>
  rows.map((row) => pick(row, keys) as Row);

const byKey = (rows: Row[], key: string) => {
  const map = new Map<unknown, Row[]>();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
};

const POST_FIELDS = [
  'id',
  'status',
  'plate',
  'make',
  'model',
  'year',
  'colour',
  'colour_finish',
  'body_type',
  'bounty_amount_pence',
  'listing_fee_pence',
  'last_seen_at',
  'last_seen_area',
  'last_seen_locality',
  'stolen_from',
  'keys_taken',
  'distinguishing_features',
  'owner_note',
  'desc_recognise',
  'desc_drives',
  'created_at',
  'activated_at',
  'expires_at',
  'recovered_at',
  'closed_at',
  'archived_at',
] as const;

const VEHICLE_FIELDS = [
  'id',
  'plate',
  'make',
  'model',
  'year',
  'colour',
  'colour_finish',
  'colour_note',
  'body_type',
  'nickname',
  'created_at',
  'updated_at',
] as const;

/** The structured answers a spotter gives — shared with the owner already. */
const SIGHTING_ANSWERS = [
  'status',
  'area_label',
  'locality',
  'location_unavailable',
  'context_flags',
  'parked_likelihood',
  'direction',
  'people_presence',
  'confirmed_feature_ids',
  'damage_kinds',
  'missing_parts',
  'created_at',
] as const;

export function buildDataExport(raw: DataExportRaw, userId: string, now: Date): Row {
  const pointsByPost = new Map(raw.postPoints.map((p) => [p.id, p]));
  const photosByPost = byKey(raw.postPhotos, 'post_id');
  const featuresByPost = byKey(raw.postFeatures, 'post_id');
  const distinctiveByPost = byKey(raw.postDistinctive, 'post_id');
  const othersSightingsByPost = byKey(
    // Backstop to the gather's filter: never their own spotting, never a
    // report the spotter withdrew (it left the owner's list — DOMAIN.md).
    raw.sightingsOnMyListings.filter((s) => s.spotter_id !== userId && s.status !== 'withdrawn'),
    'post_id',
  );
  const photosByVehicle = byKey(raw.vehiclePhotos, 'vehicle_id');
  const distinctiveByVehicle = byKey(raw.vehicleDistinctive, 'vehicle_id');
  const photosBySighting = byKey(raw.mySightingPhotos, 'sighting_id');
  const messagesByThread = byKey(raw.messages, 'thread_id');
  const pointsByZone = new Map(raw.alertPoints.map((p) => [p.id, p]));

  return {
    about: {
      generated_at: now.toISOString(),
      service: 'Trackitdown',
      what_this_is:
        'A copy of the personal data Trackitdown holds about you, as of the time above.',
      not_included: [
        'Card details, and the identity and bank details you gave for payouts — held by our payment partner, never by us. Ask them for a copy.',
        'Other people’s identities — in chats and on sightings of your listings they appear as "other person". (Their messages to you are included, as part of your conversations.)',
        'Internal fraud and safety checks (withheld to prevent crime), and anonymous app usage statistics.',
        'The documents you uploaded to verify a listing — ask support for copies.',
        'Device push tokens (only which devices are registered).',
      ],
      your_rights:
        'Why we use your data, who we share it with, how long we keep it and your rights: Profile → Support & legal → Privacy policy.',
      photos:
        'Photos are links. Links to private photos stop working after 24 hours — download again for fresh ones.',
      delete_your_account: 'Profile → Danger zone → Delete account.',
    },
    account: {
      email: raw.email,
      sign_in: pick(raw.signIn, ['providers', 'phone', 'account_created_at', 'last_sign_in_at']),
      ...pick(raw.profile, [
        'first_name',
        'display_name',
        'created_at',
        'sightings_reported',
        'sightings_helpful',
        'recoveries_credited',
      ]),
      avatar: raw.avatarUrl,
    },
    listings: raw.posts.map((post) => {
      const point = pointsByPost.get(post.id);
      return {
        ...pick(post, POST_FIELDS),
        last_seen_point: point ? { lat: point.lat ?? null, lng: point.lng ?? null } : null,
        photos: (photosByPost.get(post.id) ?? []).map((p) => p.url ?? null),
        features: (featuresByPost.get(post.id) ?? []).map((f) => f.feature_key ?? null),
        distinctive_features: picks(distinctiveByPost.get(post.id) ?? [], [
          'description',
          'photo_url',
        ]),
        // ⚠️ Anonymised: when, roughly where, the answers. Never the spotter,
        // their photos or their own words.
        sightings_from_others: picks(othersSightingsByPost.get(post.id) ?? [], SIGHTING_ANSWERS),
      };
    }),
    garage: raw.vehicles.map((vehicle) => ({
      ...pick(vehicle, VEHICLE_FIELDS),
      photos: (photosByVehicle.get(vehicle.id) ?? []).map((p) => p.url ?? null),
      distinctive_features: picks(distinctiveByVehicle.get(vehicle.id) ?? [], [
        'description',
        'photo_url',
      ]),
    })),
    sightings_you_reported: raw.mySightings.map((sighting) => ({
      ...pick(sighting, [
        'id',
        'post_id',
        ...SIGHTING_ANSWERS,
        'note',
        'damage_note',
        'missing_parts_note',
        'withdraw_reason',
        'withdraw_note',
        'credited_at',
      ]),
      photos: picks(photosBySighting.get(sighting.id) ?? [], [
        'url',
        'lat',
        'lng',
        'accuracy_m',
        'captured_at',
      ]),
    })),
    conversations: raw.threads.map((thread) => ({
      listing_id: thread.post_id ?? null,
      // Which side they were on — never the other person's id.
      you_are: thread.owner_id === userId ? 'owner' : 'spotter',
      started_at: thread.created_at ?? null,
      messages: [...(messagesByThread.get(thread.id) ?? [])]
        .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
        .map((message) => ({
          from: message.sender_id === userId ? 'you' : 'other person',
          kind: message.kind ?? null,
          text: message.content ?? null,
          sent_at: message.created_at ?? null,
        })),
    })),
    watchlist: {
      collections: picks(raw.watchlistCollections, ['id', 'name', 'created_at']),
      saved_listings: picks(raw.watchlistItems, ['post_id', 'collection_id', 'created_at']),
    },
    alert_areas: raw.alertZones.map((zone) => {
      const point = pointsByZone.get(zone.id);
      return {
        ...pick(zone, [
          'name',
          'radius_m',
          'enabled',
          'approximate',
          'make',
          'model',
          'colour',
          'body_type',
          'min_bounty_pence',
          'recency_days',
          'created_at',
        ]),
        centre: point ? { lat: point.lat ?? null, lng: point.lng ?? null } : null,
      };
    }),
    notifications: picks(raw.notifications, ['kind', 'title', 'body', 'created_at', 'read_at']),
    notification_settings: pick(raw.notificationPreferences, [
      'alerts_enabled',
      'messages_enabled',
      'my_sightings_enabled',
      'money_enabled',
      'watched_enabled',
      'updated_at',
    ]),
    payments: picks(raw.payments, [
      'role',
      'listing',
      'kind',
      'status',
      'amount_pence',
      'transfer_amount_pence',
      'platform_fee_pence',
      'refunded_amount_pence',
      'created_at',
      'captured_at',
      'released_at',
      'refunded_at',
      'term_ends_at',
    ]),
    payout_account: pick(raw.payoutAccount, [
      'onboarding_complete',
      'payouts_enabled',
      'bank_last4',
      'last_payout_status',
      'last_payout_amount_pence',
      'last_payout_arrival_date',
      'created_at',
    ]),
    refund_holds: picks(raw.refundHolds, ['post_id', 'exit_path', 'created_at', 'expires_at']),
    disputes: {
      you_raised: picks(raw.myDisputes, [
        'post_id',
        'status',
        'statement',
        'created_at',
        'resolved_at',
      ]),
      // ⚠️ The outcome only — the spotter and their statement are theirs.
      on_your_listings: picks(raw.disputesOnMyListings, [
        'post_id',
        'status',
        'created_at',
        'resolved_at',
      ]),
    },
    reports_you_made: [
      ...picks(raw.flagsFiled, ['target_type', 'reason', 'created_at']),
      ...picks(raw.listingReportsFiled, ['post_id', 'reason', 'created_at']).map((r) => ({
        target_type: 'listing',
        ...r,
      })),
    ],
    people_you_blocked: picks(raw.blocks, ['first_name', 'created_at']),
    bug_reports: raw.bugReports.map((report) => ({
      ...pick(report, [
        'message',
        'expected',
        'area',
        'severity',
        'frequency',
        'app_version',
        'platform',
        'os_version',
        'device_model',
        'breadcrumbs',
        'created_at',
      ]),
      screenshots: raw.bugScreenshotUrls[String(report.id)] ?? [],
    })),
    devices: picks(raw.pushDevices, ['platform', 'updated_at']),
    verification_documents: picks(raw.verificationDocuments, ['post_id', 'created_at']),
  };
}
