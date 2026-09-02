/**
 * WHAT:  A repo-wide guard: every file that uploads an image to Supabase
 *        Storage must also re-encode it first. Scans the source tree rather
 *        than testing one function.
 * WHY:   ⚠️ THE RE-ENCODE IS THE ONLY EXIF STRIP THIS APP HAS, AND NOTHING
 *        ENFORCES IT. `post-photos` is a PUBLIC bucket and
 *        `post_photos_insert_own_folder` lets any signed-in user write to
 *        their own folder — so the strip is a convention in application code,
 *        not a boundary the server keeps (SECURITY_AND_TRUST §3, corrected
 *        2026-09-01 after that file claimed for months that stripping happened
 *        server-side).
 *
 *        The realistic failure is NOT an attack. A deliberate bypass can only
 *        expose the uploader's own metadata — the storage policy confines
 *        writes to your own folder, so bypasser and victim are the same
 *        account. What will actually happen is ACCIDENTAL: this repo already
 *        has FOUR upload paths, each having independently arrived at the same
 *        re-encode, and a fifth one calling `supabase.storage.from(...)
 *        .upload()` directly would skip it in silence. A photograph taken at
 *        home carries the GPS of that home, and post-photos is world-readable.
 *
 *        So this test does the one thing a comment cannot: makes the fifth
 *        uploader fail the build.
 *
 * ⚠️ IT PROVES A CALL IS PRESENT, NOT THAT IT IS CORRECT. A file that imports
 *        `toJpegBytes` and never calls it would pass here. That is the accepted
 *        limit of a source scan, and it is still worth having — the failure
 *        being guarded against is a whole upload path written without the
 *        strip in mind, which this catches, rather than a subtly broken one.
 *
 *        The real fix is server-side: re-encoding after upload via a storage
 *        webhook, or a private bucket served through signed transform URLs.
 *        Until one of those exists this is the enforcement.
 * LINKS: src/shared/api/photoUpload.ts (toJpegBytes — the shared strip);
 *        docs/SECURITY_AND_TRUST.md §3 (the open gap this narrows);
 *        supabase/migrations/20260713190000_post_a_car.sql (the public bucket
 *          and the own-folder write policy).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const SKIP_DIRS = new Set(['node_modules', '.expo', 'dist', 'build']);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) sourceFiles(full, found);
      continue;
    }
    if (!['.ts', '.tsx'].includes(extname(entry))) continue;
    // Tests may reference an upload without performing one.
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

/** A call that puts bytes into Supabase Storage. */
const UPLOADS = /\.upload\s*\(/;

/**
 * Evidence the file re-encodes: either it uses the shared helper, or it drives
 * ImageManipulator itself and saves as JPEG. Both are real strips — a fresh
 * JPEG carries none of the source's tags.
 */
const SHARED_HELPER = /\btoJpegBytes\b/;
const OWN_REENCODE = /ImageManipulator/;
const SAVES_JPEG = /SaveFormat\.JPEG/;

describe('⚠️ every image upload strips EXIF first', () => {
  const uploaders = sourceFiles(SRC).filter((file) =>
    UPLOADS.test(readFileSync(file, 'utf8')),
  );

  it('finds the upload paths at all, so this suite cannot pass by scanning nothing', () => {
    // The guard against the guard: if a refactor moved every upload behind a
    // wrapper this regex no longer matches, the loop below would iterate zero
    // files and report success while checking nothing.
    expect(uploaders.length).toBeGreaterThanOrEqual(4);
  });

  it('has no upload path that skips the re-encode', () => {
    const offenders = uploaders
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        const usesShared = SHARED_HELPER.test(text);
        const rollsOwn = OWN_REENCODE.test(text) && SAVES_JPEG.test(text);
        return !usesShared && !rollsOwn;
      })
      .map((f) => f.replace(process.cwd(), '').replace(/\\/g, '/'));

    // ⚠️ IF THIS FAILS, THE FIX IS IN THE OFFENDING FILE, NOT HERE. Call
    // `toJpegBytes` from '@/shared/api' before uploading. A photograph taken at
    // home carries the GPS of that home, post-photos is a PUBLIC bucket, and
    // nothing on the server strips it — the re-encode is the only control there
    // is. Widening this test to allow the new path would remove the control.
    expect(offenders).toEqual([]);
  });
});
