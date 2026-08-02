/**
 * WHAT:  Tests for OCR → ranked plate candidates. The highest-value tests in
 *        the plate-scanning feature.
 * WHY:   This module is the entire brain of scanning and it is pure, so every
 *        accuracy question can be settled here with synthetic recogniser output
 *        instead of on a phone in a car park.
 *
 *        The cases that matter are the glyph confusions. If position-based
 *        coercion regresses, scanning does not break loudly — it just starts
 *        offering people the wrong registration, which they may well confirm.
 * LINKS: ./plateCandidates.ts; ./plate.ts.
 */

import { type TextBlock, extractPlateCandidates } from './plateCandidates';

/** A plate-shaped block, so geometry never accidentally dominates a test. */
const plateBlock = (text: string, width = 460, height = 100): TextBlock => ({
  text,
  box: { x: 0, y: 0, width, height },
});

describe('a clean read', () => {
  it('finds a single plate written with a space', () => {
    const [first] = extractPlateCandidates([plateBlock('AB12 CDE')]);
    expect(first.canon).toBe('AB12CDE');
    expect(first.display).toBe('AB12 CDE');
    expect(first.format).toBe('current');
    expect(first.coercions).toBe(0);
  });

  it('finds a plate embedded in other text on the same line', () => {
    const [first] = extractPlateCandidates([plateBlock('PARKING AB12CDE ONLY')]);
    expect(first.canon).toBe('AB12CDE');
  });

  it('works with no bounding box at all', () => {
    // Some recognisers omit geometry; ranking must degrade, not crash.
    const [first] = extractPlateCandidates([{ text: 'AB12CDE' }]);
    expect(first.canon).toBe('AB12CDE');
  });
});

// The point of the whole module.
describe('glyph confusion resolved by POSITION', () => {
  it.each([
    ['AB1Z CDE', 'AB12CDE', 'Z read in a digit slot is a 2'],
    ['AB1S CDE', 'AB15CDE', 'S in a digit slot is a 5'],
    ['ABIZ CDE', 'AB12CDE', 'I and Z in digit slots'],
    ['AB12 CD0', 'AB12CDO', '0 in a letter slot is an O'],
    ['8B12 CDE', 'BB12CDE', '8 in a letter slot is a B'],
    ['AB12 6DE', 'AB12GDE', '6 in a letter slot is a G'],
  ])('reads %s as %s (%s)', (recognised, expected) => {
    const [first] = extractPlateCandidates([plateBlock(recognised)]);
    expect(first.canon).toBe(expected);
    expect(first.coercions).toBeGreaterThan(0);
  });

  it('prefers the reading that needed FEWER corrections', () => {
    const candidates = extractPlateCandidates([
      plateBlock('AB1Z CDE'), // one coercion
      plateBlock('XY34 ZZZ'), // clean
    ]);
    expect(candidates[0].canon).toBe('XY34ZZZ');
    expect(candidates[0].coercions).toBe(0);
  });

  it('does NOT force a glyph that is not a known look-alike', () => {
    // 'W' is not confusable with any digit; this must not become a plate.
    expect(extractPlateCandidates([plateBlock('ABW2 CDE')])).toHaveLength(0);
  });

  it('accepts a valid older format rather than coercing it into a modern one', () => {
    // A812CDE really IS a prefix-era plate (letter, 3 digits, 3 letters), so
    // the clean reading must win over "correct the 8 into a B".
    const [first] = extractPlateCandidates([plateBlock('A812 CDE')]);
    expect(first.canon).toBe('A812CDE');
    expect(first.format).toBe('prefix');
    expect(first.coercions).toBe(0);
  });

  // The short-format guard. Without it, ordinary text and fragments of a real
  // plate both turn into confident-looking candidates.
  it('never coerces a SHORT string into a plate', () => {
    expect(extractPlateCandidates([plateBlock('2026')])).toHaveLength(0); // a year
    expect(extractPlateCandidates([plateBlock('AB12')])).toHaveLength(0); // half a plate
  });

  it('still accepts a short plate that was read cleanly', () => {
    const [first] = extractPlateCandidates([plateBlock('A123')]);
    expect(first?.canon).toBe('A123');
  });
});

