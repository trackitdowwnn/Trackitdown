/**
 * WHAT:  CAR_MAKES — the maintained list of UK-common car makes, each tagged
 *        with its A–Z section letter and a `popular` flag for the "Popular
 *        makes" pinned group. Shared reference data: the post-a-car make picker
 *        offers these, and the search surface suggests from them.
 * WHY:   Makes are stable reference data (like an enum's options), so they live
 *        as a typed constant, not a network call — the picker opens instantly
 *        and offline. The stored value IS the display label (posts.make is free
 *        text, e.g. "BMW"), so a picked make writes exactly what the DB keeps;
 *        an unlisted make still goes in via the picker's manual-entry path, so
 *        this list can under-offer but never traps anyone. Section letters are
 *        ASCII-folded (Škoda → "S", Citroën → "C") so the A–Z index and sticky
 *        headers read as a clean alphabet.
 * LINKS: src/features/vehicles/post/components/MakeField.tsx (renders these);
 *        src/features/search-map/components/SearchSheet.tsx (the search make picker);
 *        src/shared/lib/carMakes.test.ts.
 */

export interface CarMake {
  /** Display name — and the value stored in posts.make. */
  label: string;
  /** A–Z section letter (ASCII, diacritics stripped) for headers + index. */
  section: string;
  /** In the UK-common set surfaced first under "Popular makes". */
  popular: boolean;
}

/** The UK theft-/volume-common set, surfaced before the A–Z (brief §Popular). */
const POPULAR = new Set([
  'BMW',
  'Ford',
  'Volkswagen',
  'Audi',
  'Vauxhall',
  'Toyota',
  'Mercedes-Benz',
  'Nissan',
  'Land Rover',
  'Peugeot',
]);

/** Alphabetical source list (~50 UK-market makes). */
const MAKE_LABELS = [
  'Abarth',
  'Alfa Romeo',
  'Aston Martin',
  'Audi',
  'Bentley',
  'BMW',
  'Citroën',
  'Cupra',
  'Dacia',
  'DS',
  'Ferrari',
  'Fiat',
  'Ford',
  'Genesis',
  'Honda',
  'Hyundai',
  'Jaguar',
  'Jeep',
  'Kia',
  'Lamborghini',
  'Land Rover',
  'Lexus',
  'Lotus',
  'Maserati',
  'Mazda',
  'McLaren',
  'Mercedes-Benz',
  'MG',
  'MINI',
  'Mitsubishi',
  'Nissan',
  'Peugeot',
  'Polestar',
  'Porsche',
  'Renault',
  'Rolls-Royce',
  'SEAT',
  'Škoda',
  'Smart',
  'SsangYong',
  'Subaru',
  'Suzuki',
  'Tesla',
  'Toyota',
  'Vauxhall',
  'Volkswagen',
  'Volvo',
];

/** First letter, diacritics stripped, uppercased — the A–Z bucket. */
export function makeSection(label: string): string {
  // U+0300–U+036F = combining diacritical marks (Š → S, Citroën → C).
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
}

export const CAR_MAKES: CarMake[] = MAKE_LABELS.map((label) => ({
  label,
  section: makeSection(label),
  popular: POPULAR.has(label),
}));

/** Popular make labels, in list order — the pinned "Popular makes" group. */
export const POPULAR_MAKES: string[] = CAR_MAKES.filter((make) => make.popular).map(
  (make) => make.label,
);

// ---------------------------------------------------------------------------
// CANONICALISATION (2026-09-03, review finding #20)
// ---------------------------------------------------------------------------
// ⚠️ WHY THIS EXISTS. A post says what the owner typed and an alert says what
// the spotter typed, and the server matches them with `lower(btrim(...))` on
// both sides — case and whitespace, nothing more. So "VW Golf" never matched a
// spotter who asked for a Volkswagen Golf: their alert stayed silent, the owner
// never knew, and nothing anywhere errored. DOMAIN.md calls this matching
// load-bearing and it was half-built.
//
// ⚠️ THE DIACRITICS ARE THE WORST CASE, not the abbreviations. The list stores
// `Škoda` and `Citroën`, and a UK keyboard types neither — so every hand-typed
// Skoda was a guaranteed miss, on two makes, forever.
//
// ⚠️ ONE SOURCE OF TRUTH, IN TYPESCRIPT. The obvious alternative was a
// canonical_make() in SQL used on both sides of the match, which would also fix
// rows already stored — and would put the alias table in two places that must
// agree. This repo has been bitten by exactly that: the bounty floor moved in
// seven server-side places and the one client mirror was missed, so the app
// enforced £50 against a database allowing £10 for nine days. Canonicalising at
// CAPTURE means both sides store the same string and the server needs no alias
// knowledge at all — its existing comparison is then enough.
//
// The cost of that choice, stated plainly: rows written BEFORE today keep
// whatever was typed. Nothing backfills them.

/** Lower-cased, diacritics stripped, whitespace collapsed. The comparison key. */
function foldMake(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alternative names people actually type, mapped to the label the list uses.
 *
 * ⚠️ DELIBERATELY NOT A TYPO TABLE. Every entry here is a name a reasonable
 * person would offer as the make of their car — an abbreviation, a former brand
 * name, or a spelling the UK uses. Typos are unbounded and guessing at them
 * starts silently rewriting what someone typed, which is a worse failure than
 * not matching: an owner who sees their own listing say a make they did not
 * choose loses trust in the whole thing.
 *
 * Keys are FOLDED (see foldMake), so case, spacing and accents are already
 * handled and must not be enumerated here.
 */
const MAKE_ALIASES: Record<string, string> = {
  vw: 'Volkswagen',
  'v w': 'Volkswagen',
  volkswagon: 'Volkswagen', // the one misspelling common enough to be a name
  merc: 'Mercedes-Benz',
  mercedes: 'Mercedes-Benz',
  benz: 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz',
  bmw: 'BMW',
  landrover: 'Land Rover',
  'land-rover': 'Land Rover',
  rangerover: 'Land Rover', // a model, offered as a make often enough to map
  'range rover': 'Land Rover',
  alfa: 'Alfa Romeo',
  'alfa-romeo': 'Alfa Romeo',
  // ⚠️ NO `chevy: 'Chevrolet'`. It was written here and the alias-integrity
  // test caught it on its first run: Chevrolet is not in MAKE_LABELS (it is not
  // UK-common), so the alias would have rewritten "Chevy" into a make no picker
  // offers and no alert can be built from — canonicalising it INTO a permanent
  // mismatch, which is worse than leaving it alone. Every alias must point at a
  // real label; add the label first, then the alias.
  vauxhall: 'Vauxhall',
  'citroen': 'Citroën',
  'skoda': 'Škoda',
  mini: 'MINI',
  seat: 'SEAT',
  ds: 'DS',
};

/**
 * The make as this app should store it, or the input trimmed if it recognises
 * nothing.
 *
 * ⚠️ NEVER TRAPS ANYONE. An unrecognised make is returned as typed — the list
 * is allowed to under-offer (MakeField's whole manual-entry path depends on
 * that), and a car whose make we have never heard of must still be reportable
 * by someone whose car has just been stolen.
 */
export function canonicaliseMake(input: string): string {
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (trimmed === '') {
    return '';
  }
  const folded = foldMake(trimmed);
  // The list wins over the alias table: a real label typed with the wrong case
  // or without its accent is the commonest case by far.
  const listed = MAKE_LABELS.find((label) => foldMake(label) === folded);
  return listed ?? MAKE_ALIASES[folded] ?? trimmed;
}
