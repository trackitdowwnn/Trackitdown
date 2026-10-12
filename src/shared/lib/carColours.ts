/**
 * WHAT:  CAR_COLOURS — the curated palette of real UK car colours for the
 *        post-a-car colour step (swatch grid), plus the DVLA colour → swatch
 *        mapping (`colourFromDvla`), lookups (`swatchForName` — which resolves a
 *        retired name through `LEGACY_COLOUR_ALIASES` —, `canonicalColourName`,
 *        `isNoteColour`), `colourIsComplete` (Other needs its note),
 *        `colourChangePatch` (clears the free-text note when the picked colour
 *        isn't a note colour, and the finish when it is), and the optional
 *        paint finish (`COLOUR_FINISHES`, `toColourFinish`, `savedColourFinish`).
 * WHY:   Cars come in the ~twenty colours a V5C records, so a curated NAMED-swatch set is
 *        the right pattern — a free colour/hex picker would add friction and
 *        produce useless values like "#8B8C8E". The stored value is the
 *        canonical NAME (posts.colour), a clean enum that drives the card /
 *        detail colour text and future colour filters — NOT a hex. Swatch
 *        hexes are DATA (realistic automotive shades), deliberately exempt
 *        from the token rule: they are content, not UI chrome, so /theme-audit
 *        and reviewers must NOT "tokenise" them. `colourFromDvla` is the seam
 *        for the (stubbed) DVLA lookup — its limited vocabulary maps cleanly
 *        onto this set so a returned colour can pre-select a swatch.
 *
 *        ⚠️ MOVED HERE FROM features/vehicles/post/lib ON 2026-08-28, joining
 *        carMakes and carModels — which this file's header had noted were
 *        already in shared/lib while it "stayed here and is exported rather
 *        than moved, to keep the posting wizard's imports untouched". Four
 *        features now read it (vehicles, notifications, search-map, sightings),
 *        which is well past ARCHITECTURE.md's bar, and reaching it through the
 *        vehicles barrel cost two real things:
 *
 *          * A CYCLE. `@/features/vehicles` → useSimilarPosts →
 *            `@/features/search-map` → SearchSheet → back, so SearchSheet saw
 *            `CAR_COLOURS` as `undefined` at module scope and crashed the whole
 *            app at startup — a bug no test could catch, because the suite
 *            mocks the barrel and mocking breaks the cycle. Colours are out of
 *            that loop now; body types are not, so SearchSheet's
 *            functions-not-constants rule still stands.
 *          * A TEST TAX. Three suites mocked `@/features/vehicles` and
 *            `requireActual`'d this deep path just to get a pure lookup, because
 *            the barrel drags in auth and dies on AsyncStorage's native module.
 *
 *        `bodyTypes.ts` deliberately did NOT come along: it imports lucide
 *        components and `CardSelectOption` from shared/ui, so it is UI, and
 *        shared/lib does not import shared/ui.
 * LINKS: src/features/vehicles/post/components/ColourField.tsx (renders these);
 *        src/features/vehicles/post/components/postSteps.tsx (ColourStep);
 *        src/features/sightings/components/CarColourTile.tsx (the swatch as a
 *          report card's leading tile, and the consumer of `glyphInkFor`);
 *        ./carColours.test.ts;
 *        docs/DESIGN_SYSTEM.md (Colour, Accessibility — never colour alone).
 */

