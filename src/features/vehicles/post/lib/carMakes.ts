/**
 * WHAT:  CAR_MAKES — the maintained list of UK-common car makes the post-a-car
 *        make picker offers, each tagged with its A–Z section letter and a
 *        `popular` flag for the "Popular makes" pinned group.
 * WHY:   Makes are stable reference data (like an enum's options), so they live
 *        as a typed constant, not a network call — the picker opens instantly
 *        and offline. The stored value IS the display label (posts.make is free
 *        text, e.g. "BMW"), so a picked make writes exactly what the DB keeps;
 *        an unlisted make still goes in via the picker's manual-entry path, so
 *        this list can under-offer but never traps anyone. Section letters are
 *        ASCII-folded (Škoda → "S", Citroën → "C") so the A–Z index and sticky
 *        headers read as a clean alphabet.
 * LINKS: src/features/vehicles/post/components/MakeField.tsx (renders these);
 *        src/features/vehicles/post/components/postSteps.tsx (MakeStep);
 *        src/features/vehicles/post/lib/carMakes.test.ts.
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
