/**
 * WHAT:  Tests for the shared photo upload — the object PATH it builds, the
 *        re-encode that strips EXIF, and the remote/local discrimination.
 * WHY:   ⚠️ NO COVERAGE until 2026-09-02, on a file whose path construction is
 *        exactly what the storage RLS policy validates against. Two properties
 *        here are security controls rather than conveniences:
 *
 *        1. **The path starts with the caller's own user id.** The bucket's
 *           policies allow a write only inside `<uid>/…`, so a path built any
 *           other way is refused by the server — but it is refused with an RLS
 *           message, at upload time, on someone's slowest screen. Worse, a path
 *           that accidentally embedded ANOTHER user's id would be the one shape
 *           the policy exists to stop.
 *        2. **Every upload goes through the re-encode**, because the re-encode
 *           IS the EXIF strip. A source photo of a stolen car, taken outside the
 *           owner's house, carries GPS. `scripts/check-exif-strip.mjs` enforces
 *           that every `.upload(` site re-encodes; this pins the behaviour of
 *           the function they all route through.
 *
 *        Also pinned: `upsert: true`. Without it a retry of the same photo
 *        fails on a duplicate key instead of overwriting, which is a dead end
 *        on a flaky connection — and the deterministic hash exists precisely so
 *        the retry lands on the same object rather than orphaning one.
 * LINKS: ./photoUpload.ts; scripts/check-exif-strip.mjs;
 *        supabase/migrations/20260713190000_post_a_car.sql (the bucket policies);
 *        docs/SECURITY_AND_TRUST.md §3.
 */

import type { PickedPhoto } from '@/shared/ui';

import { isRemotePhoto, POST_PHOTOS_BUCKET, toJpegBytes, uploadOwnFolderPhoto } from './photoUpload';

const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
jest.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => mockUpload(bucket, ...args),
        getPublicUrl: (path: string) => mockGetPublicUrl(bucket, path),
      }),
    },
  },
}));

