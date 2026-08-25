/**
 * WHAT:  uploadBugScreenshots — re-encodes each picked image and uploads it to
 *        `bug-screenshots/<userId>/<hash>.jpg`, returning the object PATHS.
 * WHY:   A screenshot is the most useful thing a bug report can carry and the
 *        most dangerous. This module is where that tension is resolved, so the
 *        rules are stated here rather than assumed:
 *
 *        ⚠️ PATHS, NEVER URLS. `uploadOwnFolderPhoto` returns a public URL
 *        because post photos are served publicly; these are not, and there is
 *        no URL to return. Handing a URL back would imply something fetchable
 *        and invite a client read path that the bucket deliberately does not
 *        have — no client role holds SELECT on it. The operator signs a URL
 *        with the service role when they read the queue.
 *
 *        ⚠️ THE RE-ENCODE IS THE EXIF STRIP, AND IT IS NOT OPTIONAL. The picker
 *        is set to `exif: false`, but that governs what the picker HANDS US,
 *        not what the file on disk contains — the bytes still carry their
 *        original tags. A user attaching a bug report will sometimes pick a
 *        photograph rather than a screenshot, and a photograph taken at home
 *        carries the GPS of that home. Re-encoding through ImageManipulator
 *        produces a fresh JPEG with no tags at all.
 *
 *        ⚠️ WHAT IS INSIDE THE PICTURE IS NOT SOLVED HERE, AND CANNOT BE. No
 *        redaction helper in this codebase can reach inside a PNG: an owner's
 *        sighting-detail screen shows the exact point SECURITY_AND_TRUST §2
 *        spends forty lines coarsening for everyone else, and a screenshot of
 *        it is that point in plain sight. The controls are that the user CHOSE
 *        the image, SAW it, was warned in as many words that a screenshot can
 *        show an address or a plate, and can remove it before sending. That is
 *        the whole of the mitigation. Do not add an automatic capture path.
 *
 *        Quality is deliberately higher than the post-photo path (2000px /
 *        0.9 against 1600 / 0.8): a screenshot's payload is usually small text
 *        — an error message, a wrong number — and compressing it to the point
 *        of illegibility would defeat the attachment.
 * LINKS: src/shared/api/photoUpload.ts (the shared re-encode);
 *        supabase/migrations/20260824140000_bug_report_details.sql (the private
 *          bucket, its own-folder policy, and the server-side path check);
 *        ./bugReportApi.ts (the only caller).
 */

import { supabase, toJpegBytes } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PickedPhoto } from '@/shared/ui';

const log = createLogger('profile');

/** The PRIVATE bucket. No client role holds SELECT on it. */
export const BUG_SCREENSHOTS_BUCKET = 'bug-screenshots';

/** Matches the column's cap. Three is enough to show a before, during, after. */
export const MAX_BUG_SCREENSHOTS = 3;

/** Long edge in px — generous, because the payload is usually small text. */
const SCREENSHOT_MAX_EDGE = 2000;
const SCREENSHOT_COMPRESS = 0.9;

/** Stable, non-cryptographic hash (djb2) → base36, so a retry overwrites
 *  rather than orphaning a second copy of the same image. */
function stableHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Upload each screenshot to the caller's own folder in the private bucket.
 *
 * Requires a signed-in caller: `userId` must be the caller's own `auth.uid()`,
 * because the storage policy accepts a write only under that folder and
 * `submit_bug_report` re-checks every path it is given.
 *
 * @throws the Supabase storage error if any upload fails. Callers should treat
 *   a failure as "the report was not sent" and keep the user's text — a partial
 *   upload leaves orphaned objects, which is a tidiness problem, not a
 *   correctness one, and is far better than discarding what they wrote.
 */
export async function uploadBugScreenshots(
  userId: string,
  photos: PickedPhoto[],
): Promise<string[]> {
  if (photos.length === 0) return [];

  const paths: string[] = [];
  for (const [index, photo] of photos.entries()) {
    const body = await toJpegBytes(photo, SCREENSHOT_MAX_EDGE, SCREENSHOT_COMPRESS);
    const path = `${userId}/${stableHash(photo.uri)}-${index}.jpg`;
    const { error } = await supabase.storage
      .from(BUG_SCREENSHOTS_BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      // The COUNT only. Never the path (it contains the user id), never the
      // source uri (on Android that can be a content:// pointing into their
      // gallery), and never the storage error text.
      log.error('bug_screenshot_upload_failed', { index, of: photos.length });
      throw error;
    }
    paths.push(path);
  }

  log.info('bug_screenshots_uploaded', { count: paths.length });
  return paths;
}
