/**
 * WHAT:  Tests for the sightings API layer — the evidence-atomicity mapping
 *        (a photo without its own fix submits un-located, never borrowing),
 *        min/max photo enforcement, RPC error-token translation (rate limit,
 *        own post), the quota read, and the owner-payload PRIVACY strictness
 *        (an extra spotter field — e.g. a leaked spotter_id — fails loudly).
 * WHY:   SAFETY/MONEY-adjacent: fabricated evidence and spotter exposure are
 *        the two ways this feature could hurt someone; both boundaries live
 *        in this file's schemas and are pinned here.
 * LINKS: src/features/sightings/api/sightingApi.ts, docs/TESTING.md,
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import type { EvidencePhoto } from '@/shared/ui';

import {
  buildCreateSightingParams,
  fetchPostSightings,
  fetchSightingQuota,
  markSightingHelpful,
  markSightingNotMine,
  submitSighting,
  SightingSubmissionError,
} from './sightingApi';

const mockRpc = jest.fn();
const mockGetUser = jest.fn();
const mockUpload = jest.fn();
const mockCreateSignedUrls = jest.fn();
const mockInvoke = jest.fn();

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
