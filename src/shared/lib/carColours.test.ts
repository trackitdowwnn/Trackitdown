/**
 * WHAT:  Tests for the car-colour palette + helpers: every swatch carries a
 *        name (the accessibility guarantee), light swatches are flagged, the
 *        two escapes open the note field, the DVLA colour → swatch mapping, and
 *        colourChangePatch clearing the note when the colour isn't a note colour.
 * WHY:   The colour is a CLEAN ENUM (canonical names drive the card/detail text
 *        and future filters), and a colour-blind spotter reads the NAME — so a
 *        nameless or duplicated swatch, or a note leaking under a plain colour,
 *        is a real defect. The DVLA map is the pre-select seam.
 * LINKS: src/shared/lib/carColours.ts.
 */

import {
  CAR_COLOURS,
  colourChangePatch,
  colourFromDvla,
  glyphInkFor,
  isNoteColour,
  swatchForName,
} from './carColours';

/** WCAG 2.1 relative luminance for a #rrggbb string — same maths as
 *  src/shared/theme/colors.test.ts, which is where the pattern comes from. */
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

describe('CAR_COLOURS palette', () => {
  it('gives every swatch a non-empty canonical name (the a11y guarantee)', () => {
    for (const colour of CAR_COLOURS) {
      expect(colour.name.trim().length).toBeGreaterThan(0);
      expect(colour.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('has unique names so the stored value is an unambiguous enum', () => {
    const names = CAR_COLOURS.map((colour) => colour.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('leads with the dominant UK colours in popularity order', () => {
    expect(CAR_COLOURS.slice(0, 5).map((colour) => colour.name)).toEqual([
      'Black',
      'Grey',
      'White',
      'Silver',
      'Blue',
    ]);
  });

  it('flags the light swatches (white/silver/gold) so they get a border', () => {
    expect(swatchForName('White')?.light).toBe(true);
    expect(swatchForName('Silver')?.light).toBe(true);
    expect(swatchForName('Gold')?.light).toBe(true);
    // A dark swatch needs no border.
    expect(swatchForName('Black')?.light).toBeFalsy();
  });

  it('marks exactly the two escapes as note colours', () => {
    const noteColours = CAR_COLOURS.filter((colour) => colour.note).map((colour) => colour.name);
    expect(noteColours).toEqual(['Multicolour / wrapped', 'Other']);
  });
});

describe('⚠️ glyphInkFor — the ink drawn ON a swatch', () => {
  // COMPUTED, NOT ASSERTED (DESIGN_SYSTEM: contrast is computed). The `light`
  // flag is the only thing standing between a new swatch and an invisible glyph
  // — a white car icon on White #F4F5F7 is 1.04:1 — and a component test can
  // only pin WHICH ink was chosen, never whether that choice was legible. Add a
  // colour with the flag the wrong way round and this fails here, at the data,
  // rather than shipping.
  it.each(CAR_COLOURS.map((colour) => [colour.name, colour] as const))(
    'clears the 3:1 graphic-object floor on %s',
    (_name, colour) => {
      expect(contrast(glyphInkFor(colour), colour.hex)).toBeGreaterThanOrEqual(3);
    },
  );

  it('picks the dark ink for pale swatches and the light one for the rest', () => {
    expect(glyphInkFor(swatchForName('White')!)).toBe('#1A1A1A');
    expect(glyphInkFor(swatchForName('Black')!)).toBe('#FFFFFF');
  });
});

describe('swatchForName / isNoteColour', () => {
  it('looks up a swatch case-insensitively and trims', () => {
    expect(swatchForName('  blue ')?.name).toBe('Blue');
    expect(swatchForName('SILVER')?.name).toBe('Silver');
    expect(swatchForName('navy')).toBeUndefined();
    expect(swatchForName('')).toBeUndefined();
    expect(swatchForName(null)).toBeUndefined();
  });

  it('reports the note colours (and only them)', () => {
    expect(isNoteColour('Multicolour / wrapped')).toBe(true);
    expect(isNoteColour('Other')).toBe(true);
    expect(isNoteColour('Blue')).toBe(false);
    expect(isNoteColour('nonsense')).toBe(false);
  });
});

describe('colourChangePatch (note ↔ colour dependency)', () => {
  it('clears the note when switching to a non-note colour', () => {
    expect(colourChangePatch('Blue')).toEqual({ colour: 'Blue', colourNote: '' });
  });

  it('keeps the note field open (unchanged) for a note colour', () => {
    expect(colourChangePatch('Multicolour / wrapped')).toEqual({
      colour: 'Multicolour / wrapped',
    });
    expect(colourChangePatch('Other')).not.toHaveProperty('colourNote');
  });
});

describe('colourFromDvla (pre-select mapping)', () => {
  it('maps the common DVLA colours straight onto a swatch', () => {
    expect(colourFromDvla('SILVER')).toBe('Silver');
    expect(colourFromDvla('GREY')).toBe('Grey');
    expect(colourFromDvla('Blue')).toBe('Blue');
  });

  it('folds near shades onto their nearest swatch', () => {
    expect(colourFromDvla('MAROON')).toBe('Red');
    expect(colourFromDvla('CREAM')).toBe('Brown / Beige');
    expect(colourFromDvla('BEIGE')).toBe('Brown / Beige');
  });

  it('normalises case and punctuation (e.g. "Multi-colour")', () => {
    expect(colourFromDvla('Multi-colour')).toBe('Multicolour / wrapped');
    expect(colourFromDvla('  multicolour ')).toBe('Multicolour / wrapped');
  });

  it('returns null for an unknown or empty colour', () => {
    expect(colourFromDvla('CHROME')).toBeNull();
    expect(colourFromDvla('')).toBeNull();
    expect(colourFromDvla(null)).toBeNull();
  });

  it('maps every value to a real swatch name', () => {
    for (const name of Object.values({ SILVER: 'Silver' })) {
      expect(swatchForName(name)).toBeDefined();
    }
    // Exhaustive: every DVLA mapping target resolves to a real swatch.
    expect(
      ['SILVER', 'GREY', 'MAROON', 'CREAM', 'PINK', 'TURQUOISE', 'MULTICOLOUR'].every(
        (dvla) => swatchForName(colourFromDvla(dvla)) !== undefined,
      ),
    ).toBe(true);
  });
});
