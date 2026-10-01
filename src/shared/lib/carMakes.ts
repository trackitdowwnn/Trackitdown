/**
 * WHAT:  CAR_MAKES — every car make on the app's list, A–Z, each tagged with
 *        its section letter and whether it's in the "Popular makes" group;
 *        POPULAR_MAKES (the ten most common in the UK, most first);
 *        canonicaliseMake; and makeKeywords (the other names a make is typed
 *        as, for the picker's search).
 * WHY:   The list is generated from DfT vehicle licensing statistics
 *        (carTaxonomy.generated.ts, Open Government Licence v3.0), replacing a
 *        hand-typed 47 (2026-09-30). It isn't AutoTrader's: their terms forbid
 *        reuse and UK database right protects their curated list. DfT counts
 *        every car licensed in the UK, so "Popular makes" is now ranked by how
 *        many are on the road (Ford, Volkswagen, Vauxhall…), the way AutoTrader
 *        leads its picker, instead of the old alphabetical ten.
 *        Makes are reference data, so they're bundled: the picker opens
 *        instantly and offline. The stored value IS the display label
 *        (posts.make is free text), so a picked make writes exactly what the DB
 *        keeps; an unlisted make still goes in via the picker's manual entry,
 *        so the list can under-offer but never traps anyone. Section letters are
 *        ASCII-folded (Škoda → "S", Citroën → "C") so the A–Z reads cleanly.
 * LINKS: src/shared/lib/carTaxonomy.generated.ts (the data);
 *        scripts/build-car-taxonomy.mjs (how it's built);
 *        src/features/vehicles/post/components/MakeField.tsx (renders these);
 *        src/shared/lib/carMakes.test.ts.
 */

import { CAR_TAXONOMY } from './carTaxonomy.generated';

export interface CarMake {
  /** Display name — and the value stored in posts.make. */
  label: string;
  /** A–Z section letter (ASCII, diacritics stripped) for headers + index. */
  section: string;
  /** In the "Popular makes" group at the top of the picker. */
  popular: boolean;
}

/** How many of the most common makes lead the picker (AutoTrader shows ~10). */
const POPULAR_COUNT = 10;

/** First letter, diacritics stripped, uppercased — the A–Z bucket. */
export function makeSection(label: string): string {
  // U+0300–U+036F = combining diacritical marks (Š → S, Citroën → C).
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toUpperCase();
}

/** The generated list is by UK count, most first. */
const BY_COUNT = CAR_TAXONOMY.map(([label]) => label);
const POPULAR = new Set(BY_COUNT.slice(0, POPULAR_COUNT));

/** Every make, A–Z by its folded name (so Škoda files with the S's). */
const MAKE_LABELS: readonly string[] = [...BY_COUNT].sort((a, b) =>
  foldMake(a).localeCompare(foldMake(b)),
);

export const CAR_MAKES: CarMake[] = MAKE_LABELS.map((label) => ({
  label,
  section: makeSection(label),
  popular: POPULAR.has(label),
}));

/** The most common makes in the UK, most first — the pinned "Popular makes". */
export const POPULAR_MAKES: string[] = BY_COUNT.slice(0, POPULAR_COUNT);

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

/**
 * The comparison key: lower-cased, diacritics stripped, and hyphens, dots and
 * spaces dropped, so "Mercedes Benz", "Rolls Royce" and "landrover" all meet
 * their labels without an alias each.
 */
function foldMake(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s.\-]+/g, '');
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
 * Keys are FOLDED (see foldMake): case, accents, spaces and hyphens are already
 * handled, so "land rover", "Land-Rover" and "LANDROVER" need no entries.
 *
 * ⚠️ Every alias must point at a real label (a test checks). Chevrolet joined
 * the list with the DfT data, so "chevy" can map to it now; before, it would
 * have rewritten "Chevy" into a make no picker offered.
 */
export const MAKE_ALIASES: Readonly<Record<string, string>> = {
  vw: 'Volkswagen',
  volkswagon: 'Volkswagen', // the one misspelling common enough to be a name
  merc: 'Mercedes-Benz',
  mercedes: 'Mercedes-Benz',
  benz: 'Mercedes-Benz',
  rangerover: 'Land Rover', // a model, offered as a make often enough to map
  alfa: 'Alfa Romeo',
  chevy: 'Chevrolet',
};

/**
 * Search-only names: found by typing, never used to rewrite what's stored.
 * KGM is SsangYong renamed (2023). Both stay as their own makes, because
 * the cars people own say one or the other, so each finds the other in search.
 */
const SEARCH_ONLY_KEYWORDS: Readonly<Record<string, string[]>> = {
  KGM: ['ssangyong'],
  SsangYong: ['kgm'],
};

/** Keyword lists for the picker's search, from the alias table plus the
 *  search-only names: "vw" finds Volkswagen, "merc" finds Mercedes-Benz. */
const KEYWORDS = new Map<string, string[]>(
  Object.entries(SEARCH_ONLY_KEYWORDS).map(([label, words]) => [label, [...words]]),
);
for (const [alias, label] of Object.entries(MAKE_ALIASES)) {
  KEYWORDS.set(label, [...(KEYWORDS.get(label) ?? []), alias]);
}

/** The other names a make is typed as, for search (empty for most). */
export function makeKeywords(label: string): string[] {
  return KEYWORDS.get(label) ?? [];
}

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
