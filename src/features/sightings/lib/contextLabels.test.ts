/**
 * WHAT:  Tests for contextLabels: the words for every context answer, the
 *        option lists the context step renders, contextSummary()'s narration
 *        order, and contextDetailCount().
 * WHY:   The spotter's chips and the owner's summaries share these words; a
 *        drift between them is the bug the 2026-10-01 redesign removed. The
 *        detail count drives the step's Skip / Continue label, so a "Not sure"
 *        or a blank note counted as a detail would mislabel the button.
 * LINKS: src/features/sightings/lib/contextLabels.ts;
 *        src/features/sightings/components/sightingSteps.tsx (ContextStep).
 */

import {
  CONDITION_OPTIONS,
  FLAG_LABELS,
  PARKED_LIKELIHOOD_LABELS,
  PEOPLE_OPTIONS,
  STATE_OPTIONS,
  STAYING_OPTIONS,
  contextDetailCount,
  contextSummary,
} from './contextLabels';

describe('contextLabels — the shared words', () => {
  it('offers the step\'s options in order, with no retired value', () => {
    expect(STATE_OPTIONS).toEqual(['parked', 'driving', 'being_loaded']);
    // `street` answered "where", not "staying": no longer offered.
    expect(STAYING_OPTIONS).toEqual(['settled', 'moving']);
    expect(PEOPLE_OPTIONS).toEqual(['nobody', 'nearby', 'in_vehicle']);
    expect(CONDITION_OPTIONS).toEqual([
      'plate_changed',
      'damage_visible',
      'being_stripped',
      'looks_intact',
    ]);
  });

  it('still names a legacy street-parked row', () => {
    expect(PARKED_LIKELIHOOD_LABELS.street).toBe('Street parked');
    expect(contextSummary({ contextFlags: ['parked'], parkedLikelihood: 'street' })).toEqual([
      'Parked',
      'Street parked',
    ]);
  });

  it('narrates state, its follow-up, condition, then people — in the chip words', () => {
    expect(
      contextSummary({
        contextFlags: ['driving', 'damage_visible'],
        direction: 'NE',
        peoplePresence: 'in_vehicle',
      }),
    ).toEqual(['Moving', 'Heading north-east', 'Damage visible', 'Someone in it']);
    expect(FLAG_LABELS.being_loaded).toBe('Being loaded or towed');
  });

  it('drops the legacy people flag when the 3-way answer exists', () => {
    expect(
      contextSummary({ contextFlags: ['parked', 'people_nearby'], peoplePresence: 'nobody' }),
    ).toEqual(['Parked', 'No one seen']);
    expect(contextSummary({ contextFlags: ['people_nearby'] })).toEqual(['People nearby']);
  });
});

describe('contextDetailCount', () => {
  it('is 0 for a skipped step, "Not sure" marks and a blank note', () => {
    expect(contextDetailCount({})).toBe(0);
    expect(
      contextDetailCount({
        contextFlags: [],
        note: '   ',
        confirmedFeatureIds: [],
        contextUnsure: ['state', 'people'],
      }),
    ).toBe(0);
  });

  it('counts each answer, condition, mark and the note once', () => {
    expect(
      contextDetailCount({
        contextFlags: ['parked', 'damage_visible'],
        parkedLikelihood: 'settled',
        peoplePresence: 'nobody',
        confirmedFeatureIds: ['m1', 'm2'],
        note: 'By the bins',
      }),
    ).toBe(7);
  });
});
