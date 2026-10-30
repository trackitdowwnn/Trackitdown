/**
 * WHAT:  The rules that rank which plates a photo suggests, plate scanning v3.
 *        Pure — readPlate.ts does the cropping and reading:
 *          1. linesToReread: the plate-shaped lines worth a second, full-size
 *             read — capitals only (badges and signs have lowercase), largest
 *             first, at most three
 *          2. sightingsIn: every plate reading in one pass (the first read, or
 *             one crop), with how large its line is in the photo
 *          3. rankPlates: one score per plate across every pass and photo —
 *             certainty, size, a crop's finer read, and passes that agree
 *             push it up. The best three are offered; nothing scores below
 *             the floor (a word on a sign).
 * WHY:   v2 offered a plate only when two reads agreed and the plate was ≥2% of
 *        the photo. On real phone photos (2026-10-30, 40 labelled) that threw
 *        away a third of the plates the recogniser did see: the crop's finer
 *        read disagreed with a misread first one ("VO63 CNT" / "VO63 CVT"), so
 *        neither was offered. Only owners scan, and they know their plate, so
 *        the owner decided to always offer the best guess and let them fix it.
 *        Agreement is now a bonus, never a gate.
 * SAFETY: sees every word in a photo; returns only plate candidates and keeps
 *         nothing (plates are personal data).
 * LINKS: ./plateCandidates.ts (shapes, glyph correction);
 *        src/features/vehicles/post/lib/readPlate.ts; docs/plate-scan-decisions.md.
 */

import { extractPlateCandidates, type PlateCandidate, type TextBlock } from './plateCandidates';

/** How many lines of one photo get a second read. */
export const MAX_REREADS = 3;
/** How many plates are offered. */
export const MAX_OFFERED = 3;

// Weights, tuned on the 2026-10-30 real-photo set and the 80 Commons photos.
const COST_WEIGHT = 2;
/** Lowercase in the line: usually a badge or a sign, rarely a misread plate. */
const LOWERCASE_PENALTY = 2;
/** Each further pass (or photo) that reads the same plate. */
const AGREE_BONUS = 1;
const MAX_AGREE_BONUS = 2;
/** The plate's share of the photo's height that scores 0; doubling adds 1. */
const SIZE_PIVOT = 0.03;
/** Below this a reading is not offered at all. */
export const MIN_SCORE = -2;

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

/** One plate reading from one pass over one photo. */
export interface PlateSighting<T = undefined> {
  candidate: PlateCandidate;
  /** The plate line's height as a share of the photo's (for a crop, the line
   *  it was cut around). */
  share: number;
  /** Read from a full-size crop of the line. */
  fromCrop: boolean;
  lowercase: boolean;
  /** Whatever the caller needs back (the crop's file, for the sheet). */
  extra: T;
}

/** Every plate reading in one pass. `shareOf` gives a line's size in the photo. */
export function sightingsIn<T>(
  lines: readonly TextBlock[],
  shareOf: (line: TextBlock) => number,
  fromCrop: boolean,
  extraOf: (line: TextBlock) => T,
): PlateSighting<T>[] {
  return lines.flatMap((line) => {
    const found = extractPlateCandidates([{ text: line.text }], MAX_OFFERED);
    // A fragment of a longer plate on the same line ("M345" of "M345 WED") is
    // not a plate of its own; it used to outrank the whole one.
    const whole = found.filter((c) => !found.some((o) => o !== c && o.canon.includes(c.canon)));
    return whole.map((candidate) => ({
      candidate,
      share: shareOf(line),
      fromCrop,
      lowercase: /[a-z]/.test(line.text),
      extra: extraOf(line),
    }));
  });
}

export function sightingScore(s: PlateSighting<unknown>): number {
  const size = Math.max(-3, Math.min(2, Math.log2(Math.max(s.share, 1e-4) / SIZE_PIVOT)));
  return size - COST_WEIGHT * s.candidate.cost - (s.lowercase ? LOWERCASE_PENALTY : 0);
}

export interface RankedPlate<T> {
  candidate: PlateCandidate;
  score: number;
  /** From the best-scoring sighting of this plate. */
  extra: T;
}

/** The plates to offer, best first: at most MAX_OFFERED, none below MIN_SCORE. */
export function rankPlates<T>(sightings: readonly PlateSighting<T>[]): RankedPlate<T>[] {
  const byPlate = new Map<string, { best: PlateSighting<T>; bestScore: number; count: number }>();
  for (const s of sightings) {
    const score = sightingScore(s);
    const entry = byPlate.get(s.candidate.canon);
    if (!entry) byPlate.set(s.candidate.canon, { best: s, bestScore: score, count: 1 });
    else {
      entry.count += 1;
      if (score > entry.bestScore) Object.assign(entry, { best: s, bestScore: score });
    }
  }
  return [...byPlate.values()]
    .map(({ best, bestScore, count }) => ({
      candidate: best.candidate,
      score: bestScore + Math.min(MAX_AGREE_BONUS, AGREE_BONUS * (count - 1)),
      extra: best.extra,
    }))
    .filter((p) => p.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OFFERED);
}
