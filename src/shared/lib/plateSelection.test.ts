/**
 * WHAT:  Tests for the plate ranking rules (v3) — one per rule that moved a
 *        right plate up, or a wrong one down, on the real-photo set.
 * WHY:   2026-10-30: on 38 labelled phone photos the recogniser saw the plate
 *        84% of the time, but v1's rules suggested it 53% and v2's 45%. These
 *        pin what closed that gap (71% first choice, 79% in the top three).
 * LINKS: ./plateSelection.ts; ./plateCandidates.ts; docs/plate-scan-decisions.md.
 */

import {
  linesToReread,
  MAX_OFFERED,
  MAX_REREADS,
  MIN_SCORE,
  rankPlates,
  sightingsIn,
  type PlateSighting,
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

/** Rank lines from one 1000px-tall photo read. */
const rank = (...lines: ReturnType<typeof line>[]) =>
  rankPlates(sightingsIn(lines, (l) => l.box!.height / 1000, false, () => null)).map(
    (p) => p.candidate.canon,
  );

describe('rankPlates: which plates are offered, best first', () => {
  it('offers the larger of two clean plates first', () => {
    expect(rank(line('XY34 ZZZ', 30), line('AB12 CDE', 80))).toEqual(['AB12CDE', 'XY34ZZZ']);
  });

  it('prefers the modern reading of an ambiguous line (BVI8 0ZC is BV18 OZC)', () => {
    // Counting swaps alone made it the suffix plate BVI 802C (one swap).
    expect(rank(line('BVI8 0ZC', 80))[0]).toBe('BV18OZC');
  });

  it('fixes I/1 in a short cherished plate that is alone on its line', () => {
    expect(rank(line('SI NON', 80))[0]).toBe('S1NON');
    expect(rank(line('I HRV', 80))[0]).toBe('1HRV');
  });

  it('⚠️ a fragment of the plate on the same line is not a plate of its own', () => {
    // "M345" used to outrank "M345 WED", the line it was cut from.
    expect(rank(line('M345 WED', 80))).toEqual(['M345WED']);
  });

  it('puts a clean read above a corrected one of the same size', () => {
    expect(rank(line('AB1Z CDE', 80), line('XY34 ZZZ', 80))).toEqual(['XY34ZZZ', 'AB12CDE']);
  });

  it('puts a plate seen by more passes above one seen once', () => {
    const once = sightingsIn([line('AB12 CDE', 80)], () => 0.08, false, () => null);
    const twice = [
      ...sightingsIn([line('XY34 ZZZ', 80)], () => 0.08, false, () => null),
      ...sightingsIn([line('XY34 ZZZ', 300)], () => 0.08, true, () => null),
    ];
    expect(rankPlates([...once, ...twice]).map((p) => p.candidate.canon)).toEqual([
      'XY34ZZZ',
      'AB12CDE',
    ]);
  });

  it(`offers at most ${MAX_OFFERED}`, () => {
    const four = ['AB12CDE', 'BC12DEF', 'CD12EFG', 'DE12FGH'].map((t) => line(t, 80));
    expect(rank(...four)).toHaveLength(MAX_OFFERED);
  });

  it('offers nothing below the floor (a tiny, heavily corrected read)', () => {
    const tiny: PlateSighting<null> = {
      candidate: { canon: 'AB12CDE', display: 'AB12 CDE', format: 'current', coercions: 3, cost: 3 },
      share: 0.002,
      fromCrop: false,
      lowercase: true,
      extra: null,
    };
    expect(rankPlates([tiny])).toEqual([]);
    expect(MIN_SCORE).toBeLessThan(0);
  });

  it('keeps what the caller attached (the crop) from the best sighting', () => {
    const plain = sightingsIn([line('AB12 CDE', 20)], () => 0.02, false, () => 'first');
    const crop = sightingsIn([line('AB12 CDE', 300)], () => 0.08, true, () => 'crop-1');
    expect(rankPlates([...plain, ...crop])[0].extra).toBe('crop-1');
  });

  it('nothing read, nothing offered', () => {
    expect(rankPlates([])).toEqual([]);
  });
});
