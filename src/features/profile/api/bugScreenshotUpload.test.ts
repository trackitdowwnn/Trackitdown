/**
 * WHAT:  Tests for uploadBugScreenshots — where the bytes go, what the request
 *        is allowed to ask for, and what never reaches the logs.
 * WHY:   ⚠️ THIS MODULE SHIPPED UNTESTED AND WAS BROKEN THE WHOLE TIME. It
 *        passed `upsert: true` against a bucket that ships an INSERT policy and
 *        deliberately NO UPDATE one, and Supabase needs both to satisfy an
 *        upsert — so every attempt to attach a screenshot to a bug report was
 *        refused by RLS, and the reporter was told "We couldn't send this.
 *        Please try again." forever. Nothing in the suite could see it, because
 *        every other bug-report test mocks this function away.
 *
 *        So the two properties pinned hardest here are the ones that were
 *        wrong: the request must not ask for a permission the bucket refuses,
 *        and a retry must not collide with the objects the last attempt wrote.
 * LINKS: ./bugScreenshotUpload.ts;
 *        supabase/migrations/20260824140000_bug_report_details.sql (the bucket,
 *          its INSERT-only policy, and the server-side path check).
 */

import { uploadBugScreenshots, BUG_SCREENSHOTS_BUCKET } from './bugScreenshotUpload';

const mockUpload = jest.fn();
const mockFrom = jest.fn((_bucket: string) => ({ upload: mockUpload }));
const mockToJpegBytes = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { storage: { from: (bucket: string) => mockFrom(bucket) } },
  toJpegBytes: (...args: unknown[]) => mockToJpegBytes(...args),
}));

const mockInfo = jest.fn();
const mockError = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockInfo(...args),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockError(...args),
    debug: jest.fn(),
  }),
}));

const PHOTO = { uri: 'file:///gallery/IMG_0042.png', width: 1170, height: 2532 };

beforeEach(() => {
  jest.clearAllMocks();
  mockToJpegBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockUpload.mockResolvedValue({ error: null });
});

describe('⚠️ what the request asks for', () => {
  it('does NOT ask to upsert, because the bucket refuses UPDATE by design', async () => {
    // THE BUG. `upsert: true` needs INSERT *and* UPDATE; this bucket ships
    // INSERT only, on purpose — a reporter must not be able to overwrite
    // evidence of a report they already filed. Asking anyway meant RLS refused
    // every screenshot upload this feature ever attempted.
    await uploadBugScreenshots('user-1', [PHOTO]);

    expect(mockFrom).toHaveBeenCalledWith(BUG_SCREENSHOTS_BUCKET);
    const [, , options] = mockUpload.mock.calls[0];
    expect(options).not.toHaveProperty('upsert');
    expect(options).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('writes under the caller’s own folder, which the server re-checks', async () => {
    // The storage policy accepts a write only under `<auth.uid()>/`, and
    // submit_bug_report rejects any path that does not start with it.
    const paths = await uploadBugScreenshots('user-1', [PHOTO]);

    expect(paths).toHaveLength(1);
    expect(paths[0].startsWith('user-1/')).toBe(true);
    expect(paths[0].endsWith('.jpg')).toBe(true);
    expect(mockUpload.mock.calls[0][0]).toBe(paths[0]);
  });

  it('⚠️ a retry does not collide with the objects the last attempt wrote', async () => {
    // The other half of dropping upsert. The path is derived from the source
    // uri, so without a per-attempt tag a second attempt rebuilds the identical
    // path and is refused as a duplicate — a report that failed once could then
    // never be sent at all.
    const first = await uploadBugScreenshots('user-1', [PHOTO]);
    // Same user, same picture, same index — only the attempt differs.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    const second = await uploadBugScreenshots('user-1', [PHOTO]);

    expect(second[0]).not.toBe(first[0]);
    jest.restoreAllMocks();
  });

  it('gives each photo in one attempt a distinct path', async () => {
    const paths = await uploadBugScreenshots('user-1', [PHOTO, PHOTO, PHOTO]);

    expect(new Set(paths).size).toBe(3);
  });
});

describe('the re-encode', () => {
  it('⚠️ every image goes through toJpegBytes — that IS the EXIF strip', async () => {
    // `exif: false` on the picker governs what we are HANDED, not what the file
    // on disk carries. A photograph taken at home carries that home's GPS.
    await uploadBugScreenshots('user-1', [PHOTO, PHOTO]);

    expect(mockToJpegBytes).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });

  it('uploads nothing at all when there are no screenshots', async () => {
    await expect(uploadBugScreenshots('user-1', [])).resolves.toEqual([]);
    expect(mockToJpegBytes).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('⚠️ when an upload fails', () => {
  it('throws so the caller treats the report as unsent', async () => {
    mockUpload.mockResolvedValue({ error: new Error('row-level security') });

    await expect(uploadBugScreenshots('user-1', [PHOTO])).rejects.toThrow('row-level security');
  });

  it('logs the COUNT only — never the path, the uri, or the storage error', async () => {
    // The path contains the user id, the source uri on Android can be a
    // content:// pointing into their gallery, and the storage error text is
    // server output.
    mockUpload.mockResolvedValue({
      error: new Error('new row violates row-level security policy for table "objects"'),
    });

    await expect(uploadBugScreenshots('user-1', [PHOTO])).rejects.toThrow();

    expect(mockError).toHaveBeenCalledWith('bug_screenshot_upload_failed', { index: 0, of: 1 });
    const logged = JSON.stringify(mockError.mock.calls);
    expect(logged).not.toContain('user-1');
    expect(logged).not.toContain('IMG_0042');
    expect(logged).not.toContain('row-level security');
  });

  it('stops at the first failure rather than uploading the rest', async () => {
    mockUpload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error('nope') });

    await expect(uploadBugScreenshots('user-1', [PHOTO, PHOTO, PHOTO])).rejects.toThrow();
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });
});
