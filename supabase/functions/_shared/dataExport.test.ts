/**
 * WHAT:  Tests for buildDataExport — what a person's data export contains, and
 *        ⚠️ what it must never contain: anything identifying someone else.
 * WHY:   The gather reads with the service role, past RLS, and a chat or a
 *        sighting on their listing is shared with another person. The builder
 *        picks every field by name; these tests seed user B into every shared
 *        place and assert B's id, name, email, words and photos never reach
 *        A's file.
 * LINKS: ./dataExport.ts; ../export-my-data/index.ts.
 */

import { buildDataExport, type DataExportRaw } from './dataExport';

const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const NOW = new Date('2026-10-23T12:00:00Z');

function raw(over: Partial<DataExportRaw> = {}): DataExportRaw {
  return {
    email: 'alice@example.com',
    signIn: { providers: ['email'], phone: null, last_sign_in_at: '2026-10-23' },
    profile: { id: A, first_name: 'Alice', display_name: 'Alice A', created_at: '2026-01-01' },
    avatarUrl: 'https://cdn/avatars/a.jpg',
    posts: [
      {
        id: 'post-a',
        owner_id: A,
        plate: 'AB12 CDE',
        make: 'Ford',
        model: 'Fiesta',
        status: 'active',
      },
    ],
    postPoints: [{ id: 'post-a', lat: 53.48, lng: -2.24 }],
    postPhotos: [{ post_id: 'post-a', url: 'https://cdn/post-photos/a/1.jpg' }],
    postFeatures: [{ post_id: 'post-a', feature_key: 'roof_rack' }],
    postDistinctive: [],
    vehicles: [],
    vehiclePhotos: [],
    vehicleDistinctive: [],
    mySightings: [
      {
        id: 'sight-a',
        post_id: 'post-x',
        spotter_id: A,
        area_label: 'Ancoats',
        note: 'Alice’s own note',
      },
    ],
    mySightingPhotos: [
      { sighting_id: 'sight-a', url: 'https://signed/a.jpg', lat: 53.4, lng: -2.2 },
    ],
    // B spotted A's car: B's id, notes and photos must not come through.
    sightingsOnMyListings: [
      {
        id: 'sight-b',
        post_id: 'post-a',
        spotter_id: B,
        area_label: 'Deansgate',
        status: 'unverified',
        note: 'Bob saw it outside his flat',
        damage_note: 'Bob’s words',
        created_at: '2026-10-20',
      },
    ],
    threads: [
      { id: 'thread-1', post_id: 'post-a', owner_id: A, spotter_id: B, created_at: '2026-10-21' },
    ],
    messages: [
      {
        thread_id: 'thread-1',
        sender_id: B,
        kind: 'text',
        content: 'Hi, I think I saw it',
        created_at: '2026-10-21T10:00:00Z',
      },
      {
        thread_id: 'thread-1',
        sender_id: A,
        kind: 'text',
        content: 'Thank you!',
        created_at: '2026-10-21T10:05:00Z',
      },
    ],
    watchlistCollections: [],
    watchlistItems: [],
    alertZones: [{ id: 'zone-a', name: 'Home', radius_m: 2000 }],
    alertPoints: [{ id: 'zone-a', lat: 53.5, lng: -2.3 }],
    notifications: [
      {
        kind: 'sighting',
        title: 'New sighting',
        body: 'Someone saw your car',
        created_at: '2026-10-20',
      },
    ],
    notificationPreferences: { user_id: A, alerts_enabled: true },
    payments: [
      {
        role: 'paid',
        kind: 'listing_fee',
        status: 'collected',
        amount_pence: 500,
        stripe_payment_intent_id: 'pi_secret',
        payee_account_id: 'acct-b',
      },
    ],
    payoutAccount: null,
    refundHolds: [],
    myDisputes: [],
    // B disputed on A's listing: the outcome only, not B or B's statement.
    disputesOnMyListings: [
      {
        post_id: 'post-a',
        spotter_id: B,
        sighting_id: 'sight-b',
        statement: 'Bob’s statement',
        status: 'rejected',
      },
    ],
    flagsFiled: [{ target_type: 'user', target_id: B, reason: 'spam', created_at: '2026-10-22' }],
    listingReportsFiled: [],
    blocks: [{ first_name: 'Bob', blocked_id: B, created_at: '2026-10-22' }],
    bugReports: [{ id: 'bug-1', message: 'It crashed', reporter_id: A }],
    bugScreenshotUrls: { 'bug-1': ['https://signed/bug-1.png'] },
    pushDevices: [
      { platform: 'android', token: 'ExponentPushToken[secret]', updated_at: '2026-10-23' },
    ],
    verificationDocuments: [],
    ...over,
  };
}

