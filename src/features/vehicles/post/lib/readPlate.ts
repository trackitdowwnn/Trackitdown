/**
 * WHAT:  Reads the plate from ONE photo, plate scanning v2: a first read of the
 *        whole photo, then a second read of each plate-shaped line from a
 *        full-size crop. A plate counts only when both reads agree. Returns
 *        one plate, two (two cars equally in shot), none, or an error — with
 *        each plate's crop, so the owner can check it at a glance.
 * WHY:   docs/plate-scan-decisions.md, phase 4b. Measured on 80 labelled
 *        photos: 40% of plates found, 16% of suggestions wrong (the old scan:
 *        58% / 45%). The rules are plateSelection's; this file only crops and
 *        reads, with the same sizes the measurement used.
 * SAFETY: everything stays on the phone. The photo is re-encoded before any
 *         read (drops EXIF, including GPS); crops are temporary cache files.
 *         Recognised text is never logged or kept.
 * LINKS: src/shared/lib/plateSelection.ts (the rules);
 *        src/shared/lib/ocr/textRecognition.ts (ML Kit);
 *        ../components/PhotosWithPlateScanStep.tsx, ../components/PlateStep.tsx.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { recogniseText } from '@/shared/lib/ocr/textRecognition';
import type { PlateCandidate } from '@/shared/lib/plateCandidates';
import {
  cropReading,
  decideFromRereads,
  linesToReread,
  type AgreedRead,
} from '@/shared/lib/plateSelection';

/** The first read's width (as before v2: OCR wants detail, not megapixels). */
const FIRST_READ_WIDTH = 2000;
/** The crop: padding around the line (share of its width/height), read width. */
const PAD_X = 0.25;
const PAD_Y = 0.8;
const CROP_WIDTH = 1200;

export interface ScannedPlate extends PlateCandidate {
  /** The plate's crop, a cache file — shown beside the suggestion. */
  cropUri: string;
}

export type PlateReading =
  | { kind: 'none' | 'error' }
  | { kind: 'likely' | 'pair'; plates: ScannedPlate[] };

/** Re-encode (drops EXIF, bakes in rotation), optionally to a width. */
async function encode(uri: string, width?: number) {
  const context = ImageManipulator.manipulate(uri);
  if (width) context.resize({ width });
  const rendered = await context.renderAsync();
  return rendered.saveAsync({ format: SaveFormat.JPEG });
}

export async function readPlateFromPhoto(uri: string): Promise<PlateReading> {
  try {
    const first = await encode(uri, FIRST_READ_WIDTH);
    const firstRead = await recogniseText(first.uri);
    if (firstRead.status !== 'ok') return { kind: 'error' };

    const toReread = linesToReread(firstRead.blocks);
    if (toReread.length === 0) return { kind: 'none' };

    const original = await encode(uri);
    const scale = original.width / first.width;
    const agreed: AgreedRead<string>[] = [];
    for (const { line, firstRead: firstCanon } of toReread) {
      const box = line.box!;
      const x = Math.max(0, (box.x - box.width * PAD_X) * scale);
      const y = Math.max(0, (box.y - box.height * PAD_Y) * scale);
      const width = Math.min(original.width - x, box.width * (1 + 2 * PAD_X) * scale);
      const height = Math.min(original.height - y, box.height * (1 + 2 * PAD_Y) * scale);
      const context = ImageManipulator.manipulate(original.uri);
      context.crop({ originX: x, originY: y, width, height });
      context.resize({ width: CROP_WIDTH });
      const crop = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG });

      const secondRead = await recogniseText(crop.uri);
      if (secondRead.status !== 'ok') continue;
      const reading = cropReading(secondRead.blocks);
      if (reading && reading.canon === firstCanon) {
        agreed.push({ candidate: reading, height: box.height / first.height, extra: crop.uri });
      }
    }

    const plates = decideFromRereads(agreed).map((a) => ({ ...a.candidate, cropUri: a.extra }));
    if (plates.length === 0) return { kind: 'none' };
    return { kind: plates.length === 2 ? 'pair' : 'likely', plates };
  } catch {
    // Never surface this: typing the plate always works.
    return { kind: 'error' };
  }
}
