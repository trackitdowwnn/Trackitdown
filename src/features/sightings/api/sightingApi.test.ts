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
  submitSighting,
  SightingSubmissionError,
} from './sightingApi';

const mockRpc = jest.fn();
const mockGetUser = jest.fn();
const mockUpload = jest.fn();
const mockCreateSignedUrls = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
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

const located: EvidencePhoto = {
  uri: 'file:///a.jpg',
  capturedAt: '2026-07-14T12:00:00Z',
  lat: 51.54,
  lng: -0.14,
  accuracyM: 12,
};
const unlocated: EvidencePhoto = {
  uri: 'file:///b.jpg',
  capturedAt: '2026-07-14T12:01:00Z',
};

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
      { photos: [located, unlocated], contextFlags: ['parked'], note: ' saw it ', areaLabel: 'Camden' },
      ['p/1.jpg', 'p/2.jpg'],
    );
    expect(params.p_photos[0]).toEqual({
      path: 'p/1.jpg',
      lat: 51.54,
      lng: -0.14,
      accuracy_m: 12,
      captured_at: '2026-07-14T12:00:00Z',
    });
    // SAFETY: the second photo must NOT borrow the first photo's location.
    expect(params.p_photos[1]).toEqual({
      path: 'p/2.jpg',
      lat: null,
      lng: null,
      accuracy_m: null,
      captured_at: '2026-07-14T12:01:00Z',
    });
    expect(params.p_note).toBe('saw it');
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
  });

  it('REJECTS a payload whose spotter block carries an extra field (e.g. spotter_id)', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...baseRow, spotter: { ...baseRow.spotter, spotter_id: 'leak-me' } }],
      error: null,
    });
    // A widened RPC must fail loudly, never silently reach the owner's UI.
    await expect(fetchPostSightings(POST_ID)).rejects.toThrow();
  });
});
