/**
 * WHAT:  Per-make car models: `modelsForMake` (A–Z, the data-source seam),
 *        `popularModelsForMake` (the most common in the UK, most first),
 *        `modelSection`, `makeChangePatch` (the make → model dependency) and
 *        `canonicaliseModel`.
 * WHY:   Generated from DfT vehicle licensing statistics with the makes
 *        (carTaxonomy.generated.ts, OGL v3.0, 2026-09-30). Every listed make now
 *        has its models, about 1,050 in all, where the hand list had 15 makes
 *        and ~150 models and left Škoda, SEAT, Tesla and the rest to a free-text
 *        box. Popular models are ranked by how many are on UK roads, so "Popular
 *        BMW models" is 3 Series, 1 Series, 5 Series… Common van-only models
 *        (Ranger, Transit Connect) are listed too, at count 0, so after the
 *        cars and never "popular". A model DfT also counts as a car (Transit,
 *        Hilux) ranks by that car count like any other. The stored value IS the model label, and the list can
 *        under-offer but never trap: a free-typed make has no models, and the
 *        model step then offers free text.
 * LINKS: src/shared/lib/carTaxonomy.generated.ts; src/shared/lib/carMakes.ts;
 *        src/features/vehicles/post/components/ModelField.tsx (renders these);
 *        src/features/vehicles/post/components/postSteps.tsx (makeChangePatch);
 *        src/shared/lib/carModels.test.ts.
 */

import { CAR_TAXONOMY } from './carTaxonomy.generated';

export interface CarModel {
  /** Display name — and the value stored in posts.model. */
  label: string;
  /** In the "Popular <Make> models" group. */
  popular: boolean;
}

/** How many of a make's most common models lead its picker. */
const POPULAR_COUNT = 6;

/** A–Z with numbers in number order: 1 Series, 2 Series … 7 Series, i4, X5. */
const naturalOrder = (a: string, b: string) =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** make label → { A–Z models, popular (most first) }. Built once. */
const BY_MAKE = new Map(
  CAR_TAXONOMY.map(([make, , models]) => {
    const popular = models
      .filter(([, count]) => count > 0) // vans and hand-added names are listed, never popular
      .slice(0, POPULAR_COUNT)
      .map(([label]) => label);
    const popularSet = new Set(popular);
    const all = models
      .map(([label]) => ({ label, popular: popularSet.has(label) }))
      .sort((a, b) => naturalOrder(a.label, b.label));
    return [make, { all, popular }] as const;
  }),
);

/**
 * Models for a make, A–Z — the data-source seam. [] for an unlisted or
 * free-typed make (the model step then offers free text).
 */
export function modelsForMake(make: string): readonly CarModel[] {
  return BY_MAKE.get(make)?.all ?? [];
}

/** A make's most common models in the UK, most first — the pinned group. */
export function popularModelsForMake(make: string): string[] {
  return BY_MAKE.get(make)?.popular ?? [];
}

/** A model's A–Z section: its first letter, or "#" for a number (208, 3 Series). */
export function modelSection(label: string): string {
  const first = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

/**
 * The answers patch for a make change — clears `model` when the make actually
 * changes, so a model never carries across makes (the make→model dependency);
 * re-picking the SAME make keeps the chosen model. Setting model to '' fails
 * the model step's `min(1)` schema, so it re-gates as incomplete.
 */
export function makeChangePatch(
  currentMake: string | undefined,
  nextMake: string,
): { make: string; model?: string } {
  return nextMake === currentMake ? { make: nextMake } : { make: nextMake, model: '' };
}

/**
 * The model as this app should store it, or the input trimmed if the list for
 * that make recognises nothing.
 *
 * ⚠️ NO ALIAS TABLE, unlike makes. Model names are far more varied than brand
 * names and there is no equivalent of "VW means Volkswagen" — an alias list
 * here would be guesswork, and guessing rewrites what someone typed about
 * their own car. This does one thing: match the list for that make ignoring
 * case, accents, spaces, hyphens and dots, so "golf", "3 series", "c class"
 * and "id3" store as "Golf", "3 Series", "C-Class" and "ID.3" and meet a
 * spotter's alert.
 *
 * ⚠️ THE MAKE MUST BE CANONICAL FIRST. The list is keyed by the exact make
 * label, so `modelsForMake('VW')` is empty and nothing here can match —
 * canonicaliseMake runs at the same seam (MakeField) for that reason.
 */
export function canonicaliseModel(make: string, input: string): string {
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (trimmed === '') {
    return '';
  }
  const folded = fold(trimmed);
  const listed = modelsForMake(make).find((model) => fold(model.label) === folded);
  return listed?.label ?? trimmed;
}

/** The comparison key: lower-cased, accents stripped, and spaces, hyphens and
 *  dots dropped. Mirrors carMakes' foldMake; kept local so neither file
 *  imports the other. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s.\-]+/g, '');
}