describe('buildDataExport', () => {
  it('⚠️ never carries user B — id, email, statement, notes or photos', () => {
    const text = JSON.stringify(buildDataExport(raw(), A, NOW));
    for (const leak of [
      B,
      'bob@example.com',
      'Bob saw it outside his flat',
      'Bob’s words',
      'Bob’s statement',
      'sight-b',
      'acct-b',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('chats keep both sides, the other person anonymised', () => {
    const out = buildDataExport(raw(), A, NOW) as {
      conversations: { you_are: string; messages: { from: string; text: string }[] }[];
    };
    expect(out.conversations[0].you_are).toBe('owner');
    expect(out.conversations[0].messages).toEqual([
      expect.objectContaining({ from: 'other person', text: 'Hi, I think I saw it' }),
      expect.objectContaining({ from: 'you', text: 'Thank you!' }),
    ]);
  });

  it('sightings on their listing: when and where, never the spotter', () => {
    const out = buildDataExport(raw(), A, NOW) as {
      listings: { sightings_from_others: Record<string, unknown>[] }[];
    };
    const [sighting] = out.listings[0].sightings_from_others;
    expect(sighting).toEqual(
      expect.objectContaining({ area_label: 'Deansgate', status: 'unverified' }),
    );
    expect(sighting).not.toHaveProperty('spotter_id');
    expect(sighting).not.toHaveProperty('note');
    expect(sighting).not.toHaveProperty('id');
  });

  // ⚠️ A report the spotter took back left the owner's list — it mustn't
  // come back in their export.
  it('a withdrawn sighting on their listing is left out', () => {
    const out = buildDataExport(
      raw({
        sightingsOnMyListings: [
          { post_id: 'post-a', spotter_id: B, area_label: 'Withdrawn place', status: 'withdrawn' },
        ],
      }),
      A,
      NOW,
    );
    expect(JSON.stringify(out)).not.toContain('Withdrawn place');
  });

  it('a deleted listing’s payment still says which car it was', () => {
    const out = buildDataExport(
      raw({
        payments: [
          {
            role: 'paid',
            kind: 'listing_fee',
            amount_pence: 500,
            listing: { plate: 'OLD 1', make: 'VW', model: 'Golf' },
          },
        ],
      }),
      A,
      NOW,
    ) as { payments: { listing: unknown }[]; account: { sign_in: unknown } };
    expect(out.payments[0].listing).toEqual({ plate: 'OLD 1', make: 'VW', model: 'Golf' });
    expect(out.account.sign_in).toEqual(expect.objectContaining({ providers: ['email'] }));
  });

  it('their own sightings keep their own notes and photos', () => {
    const out = buildDataExport(raw(), A, NOW) as {
      sightings_you_reported: { note: string; photos: { url: string }[] }[];
    };
    expect(out.sightings_you_reported[0].note).toBe('Alice’s own note');
    expect(out.sightings_you_reported[0].photos[0].url).toBe('https://signed/a.jpg');
  });

  it('leaves out payment ids, push token values and report targets', () => {
    const text = JSON.stringify(buildDataExport(raw(), A, NOW));
    expect(text).not.toContain('pi_secret');
    expect(text).not.toContain('ExponentPushToken');
    const out = buildDataExport(raw(), A, NOW) as { devices: unknown[]; payments: unknown[] };
    expect(out.devices).toEqual([{ platform: 'android', updated_at: '2026-10-23' }]);
    expect(out.payments).toEqual([
      expect.objectContaining({ role: 'paid', kind: 'listing_fee', amount_pence: 500 }),
    ]);
  });

  it('includes their account, listing location and alert areas', () => {
    const out = buildDataExport(raw(), A, NOW) as {
      about: { generated_at: string };
      account: Record<string, unknown>;
      listings: { last_seen_point: unknown; photos: string[] }[];
      alert_areas: { centre: unknown }[];
    };
    expect(out.about.generated_at).toBe(NOW.toISOString());
    expect(out.account).toEqual(
      expect.objectContaining({ email: 'alice@example.com', first_name: 'Alice' }),
    );
    expect(out.listings[0].last_seen_point).toEqual({ lat: 53.48, lng: -2.24 });
    expect(out.listings[0].photos).toEqual(['https://cdn/post-photos/a/1.jpg']);
    expect(out.alert_areas[0].centre).toEqual({ lat: 53.5, lng: -2.3 });
  });

  it('an empty account still builds, with every section present', () => {
    const empty = raw({
      posts: [],
      postPoints: [],
      postPhotos: [],
      postFeatures: [],
      mySightings: [],
      mySightingPhotos: [],
      sightingsOnMyListings: [],
      threads: [],
      messages: [],
      alertZones: [],
      alertPoints: [],
      notifications: [],
      notificationPreferences: null,
      payments: [],
      disputesOnMyListings: [],
      flagsFiled: [],
      blocks: [],
      bugReports: [],
      pushDevices: [],
    });
    const out = buildDataExport(empty, A, NOW);
    expect(out).toEqual(
      expect.objectContaining({ listings: [], conversations: [], payments: [], devices: [] }),
    );
  });
});