import type { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface CarColour {
  /** Canonical display name — and the value stored in posts.colour (the enum). */
  name: string;
  /**
   * Representative automotive swatch shade. DATA, NOT a design token — a
   * realistic metallic-ish colour, not a pure web colour. Exempt from the
   * token rule (see file header); do not replace with a theme colour.
   */
  hex: string;
  /** Light shade — render a border so it doesn't vanish on the light background. */
  light?: boolean;
  /** Selecting it opens the free-text note field (wrapped / other specifics). */
  note?: boolean;
  /** Present ⇒ render a two-tone swatch (a wrap hints at a colour over a colour). */
  secondaryHex?: string;
  /** Present ⇒ draw this glyph instead of a plain fill (the "Other" escape). */
  icon?: FeatherName;
  /** An escape's note sheet copy — each asks its own question (2026-10-12). */
  noteCopy?: NoteCopy;
  /** The escape cannot be used without its note (Other: "Other" alone tells
   *  a spotter nothing). */
  noteRequired?: boolean;
}

/** What an escape colour's note sheet says (ColourField renders it). */
export interface NoteCopy {
  title: string;
  label: string;
  placeholder: string;
  helper: string;
}

/**
 * The palette, in rough UK-popularity order (black/grey/white/silver/blue
 * dominate the DVLA registration data), then the two escapes. NOT exhaustive:
 * "Other" always catches the long tail, so the grid can under-offer but never
 * trap. Hexes are DATA — realistic shades, not tokens (see file header).
 *
 * ⚠️ THE V5C VOCABULARY (owner request, 2026-10-12): every colour the DVLA
 * records — the word on the owner's logbook and the one police use — has its
 * own swatch. "Brown / Beige" split into Brown and Beige, and Maroon,
 * Turquoise, Pink and Cream joined (they used to fold into a neighbour, so a
 * pink car was posted as "Purple"). Twenty in all: the grid's four columns
 * fill five even rows. A stored "Brown / Beige" still resolves — see
 * LEGACY_COLOUR_ALIASES.
 */
export const CAR_COLOURS: CarColour[] = [
  { name: 'Black', hex: '#1A1A1A' },
  { name: 'Grey', hex: '#6E7378' },
  { name: 'White', hex: '#F4F5F7', light: true },
  { name: 'Silver', hex: '#C7CCD1', light: true },
  { name: 'Blue', hex: '#2B4C7E' },
  { name: 'Red', hex: '#A81E22' },
  { name: 'Green', hex: '#2E5A43' },
  { name: 'Orange', hex: '#E2601C' },
  { name: 'Yellow', hex: '#EFC93D', light: true },
  { name: 'Brown', hex: '#6B4A2B' },
  { name: 'Beige', hex: '#D6C3A1', light: true },
  { name: 'Gold', hex: '#C9A227', light: true },
  { name: 'Purple', hex: '#5B3A82' },
  { name: 'Bronze', hex: '#8C6A3F' },
  { name: 'Maroon', hex: '#6E1F2C' },
  { name: 'Turquoise', hex: '#2A9FA3' },
  { name: 'Pink', hex: '#E7A1B6', light: true },
  { name: 'Cream', hex: '#EEE5CC', light: true },
  // Escapes — both open the note sheet, each with its own question.
  // Multicolour shows a two-tone swatch (a wrap is one colour over another);
  // Other is a neutral glyph swatch, and needs its note: "Other" alone tells
  // a spotter nothing.
  {
    name: 'Multicolour / wrapped',
    // A neutral pairing — it says "two colours" without naming a real one.
    hex: '#1A1A1A',
    secondaryHex: '#C9A227',
    note: true,
    noteCopy: {
      // Covers factory two-tone paint (DVLA MULTICOLOUR) as well as a wrap.
      title: 'Describe the colours',
      label: 'Colours',
      placeholder: 'e.g. red with a black roof, or a matte black wrap',
      helper: 'Spotters notice this first.',
    },
  },
  {
    name: 'Other',
    hex: '#E4E4E4',
    light: true,
    note: true,
    noteRequired: true,
    icon: 'more-horizontal',
    noteCopy: {
      // Every V5C colour has its own swatch, so Other is the shade itself.
      title: 'Name the colour',
      label: 'Colour',
      placeholder: 'e.g. Champagne or lime green',
      helper: 'Required — the shade or name you’d use to describe it.',
    },
  },
];

/**
 * Colours the app once offered under another name, mapped to the swatch they
 * are now. A stored value (an old listing, a garage car, a saved alert, a
 * recent search) still draws and selects its swatch. Server-side these rows
 * are folded to the new name by a migration (the colour-finish PR).
 */
export const LEGACY_COLOUR_ALIASES: Record<string, string> = {
  'brown / beige': 'Brown',
};

/**
 * The two inks anything drawn ON TOP OF a swatch may take, selected by `light`.
 *
 * ⚠️ THEY LIVE HERE BECAUSE THEY ARE DATA, exactly like the fills above and
 * exempt from the token rule for the same reason: a swatch does not flip with
 * the theme, so an ink that did would be white-on-white for the five light
 * shades. Keeping them beside the `light` flag that chooses between them means
 * a future palette edit moves fill and ink together — and gives /theme-audit
 * one sanctioned home for the exemption instead of a second one in a component.
 *
 * `carColours.test.ts` computes every pair against the 3:1 floor for graphical
 * objects, so a new swatch with the wrong `light` flag fails there rather than
 * shipping illegible.
 */
export const GLYPH_ON_DARK = '#FFFFFF';
export const GLYPH_ON_LIGHT = '#1A1A1A';

/** The ink to draw over `swatch` — see the pair above. */
export function glyphInkFor(swatch: CarColour): string {
  return swatch.light ? GLYPH_ON_LIGHT : GLYPH_ON_DARK;
}

/** Case-exact-ish lookup of a swatch by its canonical name (trimmed, case-insensitive). */
export function swatchForName(name: string | null | undefined): CarColour | undefined {
  const typed = (name ?? '').trim().toLowerCase();
  if (!typed) return undefined;
  // A retired name (LEGACY_COLOUR_ALIASES) resolves to the swatch it is now.
  // ⚠️ OWN keys only (code review): posts.colour is free text, and a stored
  // "toString" or "__proto__" would otherwise read an inherited property and
  // crash every screen that draws the car.
  const alias = Object.hasOwn(LEGACY_COLOUR_ALIASES, typed) ? LEGACY_COLOUR_ALIASES[typed] : typed;
  const target = alias.toLowerCase();
  return CAR_COLOURS.find((colour) => colour.name.toLowerCase() === target);
}

/** The canonical swatch name for a stored colour (a retired name becomes its
 *  current one), or the input unchanged when it isn't on the list. */
export function canonicalColourName(name: string | null | undefined): string | null {
  if (name == null) return null;
  return swatchForName(name)?.name ?? name;
}

/** Whether `colour` can be used as it stands — Other needs its note. */
export function colourIsComplete(
  colour: string | null | undefined,
  note: string | null | undefined,
): boolean {
  const swatch = swatchForName(colour);
  if (!swatch) return Boolean(colour?.trim());
  return !swatch.noteRequired || Boolean(note?.trim());
}

/** Whether picking this colour should reveal the free-text note field. */
export function isNoteColour(name: string | null | undefined): boolean {
  return swatchForName(name)?.note ?? false;
}

/**
 * The answers patch for a colour change — drops the note unless the new colour
 * is a note colour, so a "matte black wrap" note never rides under a plain
 * "Blue" (mirrors the make→model dependency: dependent free text is cleared
 * when its owner changes). The reverse holds for the finish: an escape has no
 * single paint to finish, so picking one drops it. Plain → plain keeps it (a
 * metallic Blue corrected to Grey is still metallic).
 */
export function colourChangePatch(colour: string): {
  colour: string;
  colourNote?: string;
  colourFinish?: null;
} {
  return isNoteColour(colour) ? { colour, colourFinish: null } : { colour, colourNote: '' };
}

/**
 * A paint finish — the optional second half of a colour (2026-10-12). Mirrors
 * the posts/vehicles `colour_finish` CHECK (20261012100000). NULL means "not
 * said", never "solid": most owners won't know or care, and that is fine.
 */
export const COLOUR_FINISH_VALUES = ['metallic', 'matte', 'pearl', 'two_tone_roof'] as const;
export type ColourFinish = (typeof COLOUR_FINISH_VALUES)[number];

/** Whether a colour is asked its finish: one is chosen and it isn't an escape
 *  (a wrap or "Other" has no single paint to finish). The colour step's Next
 *  and its screen-reader hint both read this, so they can't disagree. */
export function colourTakesFinish(colour: string | null | undefined): boolean {
  return Boolean(colour?.trim()) && !isNoteColour(colour);
}

/** The finish options (PaintFinishSheet), in the order a spotter would notice
 *  them. `hint` is what each LOOKS like, for an owner unsure of the word. */
export const COLOUR_FINISHES: { value: ColourFinish; label: string; hint: string }[] = [
  { value: 'metallic', label: 'Metallic', hint: 'Sparkles in sunlight' },
  // British "matt" on screen (UI review); the stored value keeps the CHECK's spelling.
  { value: 'matte', label: 'Matt', hint: 'Flat, with no shine' },
  { value: 'pearl', label: 'Pearl', hint: 'Shifts colour as you walk past' },
  { value: 'two_tone_roof', label: 'Two-tone roof', hint: 'The roof is a different colour' },
];

/** A stored or restored value as a finish, or null. Anything unrecognised — a
 *  value from a newer server, a corrupt draft — reads as "not said" rather than
 *  failing a whole parse over an optional detail. */
export function toColourFinish(value: unknown): ColourFinish | null {
  return (COLOUR_FINISH_VALUES as readonly unknown[]).includes(value)
    ? (value as ColourFinish)
    : null;
}

/** "Metallic" for `metallic`; null when there is none. */
export function colourFinishLabel(finish: unknown): string | null {
  const known = toColourFinish(finish);
  return known ? (COLOUR_FINISHES.find((option) => option.value === known)?.label ?? null) : null;
}

/**
 * The finish as it is SAVED: none for an escape colour, whatever the answers
 * hold. colourChangePatch already drops it on the way in; this is the same
 * rule at every write (create_post, update_post_car_details, add/update_vehicle)
 * so a stale value can't ride under "Other".
 */
export function savedColourFinish(
  colour: string | null | undefined,
  finish: unknown,
): ColourFinish | null {
  return isNoteColour(colour) ? null : toColourFinish(finish);
}

/**
 * "Blue · Metallic" — a colour with its finish, the ONE form wherever both
 * show (the step's summary, the review row, Car details, the garage's "Your
 * car"). " · " is "with a finish"; " — " stays an escape's "described as".
 * Applies savedColourFinish, so a finish the server holds under an escape
 * (it doesn't tie the two) never reads "Other · Metallic".
 */
export function colourWithFinish(colour: string, finish: unknown): string {
  const label = colourFinishLabel(savedColourFinish(colour, finish));
  return label ? `${colour} · ${label}` : colour;
}

/**
 * DVLA colour vocabulary (normalised: upper-case, alphanumerics only) → our
 * canonical swatch name. Since 2026-10-12 every DVLA colour has its own
 * swatch (the V5C vocabulary), so the map is one-to-one; only the spellings
 * of multicolour differ.
 */
export const DVLA_COLOUR_MAP: Record<string, string> = {
  BLACK: 'Black',
  GREY: 'Grey',
  WHITE: 'White',
  SILVER: 'Silver',
  BLUE: 'Blue',
  RED: 'Red',
  MAROON: 'Maroon',
  GREEN: 'Green',
  TURQUOISE: 'Turquoise',
  ORANGE: 'Orange',
  YELLOW: 'Yellow',
  BROWN: 'Brown',
  BEIGE: 'Beige',
  CREAM: 'Cream',
  GOLD: 'Gold',
  PURPLE: 'Purple',
  PINK: 'Pink',
  BRONZE: 'Bronze',
  MULTICOLOUR: 'Multicolour / wrapped',
  MULTICOLOR: 'Multicolour / wrapped',
};

/**
 * Map a DVLA-returned colour to a canonical swatch name (to pre-select it), or
 * null when unrecognised. The DVLA lookup is stubbed this build — nothing feeds
 * this yet — but the plate step's onContinue would call it and set answers.colour
 * so the colour step opens pre-selected (the user can still override).
 */
export function colourFromDvla(dvlaColour: string | null | undefined): string | null {
  const key = (dvlaColour ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return key ? (DVLA_COLOUR_MAP[key] ?? null) : null;
}
