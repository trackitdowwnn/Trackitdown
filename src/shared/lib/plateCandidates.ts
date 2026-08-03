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
 *        A PLATE RARELY ARRIVES ALONE (2026-08-02). The blue GB/UK band, a
 *        dealer frame and a trim badge all get grouped onto the plate's line,
 *        and a screw cap reads as an extra glyph on the end. Testing only the
 *        whole line and its individual words threw away perfect reads —
 *        "GB AB12 CDE" found NOTHING, and "AB12 CDE Motors Ltd" offered ONLY
 *        "M07 ORS" coerced out of "MOTORS". So we also test every contiguous
 *        run of words, and trim a single stray glyph from either end.
 *
 *        ONE GUESS AT A TIME is what keeps that from inventing registrations.
 *        Stitching part of a line is itself speculative, so a stitched piece
 *        must read CLEANLY — no glyph coercion on top. A whole line keeps full
 *        coercion rights, because that is where "AB1Z CDE" becomes "AB12 CDE".
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
      const canon = normalisePlate(piece.text);
      if (canon.length < 4 || canon.length > PLATE_MAX_CANON_LENGTH + 1) {
        continue;
      }

      const resolved =
        canon.length > PLATE_MAX_CANON_LENGTH ? resolveOverlong(canon) : resolve(canon);
      if (!resolved) {
        continue;
      }
      // ONE GUESS AT A TIME. Stitching a plate out of part of a line is already
      // speculative; letting it also bend glyphs stacks two guesses and starts
      // inventing registrations out of badge text ("ST LINE" -> "S71 INE").
      // A plate that merely had a band or a dealer name on its line reads
      // CLEANLY once peeled off, which is exactly the case this is for.
      if (piece.partial && resolved.coercions > 0) {
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
 * One character too long: try dropping the first, then the last.
 *
 * The plate typeface's screw caps, the blue band's edge and a dealer frame's
 * border all read as a stray glyph welded onto one end — "AB12CDEX" and
 * "XAB12CDE" were both thrown away whole, despite seven correct characters.
 *
 * Only ONE character, only from an END, and never in the middle: a plate with a
 * character missing from the middle is a different plate, not a misread. The
 * trim counts as a coercion because it IS doubt, so a clean seven-character
 * read always wins.
 */
function resolveOverlong(canon: string): PlateCandidate | null {
  for (const trimmed of [canon.slice(1), canon.slice(0, -1)]) {
    const resolved = resolve(trimmed);
    if (resolved) {
      return { ...resolved, coercions: resolved.coercions + 1 };
    }
  }
  return null;
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
 * Cap on words considered per line. A plate is at most three words; this only
 * bounds the run-generation below on a pathological line of sign text.
 */
const MAX_WORDS_PER_LINE = 16;

/**
 * A substring worth testing. `partial` marks one STITCHED from part of a line
 * rather than the line itself or a whole word — those must read cleanly, see
 * the check in extractPlateCandidates.
 */
interface Piece {
  text: string;
  partial: boolean;
}

/**
 * Split a recognised string into every substring worth testing: the whole
 * string, plus every CONTIGUOUS RUN of its words.
 *
 * Runs, not just whole-plus-words, because a plate very often shares its line
 * with something else and is itself split across words. Whole-plus-words alone
 * threw away perfectly good reads:
 *
 *     "GB AB12 CDE"          whole is 9 chars (too long); words are "GB",
 *                            "AB12", "CDE" — none of which is a plate. Found
 *                            NOTHING, despite a flawless read.
 *     "AB12 CDE Motors Ltd"  same miss, and worse: "MOTORS" coerces to the
 *                            valid-looking "M07 ORS", so the ONLY thing offered
 *                            was junk.
 *
 * The run "AB12 CDE" rescues both, and being a clean read it outranks the
 * coerced junk it sits beside. Every run still has to validate as a real UK
 * shape, so this widens what we look at, not what we accept.
 */
function splitPieces(text: string): Piece[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return [{ text: trimmed, partial: false }];
  }

  // The whole line and each single word keep FULL coercion rights — those are
  // the original two cases, and the whole line is where "AB1Z CDE" gets
  // repaired to "AB12 CDE", which is the point of the whole module.
  const pieces = new Map<string, Piece>();
  for (const whole of [trimmed, ...words]) {
    pieces.set(whole, { text: whole, partial: false });
  }

  const capped = words.slice(0, MAX_WORDS_PER_LINE);
  for (let start = 0; start < capped.length; start += 1) {
    let run = '';
    for (let end = start; end < capped.length; end += 1) {
      // A one-character word is never part of a plate — no UK format writes a
      // lone glyph as its own group. Joining them is how "MON FRI 9 5 SAT" gets
      // read as the perfectly-shaped "95 SAT", so they break the run instead.
      if (normalisePlate(capped[end]).length < 2) {
        break;
      }
      run += capped[end];
      // Runs only grow, so once one is too long to be a plate every longer run
      // from this start is too.
      if (normalisePlate(run).length > PLATE_MAX_CANON_LENGTH) {
        break;
      }
      if (!pieces.has(run)) {
        pieces.set(run, { text: run, partial: true });
      }
    }
  }
  return [...pieces.values()];
}
