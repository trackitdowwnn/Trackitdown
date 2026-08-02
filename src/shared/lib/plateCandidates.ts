/**
 * WHAT:  Turns raw OCR output into a ranked list of plausible UK registrations.
 *        Pure — no React, no native module, no I/O. This is the whole brain of
 *        plate scanning, deliberately separated so it can be tested without a
 *        camera or a device.
 * WHY:   OCR of a number plate fails in one predictable way: glyph confusion.
 *        O/0, I/1, S/5, B/8, Z/2 and G/6 are near-identical in the tall
 *        condensed typeface UK plates use, and a recogniser reading a plate in
 *        isolation has no way to choose.
 *
 *        WE DO HAVE A WAY: POSITION. Every UK format fixes which slots are
 *        letters and which are digits, so the ambiguity mostly evaporates:
 *
 *            current format   A A 9 9 A A A
 *            recognised       A B 1 Z C D E   -> slot 4 must be a digit
 *                                             -> Z is a 2  -> AB12 CDE
 *            recognised       0 B 1 2 C D E   -> slot 1 must be a letter
 *                                             -> 0 is an O  -> OB12 CDE
 *
 *        So we do not guess and we do not rely on a confidence score (which
 *        ML Kit does not reliably expose per line on both platforms anyway).
 *        We try each shape of the right length, coerce ambiguous glyphs to the
 *        slot they sit in, and keep only what validates AFTERWARDS.
 *
 *        A coercion is evidence of doubt, so candidates needing fewer of them
 *        rank higher. After that, geometry: a car's own plate is usually the
 *        largest plate-shaped text in the frame, and a UK plate is a very
 *        distinctive oblong.
 *
 * SAFETY: this module sees every scrap of text in someone's photograph —
 *        street names, shop signs, other people's registrations. It returns
 *        ONLY plate candidates and keeps nothing. Callers must not persist or
 *        log the input; plates are personal data (use redactPlate).
 * LINKS: ./plate.ts (normalisation, formats, slot patterns);
 *        src/shared/lib/ocr/ (the adapter that produces TextBlock);
 *        src/features/garage/components/PlateScanSheet.tsx (the consumer).
 */

import {
  PLATE_MAX_CANON_LENGTH,
  type PlateFormat,
  formatPlate,
  matchPlateFormat,
  normalisePlate,
  slotsFor,
} from './plate';

/** One piece of recognised text with where it sat in the image. */
export interface TextBlock {
  text: string;
  /** Pixel rect in the source image. Absent on some recognisers — see below. */
  box?: { x: number; y: number; width: number; height: number };
  /** 0–1 if the recogniser provides it. Treated as a bonus, never required. */
  confidence?: number;
}

export interface PlateCandidate {
  /** Canonical, unspaced — what gets stored. */
  canon: string;
  /** Display form, e.g. "AB12 CDE" — what gets shown. */
  display: string;
  format: PlateFormat;
  /** How many glyphs had to be coerced to make it valid. 0 is a clean read. */
  coercions: number;
}

/**
 * A UK plate is a strikingly consistent oblong — roughly 4.6:1 for the standard
 * front/rear plate. Text blocks near that ratio are far more likely to BE a
 * plate than a shop sign, so nearness to it breaks ties.
 */
const PLATE_ASPECT_RATIO = 4.6;

/**
 * Below this canonical length we accept CLEAN reads only — never a coerced one.
 *
 * Learned from the tests, and it matters more than it looks. The short dateless
 * shapes ('A999', '999A', 'AA999') are so loose that with coercion allowed,
 * ordinary text turns into registrations: "2026" on a sign becomes "Z026", and
 * the fragment "AB12" split out of a real plate becomes "A812" — a second,
 * wrong candidate sitting next to the right one.
 *
 * Long plates carry enough structure for coercion to be evidence-led. Short
 * ones do not, so there we require the recogniser to have got it exactly right.
 */
const MIN_LENGTH_FOR_COERCION = 6;

/**
 * Glyphs that look alike in plate typefaces, mapped to what they become in a
 * slot of the opposite kind. Only these are ever coerced — an unlisted glyph in
 * the wrong slot kills the candidate rather than being forced.
 */
const TO_DIGIT: Readonly<Record<string, string>> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};

const TO_LETTER: Readonly<Record<string, string>> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

