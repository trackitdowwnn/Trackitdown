/**
 * WHAT:  Picks AT MOST ONE plate to suggest from a photo's recognised lines,
 *        or none. Pure: the rules only, no native module.
 * WHY:   Measured on 80 labelled photos (docs/plate-scan-decisions.md), the old
 *        choice (best UK-shaped text anywhere) was wrong 45% of the time it
 *        suggested anything, and suggested something on 87% of photos with no
 *        plate. A wrong plate is the worst outcome — a listing's plate can never
 *        change — so these rules prefer silence to a guess:
 *          - a line with lowercase letters is not a plate (badges, signs)
 *          - at most one corrected character; none for the loose dateless and
 *            suffix shapes (they turn ordinary text into "plates")
 *          - the plate is the LARGEST plate text in the photo; too small means
 *            a car across the street, so say nothing
 *          - if a different plate is nearly as large, two cars are equally in
 *            shot, so say nothing rather than pick one
 *        Measured: 40% of plates found (was 58%), 28% of suggestions wrong
 *        (was 45%), silent on 87% of no-plate photos (was 13%).
 * SAFETY: sees every word in the photo; returns only the chosen candidate and
 *         keeps nothing (plates are personal data).
 * LINKS: ./plateCandidates.ts (candidate shapes, glyph correction);
 *        src/features/vehicles/post/components/PhotosWithPlateScanStep.tsx;
 *        docs/plate-scan-decisions.md.
 */

import { extractPlateCandidates, type PlateCandidate, type TextBlock } from './plateCandidates';

/** Text shorter than this share of the photo's height is a distant car. */
export const MIN_PLATE_HEIGHT = 0.02;
/** A different plate at least this share of the largest one's height = two cars. */
export const AMBIGUOUS_RATIO = 0.7;

const maxCorrections = (format: PlateCandidate['format']) =>
  format === 'dateless' || format === 'suffix' ? 0 : 1;

export function choosePlate(lines: readonly TextBlock[], imageHeight: number): PlateCandidate | null {
  // Every plausible plate, with the height of the line it was read from.
  const best = new Map<string, { candidate: PlateCandidate; height: number }>();
  for (const line of lines) {
    if (/[a-z]/.test(line.text)) continue;
    const height = line.box && imageHeight > 0 ? line.box.height / imageHeight : 0;
    for (const candidate of extractPlateCandidates([line], 3)) {
      if (candidate.coercions > maxCorrections(candidate.format)) continue;
      const seen = best.get(candidate.canon);
      if (!seen || height > seen.height) best.set(candidate.canon, { candidate, height });
    }
  }

  const [first, second] = [...best.values()].sort((a, b) => b.height - a.height);
  if (!first || first.height < MIN_PLATE_HEIGHT) return null;
  if (second && second.height >= AMBIGUOUS_RATIO * first.height) return null;
  return first.candidate;
}
