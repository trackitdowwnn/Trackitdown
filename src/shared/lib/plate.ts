/**
 * WHAT:  UK number-plate normalisation, format recognition and display
 *        formatting. Pure — no React, no native, no I/O.
 * WHY:   Until now the app had NO client-side plate validation at all. The
 *        `plate` TextField variant only *formats* (uppercase + letter-spacing),
 *        and the only real check lived server-side as a loose
 *        `^[A-Z0-9]{2,8}$` after stripping punctuation — duplicated as raw SQL
 *        in three migrations and unreachable from TypeScript.
 *
 *        `normalisePlate` deliberately mirrors that SQL canon character for
 *        character, so a plate the client accepts is a plate the server
 *        accepts. If the SQL changes, this changes with it.
 *
 *        The SLOT PATTERNS are the load-bearing part. They exist so that OCR
 *        candidate extraction can disambiguate the classic misreads (O vs 0,
 *        I vs 1) by POSITION rather than by guessing: in `AA99AAA` the third
 *        character must be a digit, so a glyph read as "O" there is a zero.
 *        See ./plateCandidates.ts, which is the only reason `slotsFor` is
 *        exported.
 *
 *        PERMISSIVE ON LETTERS, STRICT ON SHAPE. DVLA excludes I and Q from
 *        several positions, but this module does not enforce that: a false
 *        negative (refusing someone's real registration) is far worse than a
 *        false positive, because every candidate is shown to the user for
 *        confirmation before it is used.
 * LINKS: supabase/migrations/20260713190000_post_a_car.sql:329 (the canon this
 *          mirrors; also plate_available.sql and
 *          20260801100000_garage_vehicles.sql:183);
 *        src/shared/lib/plateCandidates.ts (the OCR consumer);
 *        src/shared/ui/TextField.tsx (variant 'plate', maxLength 8 — every
 *          format below fits: 7 canonical characters + 1 space);
 *        src/shared/lib/logger.ts (redactPlate — plates are personal data).
 */

/** Which era/series a plate belongs to. Reported for ranking and for copy. */
export type PlateFormat =
  | 'current' // 2001–: AB12 CDE
  | 'prefix' // 1983–2001: A123 BCD
  | 'suffix' // 1963–1983: ABC 123A
  | 'northernIreland' // ABC 1234
  | 'dateless'; // pre-1963 and personalised: ABC 123, 123 ABC, …

/**
 * A slot pattern: 'A' = letter, '9' = digit. `spaceAt` is the index in the
 * CANONICAL (unspaced) string where the display space belongs.
 *
 * Order matters — the first match wins, so the specific, common formats sit
 * above the catch-all dateless shapes. `AAA9999` is Northern Ireland's shape
 * and is also a legal dateless shape; NI is listed first because it is the far
 * more likely reading of a modern photograph.
 */
interface FormatSpec {
  readonly id: PlateFormat;
  readonly pattern: string;
  readonly spaceAt: number;
}

const FORMATS: readonly FormatSpec[] = [
  { id: 'current', pattern: 'AA99AAA', spaceAt: 4 },

  { id: 'prefix', pattern: 'A999AAA', spaceAt: 4 },
  { id: 'prefix', pattern: 'A99AAA', spaceAt: 3 },
  { id: 'prefix', pattern: 'A9AAA', spaceAt: 2 },

  { id: 'suffix', pattern: 'AAA999A', spaceAt: 3 },
  { id: 'suffix', pattern: 'AAA99A', spaceAt: 3 },
  { id: 'suffix', pattern: 'AAA9A', spaceAt: 3 },

  { id: 'northernIreland', pattern: 'AAA9999', spaceAt: 3 },

  { id: 'dateless', pattern: 'AAA999', spaceAt: 3 },
  { id: 'dateless', pattern: 'AA9999', spaceAt: 2 },
  { id: 'dateless', pattern: 'AA999', spaceAt: 2 },
  { id: 'dateless', pattern: 'A9999', spaceAt: 1 },
  { id: 'dateless', pattern: 'A999', spaceAt: 1 },
  { id: 'dateless', pattern: '999AAA', spaceAt: 3 },
  { id: 'dateless', pattern: '9999AA', spaceAt: 4 },
  { id: 'dateless', pattern: '99AAA', spaceAt: 2 },
  { id: 'dateless', pattern: '9999A', spaceAt: 4 },
  { id: 'dateless', pattern: '999A', spaceAt: 3 },
] as const;

/** The longest canonical plate we recognise. +1 for the display space = 8,
 *  which is exactly TextField's `maxLength` for the plate variant. */
export const PLATE_MAX_CANON_LENGTH = 7;

const isLetter = (ch: string) => ch >= 'A' && ch <= 'Z';
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/**
 * Strip everything that is not a letter or digit, and uppercase.
 *
 * SAFETY-adjacent: this MUST stay identical to the server's canon
 * (`upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))`), or the client will
 * accept plates the server rejects — or, worse, treat two spellings of one
 * plate as different and defeat the per-user uniqueness index.
 */
export function normalisePlate(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** The first format whose shape a canonical plate matches, or null. */
export function matchPlateFormat(canon: string): PlateFormat | null {
  return FORMATS.find((format) => matchesPattern(canon, format.pattern))?.id ?? null;
}

/** Does a canonical plate match any UK format we recognise? */
export function isValidPlate(canon: string): boolean {
  return matchPlateFormat(canon) !== null;
}

/**
 * Canonical → the spaced form people actually write ("AB12CDE" → "AB12 CDE").
 * An unrecognised string is returned unchanged rather than mangled — the user
 * may be mid-type, and a formatter is not a validator.
 */
export function formatPlate(canon: string): string {
  const spec = FORMATS.find((format) => matchesPattern(canon, format.pattern));
  if (!spec) {
    return canon;
  }
  return `${canon.slice(0, spec.spaceAt)} ${canon.slice(spec.spaceAt)}`;
}

/**
 * The slot types for every format of a given LENGTH, as 'A'/'9' strings.
 *
 * Exported for ./plateCandidates.ts, which uses it to coerce ambiguous OCR
 * glyphs by position. Returns every candidate shape of that length, because at
 * this stage we do not yet know which format we are looking at — the caller
 * tries each and keeps what validates.
 */
export function slotsFor(length: number): readonly string[] {
  return FORMATS.filter((format) => format.pattern.length === length).map(
    (format) => format.pattern,
  );
}

function matchesPattern(canon: string, pattern: string): boolean {
  if (canon.length !== pattern.length) {
    return false;
  }
  for (let i = 0; i < pattern.length; i += 1) {
    const slot = pattern[i];
    const ch = canon[i];
    if (slot === 'A' ? !isLetter(ch) : !isDigit(ch)) {
      return false;
    }
  }
  return true;
}
