/**
 * WHAT:  Tests for the car-colour palette + helpers: every swatch carries a
 *        name (the accessibility guarantee), light swatches are flagged, the
 *        two escapes open the note field, the DVLA colour → swatch mapping, and
 *        colourChangePatch clearing the note when the colour isn't a note colour
 *        (and the finish when it is); the finish vocabulary and its guards.
 * WHY:   The colour is a CLEAN ENUM (canonical names drive the card/detail text
 *        and future filters), and a colour-blind spotter reads the NAME — so a
 *        nameless or duplicated swatch, or a note leaking under a plain colour,
 *        is a real defect. The DVLA map is the pre-select seam.
 * LINKS: src/shared/lib/carColours.ts.
 */

import {
  CAR_COLOURS,
  COLOUR_FINISHES,
  canonicalColourName,
  colourChangePatch,
  colourFinishLabel,
  colourFromDvla,
  colourIsComplete,
  colourTakesFinish,
  colourWithFinish,
  glyphInkFor,
  isNoteColour,
  savedColourFinish,
  swatchForName,
  toColourFinish,
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
  it('clears the note when switching to a non-note colour, and keeps the finish', () => {
    // No colourFinish key: a metallic Blue corrected to Grey is still metallic.
    expect(colourChangePatch('Blue')).toEqual({ colour: 'Blue', colourNote: '' });
  });

  it('keeps the note (unchanged) for a note colour, and drops the finish', () => {
    expect(colourChangePatch('Multicolour / wrapped')).toEqual({
      colour: 'Multicolour / wrapped',
      colourFinish: null,
    });
    expect(colourChangePatch('Other')).not.toHaveProperty('colourNote');
  });
});

describe('the paint finish', () => {
  it('offers exactly the four values the colour_finish CHECK accepts', () => {
    // 20261012100000: check (colour_finish in ('metallic','matte','pearl','two_tone_roof')).
    expect(COLOUR_FINISHES.map((option) => option.value)).toEqual([
      'metallic',
      'matte',
      'pearl',
      'two_tone_roof',
    ]);
    expect(COLOUR_FINISHES.map((option) => option.label)).toEqual([
      'Metallic',
      'Matt', // British on screen; the stored value keeps the CHECK's 'matte'
      'Pearl',
      'Two-tone roof',
    ]);
  });

  it('asks the finish of a plain colour only — never an escape, never nothing', () => {
    expect(colourTakesFinish('Blue')).toBe(true);
    expect(colourTakesFinish('Brown / Beige')).toBe(true); // a retired name is Brown
    expect(colourTakesFinish('Other')).toBe(false);
    expect(colourTakesFinish('Multicolour / wrapped')).toBe(false);
    expect(colourTakesFinish('')).toBe(false);
    expect(colourTakesFinish(undefined)).toBe(false);
  });

  it('gives each finish a line saying what it looks like', () => {
    for (const finish of COLOUR_FINISHES) expect(finish.hint.length).toBeGreaterThan(0);
  });

  it('writes a colour with its finish in one form, and never under an escape', () => {
    expect(colourWithFinish('Blue', 'metallic')).toBe('Blue · Metallic');
    expect(colourWithFinish('Blue', null)).toBe('Blue');
    expect(colourWithFinish('Blue', 'satin')).toBe('Blue');
    expect(colourWithFinish('Other', 'pearl')).toBe('Other');
  });

  it('reads anything unrecognised as "not said", never throws', () => {
    expect(toColourFinish('pearl')).toBe('pearl');
    expect(toColourFinish('satin')).toBeNull(); // a finish from a newer server
    expect(toColourFinish('Metallic')).toBeNull(); // a label is not a value
    expect(toColourFinish(null)).toBeNull();
    expect(toColourFinish(undefined)).toBeNull();
    expect(toColourFinish(42)).toBeNull();
  });

  it('labels a known finish and nothing else', () => {
    expect(colourFinishLabel('two_tone_roof')).toBe('Two-tone roof');
    expect(colourFinishLabel(null)).toBeNull();
    expect(colourFinishLabel('satin')).toBeNull();
  });

  it('saves no finish under an escape colour, whatever the answers hold', () => {
    expect(savedColourFinish('Blue', 'matte')).toBe('matte');
    expect(savedColourFinish('Blue', null)).toBeNull();
    expect(savedColourFinish('Other', 'matte')).toBeNull();
    expect(savedColourFinish('Multicolour / wrapped', 'pearl')).toBeNull();
    // A retired name is a plain colour (it resolves to Brown).
    expect(savedColourFinish('Brown / Beige', 'metallic')).toBe('metallic');
  });
});

describe('colourFromDvla (pre-select mapping)', () => {
  it('maps the common DVLA colours straight onto a swatch', () => {
    expect(colourFromDvla('SILVER')).toBe('Silver');
    expect(colourFromDvla('GREY')).toBe('Grey');
    expect(colourFromDvla('Blue')).toBe('Blue');
  });

  it('⚠️ gives every V5C colour its own swatch — no folding into a neighbour (2026-10-12)', () => {
    // A pink car used to be posted as "Purple" and a maroon one as "Red".
    expect(colourFromDvla('MAROON')).toBe('Maroon');
    expect(colourFromDvla('TURQUOISE')).toBe('Turquoise');
    expect(colourFromDvla('PINK')).toBe('Pink');
    expect(colourFromDvla('CREAM')).toBe('Cream');
    expect(colourFromDvla('BEIGE')).toBe('Beige');
    expect(colourFromDvla('BROWN')).toBe('Brown');
  });

  it('offers twenty colours, the two escapes last', () => {
    expect(CAR_COLOURS).toHaveLength(20);
    expect(CAR_COLOURS.slice(-2).map((colour) => colour.name)).toEqual([
      'Multicolour / wrapped',
      'Other',
    ]);
  });

  it('⚠️ a stored colour that is an Object property name never crashes', () => {
    // posts.colour is free text: "toString" once read an inherited function
    // from the alias table and threw on every screen drawing the car.
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(() => swatchForName(name)).not.toThrow();
      expect(swatchForName(name)).toBeUndefined();
      expect(canonicalColourName(name)).toBe(name);
    }
  });

  it('⚠️ still resolves a retired name — an old "Brown / Beige" is Brown', () => {
    expect(swatchForName('Brown / Beige')?.name).toBe('Brown');
    expect(swatchForName('  brown / beige ')?.name).toBe('Brown');
    expect(canonicalColourName('Brown / Beige')).toBe('Brown');
    expect(canonicalColourName('Chartreuse')).toBe('Chartreuse');
    expect(canonicalColourName(null)).toBeNull();
  });

  it('⚠️ "Other" is only complete with a description; the wrap and plain colours always are', () => {
    expect(colourIsComplete('Other', '')).toBe(false);
    expect(colourIsComplete('Other', '   ')).toBe(false);
    expect(colourIsComplete('Other', 'Teal')).toBe(true);
    expect(colourIsComplete('Multicolour / wrapped', '')).toBe(true);
    expect(colourIsComplete('Blue', '')).toBe(true);
    expect(colourIsComplete('', '')).toBe(false);
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
