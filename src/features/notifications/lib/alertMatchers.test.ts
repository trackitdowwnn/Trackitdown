/**
 * WHAT:  Tests for the criteria ↔ matchers translation: which cards a saved
 *        alert re-opens with, and which answers survive to the saved row.
 * WHY:   SAFETY. `criteriaForMatchers` is the ONLY thing stopping an unticked
 *        card from leaving a live filter on the alert. `update_my_alert` is a
 *        FULL REPLACE and the wizard's answers keep whatever a step wrote even
 *        after its card is unticked, so without the reduction a user who tried
 *        a BMW filter and changed their mind would keep receiving BMW-only
 *        alerts while every screen told them "Any car" — a silent, invisible
 *        failure of exactly the kind an alert cannot afford, because the way
 *        you discover it is the theft you were never told about.
 *
 *        The round-trip matters too: matchersForCriteria must re-tick anything
 *        criteriaForMatchers would keep, or editing an alert twice would drop
 *        filters one visit at a time.
 * LINKS: ./alertMatchers.ts; ../screens/AlertWizardScreen.tsx (the caller);
 *        ../types.ts.
 */

import { criteriaForMatchers, matchersForCriteria } from './alertMatchers';
import { EMPTY_CRITERIA, type AlertAnswers, type AlertMatcher } from '../types';

const ANSWERS: Partial<AlertAnswers> = {
  make: 'BMW',
  model: '320d',
  colour: 'Blue',
  bodyType: 'saloon',
  minBountyPence: 50000,
  recencyDays: 7,
};

describe('matchersForCriteria', () => {
  it('always ticks area — every alert has a point and a radius', () => {
    expect(matchersForCriteria(EMPTY_CRITERIA)).toEqual(['area']);
  });

  it('ticks car for any one of make, model, colour or body type', () => {
    for (const key of ['make', 'model', 'colour', 'bodyType'] as const) {
      expect(matchersForCriteria({ ...EMPTY_CRITERIA, [key]: 'x' })).toContain('car');
    }
  });

  it('ticks bounty for either a minimum bounty or a recency window', () => {
    expect(matchersForCriteria({ ...EMPTY_CRITERIA, minBountyPence: 50000 })).toContain('bounty');
    // Recency rides with bounty rather than earning a fourth card — an alert
    // saved with ONLY a recency window must still re-open on a step that shows
    // it, or editing would silently drop it.
    expect(matchersForCriteria({ ...EMPTY_CRITERIA, recencyDays: 7 })).toContain('bounty');
  });

  it('re-opens a fully narrowed alert with everything ticked', () => {
    expect(matchersForCriteria({ ...ANSWERS } as never)).toEqual(['area', 'car', 'bounty']);
  });
});

describe('criteriaForMatchers', () => {
  it('keeps every field when its card is ticked', () => {
    expect(criteriaForMatchers(ANSWERS, ['area', 'car', 'bounty'])).toEqual({
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      bodyType: 'saloon',
      minBountyPence: 50000,
      recencyDays: 7,
    });
  });

  it('DROPS car answers when the car card is unticked', () => {
    // The bug this exists to prevent: answers still hold the BMW.
    const criteria = criteriaForMatchers(ANSWERS, ['area', 'bounty']);
    expect(criteria.make).toBeNull();
    expect(criteria.model).toBeNull();
    expect(criteria.colour).toBeNull();
    expect(criteria.bodyType).toBeNull();
    // …while the card that IS ticked keeps its answers.
    expect(criteria.minBountyPence).toBe(50000);
  });

  it('DROPS bounty and recency when the bounty card is unticked', () => {
    const criteria = criteriaForMatchers(ANSWERS, ['area', 'car']);
    expect(criteria.minBountyPence).toBeNull();
    expect(criteria.recencyDays).toBeNull();
    expect(criteria.make).toBe('BMW');
  });

  it('reduces to "any car" when only the area is ticked', () => {
    expect(criteriaForMatchers(ANSWERS, ['area'])).toEqual(EMPTY_CRITERIA);
  });

  it('never emits undefined for an answer that was never set', () => {
    // The RPC takes explicit nulls; undefined would drop the argument and let
    // the server's default decide, which is not the same thing.
    const criteria = criteriaForMatchers({}, ['area', 'car', 'bounty']);
    expect(criteria).toEqual(EMPTY_CRITERIA);
    for (const value of Object.values(criteria)) expect(value).toBeNull();
  });

  it('round-trips: what survives a save re-ticks the same cards', () => {
    const matchers: AlertMatcher[] = ['area', 'car'];
    const saved = criteriaForMatchers(ANSWERS, matchers);
    expect(matchersForCriteria(saved)).toEqual(matchers);
  });
});