const mockResize = jest.fn();
const mockSaveAsync = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: (...args: unknown[]) => mockResize(...args),
      renderAsync: async () => ({
        saveAsync: (...args: unknown[]) => mockSaveAsync(...args),
      }),
    }),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const photo: PickedPhoto = { uri: 'file:///tmp/one.jpg', width: 4000, height: 3000 };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockGetPublicUrl
    .mockReset()
    .mockImplementation((_bucket: string, path: string) => ({
      data: { publicUrl: `https://cdn.test/${path}` },
    }));
  mockResize.mockReset();
  mockSaveAsync.mockReset().mockResolvedValue({ uri: 'file:///tmp/out.jpg' });
  globalThis.fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('uploadOwnFolderPhoto', () => {
  it('⚠️ writes inside the caller’s OWN folder', async () => {
    await uploadOwnFolderPhoto(USER, photo);

    const [bucket, path] = mockUpload.mock.calls[0] as [string, string];
    expect(bucket).toBe(POST_PHOTOS_BUCKET);
    // The storage policy allows a write only under `<uid>/`. Anything else is
    // refused server-side — and a path carrying someone ELSE'S id is the exact
    // shape that policy exists to stop.
    expect(path.startsWith(`${USER}/`)).toBe(true);
    expect(path).not.toContain(OTHER);
    expect(path.endsWith('.jpg')).toBe(true);
  });

  it('is deterministic for the same photo, so a retry overwrites', async () => {
    await uploadOwnFolderPhoto(USER, photo);
    await uploadOwnFolderPhoto(USER, photo);

    const first = (mockUpload.mock.calls[0] as [string, string])[1];
    const second = (mockUpload.mock.calls[1] as [string, string])[1];
    expect(second).toBe(first);

    // ⚠️ upsert, not insert. Without it the retry above fails on a duplicate
    // key — a dead end on exactly the flaky connection that caused the retry.
    const options = (mockUpload.mock.calls[0] as unknown[])[3] as { upsert: boolean };
    expect(options.upsert).toBe(true);
    expect(options).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('separates two photos of the same post by index', async () => {
    await uploadOwnFolderPhoto(USER, photo, 0);
    await uploadOwnFolderPhoto(USER, photo, 1);

    const first = (mockUpload.mock.calls[0] as [string, string])[1];
    const second = (mockUpload.mock.calls[1] as [string, string])[1];
    expect(second).not.toBe(first);
  });

  it('namespaces feature photos so they cannot collide with hero photos', async () => {
    await uploadOwnFolderPhoto(USER, photo, 0);
    await uploadOwnFolderPhoto(USER, photo, 0, 'mark-');

    const hero = (mockUpload.mock.calls[0] as [string, string])[1];
    const mark = (mockUpload.mock.calls[1] as [string, string])[1];
    expect(mark).toContain('/mark-');
    expect(mark).not.toBe(hero);
  });

  it('⚠️ re-encodes before uploading — the re-encode IS the EXIF strip', async () => {
    await uploadOwnFolderPhoto(USER, photo);

    // A stolen-car photo is often taken where the car was kept. If a source
    // GPS tag survived, the public bucket would publish the owner's address.
    expect(mockSaveAsync).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'jpeg' }),
    );
    // Ordering, not just occurrence: bytes uploaded before the re-encode would
    // be the ORIGINAL file. (invocationCallOrder rather than jest-extended's
    // toHaveBeenCalledBefore, which this repo does not install.)
    expect(mockSaveAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpload.mock.invocationCallOrder[0],
    );
  });

  it('returns the public URL of the object it wrote', async () => {
    const url = await uploadOwnFolderPhoto(USER, photo);
    const path = (mockUpload.mock.calls[0] as [string, string])[1];
    expect(url).toBe(`https://cdn.test/${path}`);
  });

  it('throws when the upload is refused rather than returning a dead URL', async () => {
    mockUpload.mockResolvedValue({ error: new Error('row-level security') });

    // A returned URL here would be stored on a post and 404 forever.
    await expect(uploadOwnFolderPhoto(USER, photo)).rejects.toThrow();
    expect(mockGetPublicUrl).not.toHaveBeenCalled();
  });
});

describe('toJpegBytes', () => {
  it('resizes a landscape photo by its long edge', async () => {
    await toJpegBytes({ uri: 'file:///a.jpg', width: 4000, height: 3000 }, 1600, 0.8);
    expect(mockResize).toHaveBeenCalledWith({ width: 1600 });
  });

  it('resizes a portrait photo by its long edge', async () => {
    await toJpegBytes({ uri: 'file:///a.jpg', width: 3000, height: 4000 }, 1600, 0.8);
    expect(mockResize).toHaveBeenCalledWith({ height: 1600 });
  });

  it('does not upscale a photo that is already small', async () => {
    await toJpegBytes({ uri: 'file:///a.jpg', width: 800, height: 600 }, 1600, 0.8);
    expect(mockResize).not.toHaveBeenCalled();
    // ⚠️ Still saved as JPEG. A small photo skips the RESIZE, never the
    // re-encode — skipping it would carry EXIF straight into a public bucket.
    expect(mockSaveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg' }));
  });
});

describe('isRemotePhoto', () => {
  it('keeps already-uploaded photos and re-uploads local ones', () => {
    expect(isRemotePhoto('https://cdn.test/a.jpg')).toBe(true);
    expect(isRemotePhoto('http://cdn.test/a.jpg')).toBe(true);
    expect(isRemotePhoto('file:///tmp/a.jpg')).toBe(false);
    expect(isRemotePhoto('ph://ABC-123')).toBe(false);
    // ⚠️ Anchored: a local path that merely CONTAINS a URL is not remote, and
    // treating it as one would store a file:// uri on a public post.
    expect(isRemotePhoto('file:///tmp/https://a.jpg')).toBe(false);
  });
});
