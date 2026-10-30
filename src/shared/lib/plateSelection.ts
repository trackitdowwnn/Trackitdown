/**
 * WHAT:  The rules that decide which plate (if any) a photo suggests, plate
 *        scanning v2. Pure — readPlate.ts does the cropping and reading:
 *          1. linesToReread: the plate-shaped lines worth a second read —
 *             capitals only (badges and signs have lowercase), largest first,
 *             at most three
 *          2. cropReading: what the full-size crop of a line says — a plate
 *             with at most one corrected character on the structured current
 *             and prefix shapes, none on the loose ones (they turn ordinary
 *             text into "plates": 'ST LINE' was once offered as S71 INE)
 *          3. decideFromRereads: from the lines whose two reads AGREE — the
 *             largest; nothing if it is too small to be this car (a car across
 *             the street); both if a different plate is nearly as large (two
 *             cars equally in shot, the owner picks)
 * WHY:   Measured on 80 labelled photos (docs/plate-scan-decisions.md), the old
 *        choice — the best UK-shaped text anywhere — was wrong 45% of the time
 *        it suggested anything, and suggested something on 87% of photos with
 *        no plate. A listing's plate can never change, so these rules prefer
 *        silence to a guess. Measured: 40% of plates found (was 58%), 16% of
 *        suggestions wrong, silent on 13 of 15 no-plate photos (was 2).
 * SAFETY: sees every word in a photo; returns only plate candidates and keeps
 *         nothing (plates are personal data).
 * LINKS: ./plateCandidates.ts (shapes, glyph correction);
 *        src/features/vehicles/post/lib/readPlate.ts; docs/plate-scan-decisions.md.
 */

import { extractPlateCandidates, type PlateCandidate, type TextBlock } from './plateCandidates';

/** Text shorter than this share of the photo's height is a distant car. */
export const MIN_PLATE_HEIGHT = 0.02;
/** A different plate at least this share of the largest one's height = two cars. */
export const AMBIGUOUS_RATIO = 0.7;
/** How many lines of one photo get a second read. */
export const MAX_REREADS = 3;

export interface RereadLine {
  /** The line as first read, with its box in the first read's image. */
  line: TextBlock;
  /** What the first read makes of it (canonical). */
  firstRead: string;
}

/** The plate-shaped lines worth reading again, largest first. */
export function linesToReread(lines: readonly TextBlock[]): RereadLine[] {
  const out: RereadLine[] = [];
  for (const line of lines) {
    if (!line.box || /[a-z]/.test(line.text)) continue;
    const candidate = extractPlateCandidates([{ text: line.text }], 1)[0];
    if (candidate) out.push({ line, firstRead: candidate.canon });
  }
  return out.sort((a, b) => b.line.box!.height - a.line.box!.height).slice(0, MAX_REREADS);
}

/**
 * The crop's own reading of the plate: its largest capital-letter line that is
 * a plate with at most one corrected character on a structured (current or
 * prefix) shape, none otherwise. Null when the crop shows no plate.
 */
export function cropReading(cropLines: readonly TextBlock[]): PlateCandidate | null {
  const capitals = cropLines
    .filter((l) => !/[a-z]/.test(l.text))
    .sort((a, b) => (b.box?.height ?? 0) - (a.box?.height ?? 0));
  for (const l of capitals) {
    const candidate = extractPlateCandidates([{ text: l.text }], 1)[0];
    const allowed = candidate?.format === 'current' || candidate?.format === 'prefix' ? 1 : 0;
    if (candidate && candidate.coercions <= allowed) return candidate;
  }
  return null;
}

/** A line whose second read agreed, with its size in the photo. */
export interface AgreedRead<T> {
  candidate: PlateCandidate;
  /** Line height as a share of the photo's height. */
  height: number;
  /** Whatever the caller needs back (the crop's file, for the sheet). */
  extra: T;
}

/**
 * From the AGREED reads (largest first): one plate, two when two cars are
 * equally in shot, or none when the largest is too small to be this car.
 */
export function decideFromRereads<T>(agreed: readonly AgreedRead<T>[]): AgreedRead<T>[] {
  const [top, ...rest] = agreed;
  if (!top || top.height < MIN_PLATE_HEIGHT) return [];
  const rival = rest.find((r) => r.candidate.canon !== top.candidate.canon);
  return rival && rival.height >= AMBIGUOUS_RATIO * top.height ? [top, rival] : [top];
}
