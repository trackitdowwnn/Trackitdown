/**
 * WHAT:  Tests for the post-a-car write path — the pure answers→RPC-args
 *        mapping, create_post error translation (raised code → user message),
 *        and the submit orchestrator: happy path (upload photos + V5C → RPC),
 *        a mid-submit photo-upload failure that stops before the RPC (so the
 *        wizard stays intact), and the incomplete-answers backstop.
 * WHY:   create_post is the money/safety write boundary; the mapping must not
 *        silently drop or mis-place a field, the error copy must be the plain
 *        strings the wizard shows, and a failed upload must NEVER create a
 *        half-post — losing a completed wizard to a blip is the failure this
 *        flow exists to avoid. MONEY: bounty range + SAFETY: private-bucket
 *        V5C path are asserted here.
 * LINKS: src/features/vehicles/post/api/postApi.ts, docs/TESTING.md.
 */

import {
  CREATE_POST_ERROR_MESSAGES,
  PostSubmissionError,
  buildCreatePostParams,
  createPost,
  submitPost,
  type SubmitReadyAnswers,
} from './postApi';

const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, opts: unknown) =>
          mockUpload(bucket, path, body, opts),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn/${bucket}/${path}` },
        }),
      }),
    },
  },
}));

// Image processing + the fetch that reads the processed file back as bytes.
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => ({ uri: 'file://processed.jpg' }),
      }),
    }),
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
});

function readyAnswers(overrides: Partial<SubmitReadyAnswers> = {}): SubmitReadyAnswers {
  return {
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colourNote: '',
    year: 2019,
    bodyType: 'Saloon',
    distinctiveFeatures: [],
    photos: [
      { uri: 'file://a.jpg', width: 4000, height: 3000 },
      { uri: 'file://b.jpg', width: 4000, height: 3000 },
      { uri: 'file://c.jpg', width: 4000, height: 3000 },
    ],
    lastSeenAt: '2026-07-10T18:00:00Z',
    location: { latitude: 53.48, longitude: -2.24, addressLabel: 'Manchester' },
    lastSeenArea: 'Manchester',
    stolenFrom: 'driveway',
    keysTaken: 'yes',
    descDrives: 'Slight rattle from the exhaust.',
    bountyAmountPence: 30000,
    verification: { uri: 'file://v5c.jpg', width: 2400, height: 1600 },
    ...overrides,
  };
}

describe('buildCreatePostParams', () => {
  it('maps answers + uploads onto the RPC args (lat/lng, features, V5C path)', () => {
    const params = buildCreatePostParams(readyAnswers(), {
      photoUrls: ['https://cdn/p/0', 'https://cdn/p/1', 'https://cdn/p/2'],
      verificationPath: 'user-1/v5c-abc.jpg',
    });

    expect(params).toMatchObject({
      // Plate capture deferred — always plate-less for now.
      p_plate: null,
      p_make: 'BMW',
      p_year: 2019,
      p_last_seen_lat: 53.48,
      p_last_seen_lng: -2.24,
      p_last_seen_area: 'Manchester',
      p_bounty_amount_pence: 30000,
      p_photo_urls: ['https://cdn/p/0', 'https://cdn/p/1', 'https://cdn/p/2'],
      p_verification_path: 'user-1/v5c-abc.jpg',
      // Legacy free-text columns + the removed chip taxonomy are all null now.
      p_distinguishing_features: null,
      p_owner_note: null,
      p_feature_keys: null,
    });
  });

  it('nulls the removed guided prompts and chip taxonomy', () => {
    const params = buildCreatePostParams(readyAnswers({ descDrives: '' }), {
      photoUrls: ['a', 'b', 'c'],
      verificationPath: null,
    });

    expect(params.p_desc_recognise).toBeNull(); // free-text prompt removed — always null
    expect(params.p_desc_drives).toBeNull();
    expect(params.p_feature_keys).toBeNull(); // chip taxonomy step removed — always null
    expect(params.p_verification_path).toBeNull();
  });

  it('zips distinctive-feature descriptions with their uploaded photo URLs, in order', () => {
    const marks = [
      { photo: { uri: 'file://m0.jpg', width: 100, height: 100 }, description: '  Cracked wing mirror  ' },
      { photo: { uri: 'file://m1.jpg', width: 100, height: 100 }, description: 'Rear window sticker' },
    ];
    const params = buildCreatePostParams(readyAnswers({ distinctiveFeatures: marks }), {
      photoUrls: ['a', 'b', 'c'],
      verificationPath: null,
      distinctiveFeatureUrls: ['https://cdn/mark/0', 'https://cdn/mark/1'],
    });

    expect(params.p_distinctive_features).toEqual([
      { photo_url: 'https://cdn/mark/0', description: 'Cracked wing mirror' },
      { photo_url: 'https://cdn/mark/1', description: 'Rear window sticker' },
    ]);
  });

  it('sends an empty distinctive-features array when none were added', () => {
    const params = buildCreatePostParams(readyAnswers(), {
      photoUrls: ['a', 'b', 'c'],
      verificationPath: null,
    });
    expect(params.p_distinctive_features).toEqual([]);
  });

  it('carries the colour note into owner_note (trimmed), null when blank', () => {
    const uploads = { photoUrls: ['a', 'b', 'c'], verificationPath: null };
    expect(
      buildCreatePostParams(
        readyAnswers({ colour: 'Multicolour / wrapped', colourNote: '  matte black wrap  ' }),
        uploads,
      ).p_owner_note,
    ).toBe('matte black wrap');
    // A plain colour leaves no note → owner_note stays null.
    expect(buildCreatePostParams(readyAnswers({ colourNote: '   ' }), uploads).p_owner_note).toBeNull();
  });

});

describe('createPost', () => {
  it('returns the draft id on success', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: '11111111-1111-1111-1111-111111111111', status: 'draft' },
      error: null,
    });

    const result = await createPost(
      buildCreatePostParams(readyAnswers(), { photoUrls: ['a', 'b', 'c'], verificationPath: null }),
    );

    expect(result).toEqual({ postId: '11111111-1111-1111-1111-111111111111', status: 'draft' });
  });

  it('translates a raised code into the user-facing message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PLATE_IN_USE', code: 'P0001' } });

    await expect(
      createPost(
        buildCreatePostParams(readyAnswers(), { photoUrls: ['a', 'b', 'c'], verificationPath: null }),
      ),
    ).rejects.toMatchObject({
      code: 'PLATE_IN_USE',
      message: CREATE_POST_ERROR_MESSAGES.PLATE_IN_USE,
    });
  });

  it('falls back to a generic message for an unmapped error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'weird db error', code: 'XX000' } });

    await expect(
      createPost(
        buildCreatePostParams(readyAnswers(), { photoUrls: ['a', 'b', 'c'], verificationPath: null }),
      ),
    ).rejects.toBeInstanceOf(PostSubmissionError);
  });
});

describe('submitPost', () => {
  it('uploads photos + V5C then creates the draft, clearing each tile on success', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: '22222222-2222-2222-2222-222222222222', status: 'draft' },
      error: null,
    });
    const onPhotoStatus = jest.fn();

    const result = await submitPost(readyAnswers(), { onPhotoStatus });

    expect(result.postId).toBe('22222222-2222-2222-2222-222222222222');
    // 3 hero photos to the public bucket + 1 V5C to the private bucket.
    const buckets = mockUpload.mock.calls.map((call) => call[0]);
    expect(buckets.filter((b) => b === 'post-photos')).toHaveLength(3);
    expect(buckets.filter((b) => b === 'verification-documents')).toHaveLength(1);
    // SAFETY: the V5C uploads under the user's own folder in the private bucket.
    const v5cCall = mockUpload.mock.calls.find((call) => call[0] === 'verification-documents');
    expect(v5cCall?.[1]).toMatch(/^user-1\/v5c-/);
    // Each photo tile shows uploading, then clears (null) once done.
    expect(onPhotoStatus).toHaveBeenCalledWith('file://a.jpg', { kind: 'uploading' });
    expect(onPhotoStatus).toHaveBeenCalledWith('file://a.jpg', null);
  });

  it('accepts a submit where untouched optional fields are undefined', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: '33333333-3333-3333-3333-333333333333', status: 'draft' },
      error: null,
    });
    // Only the genuinely-required answers — no year/bodyType/features/guided
    // prompts/theft-context/V5C, exactly as the controller leaves untouched steps.
    const minimal = {
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      photos: readyAnswers().photos,
      lastSeenAt: '2026-07-10T18:00:00Z',
      location: { latitude: 53.48, longitude: -2.24, addressLabel: 'Manchester' },
      bountyAmountPence: 30000,
    };

    const result = await submitPost(minimal);

    expect(result.status).toBe('draft');
    // The RPC got nulls for the untouched fields — not an INCOMPLETE rejection.
    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_year).toBeNull();
    expect(params.p_feature_keys).toBeNull();
    expect(params.p_verification_path).toBeNull();
  });

  it('always creates a plate-less post (p_plate null — plate capture deferred)', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: '44444444-4444-4444-4444-444444444444', status: 'draft' },
      error: null,
    });

    const result = await submitPost(readyAnswers());

    expect(result.status).toBe('draft');
    expect((mockRpc.mock.calls[0][1] as Record<string, unknown>).p_plate).toBeNull();
  });

  it('stops before the RPC and flags the tile when a photo upload fails', async () => {
    mockUpload.mockResolvedValueOnce({ error: null }); // photo 0 ok
    mockUpload.mockResolvedValueOnce({ error: { message: 'network' } }); // photo 1 fails
    const onPhotoStatus = jest.fn();

    await expect(submitPost(readyAnswers(), { onPhotoStatus })).rejects.toMatchObject({
      code: 'PHOTO_UPLOAD',
    });

    // The draft is NEVER created when an upload fails — no half-post.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(onPhotoStatus).toHaveBeenCalledWith('file://b.jpg', { kind: 'error' });
  });

  it('rejects incomplete answers before touching storage or the RPC', async () => {
    await expect(submitPost({ make: 'BMW' })).rejects.toMatchObject({ code: 'INCOMPLETE' });

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('uploads distinctive-feature photos (mark- namespace) and zips them into the RPC, in order', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: '55555555-5555-5555-5555-555555555555', status: 'draft' },
      error: null,
    });
    const marks = [
      { photo: { uri: 'file://m0.jpg', width: 100, height: 100 }, description: 'Cracked wing mirror' },
      { photo: { uri: 'file://m1.jpg', width: 100, height: 100 }, description: 'Rear window sticker' },
    ];

    await submitPost(readyAnswers({ distinctiveFeatures: marks }));

    // Two extra post-photos uploads, under the owner's folder in the mark- namespace.
    const markUploads = mockUpload.mock.calls.filter(
      (call) => call[0] === 'post-photos' && /^user-1\/mark-/.test(call[1] as string),
    );
    expect(markUploads).toHaveLength(2);
    // The RPC got the pairs in order, each description zipped to its public URL.
    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    const df = params.p_distinctive_features as { photo_url: string; description: string }[];
    expect(df.map((d) => d.description)).toEqual(['Cracked wing mirror', 'Rear window sticker']);
    expect(df.every((d) => /post-photos\/user-1\/mark-/.test(d.photo_url))).toBe(true);
  });

  it('stops before the RPC and flags the tile when a feature photo fails (answers kept for retry)', async () => {
    // 3 hero photos ok, then the first mark photo fails.
    mockUpload.mockResolvedValueOnce({ error: null });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockUpload.mockResolvedValueOnce({ error: { message: 'network' } });
    const onPhotoStatus = jest.fn();
    const marks = [
      { photo: { uri: 'file://m0.jpg', width: 100, height: 100 }, description: 'Cracked wing mirror' },
    ];

    await expect(
      submitPost(readyAnswers({ distinctiveFeatures: marks }), { onPhotoStatus }),
    ).rejects.toMatchObject({ code: 'FEATURE_PHOTO_UPLOAD' });

    // No draft created — the wizard keeps every answer (incl. the marks) for retry.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(onPhotoStatus).toHaveBeenCalledWith('file://m0.jpg', { kind: 'error' });
  });

  it('rejects when the caller is not signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(submitPost(readyAnswers())).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
