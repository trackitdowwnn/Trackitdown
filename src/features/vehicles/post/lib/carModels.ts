/**
 * WHAT:  CAR_MODELS — a maintained, per-make list of common UK models for the
 *        post-a-car model step, plus `modelsForMake` (the data-source seam),
 *        `popularModelsForMake`, and `makeChangePatch` (the make→model
 *        dependency rule).
 * WHY:   Models are stable reference data keyed by make label (matching
 *        carMakes), so a picked make instantly yields its models — no network,
 *        offline. It is NOT exhaustive: `modelsForMake` returns [] for an
 *        unseeded or free-typed make, and the model step falls back to free
 *        text, so this list can under-offer but never trap. `modelsForMake` is
 *        the SEAM: a future DVLA/vehicle-data source swaps the implementation
 *        behind the same signature, with callers unchanged. NB DVLA returns
 *        ONE vehicle's model from a plate, not a per-make enumeration, so it
 *        does not replace this list. The stored value IS the model label.
 * LINKS: src/features/vehicles/post/lib/carMakes.ts (the makes, keys);
 *        src/features/vehicles/post/components/ModelField.tsx (renders these);
 *        src/features/vehicles/post/components/postSteps.tsx (MakeStep uses
 *        makeChangePatch); src/features/vehicles/post/lib/carModels.test.ts.
 */

export interface CarModel {
  /** Display name — and the value stored in posts.model. */
  label: string;
  /** In the "Popular <Make> models" pinned group. */
  popular: boolean;
}

/** All models per make (alphabetical enough for the picker's A–Z sections). */
const MODELS: Record<string, string[]> = {
  Audi: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron'],
  BMW: [
    '1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series',
    'X1', 'X3', 'X5', 'X6', 'Z4', 'i4', 'iX', 'M3', 'M4',
  ],
  Ford: [
    'Fiesta', 'Focus', 'Puma', 'Kuga', 'Mondeo', 'EcoSport', 'Ka', 'Galaxy', 'S-Max',
    'Mustang', 'Ranger', 'Transit',
  ],
  Honda: ['Jazz', 'Civic', 'CR-V', 'HR-V', 'Accord', 'e'],
  Hyundai: ['i10', 'i20', 'i30', 'Tucson', 'Kona', 'Santa Fe', 'Ioniq', 'Bayon'],
  Kia: ['Picanto', 'Rio', 'Ceed', 'Sportage', 'Niro', 'Sorento', 'Stonic', 'EV6'],
  'Land Rover': [
    'Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport',
    'Range Rover Evoque', 'Range Rover Velar', 'Freelander',
  ],
  'Mercedes-Benz': [
    'A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'CLA', 'GLA', 'GLB', 'GLC',
    'GLE', 'SL', 'V-Class', 'Vito',
  ],
  MINI: ['Hatch', 'Clubman', 'Countryman', 'Convertible', 'Electric'],
  Nissan: ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Leaf', 'Note', 'Navara', 'GT-R'],
  Peugeot: ['108', '208', '308', '508', '2008', '3008', '5008', 'Partner', 'Rifter'],
  Toyota: [
    'Aygo', 'Yaris', 'Corolla', 'C-HR', 'RAV4', 'Prius', 'Camry', 'Hilux', 'Land Cruiser',
    'Supra',
  ],
  Vauxhall: [
    'Corsa', 'Astra', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Zafira', 'Vivaro',
    'Combo',
  ],
  Volkswagen: [
    'Up', 'Polo', 'Golf', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Touran', 'Touareg',
    'Arteon', 'ID.3', 'ID.4', 'Caddy', 'Transporter',
  ],
  Volvo: ['V40', 'V60', 'V90', 'S60', 'S90', 'XC40', 'XC60', 'XC90'],
};

/** The popular subset per make — surfaced first under "Popular <Make> models". */
const POPULAR: Record<string, string[]> = {
  Audi: ['A3', 'A4', 'Q3', 'Q5'],
  BMW: ['1 Series', '3 Series', '5 Series', 'X3'],
  Ford: ['Fiesta', 'Focus', 'Puma', 'Kuga'],
  Honda: ['Jazz', 'Civic', 'CR-V'],
  Hyundai: ['i10', 'i20', 'Tucson'],
  Kia: ['Picanto', 'Ceed', 'Sportage'],
  'Land Rover': ['Defender', 'Discovery Sport', 'Range Rover Evoque'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'GLC'],
  MINI: ['Hatch', 'Countryman'],
  Nissan: ['Micra', 'Juke', 'Qashqai', 'X-Trail'],
  Peugeot: ['208', '308', '2008', '3008'],
  Toyota: ['Yaris', 'Corolla', 'C-HR', 'RAV4'],
  Vauxhall: ['Corsa', 'Astra', 'Mokka', 'Grandland'],
  Volkswagen: ['Polo', 'Golf', 'Tiguan', 'T-Roc'],
  Volvo: ['XC40', 'XC60'],
};

/**
 * Models for a make — the data-source seam. [] for an unseeded/free-typed make
 * (the model step then offers free text). A future API source implements this
 * signature; callers stay the same.
 */
export function modelsForMake(make: string): CarModel[] {
  const labels = MODELS[make];
  if (!labels) {
    return [];
  }
  const popular = new Set(POPULAR[make] ?? []);
  return labels.map((label) => ({ label, popular: popular.has(label) }));
}

/** Popular model labels for a make, in list order — the pinned group. */
export function popularModelsForMake(make: string): string[] {
  return modelsForMake(make)
    .filter((model) => model.popular)
    .map((model) => model.label);
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
