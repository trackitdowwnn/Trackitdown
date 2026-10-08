/**
 * WHAT:  Tests for contextLabels: the words for every context answer, the
 *        option lists the context step renders, contextSummary()'s narration
 *        order, contextReviewRows() (the check-and-send rows), and
 *        contextDetailCount().
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
  contextReviewRows,
  contextSummary,
  sightingDetailRows,
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

// 2026-10-08: the owner's sighting page reads the spotter's answers under the
// same labels the spotter checked them under.
describe('sightingDetailRows — the owner’s "What they saw"', () => {
  it('uses the SAME words as the spotter’s check-and-send rows', () => {
    const answers = {
      contextFlags: ['parked', 'damage_visible'] as const,
      parkedLikelihood: 'settled' as const,
      peoplePresence: 'nearby' as const,
    };
    const owner = sightingDetailRows({ ...answers, contextFlags: [...answers.contextFlags] });
    const spotter = contextReviewRows({ ...answers, contextFlags: [...answers.contextFlags] });
    const shared = ['state', 'people', 'condition'];
    expect(owner).toEqual(spotter.filter((row) => shared.includes(row.key)));
    expect(owner.map((row) => row.label)).toEqual([
      'What it was doing',
      'Anyone in or near it',
      'Its condition',
    ]);
  });

  it('shows only the questions that were answered', () => {
    expect(sightingDetailRows({ contextFlags: [] })).toEqual([]);
    expect(sightingDetailRows({ contextFlags: [], peoplePresence: 'nobody' })).toEqual([
      { key: 'people', label: 'Anyone in or near it', value: 'No one seen' },
    ]);
  });
});

describe('contextReviewRows — the check-and-send rows', () => {
  const MARKS = [
    { id: 'm1', description: 'Bee sticker' },
    { id: 'm2', description: 'Roof rack' },
  ];

  it('labels every answered question, in the chip words, marks in the owner’s order', () => {
    expect(
      contextReviewRows({
        contextFlags: ['driving', 'damage_visible', 'plate_changed'],
        direction: 'NE',
        peoplePresence: 'in_vehicle',
        confirmableFeatures: MARKS,
        confirmedFeatureIds: ['m2', 'm1', 'gone'],
        note: '  Two men loading it  ',
      }),
    ).toEqual([
      { key: 'state', label: 'What it was doing', value: 'Moving · Heading north-east' },
      { key: 'people', label: 'Anyone in or near it', value: 'Someone in it' },
      {
        key: 'condition',
        label: 'Its condition',
        value: 'Damage visible · Plate changed or missing',
      },
      { key: 'marks', label: 'Marks you could see', value: 'Bee sticker · Roof rack' },
      { key: 'note', label: 'Your note', value: 'Two men loading it' },
    ]);
  });

  it('is empty for a skipped step, "Not sure" marks and a blank note', () => {
    expect(contextReviewRows({})).toEqual([]);
    expect(
      contextReviewRows({
        contextFlags: [],
        note: '   ',
        confirmedFeatureIds: [],
        contextUnsure: ['state', 'people', 'direction'],
      }),
    ).toEqual([]);
  });

  it('reads a legacy people flag only when there is no 3-way answer', () => {
    expect(contextReviewRows({ contextFlags: ['people_nearby'] })).toEqual([
      { key: 'people', label: 'Anyone in or near it', value: 'People nearby' },
    ]);
    expect(
      contextReviewRows({ contextFlags: ['people_nearby'], peoplePresence: 'nobody' }),
    ).toEqual([{ key: 'people', label: 'Anyone in or near it', value: 'No one seen' }]);
  });

  it('says everything contextSummary says (one vocabulary)', () => {
    const answers = {
      contextFlags: ['parked', 'looks_intact'] as const,
      parkedLikelihood: 'settled' as const,
      peoplePresence: 'nearby' as const,
    };
    const rowText = contextReviewRows({ ...answers, contextFlags: [...answers.contextFlags] })
      .map((row) => row.value)
      .join(' · ');
    for (const part of contextSummary({ ...answers, contextFlags: [...answers.contextFlags] })) {
      expect(rowText).toContain(part);
    }
  });
});
