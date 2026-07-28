/**
 * WHAT:  Tests for the per-section save path — each save calls its own RPC with
 *        the right params (bounty carries ONLY the amount), photo sections keep
 *        already-uploaded remote URLs and upload only new local files, and a
 *        raised code (POST_NOT_EDITABLE) maps to a user-facing PostSubmissionError.
 * WHY:   Per-section saves are the money surface for editing; sending the wrong
 *        field or re-uploading kept photos would be a real defect, and the
 *        draft-only/safe status gates rely on the client hitting the correct RPC.
 * LINKS: src/features/vehicles/post/api/editSectionApi.ts, docs/TESTING.md.
 */

import {
  saveBounty,
  saveCarDetails,
  saveDescription,
  saveDistinctiveFeatures,
  savePhotos,
  saveTheftContext,
} from './editSectionApi';

const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockGetUser = jest.fn();
jest.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, opts: unknown) => mockUpload(bucket, path, body, opts),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${bucket}/${path}` } }),
      }),
    },
  },
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file://processed.jpg' }) }),
    }),
  },
}));

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ error: null });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
});

describe('editSectionApi', () => {
  it('saveBounty calls update_post_bounty with ONLY the id + amount', async () => {
    await saveBounty('p1', 40000);
    expect(mockRpc).toHaveBeenCalledWith('update_post_bounty', {
      p_post_id: 'p1',
      p_bounty_amount_pence: 40000,
    });
  });

  it('saveCarDetails maps colourNote → owner_note (null when blank)', async () => {
    await saveCarDetails('p1', {
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      colourNote: '   ',
      year: 2019,
      bodyType: null,
    });
    expect(mockRpc).toHaveBeenCalledWith('update_post_car_details', {
      p_post_id: 'p1',
      p_make: 'BMW',
      p_model: '320d',
      p_colour: 'Blue',
      p_owner_note: null,
      p_year: 2019,
      p_body_type: null,
    });
  });

  it('saveTheftContext trims desc to null and passes enums through', async () => {
    await saveTheftContext('p1', { stolenFrom: 'driveway', keysTaken: null, descDrives: '  ' });
    expect(mockRpc).toHaveBeenCalledWith('update_post_theft_context', {
      p_post_id: 'p1',
      p_stolen_from: 'driveway',
      p_keys_taken: null,
      p_desc_drives: null,
    });
  });

  it('savePhotos keeps remote URLs and uploads only new local files', async () => {
    await savePhotos('p1', [
      { uri: 'https://cdn/post-photos/user-1/existing.jpg', width: 1600, height: 1200 },
      { uri: 'file://new.jpg', width: 4000, height: 3000 },
      { uri: 'https://cdn/post-photos/user-1/kept.jpg', width: 1600, height: 1200 },
    ]);
    expect(mockUpload).toHaveBeenCalledTimes(1); // only the one local file
    const params = mockRpc.mock.calls[0][1];
    expect(mockRpc.mock.calls[0][0]).toBe('update_post_photos');
    expect(params.p_photo_urls[0]).toBe('https://cdn/post-photos/user-1/existing.jpg');
    expect(params.p_photo_urls[2]).toBe('https://cdn/post-photos/user-1/kept.jpg');
    expect(params.p_photo_urls[1]).toMatch(/^https:\/\/cdn\/post-photos\//);
  });

  it('saveDistinctiveFeatures keeps remote mark photos, uploads new ones, builds rows', async () => {
    await saveDistinctiveFeatures('p1', [
      {
        photo: { uri: 'https://cdn/post-photos/user-1/mark-0.jpg', width: 1600, height: 1200 },
        description: '  Cracked mirror  ',
      },
      { photo: { uri: 'file://new-mark.jpg', width: 100, height: 100 }, description: 'Scratch' },
    ]);
    expect(mockUpload).toHaveBeenCalledTimes(1); // only the new local mark
    const rows = mockRpc.mock.calls[0][1].p_distinctive_features;
    expect(rows[0]).toEqual({
      photo_url: 'https://cdn/post-photos/user-1/mark-0.jpg',
      description: 'Cracked mirror',
    });
    expect(rows[1].photo_url).toMatch(/^https:\/\/cdn\/post-photos\//);
  });

  it('saveDescription calls update_post_description, trimming an empty note to null', async () => {
    await saveDescription('p1', '   ');
    expect(mockRpc).toHaveBeenCalledWith('update_post_description', {
      p_post_id: 'p1',
      p_desc_recognise: null,
    });
    await saveDescription('p1', 'A dent on the rear door.');
    expect(mockRpc).toHaveBeenLastCalledWith('update_post_description', {
      p_post_id: 'p1',
      p_desc_recognise: 'A dent on the rear door.',
    });
  });

  it('translates POST_NOT_EDITABLE into a PostSubmissionError', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'POST_NOT_EDITABLE', code: 'P0001' } });
    await expect(saveBounty('p1', 40000)).rejects.toMatchObject({ code: 'POST_NOT_EDITABLE' });
  });
});
