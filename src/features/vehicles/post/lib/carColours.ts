/**
 * WHAT:  CAR_COLOURS — the curated palette of real UK car colours for the
 *        post-a-car colour step (swatch grid), plus the DVLA colour → swatch
 *        mapping (`colourFromDvla`), lookups (`swatchForName`, `isNoteColour`),
 *        and `colourChangePatch` (clears the free-text note when the picked
 *        colour isn't a note colour).
 * WHY:   Cars come in ~a dozen real colours, so a curated NAMED-swatch set is
 *        the right pattern — a free colour/hex picker would add friction and
 *        produce useless values like "#8B8C8E". The stored value is the
 *        canonical NAME (posts.colour), a clean enum that drives the card /
 *        detail colour text and future colour filters — NOT a hex. Swatch
 *        hexes are DATA (realistic automotive shades), deliberately exempt
 *        from the token rule: they are content, not UI chrome, so /theme-audit
 *        and reviewers must NOT "tokenise" them. `colourFromDvla` is the seam
 *        for the (stubbed) DVLA lookup — its limited vocabulary maps cleanly
 *        onto this set so a returned colour can pre-select a swatch.
 * LINKS: src/features/vehicles/post/components/ColourField.tsx (renders these);
 *        src/features/vehicles/post/components/postSteps.tsx (ColourStep);
 *        src/features/vehicles/post/lib/carColours.test.ts;
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
}

/**
 * The palette, in rough UK-popularity order (black/grey/white/silver/blue
 * dominate the DVLA registration data), then the two escapes. NOT exhaustive:
 * "Other" always catches the long tail, so the grid can under-offer but never
 * trap. Hexes are DATA — realistic shades, not tokens (see file header).
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
  { name: 'Brown / Beige', hex: '#6B4A2B' },
  { name: 'Gold', hex: '#C9A227', light: true },
  { name: 'Purple', hex: '#5B3A82' },
  { name: 'Bronze', hex: '#8C6A3F' },
  // Escapes — both open the note field. Multicolour shows a two-tone swatch
  // (a wrap is one colour over another); Other is a neutral glyph swatch.
  { name: 'Multicolour / wrapped', hex: '#2B4C7E', secondaryHex: '#C7CCD1', note: true },
  { name: 'Other', hex: '#E4E4E4', light: true, note: true, icon: 'more-horizontal' },
];

/** Case-exact-ish lookup of a swatch by its canonical name (trimmed, case-insensitive). */
export function swatchForName(name: string | null | undefined): CarColour | undefined {
  const target = (name ?? '').trim().toLowerCase();
  if (!target) return undefined;
  return CAR_COLOURS.find((colour) => colour.name.toLowerCase() === target);
}

/** Whether picking this colour should reveal the free-text note field. */
export function isNoteColour(name: string | null | undefined): boolean {
  return swatchForName(name)?.note ?? false;
}

/**
 * The answers patch for a colour change — drops the note unless the new colour
 * is a note colour, so a "matte black wrap" note never rides under a plain
 * "Blue" (mirrors the make→model dependency: dependent free text is cleared
 * when its owner changes).
 */
export function colourChangePatch(colour: string): { colour: string; colourNote?: string } {
  return isNoteColour(colour) ? { colour } : { colour, colourNote: '' };
}

/**
 * DVLA colour vocabulary (normalised: upper-case, alphanumerics only) → our
 * canonical swatch name. DVLA's set is small and maps cleanly; a few shades
 * fold into their nearest swatch (maroon→Red, cream→Brown/Beige), and colours
 * with no swatch (pink, turquoise) fall to a sensible neighbour or Other.
 */
export const DVLA_COLOUR_MAP: Record<string, string> = {
  BLACK: 'Black',
  GREY: 'Grey',
  WHITE: 'White',
  SILVER: 'Silver',
  BLUE: 'Blue',
  RED: 'Red',
  MAROON: 'Red',
  GREEN: 'Green',
  TURQUOISE: 'Green',
  ORANGE: 'Orange',
  YELLOW: 'Yellow',
  BROWN: 'Brown / Beige',
  BEIGE: 'Brown / Beige',
  CREAM: 'Brown / Beige',
  GOLD: 'Gold',
  PURPLE: 'Purple',
  PINK: 'Purple',
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
