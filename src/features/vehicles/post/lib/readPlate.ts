/**
 * WHAT:  Reads the plates in ONE photo, plate scanning v3: a first read of the
 *        whole photo, then a second read of each plate-shaped line from a
 *        full-size crop. Returns every plate reading from both passes, with the
 *        crop it came from; rankScannedPlates turns readings (from one photo or
 *        several) into the plates to offer, best first.
 * WHY:   docs/plate-scan-decisions.md. v2 offered a plate only when both reads
 *        agreed, and on real phone photos found nothing; the reads are now
 *        evidence for plateSelection's ranking, not a gate.
 * SAFETY: everything stays on the phone. The photo is re-encoded before any
 *         read (drops EXIF, including GPS); crops are temporary cache files.
 *         Recognised text is never logged or kept.
 * LINKS: src/shared/lib/plateSelection.ts (the rules);
 *        src/shared/lib/ocr/textRecognition.ts (ML Kit);
 *        ../components/PhotosWithPlateScanStep.tsx, ../components/PlateStep.tsx.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { recogniseText } from '@/shared/lib/ocr/textRecognition';
import type { PlateCandidate, TextBlock } from '@/shared/lib/plateCandidates';
import {
  linesToReread,
  rankPlates,
  sightingsIn,
  type PlateSighting,
} from '@/shared/lib/plateSelection';

/** The first read's width (OCR wants detail, not megapixels). */
const FIRST_READ_WIDTH = 2000;
/** The crop: padding around the line (share of its width/height), read width. */
const PAD_X = 0.25;
const PAD_Y = 0.8;
const CROP_WIDTH = 1200;

/** A plate reading, and the crop file that shows it (when its line was cropped). */
export type PlateScanSighting = PlateSighting<string | undefined>;

export interface ScannedPlate extends PlateCandidate {
  /** The plate's crop, a cache file — shown beside the suggestion. */
  cropUri?: string;
  score: number;
}

export type PlateReading =
  | { kind: 'error' }
  /** `sawText`: the photo had any text at all — telemetry's "why nothing". */
  | { kind: 'read'; sightings: PlateScanSighting[]; sawText: boolean };

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

    const shareOf = (line: TextBlock) => (line.box ? line.box.height / first.height : 0);
    const cropOf = new Map<TextBlock, string>();
    const fromCrops: PlateScanSighting[] = [];

    const toReread = linesToReread(firstRead.blocks);
    if (toReread.length > 0) {
      const original = await encode(uri);
      const scale = original.width / first.width;
      for (const { line } of toReread) {
        const box = line.box!;
        const x = Math.max(0, (box.x - box.width * PAD_X) * scale);
        const y = Math.max(0, (box.y - box.height * PAD_Y) * scale);
        const width = Math.min(original.width - x, box.width * (1 + 2 * PAD_X) * scale);
        const height = Math.min(original.height - y, box.height * (1 + 2 * PAD_Y) * scale);
        const context = ImageManipulator.manipulate(original.uri);
        context.crop({ originX: x, originY: y, width, height });
        context.resize({ width: CROP_WIDTH });
        const crop = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG });
        cropOf.set(line, crop.uri);

        const secondRead = await recogniseText(crop.uri);
        if (secondRead.status !== 'ok') continue;
        // The crop's lines are as large as the line it was cut around.
        fromCrops.push(...sightingsIn(secondRead.blocks, () => shareOf(line), true, () => crop.uri));
      }
    }

    const sightings = [
      ...sightingsIn(firstRead.blocks, shareOf, false, (line) => cropOf.get(line)),
      ...fromCrops,
    ];
    return { kind: 'read', sightings, sawText: firstRead.blocks.length > 0 };
  } catch {
    // Never surface this: typing the plate always works.
    return { kind: 'error' };
  }
}

/** The plates to offer from any number of readings, best first (at most 3). */
export function rankScannedPlates(sightings: readonly PlateScanSighting[]): ScannedPlate[] {
  return rankPlates(sightings).map((r) => ({ ...r.candidate, cropUri: r.extra, score: r.score }));
}
