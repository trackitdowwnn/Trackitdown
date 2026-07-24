/**
 * WHAT:  Unit tests for the SearchCriteria model — the empty defaults, the
 *        server mapping (omitting defaults, never emitting plate/distance),
 *        the pill summary, and value equality.
 * WHY:   toRpcCriteria is the client→server search contract: a stray key or a
 *        full-range bound sent as a filter would silently narrow results, and
 *        emitting distance/plate would break the geo model / privacy rule. Pure
 *        maths, hammered here.
 * LINKS: src/features/search-map/lib/searchCriteria.ts.
 */

import {
  type SearchCriteria,
  SEARCH_BOUNTY_MAX_PENCE,
  SEARCH_BOUNTY_MIN_PENCE,
  emptyCriteria,
  isEmptyCriteria,
  parseCriteria,
  summarise,
  toRpcCriteria,
} from './searchCriteria';

const withCriteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
  ...emptyCriteria(),
  ...overrides,
});

describe('emptyCriteria / isEmptyCriteria', () => {
  it('starts unfiltered', () => {
    const empty = emptyCriteria();
    expect(empty.bountyMinPence).toBe(SEARCH_BOUNTY_MIN_PENCE);
    expect(empty.bountyMaxPence).toBe(SEARCH_BOUNTY_MAX_PENCE);
    expect(isEmptyCriteria(empty)).toBe(true);
  });

  it('is not empty once any facet is set', () => {
    expect(isEmptyCriteria(withCriteria({ make: 'BMW' }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ text: 'focus' }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ bountyMinPence: 50000 }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ recencyDays: 7 }))).toBe(false);
  });

  it('ignores distance for emptiness (it never filters, only frames)', () => {
    expect(isEmptyCriteria(withCriteria({ distanceMiles: 10 }))).toBe(true);
  });
});

describe('toRpcCriteria', () => {
  it('omits every default (empty criteria → empty object)', () => {
    expect(toRpcCriteria(emptyCriteria())).toEqual({});
  });

  it('maps set facets and trims the text', () => {
    expect(
      toRpcCriteria(
        withCriteria({ text: '  focus ', make: 'BMW', model: '3 Series', colour: 'Blue' }),
      ),
    ).toEqual({ text: 'focus', make: 'BMW', model: '3 Series', colour: 'Blue' });
  });

  it('only sends a bounty bound when it narrows the range', () => {
    expect(toRpcCriteria(withCriteria({ bountyMinPence: 50000 }))).toEqual({ bounty_min: 50000 });
    expect(toRpcCriteria(withCriteria({ bountyMaxPence: 100000 }))).toEqual({ bounty_max: 100000 });
    expect(
      toRpcCriteria(withCriteria({ bountyMinPence: 50000, bountyMaxPence: 100000 })),
    ).toEqual({ bounty_min: 50000, bounty_max: 100000 });
  });

  it('sends recency_days when set', () => {
    expect(toRpcCriteria(withCriteria({ recencyDays: 30 }))).toEqual({ recency_days: 30 });
  });

  it('NEVER emits distanceMiles or a plate key (geo model + privacy)', () => {
    const rpc = toRpcCriteria(
      withCriteria({ make: 'BMW', distanceMiles: 25, recencyDays: 7, text: 'x' }),
    );
    expect(rpc).not.toHaveProperty('distance_miles');
    expect(rpc).not.toHaveProperty('distanceMiles');
    expect(rpc).not.toHaveProperty('plate');
    // Only the whitelisted keys ever appear.
    expect(Object.keys(rpc).sort()).toEqual(['make', 'recency_days', 'text']);
  });
});

describe('summarise', () => {
  it('is empty for unfiltered criteria', () => {
    expect(summarise(emptyCriteria())).toBe('');
  });

  it('builds "Blue BMW · £500+ · 10mi"', () => {
    expect(
      summarise(
        withCriteria({ colour: 'Blue', make: 'BMW', bountyMinPence: 50000, distanceMiles: 10 }),
      ),
    ).toBe('Blue BMW · £500+ · 10mi');
  });

  it('falls back to free text when no facet is chosen', () => {
    expect(summarise(withCriteria({ text: 'transit' }))).toBe('transit');
  });

  it('shows a bounty band and recency', () => {
    expect(
      summarise(withCriteria({ bountyMinPence: 50000, bountyMaxPence: 100000, recencyDays: 7 })),
    ).toBe('£500–£1,000 · 7d');
    expect(summarise(withCriteria({ bountyMaxPence: 100000 }))).toBe('up to £1,000');
  });
});

describe('parseCriteria', () => {
  it('round-trips a JSON criteria param', () => {
    const criteria = withCriteria({ make: 'BMW', bountyMinPence: 50000, distanceMiles: 10 });
    expect(parseCriteria(JSON.stringify(criteria))).toEqual(criteria);
  });

  it('returns null for absent, empty, or corrupt input', () => {
    expect(parseCriteria(undefined)).toBeNull();
    expect(parseCriteria('')).toBeNull();
    expect(parseCriteria('{not json')).toBeNull();
    expect(parseCriteria(JSON.stringify({ make: 'BMW' }))).toBeNull(); // wrong shape
  });
});
