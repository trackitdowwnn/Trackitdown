/**
 * WHAT:  Tests for the sightings API layer — the evidence-atomicity mapping
 *        (a photo without its own fix submits un-located, never borrowing),
 *        min/max photo enforcement, RPC error-token translation (rate limit,
 *        own post), the quota read, the owner-payload PRIVACY strictness
 *        (an extra spotter field — e.g. a leaked spotter_id — fails loudly),
 *        and that the wizard's seeds and UI-only fields are never sent.
 * WHY:   SAFETY/MONEY-adjacent: fabricated evidence and spotter exposure are
 *        the two ways this feature could hurt someone; both boundaries live
 *        in this file's schemas and are pinned here.
 * LINKS: src/features/sightings/api/sightingApi.ts, docs/TESTING.md,
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import { getRecentLogs } from '@/shared/lib/logger';
import type { EvidencePhoto } from '@/shared/ui';

import {
  buildCreateSightingParams,
  fetchMyReportPhotos,
  fetchPostSightings,
  fetchPostWithdrawals,
  fetchMySightingRecord,
  fetchSightingQuota,
  markSightingHelpful,
  markSightingNotMine,
  submitSighting,
  SightingSubmissionError,
  withdrawSighting,
} from './sightingApi';

const mockRpc = jest.fn();
const mockGetUser = jest.fn();
const mockUpload = jest.fn();
const mockCreateSignedUrls = jest.fn();
const mockInvoke = jest.fn();
const mockTableCall = jest.fn();
const mockTableRead = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
    // Notifications are dispatched fire-and-forget through the Edge Function;
    // resolve so the un-awaited promise never rejects mid-test.
    functions: {
      invoke: (...args: unknown[]) => {
        mockInvoke(...args);
        return Promise.resolve({ error: null });
      },
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
    // Table reads (fetchMyReportPhotos): from → select → in → order, which
    // resolves to whatever mockTableRead returns, with the chain recorded.
    from: (table: string) => {
      const chain = {
        select: (columns: string) => {
          mockTableCall('select', table, columns);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          mockTableCall('in', column, values);
          return chain;
        },
        order: (column: string) => {
          mockTableCall('order', column);
          return Promise.resolve(mockTableRead());
        },
      };
      return chain;
    },
    auth: { getUser: () => mockGetUser() },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args),
      }),
    },
  },
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => ({ uri: 'file:///resized.jpg' }),
      }),
    }),
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const located = {
  uri: 'file:///a.jpg',
  capturedAt: '2026-07-14T12:00:00Z',
  lat: 51.54,
  lng: -0.14,
  accuracyM: 12,
  source: 'live',
} as const satisfies EvidencePhoto;
const unlocated = {
  uri: 'file:///b.jpg',
  capturedAt: '2026-07-14T12:01:00Z',
  source: 'live',
} as const satisfies EvidencePhoto;

beforeEach(() => {
  jest.clearAllMocks();
  // fetch() is used to read the resized JPEG bytes.
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) }) as never;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mockUpload.mockResolvedValue({ error: null });
});

describe('buildCreateSightingParams (evidence atomicity)', () => {
  it('maps a located photo with ITS fix and an un-located one with nulls', () => {
    const params = buildCreateSightingParams(
      POST_ID,
      {
        photos: [located, unlocated],
        contextFlags: ['parked'],
        note: ' saw it ',
        areaLabel: 'Camden',
        confirmedFeatureIds: [],
      },
      ['p/1.jpg', 'p/2.jpg'],
    );
    expect(params.p_photos[0]).toEqual({
      path: 'p/1.jpg',
      lat: 51.54,
      lng: -0.14,
      accuracy_m: 12,
      captured_at: '2026-07-14T12:00:00Z',
      source: 'live',
    });
    // SAFETY: the second photo must NOT borrow the first photo's location.
    expect(params.p_photos[1]).toEqual({
      path: 'p/2.jpg',
      lat: null,
      lng: null,
      accuracy_m: null,
      captured_at: '2026-07-14T12:01:00Z',
      source: 'live',
    });
    expect(params.p_note).toBe('saw it');
  });

  it('maps the optional context fields, and their absence, onto the RPC params', () => {
    const answered = buildCreateSightingParams(
      POST_ID,
      {
        photos: [located],
        contextFlags: ['driving', 'damage_visible'],
        note: '',
        parkedLikelihood: undefined,
        direction: 'NE',
        peoplePresence: 'in_vehicle',
        confirmedFeatureIds: ['dddddddd-0000-0000-0000-000000000001'],
      },
      ['p/1.jpg'],
    );
    expect(answered.p_direction).toBe('NE');
    expect(answered.p_people_presence).toBe('in_vehicle');
    expect(answered.p_confirmed_feature_ids).toEqual(['dddddddd-0000-0000-0000-000000000001']);

    // A skipped context step is a VALID report: everything null, never ''/[].
    const skipped = buildCreateSightingParams(
      POST_ID,
      { photos: [located], contextFlags: [], note: '', confirmedFeatureIds: [] },
      ['p/1.jpg'],
    );
    expect(skipped.p_parked_likelihood).toBeNull();
    expect(skipped.p_direction).toBeNull();
    expect(skipped.p_people_presence).toBeNull();
    expect(skipped.p_confirmed_feature_ids).toBeNull();
  });

  it('never sends the UI-only "Not sure" marks (contextUnsure)', () => {
    // The wizard bag carries contextUnsure for the chips' selected look; it
    // is not a fact and has no RPC param. Explicit mapping keeps it out.
    const answers = {
      photos: [located],
      contextFlags: [],
      note: '',
      confirmedFeatureIds: [],
      contextUnsure: ['state', 'people'],
    } as unknown as Parameters<typeof buildCreateSightingParams>[1];
    const params = buildCreateSightingParams(POST_ID, answers, ['p/1.jpg']);
    expect(JSON.stringify(params)).not.toMatch(/unsure/i);
  });

  it('never sends the read-only seeds (the car and the offered marks)', () => {
    // They come FROM the post, to show the spotter; the server already has
    // them. Echoing them back would be noise at best, a forgery vector at worst.
    const answers = {
      photos: [located],
      contextFlags: [],
      note: '',
      confirmedFeatureIds: [],
      reportedCar: {
        make: 'BMW',
        model: '3 Series',
        colour: 'Blue',
        plate: 'AB12 CDE',
        photoUrl: 'https://example.test/listing-hero.jpg',
      },
      confirmableFeatures: [{ id: 'm1', description: 'Bee sticker' }],
    } as unknown as Parameters<typeof buildCreateSightingParams>[1];
    const params = buildCreateSightingParams(POST_ID, answers, ['p/1.jpg']);
    expect(JSON.stringify(params)).not.toMatch(
      /BMW|AB12|Bee sticker|listing-hero|reportedCar|confirmable/,
    );
  });
});

describe('submitSighting', () => {
  it('rejects zero photos and more than three without calling the network', async () => {
    await expect(submitSighting(POST_ID, { photos: [], note: '' })).rejects.toThrow(
      SightingSubmissionError,
    );
    await expect(
      submitSighting(POST_ID, { photos: [located, located, located, located], note: '' }),
    ).rejects.toThrow(SightingSubmissionError);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a photo with lat but no lng (a broken evidence bundle)', async () => {
    const broken = { ...unlocated, lat: 51.5 } as EvidencePhoto;
    await expect(submitSighting(POST_ID, { photos: [broken], note: '' })).rejects.toThrow(
      SightingSubmissionError,
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('translates RATE_LIMITED and OWN_POST into their calm copy', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RATE_LIMITED', code: 'P0001' } });
    await expect(
      submitSighting(POST_ID, { photos: [located], note: '' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', message: expect.stringContaining('3 reports') });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'OWN_POST', code: 'P0001' } });
    await expect(
      submitSighting(POST_ID, { photos: [located], note: '' }),
    ).rejects.toMatchObject({ code: 'OWN_POST', message: expect.stringContaining('your own car') });
  });

  it('maps suffixed validation tokens (INVALID_PHOTOS: detail) by prefix', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_PHOTOS: expected 1..3 photos, got 0', code: 'P0001' },
    });
    await expect(
      submitSighting(POST_ID, { photos: [located], note: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_PHOTOS' });
  });

  it('submits happily: uploads then RPC, returning the sighting id', async () => {
    mockRpc.mockResolvedValue({
      data: { sighting_id: 'bbbbbbbb-0000-0000-0000-000000000002' },
      error: null,
    });
    const result = await submitSighting(POST_ID, {
      photos: [located],
      contextFlags: ['driving'],
      note: '',
    });
    expect(result.sightingId).toBe('bbbbbbbb-0000-0000-0000-000000000002');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const rpcArgs = mockRpc.mock.calls[0];
    expect(rpcArgs[0]).toBe('create_sighting');
    // Paths are pinned under <postId>/<userId>/ so the RPC (and storage RLS)
    // can verify ownership of every object.
    expect(rpcArgs[1].p_photos[0].path).toMatch(new RegExp(`^${POST_ID}/user-1/`));
  });

  it('strips the wizard’s seeds and UI-only marks end to end', async () => {
    // Both layers at once: the schema strip AND the explicit mapping.
    mockRpc.mockResolvedValue({
      data: { sighting_id: 'bbbbbbbb-0000-0000-0000-000000000002' },
      error: null,
    });
    await submitSighting(POST_ID, {
      photos: [located],
      contextFlags: [],
      note: '',
      reportedCar: {
        make: 'BMW',
        model: '3 Series',
        colour: 'Blue',
        plate: 'AB12 CDE',
        photoUrl: 'https://example.test/listing-hero.jpg',
      },
      confirmableFeatures: [{ id: 'm1', description: 'Bee sticker' }],
      contextUnsure: ['state'],
    });
    const payload = JSON.stringify(mockRpc.mock.calls[0][1]);
    expect(payload).not.toMatch(
      /BMW|AB12|Bee sticker|listing-hero|reportedCar|confirmable|unsure/i,
    );
  });

  // Stub migration: the sightings feature's notify-owner-of-sighting push now
  // goes through the shared notifications door, not any sightings-local code.
  it('dispatches an owner notification carrying only the sighting id', async () => {
    const sightingId = 'bbbbbbbb-0000-0000-0000-000000000002';
    mockRpc.mockResolvedValue({ data: { sighting_id: sightingId }, error: null });

    await submitSighting(POST_ID, {
      photos: [located],
      note: 'silver car parked behind the pub',
    });

    expect(mockInvoke).toHaveBeenCalledWith('notify-sighting', { body: { sightingId } });
    // SAFETY: the note, the photos and the location stay out of it — the push
    // body is built server-side from make/colour only.
    const dispatched = JSON.stringify(mockInvoke.mock.calls);
    expect(dispatched).not.toContain('silver car parked behind the pub');
    expect(dispatched).not.toContain(String(located.lat));
  });

  it('still returns the sighting id when the notification dispatch fails', async () => {
    const sightingId = 'bbbbbbbb-0000-0000-0000-000000000002';
    mockRpc.mockResolvedValue({ data: { sighting_id: sightingId }, error: null });
    mockInvoke.mockImplementationOnce(() => {
      throw new Error('offline');
    });

    // The report has landed; a push that cannot be sent must not surface as a
    // failed submit to the spotter.
    await expect(
      submitSighting(POST_ID, { photos: [located], note: '' }),
    ).resolves.toMatchObject({ sightingId });
  });

  it('keeps a failed upload retryable with a user-facing message', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network' } });
    await expect(
      submitSighting(POST_ID, { photos: [located], note: '' }),
    ).rejects.toMatchObject({ code: 'PHOTO_UPLOAD' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('fetchSightingQuota', () => {
  it('parses the quota payload', async () => {
    mockRpc.mockResolvedValue({ data: { used: 2, max_per_day: 3 }, error: null });
    await expect(fetchSightingQuota(POST_ID)).resolves.toEqual({ used: 2, maxPerDay: 3 });
  });
});

describe('fetchPostSightings (PRIVACY strictness)', () => {
  const baseRow = {
    id: 'cccccccc-0000-0000-0000-000000000003',
    created_at: '2026-07-14T12:05:00Z',
    status: 'unverified',
    context_flags: ['parked'],
    note: null,
    area_label: 'Camden',
    location_unavailable: false,
    parked_likelihood: null,
    direction: null,
    people_presence: null,
    confirmed_features: [],
    photos: [
      { path: 'p/1.jpg', lat: 51.5, lng: -0.1, accuracy_m: 10, captured_at: '2026-07-14T12:00:00Z' },
    ],
    spotter: {
      first_name: 'Beth',
      sightings_reported: 4,
      sightings_helpful: 1,
      recoveries_credited: 0,
      member_since: '2026-01-01',
    },
  };

  it('parses the owner payload', async () => {
    mockRpc.mockResolvedValue({ data: [baseRow], error: null });
    const rows = await fetchPostSightings(POST_ID);
    expect(rows[0].spotter.firstName).toBe('Beth');
    expect(rows[0].contextFlags).toEqual(['parked']);
    // Old sightings: null context-v2 fields parse and render as absent.
    expect(rows[0].peoplePresence).toBeNull();
    expect(rows[0].confirmedFeatures).toEqual([]);
  });

  // 2026-10-08: the server has sent reviewed_at since 20260816130000; the
  // client used to drop it, so the owner never saw when they had decided.
  it('reads when the owner decided — and a payload without it still parses', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...baseRow, status: 'not_mine', reviewed_at: '2026-07-15T09:00:00Z' }, baseRow],
      error: null,
    });
    const rows = await fetchPostSightings(POST_ID);
    expect(rows[0].reviewedAt).toBe('2026-07-15T09:00:00Z');
    expect(rows[1].reviewedAt).toBeNull();
  });

  it('parses the context-v2 fields on a new sighting', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          ...baseRow,
          context_flags: ['being_loaded', 'looks_intact'],
          people_presence: 'nearby',
          confirmed_features: [
            { id: 'dddddddd-0000-0000-0000-000000000001', description: 'Cracked wing mirror' },
          ],
        },
      ],
      error: null,
    });
    const rows = await fetchPostSightings(POST_ID);
    expect(rows[0].peoplePresence).toBe('nearby');
    expect(rows[0].confirmedFeatures).toEqual([
      { id: 'dddddddd-0000-0000-0000-000000000001', description: 'Cracked wing mirror' },
    ]);
  });

  it('REJECTS a payload whose spotter block carries an extra field (e.g. spotter_id)', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...baseRow, spotter: { ...baseRow.spotter, spotter_id: 'leak-me' } }],
      error: null,
    });
    // A widened RPC must fail loudly, never silently reach the owner's UI.
    await expect(fetchPostSightings(POST_ID)).rejects.toThrow();
  });

  it('parses a not_mine verdict', async () => {
    // The owner's "that isn't my car" (20260814100000). Absent from the status
    // enum until 2026-08-22, so ONE rejected sighting would have failed the
    // parse for the owner's whole list.
    mockRpc.mockResolvedValue({ data: [{ ...baseRow, status: 'not_mine' }], error: null });
    const rows = await fetchPostSightings(POST_ID);
    expect(rows[0].status).toBe('not_mine');
  });
});

describe('markSightingHelpful', () => {
  const SIGHTING_ID = 'cccccccc-0000-0000-0000-000000000003';

  // ⚠️ THIS SUITE EXISTS BECAUSE THERE WAS NONE, and the gap was expensive.
  // mark_sighting_helpful grew `crossedThreshold` and `counted` in
  // 20260814140000 while the client parsed `.strict()` for two keys, so from
  // that migration until 2026-08-22 EVERY tap raised a ZodError — after the
  // server had already recorded the verdict and bumped the spotter's
  // reputation. The owner saw "we couldn't mark that sighting" for something
  // that had, in fact, worked. Nothing failed here, because nothing was here.
  it('parses the full four-key payload the RPC actually returns', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'helpful', changed: true, crossedThreshold: 5, counted: true },
      error: null,
    });

    await expect(markSightingHelpful(SIGHTING_ID)).resolves.toEqual({
      status: 'helpful',
      changed: true,
      crossedThreshold: 5,
      counted: true,
    });
  });

  it('carries counted:false through, without asking why', async () => {
    // Two causes produce it — the one-point-per-listing cap, and a collusion
    // flag — and the RPC returns the IDENTICAL shape for both on purpose. The
    // client must not try to tell them apart; naming the signal that caught
    // someone is a tutorial in evading it.
    mockRpc.mockResolvedValue({
      data: { status: 'helpful', changed: true, crossedThreshold: null, counted: false },
      error: null,
    });

    const result = await markSightingHelpful(SIGHTING_ID);
    expect(result.counted).toBe(false);
    expect(result.crossedThreshold).toBeNull();
  });

  it('tells the spotter — but only when the verdict actually changed', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'helpful', changed: true, crossedThreshold: 1, counted: true },
      error: null,
    });
    await markSightingHelpful(SIGHTING_ID);
    expect(mockInvoke).toHaveBeenCalledWith('notify-sighting-confirmed', {
      body: { sightingId: SIGHTING_ID },
    });

    // A re-mark is an idempotent no-op server-side and the claim RPC would
    // refuse it anyway (confirmed_notified_at is already stamped), so
    // dispatching would spend a round trip to be told no.
    mockInvoke.mockClear();
    mockRpc.mockResolvedValue({
      data: { status: 'helpful', changed: false, crossedThreshold: null, counted: true },
      error: null,
    });
    await markSightingHelpful(SIGHTING_ID);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('STILL tells the spotter when the point was withheld', async () => {
    // The sighting genuinely was confirmed. Staying silent on a capped or
    // collusion-flagged pair would leak that something about them had been
    // judged — the badge line simply does not appear, because the counter did
    // not move.
    mockInvoke.mockClear();
    mockRpc.mockResolvedValue({
      data: { status: 'helpful', changed: true, crossedThreshold: null, counted: false },
      error: null,
    });
    await markSightingHelpful(SIGHTING_ID);
    expect(mockInvoke).toHaveBeenCalledWith('notify-sighting-confirmed', {
      body: { sightingId: SIGHTING_ID },
    });
  });

  it('still fails loudly on a payload it does not recognise', async () => {
    // The strictness is the point and must survive: a FURTHER widened RPC
    // should break here, in one place, rather than reach the UI unvalidated.
    mockRpc.mockResolvedValue({
      data: { status: 'helpful', changed: true, crossedThreshold: null, counted: true, extra: 1 },
      error: null,
    });
    await expect(markSightingHelpful(SIGHTING_ID)).rejects.toThrow();
  });
});

describe('fetchMySightingRecord (PRIVACY strictness)', () => {
  const row = {
    id: 'cccccccc-0000-0000-0000-000000000003',
    created_at: '2026-07-14T12:05:00Z',
    status: 'unverified',
    reviewed_at: null,
    area_label: 'Camden',
    car: { make: 'Ford', colour: 'Blue' },
  };

  it('maps the spotter’s own record', async () => {
    mockRpc.mockResolvedValue({ data: { sightings: [row] }, error: null });

    const entries = await fetchMySightingRecord();

    expect(entries).toEqual([
      {
        id: row.id,
        createdAt: row.created_at,
        status: 'unverified',
        reviewedAt: null,
        // Absent from the fixture (an older server) collapses to null, exactly
        // as a CLOSED post does — the screen never has to tell them apart.
        postId: null,
        areaLabel: 'Camden',
        car: { make: 'Ford', colour: 'Blue' },
      },
    ]);
  });

  // ⚠️ Review finding #16, the API half. The `active`-only rule lives in the
  // RPC; what this pins is that the client passes the id through when given one
  // and collapses both "closed" and "old server" to null.
  it('carries the post id when the post is still live', async () => {
    mockRpc.mockResolvedValue({
      data: { sightings: [{ ...row, post_id: 'aaaaaaaa-0000-0000-0000-00000000000a' }] },
      error: null,
    });

    const [entry] = await fetchMySightingRecord();

    expect(entry.postId).toBe('aaaaaaaa-0000-0000-0000-00000000000a');
  });

  it('⚠️ collapses a closed post to null rather than a missing key', async () => {
    // The server sends explicit null for a closed listing. The screen decides
    // "no press target" from a single falsy check, so null and absent must not
    // behave differently.
    mockRpc.mockResolvedValue({
      data: { sightings: [{ ...row, post_id: null }] },
      error: null,
    });

    const [entry] = await fetchMySightingRecord();

    expect(entry.postId).toBeNull();
  });

  it('carries a not_mine verdict and when it was made', async () => {
    // This is the ONLY surface on which a rejection is visible, and only to the
    // spotter. It must parse, or their own history breaks on the one row they
    // most want an answer about.
    mockRpc.mockResolvedValue({
      data: {
        sightings: [{ ...row, status: 'not_mine', reviewed_at: '2026-07-15T09:00:00Z' }],
      },
      error: null,
    });

    const [entry] = await fetchMySightingRecord();
    expect(entry.status).toBe('not_mine');
    expect(entry.reviewedAt).toBe('2026-07-15T09:00:00Z');
  });

  it('REJECTS a payload carrying anything about the post beyond the car', async () => {
    // The guarantee this screen rests on. my_sighting_record hands a spotter
    // rows joined to SOMEBODY ELSE'S post, so a widened server payload — a post
    // id, a location, an owner's name — must fail loudly here rather than
    // quietly reach a page that was never reviewed for it.
    mockRpc.mockResolvedValue({
      data: { sightings: [{ ...row, post_id: 'leak-me' }] },
      error: null,
    });
    await expect(fetchMySightingRecord()).rejects.toThrow();

    mockRpc.mockResolvedValue({
      data: { sightings: [{ ...row, car: { ...row.car, plate: 'AB12CDE' } }] },
      error: null,
    });
    await expect(fetchMySightingRecord()).rejects.toThrow();
  });

  it('returns an empty list rather than throwing on a spotter with no reports', async () => {
    mockRpc.mockResolvedValue({ data: { sightings: [] }, error: null });
    await expect(fetchMySightingRecord()).resolves.toEqual([]);
  });
});

describe('markSightingNotMine', () => {
  const SIGHTING_ID = 'cccccccc-0000-0000-0000-000000000003';

  it('records the verdict', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'not_mine', changed: true }, error: null });

    await expect(markSightingNotMine(SIGHTING_ID)).resolves.toEqual({
      status: 'not_mine',
      changed: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('mark_sighting_not_mine', {
      p_sighting_id: SIGHTING_ID,
    });
  });

  it('is idempotent — a second tap changes nothing', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'not_mine', changed: false }, error: null });
    const result = await markSightingNotMine(SIGHTING_ID);
    expect(result.changed).toBe(false);
  });

  it('explains ALREADY_COUNTED rather than showing a generic failure', async () => {
    // helpful → not_mine is REFUSED, and the reason is structural: the
    // confirmation has already moved profiles.sightings_helpful and this schema
    // has no decrement anywhere. An owner who mis-tapped deserves to be told
    // that plainly, not handed "please try again" for something that will never
    // succeed.
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ALREADY_COUNTED', code: 'P0001' },
    });

    await expect(markSightingNotMine(SIGHTING_ID)).rejects.toMatchObject({
      code: 'ALREADY_COUNTED',
      message: expect.stringContaining('can’t be taken back'),
    });
  });

  it('does not leak an unknown server token into the UI', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'SOME_NEW_TOKEN', code: 'P0001' } });
    await expect(markSightingNotMine(SIGHTING_ID)).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringContaining('Please try again'),
    });
  });
});

describe('fetchMyReportPhotos — the spotter’s own lead photos (2026-10-09)', () => {
  const row = (
    sighting_id: string,
    path: string,
    source: 'live' | 'gallery',
    position: number,
  ) => ({ sighting_id, path, source, position });

  beforeEach(() => {
    mockTableCall.mockClear();
    mockTableRead.mockReset();
  });

  it('reads only these four columns of sighting_photos, for these reports', async () => {
    mockTableRead.mockReturnValue({ data: [], error: null });
    await fetchMyReportPhotos(['s1', 's2']);
    expect(mockTableCall).toHaveBeenCalledWith(
      'select',
      'sighting_photos',
      'sighting_id, path, source, position',
    );
    expect(mockTableCall).toHaveBeenCalledWith('in', 'sighting_id', ['s1', 's2']);
  });

  it('⚠️ leads with the first in-app photo — a library photo only when there is none', async () => {
    mockTableRead.mockReturnValue({
      data: [
        row('s1', 'p/u/lib.jpg', 'gallery', 0),
        row('s1', 'p/u/live.jpg', 'live', 1),
        row('s1', 'p/u/live2.jpg', 'live', 2),
        row('s2', 'p/u/only-lib.jpg', 'gallery', 0),
      ],
      error: null,
    });
    await expect(fetchMyReportPhotos(['s1', 's2'])).resolves.toEqual({
      s1: 'p/u/live.jpg',
      s2: 'p/u/only-lib.jpg',
    });
  });

  it('asks nothing when there are no reports', async () => {
    await expect(fetchMyReportPhotos([])).resolves.toEqual({});
    expect(mockTableCall).not.toHaveBeenCalled();
  });

  it('⚠️ fails loudly on a wider row than it asked for', async () => {
    mockTableRead.mockReturnValue({
      data: [{ ...row('s1', 'p/u/a.jpg', 'live', 0), lat: 53.48 }],
      error: null,
    });
    await expect(fetchMyReportPhotos(['s1'])).rejects.toThrow();
  });

  it('throws on a read error (the hook keeps the tiles)', async () => {
    mockTableRead.mockReturnValue({ data: null, error: { message: 'permission denied' } });
    await expect(fetchMyReportPhotos(['s1'])).rejects.toThrow();
  });
});

describe('fetchMyReportPhotos — batching', () => {
  beforeEach(() => {
    mockTableCall.mockClear();
    mockTableRead.mockReset();
  });

  it('⚠️ reads a long history in batches of 100 — one `in (…)` would outgrow the URL', async () => {
    mockTableRead.mockReturnValue({ data: [], error: null });
    const ids = Array.from({ length: 250 }, (_, i) => `s${i}`);
    await fetchMyReportPhotos(ids);
    const inCalls = mockTableCall.mock.calls.filter(([kind]) => kind === 'in');
    expect(inCalls.map(([, , values]) => (values as string[]).length)).toEqual([100, 100, 50]);
  });
});

describe('withdrawSighting — the reason, and telling the owner (2026-10-09)', () => {
  const ID = '4f3c2b1a-0000-4000-8000-000000000001';

  beforeEach(() => {
    mockRpc.mockReset();
    mockInvoke.mockClear();
  });

  it('sends the spotter’s answer with the withdrawal', async () => {
    mockRpc.mockResolvedValue({ data: { sighting_id: ID, withdrawn: true }, error: null });
    await withdrawSighting(ID, 'not_sure');
    expect(mockRpc).toHaveBeenCalledWith('withdraw_sighting', {
      p_sighting_id: ID,
      p_reason: 'not_sure',
    });
  });

  it('sends null when the question was skipped — it is optional', async () => {
    mockRpc.mockResolvedValue({ data: { sighting_id: ID, withdrawn: true }, error: null });
    await withdrawSighting(ID);
    expect(mockRpc).toHaveBeenCalledWith('withdraw_sighting', {
      p_sighting_id: ID,
      p_reason: null,
    });
  });

  it('⚠️ tells the owner once the server has taken it back — by sighting id only', async () => {
    mockRpc.mockResolvedValue({ data: { sighting_id: ID, withdrawn: true }, error: null });
    await withdrawSighting(ID, 'mistake');
    expect(mockInvoke).toHaveBeenCalledWith('notify-sighting-withdrawn', {
      body: { sightingId: ID },
    });
    // The reason never rides the dispatch: the claim reads it from the row.
    expect(JSON.stringify(mockInvoke.mock.calls)).not.toContain('mistake');
  });

  it('⚠️ tells nobody when the withdrawal was refused', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'SIGHTING_NOT_WITHDRAWABLE' },
    });
    await expect(withdrawSighting(ID, 'not_the_car')).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('withdrawSighting — the "Something else" note (2026-10-09)', () => {
  const ID = '4f3c2b1a-0000-4000-8000-000000000002';
  // Built from code points so this file holds no invisible characters.
  const RLO = String.fromCharCode(0x202e);
  const ZWSP = String.fromCharCode(0x200b);

  beforeEach(() => {
    mockRpc.mockReset();
    mockInvoke.mockClear();
    mockRpc.mockResolvedValue({ data: { sighting_id: ID, withdrawn: true }, error: null });
  });

  it('sends the note, trimmed, with "Something else"', async () => {
    await withdrawSighting(ID, 'other', `  Wrong street, sorry ${String.fromCharCode(10)}`);
    expect(mockRpc).toHaveBeenCalledWith('withdraw_sighting', {
      p_sighting_id: ID,
      p_reason: 'other',
      p_note: 'Wrong street, sorry',
    });
  });

  it('⚠️ never sends a note with any other answer', async () => {
    await withdrawSighting(ID, 'mistake', 'typed then switched');
    expect(mockRpc).toHaveBeenCalledWith('withdraw_sighting', {
      p_sighting_id: ID,
      p_reason: 'mistake',
    });
  });

  it('⚠️ leaves p_note out entirely when there is none — the call resolves on either server', async () => {
    await withdrawSighting(ID, 'other', '   ');
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_note');
  });

  it('strips the hidden characters the server refuses', async () => {
    await withdrawSighting(ID, 'other', `it was ok${ZWSP} ${RLO}fine`);
    expect(mockRpc.mock.calls[0][1].p_note).toBe('it was ok fine');
    // A note of nothing but hidden characters is no note.
    mockRpc.mockClear();
    await withdrawSighting(ID, 'other', `${ZWSP}${RLO}`);
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_note');
  });

  it('⚠️ logs whether there was a note — never its words', async () => {
    await withdrawSighting(ID, 'other', 'my secret words');
    const logged = JSON.stringify(getRecentLogs());
    expect(logged).not.toContain('my secret words');
    // The NEWEST such entry — earlier tests in this file logged their own.
    const entry = getRecentLogs().findLast((e) => e.message === 'sighting_withdrawn');
    expect(entry?.data).toMatchObject({ gaveNote: true });
    // …nor do the words ride the owner's dispatch.
    expect(JSON.stringify(mockInvoke.mock.calls)).not.toContain('my secret words');
  });
});

describe('fetchPostWithdrawals — the owner’s "Taken back" list (2026-10-09)', () => {
  const POST = 'a1a1a1a1-0000-4000-8000-000000000003';

  beforeEach(() => mockRpc.mockReset());

  it('reads the owner RPC and maps its three fields', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { withdrawn_at: '2026-10-09T10:00:00Z', reason: 'other', note: 'Wrong street' },
        { withdrawn_at: '2026-10-08T10:00:00Z', reason: null, note: null },
      ],
      error: null,
    });
    await expect(fetchPostWithdrawals(POST)).resolves.toEqual([
      { withdrawnAt: '2026-10-09T10:00:00Z', reason: 'other', note: 'Wrong street' },
      { withdrawnAt: '2026-10-08T10:00:00Z', reason: null, note: null },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('get_post_withdrawals', { p_post_id: POST });
  });

  it('⚠️ refuses a widened payload — no sighting id or spotter may reach the screen', async () => {
    mockRpc.mockResolvedValue({
      data: [{ withdrawn_at: '2026-10-09T10:00:00Z', reason: null, note: null, spotter_id: 'x' }],
      error: null,
    });
    await expect(fetchPostWithdrawals(POST)).rejects.toThrow();
  });

  it('refuses an answer outside the vocabulary', async () => {
    mockRpc.mockResolvedValue({
      data: [{ withdrawn_at: '2026-10-09T10:00:00Z', reason: 'he was rude', note: null }],
      error: null,
    });
    await expect(fetchPostWithdrawals(POST)).rejects.toThrow();
  });

  it('throws a calm error when the server refuses', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'NOT_OWNER' } });
    await expect(fetchPostWithdrawals(POST)).rejects.toThrow(
      'We couldn’t load what was taken back. Please try again.',
    );
  });
});

describe('fetchPostWithdrawals — the 200 is characters, as the server counts', () => {
  beforeEach(() => mockRpc.mockReset());

  it('⚠️ accepts 200 emoji — one stranger’s note must not blank the owner’s list', async () => {
    // 200 characters, 400 UTF-16 units: the server's char_length allows it.
    const car = String.fromCodePoint(0x1f697);
    mockRpc.mockResolvedValue({
      data: [{ withdrawn_at: '2026-10-09T10:00:00Z', reason: 'other', note: car.repeat(200) }],
      error: null,
    });
    await expect(fetchPostWithdrawals('p1')).resolves.toHaveLength(1);
  });

  it('refuses 201 characters — calmly, and without logging a word of it', async () => {
    const note = `REFUSEDNOTE${'a'.repeat(190)}`;
    mockRpc.mockResolvedValue({
      data: [{ withdrawn_at: '2026-10-09T10:00:00Z', reason: 'other', note }],
      error: null,
    });
    await expect(fetchPostWithdrawals('p1')).rejects.toThrow(
      'We couldn’t load what was taken back. Please try again.',
    );
    // The refusal is logged as counts and codes only — never the note.
    expect(JSON.stringify(getRecentLogs())).not.toContain('REFUSEDNOTE');
    expect(getRecentLogs().findLast((e) => e.message === 'get_post_withdrawals payload refused'))
      .toBeTruthy();
  });
});
