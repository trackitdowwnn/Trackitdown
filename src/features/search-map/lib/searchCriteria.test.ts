/**
 * WHAT:  Unit tests for the SearchCriteria model — the empty defaults, the
 *        server mapping (omitting defaults, never emitting a plate key), the
 *        multi-select facets and year range, the pill summary, the legacy
 *        route-param migration, and the distance copy.
 * WHY:   toRpcCriteria is the client→server search contract: a stray key or a
 *        full-range bound sent as a filter would silently narrow results, and
 *        emitting a plate key would break the privacy rule. Pure maths,
 *        hammered here. The plate assertion is deliberately SEPARATE from the
 *        distance one (they were bundled until 2026-08-10) — the geo model
 *        changed and the privacy guarantee must not be edited alongside it.
 * LINKS: src/features/search-map/lib/searchCriteria.ts.
 */

import {
  type SearchCriteria,
  RPC_CRITERIA_KEYS,
  SEARCH_BOUNTY_MAX_PENCE,
  SEARCH_BOUNTY_MIN_PENCE,
  distanceLabel,
  emptyCriteria,
  exclusiveEndIso,
  startOfLocalDayIso,
  isEmptyCriteria,
  parseCriteria,
  seenRangeSummary,
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

  it('counts distance as a filter (it now NARROWS results, not just the camera)', () => {
    // FLIPPED 2026-08-10. This used to assert `true` — back then distanceMiles
    // never crossed the wire and only sized the bbox, so a radius-only search
    // really was unfiltered. It is now sent as p_radius_m and removes cars from
    // the result set, so the pill must show it and offer the × to undo it.
    expect(isEmptyCriteria(withCriteria({ distanceMiles: 10 }))).toBe(false);
  });

  it('counts the new facets as filters', () => {
    expect(isEmptyCriteria(withCriteria({ colours: ['Blue'] }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ bodyTypes: ['SUV'] }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ yearFrom: 2018 }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ yearTo: 2022 }))).toBe(false);
    // An EMPTY multi-select is still "any" — selecting then deselecting a
    // colour must return the pill to its placeholder, not strand it showing a
    // filter that filters nothing.
    expect(isEmptyCriteria(withCriteria({ colours: [], bodyTypes: [] }))).toBe(true);
  });
});

