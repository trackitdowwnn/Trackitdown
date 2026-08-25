/**
 * WHAT:  Contrast tests for both palettes — every text token clears WCAG AA
 *        against the surfaces it can sit on, graphic tokens clear 3:1, and the
 *        dark palette answers for every light token.
 * WHY:   A dark palette is where accessibility quietly dies: a token gets
 *        eyeballed, looks fine on the designer's screen, and ships at 3:1 as
 *        body text. These assertions COMPUTE the ratios rather than pinning
 *        hexes, so changing a value re-checks the promise instead of just
 *        updating the expectation — the lesson StatsSparkline.test.tsx records
 *        after a pinned-token test kept passing while the real ratio fell below
 *        the floor.
 *
 *        Both surfaces are checked, not just the page: cards (`surface`) sit
 *        above the background in both schemes, so text clearing AA on one and
 *        failing on the other is a real and easy-to-miss defect.
 * LINKS: src/shared/theme/colors.ts; docs/DESIGN_SYSTEM.md (contrast tables);
 *        src/features/vehicles/components/StatsSparkline.test.tsx (the
 *        compute-don't-pin precedent).
 */

import { colors, darkColors, paletteFor, type Palette } from './colors';

/** WCAG 2.1 relative luminance for a #rrggbb string. */
function luminance(hex: string): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Tokens rendered as TEXT — WCAG 1.4.3 puts the floor at 4.5:1. */
const TEXT_TOKENS = ['textPrimary', 'textSecondary', 'primary', 'accentText', 'danger'] as const;

/** Non-text graphics (1.4.11) — 3:1. `border` is decorative and exempt. */
const GRAPHIC_TOKENS = ['borderStrong', 'success', 'warning'] as const;

/** Graphic tokens that must clear 3:1 on the PAGE as well as the card.
 *  `borderStrong` joined this on 2026-08-25 when it was raised to #8F8F8F. */
const GRAPHIC_TOKENS_ON_PAGE = ['borderStrong', 'success', 'warning'] as const;

describe.each([
  ['light', colors],
  ['dark', darkColors],
])('%s palette', (_name, palette: Palette) => {
  it.each(TEXT_TOKENS)('%s clears AA (4.5:1) on background AND surface', (token) => {
    expect(contrast(palette[token], palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette[token], palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAPHIC_TOKENS)('%s clears the 3:1 graphic floor on the card surface', (token) => {
    expect(contrast(palette[token], palette.surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(GRAPHIC_TOKENS_ON_PAGE)('%s also clears 3:1 on the PAGE', (token) => {
    // `borderStrong` was excluded from this until 2026-08-25 because it
    // genuinely did not clear it in light (2.832). Raising it to #8F8F8F fixed
    // that, so the exception is gone and the dedicated describe below it went
    // with it. Asserting these on the page stops a future lightening pass from
    // quietly dropping one to a card-only value.
    expect(contrast(palette[token], palette.background)).toBeGreaterThanOrEqual(3);
  });

  it('carries its on-media chrome at AA, unaffected by the scheme', () => {
    // surfaceOverMedia/textOnMedia are the SAME in both palettes by design —
    // a photo is as bright in dark mode as in light, so its chrome must not
    // flip. Asserted per-palette anyway so a future "tidy-up" that themes them
    // has to break a test that says why not.
    expect(contrast(palette.textOnMedia, palette.surfaceOverMedia)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads text on the primary fill at AA', () => {
    expect(contrast(palette.textOnPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads its on-fill ink on the danger fill at AA', () => {
    // `textOnPrimary`, NOT a hardcoded white: Button's danger variant labels
    // itself with that token, and it inverts to near-black in dark. Asserting
    // white here failed at 3.0 against the lightened dark red — the assertion
    // was wrong, not the palette, and pinning the literal would have driven a
    // needless palette change to satisfy a rule the app doesn't follow.
    expect(contrast(palette.textOnPrimary, palette.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it('separates the card surface from the page', () => {
    // Not a WCAG rule — the hierarchy itself. Identical values would flatten
    // every card into the background, which is how "dark mode" ends up as one
    // undifferentiated slab.
    expect(palette.surface).not.toBe(palette.background);
  });
});

describe('⚠️ the off-state Switch boundary', () => {
  // Five new Switch tracks shipped on borderStrong with the Settings screen,
  // which is what finally made the recorded gap worth spending a visual change
  // on. The two contrasts a switch depends on:
  it('the thumb is visible against its own track', () => {
    // React Native's Switch takes thumbColor={surface} on trackColor={
    // borderStrong} when off — if these converge the control reads as a blank
    // pill with no indication of which way it is set.
    expect(contrast(colors.surface, colors.borderStrong)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkColors.surface, darkColors.borderStrong)).toBeGreaterThanOrEqual(3);
  });

  it('the track is visible against the page it sits on', () => {
    // This is the one that was failing: 2.832 in light. A settings row sits on
    // the page background, so an off switch had no boundary clearing 1.4.11 in
    // either direction.
    expect(contrast(colors.borderStrong, colors.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkColors.borderStrong, darkColors.background)).toBeGreaterThanOrEqual(3);
  });
});

describe('paletteFor', () => {
  it('returns the dark palette only for an explicit dark scheme', () => {
    expect(paletteFor('dark')).toBe(darkColors);
    expect(paletteFor('light')).toBe(colors);
  });

  it('falls back to light when the scheme is unresolved', () => {
    // useColorScheme returns null before the native module answers; a null must
    // never be read as "dark" or the app flashes inverted on launch.
    expect(paletteFor(null)).toBe(colors);
    expect(paletteFor(undefined)).toBe(colors);
  });
});

describe('the two palettes', () => {
  it('answer for exactly the same tokens', () => {
    // The `satisfies Palette` in colors.ts catches a MISSING dark token at
    // compile time; this catches the reverse (an extra one) and documents the
    // rule for anyone adding to either.
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(colors).sort());
  });

  it('invert the action colour rather than reusing it', () => {
    // The monochrome scheme's one accent flips: near-black on light, near-white
    // on dark, with textOnPrimary flipping to match. Reusing light's near-black
    // primary on a charcoal page would be invisible.
    expect(contrast(darkColors.primary, darkColors.background)).toBeGreaterThan(10);
    expect(contrast(colors.primary, colors.background)).toBeGreaterThan(10);
  });
});
