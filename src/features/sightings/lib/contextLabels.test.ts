/**
 * WHAT:  Tests for contextLabels: the words for every context answer, the
 *        option lists the context step renders and its questions,
 *        sightingAnswerGroups() (the owner's "What they saw" answers, per
 *        question), contextReviewRows() (the
 *        check-and-send rows), and contextDetailCount().
 * WHY:   The spotter's chips and the owner's summaries share these words; a
 *        drift between them is the bug the 2026-10-01 redesign removed. The
 *        detail count drives the step's Skip / Continue label, so a "Not sure"
 *        or a blank note counted as a detail would mislabel the button.
 * LINKS: src/features/sightings/lib/contextLabels.ts;
 *        src/features/sightings/components/sightingSteps.tsx (ContextStep).
 */

import {
  CONDITION_OPTIONS,
  CONTEXT_QUESTIONS,
  FLAG_LABELS,
  PARKED_LIKELIHOOD_LABELS,
  PEOPLE_OPTIONS,
  STATE_OPTIONS,
  STAYING_OPTIONS,
  contextDetailCount,
  contextReviewRows,
  sightingAnswerGroups,
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
    expect(sightingAnswerGroups({ contextFlags: ['parked'], parkedLikelihood: 'street' })).toEqual(
      [{ key: 'state', question: 'What was it doing?', answers: ['Parked', 'Street parked'] }],
    );
  });

  it('gives the owner each question asked, with the chips they tapped', () => {
    expect(
      sightingAnswerGroups({
        contextFlags: ['driving', 'damage_visible', 'plate_changed'],
        direction: 'NE',
        peoplePresence: 'in_vehicle',
      }),
    ).toEqual([
      { key: 'state', question: 'What was it doing?', answers: ['Moving', 'Heading north-east'] },
      { key: 'people', question: 'Anyone in or near it?', answers: ['Someone in it'] },
      {
        key: 'condition',
        question: 'Its condition',
        answers: ['Damage visible', FLAG_LABELS.plate_changed],
      },
    ]);
    expect(FLAG_LABELS.being_loaded).toBe('Being loaded or towed');
  });

  it('leaves out every question they skipped — or answered "Not sure"', () => {
    expect(sightingAnswerGroups({})).toEqual([]);
    expect(sightingAnswerGroups({ contextFlags: [], peoplePresence: null })).toEqual([]);
  });

  it('shows a legacy two-state row as stored — never guessing which was meant', () => {
    expect(sightingAnswerGroups({ contextFlags: ['parked', 'driving'] })).toEqual([
      { key: 'state', question: 'What was it doing?', answers: ['Parked', 'Moving'] },
    ]);
  });

  it('drops the legacy people flag when the 3-way answer exists', () => {
    expect(
      sightingAnswerGroups({ contextFlags: ['parked', 'people_nearby'], peoplePresence: 'nobody' }),
    ).toEqual([
      { key: 'state', question: 'What was it doing?', answers: ['Parked'] },
      { key: 'people', question: 'Anyone in or near it?', answers: ['No one seen'] },
    ]);
    expect(sightingAnswerGroups({ contextFlags: ['people_nearby'] })).toEqual([
      { key: 'people', question: 'Anyone in or near it?', answers: ['People nearby'] },
    ]);
  });

  it('asks the owner’s page the wizard’s own questions — one copy', () => {
    expect(CONTEXT_QUESTIONS).toEqual({
      state: 'What was it doing?',
      people: 'Anyone in or near it?',
      condition: 'Its condition',
    });
  });

  it('keeps the check-and-send rows as they were (same answers, statement labels)', () => {
    expect(contextReviewRows({ contextFlags: ['parked'], parkedLikelihood: 'settled' })).toEqual([
      {
        key: 'state',
        label: 'What it was doing',
        value: `Parked · ${PARKED_LIKELIHOOD_LABELS.settled}`,
      },
    ]);
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

// The owner's sighting page reads the spotter's answers as the chips they
// tapped, under the questions they were asked (2026-10-19; text rows under
// the check-step's labels since 2026-10-08).
describe('sightingAnswerGroups — the owner’s "What they saw"', () => {
  it('carries the SAME answers as the spotter’s check-and-send rows', () => {
    const answers = {
      contextFlags: ['parked', 'damage_visible'] as const,
      parkedLikelihood: 'settled' as const,
      peoplePresence: 'nearby' as const,
    };
    const owner = sightingAnswerGroups({ ...answers, contextFlags: [...answers.contextFlags] });
    const spotter = contextReviewRows({ ...answers, contextFlags: [...answers.contextFlags] });
    const shared = ['state', 'people', 'condition'];
    expect(owner.map((group) => group.answers.join(' · '))).toEqual(
      spotter.filter((row) => shared.includes(row.key)).map((row) => row.value),
    );
    expect(owner.map((group) => group.question)).toEqual([
      'What was it doing?',
      'Anyone in or near it?',
      'Its condition',
    ]);
  });

  it('shows only the questions that were answered', () => {
    expect(sightingAnswerGroups({ contextFlags: [] })).toEqual([]);
    expect(sightingAnswerGroups({ contextFlags: [], peoplePresence: 'nobody' })).toEqual([
      { key: 'people', question: 'Anyone in or near it?', answers: ['No one seen'] },
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

  it('what the spotter checks is what the owner reads (one vocabulary)', () => {
    const answers = {
      contextFlags: ['parked', 'looks_intact'] as const,
      parkedLikelihood: 'settled' as const,
      peoplePresence: 'nearby' as const,
    };
    const checked = contextReviewRows({ ...answers, contextFlags: [...answers.contextFlags] });
    const owner = sightingAnswerGroups({ ...answers, contextFlags: [...answers.contextFlags] });
    // The spotter's rows add marks and the note, which the owner's page shows
    // in blocks of its own; the answers themselves are identical.
    expect(
      checked
        .filter((row) => owner.some((group) => group.key === row.key))
        .map((row) => [row.key, row.value]),
    ).toEqual(owner.map((group) => [group.key, group.answers.join(' · ')]));
    expect(owner.length).toBe(3);
  });
});