/**
 * Extract ranked plate candidates from recognised text.
 *
 * @param blocks recognised text, in any order
 * @param limit  how many to return (the sheet shows at most 3)
 */
export function extractPlateCandidates(
  blocks: readonly TextBlock[],
  limit = 3,
): PlateCandidate[] {
  const best = new Map<string, { candidate: PlateCandidate; score: number }>();

  for (const block of blocks) {
    // One block can hold several words ("AB12 CDE" often arrives as one line,
    // but a two-line plate or a busy sign arrives as several).
    for (const piece of splitPieces(block.text)) {
      const canon = normalisePlate(piece);
      if (canon.length < 4 || canon.length > PLATE_MAX_CANON_LENGTH) {
        continue;
      }

      const resolved = resolve(canon);
      if (!resolved) {
        continue;
      }

      const score = scoreOf(resolved.coercions, block);
      const existing = best.get(resolved.canon);
      // The same plate can be read from several blocks; keep the best reading.
      if (!existing || score > existing.score) {
        best.set(resolved.canon, { candidate: resolved, score });
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/**
 * Try every shape of this length; coerce ambiguous glyphs into the slot they
 * occupy; keep the reading that needed the fewest coercions.
 *
 * Returns null when nothing validates — which is the common case, because most
 * text in a photograph is not a registration.
 */
function resolve(canon: string): PlateCandidate | null {
  // A clean read needs no work and can never be beaten.
  const direct = matchPlateFormat(canon);
  if (direct) {
    return { canon, display: formatPlate(canon), format: direct, coercions: 0 };
  }

  // Short strings do not earn the benefit of the doubt — see the constant.
  if (canon.length < MIN_LENGTH_FOR_COERCION) {
    return null;
  }

  let bestCandidate: PlateCandidate | null = null;

  for (const pattern of slotsFor(canon.length)) {
    let coerced = '';
    let coercions = 0;
    let possible = true;

    for (let i = 0; i < pattern.length; i += 1) {
      const ch = canon[i];
      const wantsDigit = pattern[i] === '9';
      const isDigit = ch >= '0' && ch <= '9';

      if (wantsDigit === isDigit) {
        coerced += ch;
        continue;
      }
      const swap = wantsDigit ? TO_DIGIT[ch] : TO_LETTER[ch];
      if (!swap) {
        // Not a known look-alike — this shape is simply wrong, don't force it.
        possible = false;
        break;
      }
      coerced += swap;
      coercions += 1;
    }

    if (!possible) {
      continue;
    }
    const format = matchPlateFormat(coerced);
    if (!format) {
      continue;
    }
    if (!bestCandidate || coercions < bestCandidate.coercions) {
      bestCandidate = {
        canon: coerced,
        display: formatPlate(coerced),
        format,
        coercions,
      };
    }
  }

  return bestCandidate;
}

/**
 * Higher is better. Certainty first, then geometry.
 *
 * Coercions dominate deliberately: a plate we read cleanly should always beat
 * one we had to correct, however big and plate-shaped the corrected one looked.
 * Geometry only separates readings we are equally sure of.
 */
function scoreOf(coercions: number, block: TextBlock): number {
  let score = 1000 - coercions * 100;

  const box = block.box;
  if (box && box.width > 0 && box.height > 0) {
    // Area, as a coarse "how close was this to the camera" proxy. Damped hard
    // so a large sign cannot outrank a cleanly-read plate.
    score += Math.min(Math.sqrt(box.width * box.height) / 10, 40);

    const ratio = box.width / box.height;
    const closeness = 1 - Math.min(Math.abs(ratio - PLATE_ASPECT_RATIO) / PLATE_ASPECT_RATIO, 1);
    score += closeness * 30;
  }

  // A bonus when the recogniser offers it; never required (ML Kit's JS bindings
  // do not expose per-line confidence consistently across platforms).
  if (typeof block.confidence === 'number') {
    score += block.confidence * 20;
  }

  return score;
}

/**
 * Split a recognised string into things worth testing: the whole string (a
 * plate usually arrives as one line, spaces and all) plus each whitespace-
 * separated word, so "PARKING AB12CDE" still yields the plate.
 */
function splitPieces(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const words = trimmed.split(/\s+/);
  return words.length > 1 ? [trimmed, ...words] : [trimmed];
}
