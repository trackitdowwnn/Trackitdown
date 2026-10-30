/**
 * WHAT:  Tests for the plate selection rules — one per rule that keeps a wrong
 *        plate from being suggested.
 * WHY:   Measured, the old choice was wrong 45% of the time it suggested
 *        anything, and a listing's plate can never change. Each rule removed a
 *        measured class of wrong suggestion; these pin them.
 * LINKS: ./plateSelection.ts; docs/plate-scan-decisions.md.
 */

import {
  cropReading,
  decideFromRereads,
  linesToReread,
  MAX_REREADS,
  type AgreedRead,
} from './plateSelection';

/** A line of text, `height` px tall. */
const line = (text: string, height: number) => ({
  text,
  box: { x: 0, y: 0, width: height * 4.6, height },
});

describe('linesToReread: which lines get a second read', () => {
  it('takes plate-shaped lines, largest first', () => {
    const picked = linesToReread([line('XY34 ZZZ', 30), line('AB12 CDE', 80), line('HIGH STREET', 90)]);
    expect(picked.map((p) => p.firstRead)).toEqual(['AB12CDE', 'XY34ZZZ']);
  });

  it('skips lines with lowercase letters: plates are capitals, signs are not', () => {
    expect(linesToReread([line('Ab12 Cde', 80)])).toEqual([]);
  });

  it('skips a line with no box (its size cannot be judged)', () => {
    expect(linesToReread([{ text: 'AB12 CDE' }])).toEqual([]);
  });

  it(`reads at most ${MAX_REREADS} lines again`, () => {
    const many = ['AB12CDE', 'BC12DEF', 'CD12EFG', 'DE12FGH'].map((t, i) => line(t, 80 - i));
    expect(linesToReread(many)).toHaveLength(MAX_REREADS);
  });
});

describe('cropReading: what the full-size crop says', () => {
  it('reads a clean plate', () => {
    expect(cropReading([line('AB12 CDE', 100)])?.canon).toBe('AB12CDE');
  });

  it('allows ONE corrected character on a structured plate, not two', () => {
    expect(cropReading([line('AB1Z CDE', 100)])?.canon).toBe('AB12CDE');
    // Two corrections in every shape it could be.
    expect(cropReading([line('A8IZ CDE', 100)])).toBeNull();
  });

  it('allows no correction on the loose dateless shapes', () => {
    expect(cropReading([line('ABC 123', 100)])?.canon).toBe('ABC123');
    expect(cropReading([line('ABC 1Z3', 100)])).toBeNull();
  });

  it("⚠️ never turns a badge into a plate ('ST LINE' was once offered as S71 INE)", () => {
    expect(cropReading([line('ST LINE', 100)])).toBeNull();
  });

  it('ignores lowercase lines in the crop too, and takes the largest plate', () => {
    expect(cropReading([line('Ford', 120), line('XY34 ZZZ', 20), line('AB12 CDE', 100)])?.canon).toBe(
      'AB12CDE',
    );
  });
});

describe('decideFromRereads: one plate, two, or none', () => {
  const agreed = (canon: string, height: number): AgreedRead<string> => ({
    candidate: { canon, display: canon, format: 'current', coercions: 0 },
    height,
    extra: `crop-${canon}`,
  });
  const decide = (reads: AgreedRead<string>[]) => decideFromRereads(reads).map((r) => r.candidate.canon);

  it('suggests the largest agreed plate', () => {
    expect(decide([agreed('AB12CDE', 0.08), agreed('XY34ZZZ', 0.02)])).toEqual(['AB12CDE']);
  });

  it('says nothing when the largest is too small to be this car', () => {
    expect(decide([agreed('AB12CDE', 0.015)])).toEqual([]);
    expect(decide([agreed('AB12CDE', 0.02)])).toEqual(['AB12CDE']);
  });

  it('offers both when a different plate is nearly as large (two cars in shot)', () => {
    expect(decide([agreed('AB12CDE', 0.08), agreed('XY34ZZZ', 0.07)])).toEqual(['AB12CDE', 'XY34ZZZ']);
  });

  it('one plate read twice is still one plate, not two cars', () => {
    expect(decide([agreed('AB12CDE', 0.08), agreed('AB12CDE', 0.075)])).toEqual(['AB12CDE']);
  });

  it('keeps what the caller attached (the crop) with each plate', () => {
    expect(decideFromRereads([agreed('AB12CDE', 0.08)])[0].extra).toBe('crop-AB12CDE');
  });

  it('nothing agreed, nothing suggested', () => {
    expect(decide([])).toEqual([]);
  });
});
