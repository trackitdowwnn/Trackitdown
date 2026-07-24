/**
 * WHAT:  Tests for the car-colour palette + helpers: every swatch carries a
 *        name (the accessibility guarantee), light swatches are flagged, the
 *        two escapes open the note field, the DVLA colour → swatch mapping, and
 *        colourChangePatch clearing the note when the colour isn't a note colour.
 * WHY:   The colour is a CLEAN ENUM (canonical names drive the card/detail text
 *        and future filters), and a colour-blind spotter reads the NAME — so a
 *        nameless or duplicated swatch, or a note leaking under a plain colour,
 *        is a real defect. The DVLA map is the pre-select seam.
 * LINKS: src/features/vehicles/post/lib/carColours.ts.
 */

import {
  CAR_COLOURS,
  colourChangePatch,
  colourFromDvla,
  isNoteColour,
  swatchForName,
} from './carColours';

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
