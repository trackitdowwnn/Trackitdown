/**
 * WHAT:  The OCR boundary — one function that turns a local image URI into
 *        recognised text blocks, and nothing else.
 * WHY:   Two reasons this is a seam rather than a direct call.
 *
 *        TESTABILITY. Everything that decides what a plate IS lives in the pure
 *        modules next door (plate.ts, plateCandidates.ts) and is tested with
 *        synthetic blocks, with no native module and no device. This file is
 *        the only part that cannot be unit-tested, so it is kept as small as it
 *        can possibly be.
 *
 *        SWAPPABILITY, which is not theoretical here.
 *        `@react-native-ml-kit/text-recognition` declares no `codegenConfig`
 *        and was last published before RN 0.86, so under Expo 57's New
 *        Architecture it depends on the legacy interop layer. That is the
 *        common case and usually works, but it is UNVERIFIED until a real
 *        `eas build --profile development` runs it on a device. If it turns out
 *        not to work, only this file changes.
 *
 * SAFETY: this function sees every word in a user's photograph — street names,
 *         shop fronts, other people's registrations. It runs ON DEVICE: no
 *         image and no recognised text ever leaves the phone. It returns text
 *         to the caller and keeps nothing; callers must not persist or log it
 *         (plates are personal data — see redactPlate).
 * LINKS: src/shared/lib/plateCandidates.ts (the only consumer of the output);
 *        src/features/garage/components/PlateScanSheet.tsx;
 *        docs/SECURITY_AND_TRUST.md §3.
 */

import TextRecognition from '@react-native-ml-kit/text-recognition';

import type { TextBlock } from '../plateCandidates';
import { createLogger } from '../logger';

const log = createLogger('garage');

/** What the caller needs to know when recognition could not run at all. */
export type RecogniseResult =
  | { status: 'ok'; blocks: TextBlock[] }
  /** The recogniser failed or is unavailable — offer typing, never a dead end. */
  | { status: 'unavailable' };

/**
 * Recognise text in a local image.
 *
 * Never throws. A missing native module, an unreadable file or a recogniser
 * error all resolve to `unavailable`, because the only sensible response to any
 * of them is the same: let the person type their plate instead.
 */
export async function recogniseText(uri: string): Promise<RecogniseResult> {
  try {
    const result = await TextRecognition.recognize(uri);

    const blocks: TextBlock[] = (result?.blocks ?? []).flatMap((block) =>
      // Prefer LINES over blocks: a plate is one line, whereas a block can
      // merge the plate with a bumper sticker or the dealer's name and produce
      // a string that matches nothing.
      (block.lines ?? []).map((line) => ({
        text: line.text,
        box: line.frame
          ? {
              x: line.frame.left,
              y: line.frame.top,
              width: line.frame.width,
              height: line.frame.height,
            }
          : undefined,
      })),
    );

    // SAFETY: count only. The recognised text itself is personal data and is
    // never logged, not even redacted — redaction is for a KNOWN plate, and at
    // this point we do not yet know which of these strings is one.
    log.debug('plate_scan_recognised', { blocks: blocks.length });
    return { status: 'ok', blocks };
  } catch (error) {
    // Name only — an error message can echo a file path or recognised content.
    log.warn('plate_scan_unavailable', { error: (error as Error).name });
    return { status: 'unavailable' };
  }
}
