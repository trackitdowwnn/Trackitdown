/**
 * WHAT:  Tests for the select components' pure data logic — query
 *        normalisation, case/whitespace-insensitive filtering, empty
 *        results, section grouping and sticky indices, and the
 *        consumer-fed Recent group's rules.
 * WHY:   This logic decides what a user can find and pick in every select
 *        in the app (car make, colour, future filters); a filtering bug
 *        here silently hides valid options everywhere at once.
 * LINKS: src/shared/ui/selectOptions.ts, docs/TESTING.md.
 */

import {
  RECENT_SECTION_TITLE,
  buildSelectList,
  matchesQuery,
  normalizeQuery,
  optionCount,
  stickyHeaderIndices,
  type SelectOption,
} from './selectOptions';

const MAKES: SelectOption[] = [
  { value: 'aston-martin', label: 'Aston Martin', section: 'A' },
  { value: 'audi', label: 'Audi', section: 'A' },
  { value: 'bmw', label: 'BMW', section: 'B' },
  { value: 'bentley', label: 'Bentley', section: 'B' },
];

const COLOURS: SelectOption[] = [
  { value: 'sage', label: 'Sage' },
  { value: 'sand', label: 'Sand' },
];

describe('normalizeQuery', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeQuery('  Aston   MARTIN  ')).toBe('aston martin');
  });
});

describe('matchesQuery', () => {
  it('matches case-insensitively', () => {
    expect(matchesQuery('Aston Martin', normalizeQuery('aStOn'))).toBe(true);
  });

  it('matches with messy whitespace in the query', () => {
    expect(matchesQuery('Aston Martin', normalizeQuery('  aston    martin '))).toBe(true);
  });

  it('rejects non-matches', () => {
    expect(matchesQuery('Audi', normalizeQuery('bmw'))).toBe(false);
  });
});

describe('buildSelectList', () => {
  it('interleaves section headers in first-appearance order with their options', () => {
    const items = buildSelectList(MAKES, '');
    expect(items.map((item) => (item.kind === 'header' ? `#${item.title}` : item.option.label)))
      .toEqual(['#A', 'Aston Martin', 'Audi', '#B', 'BMW', 'Bentley']);
  });

  it('renders unsectioned options without any header', () => {
    const items = buildSelectList(COLOURS, '');
    expect(items.every((item) => item.kind === 'option')).toBe(true);
  });

  it('filters by label, dropping sections that empty out', () => {
    const items = buildSelectList(MAKES, 'audi');
    expect(items.map((item) => (item.kind === 'header' ? `#${item.title}` : item.option.label)))
      .toEqual(['#A', 'Audi']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(buildSelectList(MAKES, 'zonda')).toEqual([]);
  });

  it('puts consumer-fed recents first, in the given order, when not searching', () => {
    const items = buildSelectList(MAKES, '', ['bmw', 'audi']);
    expect(items[0]).toMatchObject({ kind: 'header', title: RECENT_SECTION_TITLE });
    expect(
      items
        .slice(1, 3)
        .map((item) => (item.kind === 'option' ? item.option.label : '?')),
    ).toEqual(['BMW', 'Audi']);
    // The options also remain in their home sections further down.
    expect(optionCount(items)).toBe(MAKES.length + 2);
  });

  it('hides the Recent group while searching and ignores unknown recent values', () => {
    expect(
      buildSelectList(MAKES, 'audi', ['bmw']).some(
        (item) => item.kind === 'header' && item.title === RECENT_SECTION_TITLE,
      ),
    ).toBe(false);
    expect(buildSelectList(MAKES, '', ['not-a-make'])[0]).toMatchObject({ kind: 'header', title: 'A' });
  });
});

describe('list keys', () => {
  it('never collide, even for adversarial section/value combinations', () => {
    const adversarial: SelectOption[] = [
      { value: 'x', label: 'X', section: 'recent' }, // vs the Recent header
      { value: 'b-c', label: 'BC', section: 'A' }, // vs section 'A-b' + 'c'
      { value: 'c', label: 'C', section: 'A-b' },
      { value: 'y', label: 'Y' }, // unsectioned vs a section named 'option'
      { value: 'z', label: 'Z', section: 'option' },
    ];
    const keys = buildSelectList(adversarial, '', ['x']).map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('stickyHeaderIndices / optionCount', () => {
  it('reports the indices of every header item', () => {
    expect(stickyHeaderIndices(buildSelectList(MAKES, ''))).toEqual([0, 3]);
  });

  it('counts only pickable options', () => {
    expect(optionCount(buildSelectList(MAKES, ''))).toBe(4);
    expect(optionCount(buildSelectList(MAKES, 'zonda'))).toBe(0);
  });
});