describe('rejecting things that are not plates', () => {
  it.each([
    ['HIGH STREET', 'a street name'],
    ['PAY HERE', 'signage'],
    ['2026', 'a year'],
    ['£4.50', 'a price'],
    ['A', 'a single letter'],
    ['ABCDEFGHIJK', 'a long word'],
  ])('finds nothing in %s (%s)', (text) => {
    expect(extractPlateCandidates([plateBlock(text)])).toHaveLength(0);
  });

  it('returns an empty list for empty input', () => {
    expect(extractPlateCandidates([])).toEqual([]);
    expect(extractPlateCandidates([plateBlock('   ')])).toEqual([]);
  });
});

describe('several plates in frame', () => {
  it('ranks the largest plate-shaped block first', () => {
    // The car in front of you is bigger in frame than the one behind it.
    const candidates = extractPlateCandidates([
      plateBlock('XY34 ZZZ', 150, 33), // distant
      plateBlock('AB12 CDE', 600, 130), // near
    ]);
    expect(candidates[0].canon).toBe('AB12CDE');
  });

  it('prefers plate-shaped geometry over a square block of the same area', () => {
    const candidates = extractPlateCandidates([
      { text: 'XY34ZZZ', box: { x: 0, y: 0, width: 220, height: 220 } },
      { text: 'AB12CDE', box: { x: 0, y: 0, width: 460, height: 100 } },
    ]);
    expect(candidates[0].canon).toBe('AB12CDE');
  });

  it('returns at most the requested number', () => {
    const blocks = [
      plateBlock('AB12 CDE'),
      plateBlock('XY34 ZZZ'),
      plateBlock('LM56 NOP'),
      plateBlock('QR78 STU'),
    ];
    expect(extractPlateCandidates(blocks)).toHaveLength(3);
    expect(extractPlateCandidates(blocks, 1)).toHaveLength(1);
  });

  it('deduplicates the same plate read from several blocks', () => {
    const candidates = extractPlateCandidates([
      plateBlock('AB12 CDE'),
      plateBlock('AB12CDE'),
    ]);
    expect(candidates).toHaveLength(1);
  });
});

describe('older and regional formats', () => {
  it.each([
    ['A123 BCD', 'A123BCD', 'prefix'],
    ['ABC 123A', 'ABC123A', 'suffix'],
    ['ABC 1234', 'ABC1234', 'northernIreland'],
    ['123 ABC', '123ABC', 'dateless'],
  ])('reads %s', (recognised, canon, format) => {
    const [first] = extractPlateCandidates([plateBlock(recognised)]);
    expect(first.canon).toBe(canon);
    expect(first.format).toBe(format);
  });
});

describe('confidence, when the recogniser offers it', () => {
  it('breaks a tie between two equally clean reads', () => {
    const candidates = extractPlateCandidates([
      { text: 'XY34ZZZ', box: { x: 0, y: 0, width: 460, height: 100 }, confidence: 0.4 },
      { text: 'AB12CDE', box: { x: 0, y: 0, width: 460, height: 100 }, confidence: 0.95 },
    ]);
    expect(candidates[0].canon).toBe('AB12CDE');
  });

  it('never outranks a cleaner read', () => {
    // Certainty about the CHARACTERS beats the recogniser's own optimism.
    const candidates = extractPlateCandidates([
      { text: 'AB1Z CDE', box: { x: 0, y: 0, width: 460, height: 100 }, confidence: 1 },
      { text: 'XY34 ZZZ', box: { x: 0, y: 0, width: 460, height: 100 }, confidence: 0 },
    ]);
    expect(candidates[0].canon).toBe('XY34ZZZ');
  });
});