describe('toRpcCriteria', () => {
  it('omits every default (empty criteria → empty object)', () => {
    expect(toRpcCriteria(emptyCriteria())).toEqual({});
  });

  it('maps set facets and trims the text', () => {
    expect(
      toRpcCriteria(
        withCriteria({ text: '  focus ', make: 'BMW', model: '3 Series', colours: ['Blue'] }),
      ),
    ).toEqual({ text: 'focus', make: 'BMW', model: '3 Series', colours: ['Blue'] });
  });

  it('sends multi-select facets as ARRAYS, and omits them when empty', () => {
    expect(toRpcCriteria(withCriteria({ colours: ['Blue', 'Black'] }))).toEqual({
      colours: ['Blue', 'Black'],
    });
    expect(toRpcCriteria(withCriteria({ bodyTypes: ['SUV'] }))).toEqual({ body_types: ['SUV'] });
    // Omitted, not sent as [] — an empty array means "any" to the server too,
    // but sending it would put a meaningless key in the criteriaKeys log line
    // and in the live-count cache key.
    expect(toRpcCriteria(withCriteria({ colours: [], bodyTypes: [] }))).toEqual({});
  });

  it('sends year bounds independently', () => {
    expect(toRpcCriteria(withCriteria({ yearFrom: 2018 }))).toEqual({ year_min: 2018 });
    expect(toRpcCriteria(withCriteria({ yearTo: 2022 }))).toEqual({ year_max: 2022 });
    expect(toRpcCriteria(withCriteria({ yearFrom: 2018, yearTo: 2022 }))).toEqual({
      year_min: 2018,
      year_max: 2022,
    });
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

  // SPLIT from a single "NEVER emits distanceMiles or a plate key" test
  // (2026-08-10). That one bundled a PRIVACY guarantee with a GEO-MODEL
  // guarantee, and the geo half was about to change — so rewriting it for
  // distance risked carrying the plate assertion out with it. They are now
  // independent, and the plate one is the load-bearing half.
  it('NEVER emits a plate key (privacy — SECURITY_AND_TRUST §1)', () => {
    // SAFETY: a plate filter would let an anonymous caller confirm a specific
    // plate is listed. This assertion is STRUCTURAL rather than per-case: the
    // whitelist IS the contract, and every emitted key must be a member of it,
    // so adding a criterion cannot silently widen the surface.
    expect(RPC_CRITERIA_KEYS).not.toContain('plate');

    const rpc = toRpcCriteria(
      withCriteria({
        text: 'AB12CDE',
        make: 'BMW',
        model: '3 Series',
        colours: ['Blue', 'Black'],
        bodyTypes: ['SUV'],
        bountyMinPence: 50000,
        bountyMaxPence: 100000,
        yearFrom: 2018,
        yearTo: 2022,
        recencyDays: 7,
        distanceMiles: 25,
      }),
    );
    expect(rpc).not.toHaveProperty('plate');
    expect(Object.keys(rpc).every((key) => (RPC_CRITERIA_KEYS as readonly string[]).includes(key)))
      .toBe(true);
    // A plate-SHAPED free-text term is still just free text: the server matches
    // it against make/model only, so it can never confirm a plate is listed.
    expect(rpc.text).toBe('AB12CDE');
  });

  it('never emits the radius into p_criteria (it is an RPC parameter)', () => {
    // Distance IS sent now — but as p_origin_lat/p_origin_lng/p_radius_m, never
    // as a criteria key: the bag holds post ATTRIBUTES, and an origin is a
    // frame of reference. mapApi.test.ts covers the parameters themselves.
    const rpc = toRpcCriteria(withCriteria({ make: 'BMW', distanceMiles: 25 }));
    expect(rpc).not.toHaveProperty('distance_miles');
    expect(rpc).not.toHaveProperty('distanceMiles');
    expect(rpc).not.toHaveProperty('radius_m');
    expect(Object.keys(rpc)).toEqual(['make']);
  });
});

describe('summarise', () => {
  it('is empty for unfiltered criteria', () => {
    expect(summarise(emptyCriteria())).toBe('');
  });

  it('builds "Blue BMW · £500+ · 10mi"', () => {
    expect(
      summarise(
        withCriteria({ colours: ['Blue'], make: 'BMW', bountyMinPence: 50000, distanceMiles: 10 }),
      ),
    ).toBe('Blue BMW · £500+ · 10mi');
  });

  it('collapses 3+ multi-select values to a count (the pill is ONE line)', () => {
    expect(summarise(withCriteria({ colours: ['Blue', 'Black'] }))).toBe('Blue, Black');
    expect(summarise(withCriteria({ colours: ['Blue', 'Black', 'Red'] }))).toBe('3 colours');
    expect(summarise(withCriteria({ bodyTypes: ['SUV', 'Van', 'Estate', 'Saloon'] }))).toBe(
      '4 body types',
    );
  });

  it('shows a year range, and each open-ended bound', () => {
    expect(summarise(withCriteria({ yearFrom: 2018, yearTo: 2022 }))).toBe('2018–2022');
    expect(summarise(withCriteria({ yearFrom: 2019, yearTo: 2019 }))).toBe('2019');
    expect(summarise(withCriteria({ yearFrom: 2018 }))).toBe('2018+');
    expect(summarise(withCriteria({ yearTo: 2022 }))).toBe('up to 2022');
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

  it('migrates a LEGACY singular `colour` param rather than discarding the search', () => {
    // The route param is written by one screen and read by another. Normally
    // same bundle, same session — but expo-router state restoration and
    // dev-client reloads can replay an older serialisation, and failing to null
    // would silently throw away the user's WHOLE search rather than the one
    // field that moved.
    const legacy = { ...emptyCriteria(), colour: 'Blue' } as unknown as Record<string, unknown>;
    delete legacy.colours;

    const parsed = parseCriteria(JSON.stringify(legacy));
    expect(parsed?.colours).toEqual(['Blue']);
    // The stale key does not survive into the model (zod strips unknowns).
    expect(parsed).not.toHaveProperty('colour');
  });

  it('defaults the fields an older param could not have carried', () => {
    const old = { ...emptyCriteria() } as unknown as Record<string, unknown>;
    delete old.bodyTypes;
    delete old.yearFrom;
    delete old.yearTo;
    delete old.colours;

    const parsed = parseCriteria(JSON.stringify(old));
    expect(parsed).not.toBeNull();
    expect(parsed?.bodyTypes).toEqual([]);
    expect(parsed?.colours).toEqual([]);
    expect(parsed?.yearFrom).toBeNull();
    expect(parsed?.yearTo).toBeNull();
  });

  it('rejects out-of-range values a crafted deep link could seed', () => {
    // The radius is bounded to the SAME 1–50 the server clamps and the slider
    // offers, so a hand-edited link can't ask for a 500-mile sweep.
    expect(parseCriteria(JSON.stringify(withCriteria({ distanceMiles: 500 })))).toBeNull();
    expect(parseCriteria(JSON.stringify(withCriteria({ yearFrom: 3000 })))).toBeNull();
  });
});

describe('the absolute last-seen window', () => {
  // 10 May 2026 was a Sunday; BST, so local != UTC — which is the point.
  const MAY_10 = new Date(2026, 4, 10);
  const MAY_1 = new Date(2026, 4, 1);

  it('sends an EXCLUSIVE upper bound — the start of the day after the one picked', () => {
    // THE bug this guards: last_seen_at is a timestamp and the user picks a
    // date, so an inclusive `<= 10 May` means `<= 10 May 00:00` and silently
    // drops a car last seen at 14:00 that day.
    const rpc = toRpcCriteria(
      withCriteria({ seenFrom: startOfLocalDayIso(MAY_1), seenTo: startOfLocalDayIso(MAY_10) }),
    );

    expect(rpc.seen_from).toBe(startOfLocalDayIso(MAY_1));
    expect(rpc.seen_to).toBe(startOfLocalDayIso(new Date(2026, 4, 11)));
    // The model still holds the day the user actually picked, so the UI can
    // render it back to them unchanged.
    expect(rpc.seen_to).not.toBe(startOfLocalDayIso(MAY_10));
  });

  it('anchors the window to the LOCAL day, not UTC midnight', () => {
    // A bare UTC midnight would put an hour of BST on the wrong side of the
    // boundary, so "10 May" would mean different windows in different places.
    const iso = startOfLocalDayIso(MAY_10);
    const back = new Date(iso);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(4);
    expect(back.getDate()).toBe(10);
    expect(back.getHours()).toBe(0);
    expect(back.getMinutes()).toBe(0);
  });

  it('crosses a DST boundary without losing or gaining a day', () => {
    // UK clocks go forward on 29 March 2026, so that day is 23 hours long —
    // `+ 86_400_000` would land on the wrong date.
    const dstDay = new Date(2026, 2, 29);
    const next = new Date(exclusiveEndIso(startOfLocalDayIso(dstDay)));
    expect(next.getDate()).toBe(30);
    expect(next.getMonth()).toBe(2);
    expect(next.getHours()).toBe(0);
  });

  it('drops the year in the CURRENT year, and keeps it otherwise', () => {
    // The map pill sits between a back button and a locate button; the full
    // "11 Jul 2026 – 2 Aug 2026" truncated to "…2 Au…" there.
    const thisYear = seenRangeSummary(
      withCriteria({ seenFrom: startOfLocalDayIso(MAY_1), seenTo: startOfLocalDayIso(MAY_10) }),
      new Date(2026, 7, 10),
    );
    expect(thisYear).toBe('1 May – 10 May');

    // A different year is the load-bearing part of the label — keep it.
    const otherYear = seenRangeSummary(
      withCriteria({ seenFrom: startOfLocalDayIso(MAY_1), seenTo: startOfLocalDayIso(MAY_10) }),
      new Date(2030, 0, 1),
    );
    expect(otherYear).toContain('2026');
  });

  it('counts as a filter, and summarises both open-ended forms', () => {
    const from = startOfLocalDayIso(MAY_1);
    const to = startOfLocalDayIso(MAY_10);

    expect(isEmptyCriteria(withCriteria({ seenFrom: from }))).toBe(false);
    expect(isEmptyCriteria(withCriteria({ seenTo: to }))).toBe(false);

    expect(summarise(withCriteria({ seenFrom: from, seenTo: to }))).toContain('–');
    expect(summarise(withCriteria({ seenFrom: from }))).toMatch(/^from /);
    expect(summarise(withCriteria({ seenTo: to }))).toMatch(/^until /);
    // A single-day window reads as one date, not "1 May – 1 May".
    expect(summarise(withCriteria({ seenFrom: from, seenTo: from }))).not.toContain('–');
  });

  it('round-trips through the route param, and rejects a malformed date', () => {
    const criteria = withCriteria({
      seenFrom: startOfLocalDayIso(MAY_1),
      seenTo: startOfLocalDayIso(MAY_10),
    });
    expect(parseCriteria(JSON.stringify(criteria))).toEqual(criteria);

    // Fail-soft, like every other field: the caller drops to unfiltered rather
    // than handing a bad string to formatDateLabel, which THROWS.
    const bad = { ...emptyCriteria(), seenFrom: 'not-a-date' };
    expect(parseCriteria(JSON.stringify(bad))).toBeNull();
  });

  it('defaults to null for a param written before the window existed', () => {
    const old = { ...emptyCriteria() } as unknown as Record<string, unknown>;
    delete old.seenFrom;
    delete old.seenTo;

    const parsed = parseCriteria(JSON.stringify(old));
    expect(parsed).not.toBeNull();
    expect(parsed?.seenFrom).toBeNull();
    expect(parsed?.seenTo).toBeNull();
  });
});

describe('distanceLabel', () => {
  it('NEVER claims proximity to the user — the radius is from the map centre', () => {
    // It used to say "of you" whenever a device fix existed, but holding a fix
    // does not mean the map is still centred on it: after panning to another
    // city that sentence was simply false while the server filtered elsewhere.
    expect(distanceLabel(10)).toBe('within 10 miles of this area');
    expect(distanceLabel(10)).not.toContain('you');
  });

  it('singularises one mile', () => {
    expect(distanceLabel(1)).toBe('within 1 mile of this area');
  });
});
