/**
 * WHAT:  Tests for contextLabels: the words for every context answer, the
 *        option lists the context step renders and its questions,
 *        sightingAnswerGroups() (the owner's "What they saw" answers, per
 *        question), contextReviewGroups() (the check-and-send step's
 *        cards, 2026-10-22), and contextDetailCount(); the damage seen
 *        (2026-10-21) on the "Damage visible" line, and its own words; which
 *        parts are missing (2026-10-21) in brackets on that line, for both.
 * WHY:   The spotter's chips and the owner's summaries share these words; a
 *        drift between them is the bug the 2026-10-01 redesign removed. The
 *        detail count drives the step's Skip / Continue label, so a "Not sure"
 *        or a blank note counted as a detail would mislabel the button.
 * LINKS: src/features/sightings/lib/contextLabels.ts;
 *        src/features/sightings/components/sightingSteps.tsx (ContextStep).
 */

import {
  CONDITION_OPTIONS,
  CONTEXT_OPTION_DESCRIPTIONS,
  CONTEXT_QUESTIONS,
  CONTEXT_SHORT_LABELS,
  CONTEXT_STEP_QUESTIONS,
  DAMAGE_KIND_LABELS,
  FLAG_LABELS,
  MISSING_PART_LABELS,
  PARKED_LIKELIHOOD_LABELS,
  PEOPLE_OPTIONS,
  STATE_OPTIONS,
  STAYING_OPTIONS,
  contextDetailCount,
  contextReviewGroups,
  sightingAnswerGroups,
} from './contextLabels';
import { DAMAGE_KINDS, MISSING_PARTS } from '../types';

/** A check-and-send group as the one line it reads as — each card's title
 *  with its line, or the words, or the marks — so the assertions below read
 *  like the screen. contextReviewGroups' own shape is pinned separately. */
function asRows(answers: Parameters<typeof contextReviewGroups>[0]) {
  return contextReviewGroups(answers).map((group) => ({
    key: group.key,
    label: group.label,
    value: group.cards
      ? group.cards
          .map((card) => (card.detail ? `${card.label} · ${card.detail}` : card.label))
          .join(' · ')
      : group.marks
        ? group.marks.map((mark) => mark.description).join(' · ')
        : group.text,
  }));
}

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
      [{ key: 'state', label: 'Doing', answers: ['Parked', 'Street parked'] }],
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
      { key: 'state', label: 'Doing', answers: ['Moving', 'Heading north-east'] },
      { key: 'people', label: 'People', answers: ['Someone in it'] },
      {
        key: 'condition',
        label: 'Condition',
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
      { key: 'state', label: 'Doing', answers: ['Parked', 'Moving'] },
    ]);
  });

  it('drops the legacy people flag when the 3-way answer exists', () => {
    expect(
      sightingAnswerGroups({ contextFlags: ['parked', 'people_nearby'], peoplePresence: 'nobody' }),
    ).toEqual([
      { key: 'state', label: 'Doing', answers: ['Parked'] },
      { key: 'people', label: 'People', answers: ['No one seen'] },
    ]);
    expect(sightingAnswerGroups({ contextFlags: ['people_nearby'] })).toEqual([
      { key: 'people', label: 'People', answers: ['People nearby'] },
    ]);
  });

  it('keeps the wizard’s questions in one copy', () => {
    expect(CONTEXT_QUESTIONS).toEqual({
      state: 'What was it doing?',
      people: 'Anyone in or near it?',
      condition: 'Its condition',
    });
  });

  it('labels the owner’s table in one word per question', () => {
    expect(CONTEXT_SHORT_LABELS).toEqual({ state: 'Doing', people: 'People', condition: 'Condition' });
  });

  it('labels check-and-send’s questions as statements, the follow-up on the card', () => {
    expect(asRows({ contextFlags: ['parked'], parkedLikelihood: 'settled' })).toEqual([
      {
        key: 'state',
        label: 'What it was doing',
        value: `Parked · ${PARKED_LIKELIHOOD_LABELS.settled}`,
      },
    ]);
  });
});

describe('the context steps’ cards (2026-10-20)', () => {
  const lines = [
    ...STATE_OPTIONS.map((value) => CONTEXT_OPTION_DESCRIPTIONS.state[value]),
    ...STAYING_OPTIONS.map(
      (value) => CONTEXT_OPTION_DESCRIPTIONS.staying[value as 'settled' | 'moving'],
    ),
    ...PEOPLE_OPTIONS.map((value) => CONTEXT_OPTION_DESCRIPTIONS.people[value]),
  ];

  it('gives every single-answer card one short line — six words at most (fewer words)', () => {
    expect(lines).toHaveLength(8);
    for (const line of lines) {
      expect(line).toBeTruthy();
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(6);
    }
  });

  it('⚠️ SAFETY: no line asks the spotter to follow, watch, track or go closer', () => {
    for (const line of lines) {
      expect(line).not.toMatch(
        /follow|watch|track|approach|closer|nearer|check|inspect|wait|meet|get close|go to/i,
      );
    }
  });

  it('keeps the condition cards title-only (owner, 2026-10-21)', () => {
    expect('condition' in CONTEXT_OPTION_DESCRIPTIONS).toBe(false);
    expect(CONDITION_OPTIONS).toHaveLength(4);
  });

  it('asks each step’s question in the same words the rest of the app uses', () => {
    expect(CONTEXT_STEP_QUESTIONS.state).toBe(CONTEXT_QUESTIONS.state);
    expect(CONTEXT_STEP_QUESTIONS.people).toBe(CONTEXT_QUESTIONS.people);
    expect(CONTEXT_STEP_QUESTIONS.condition).toBe(CONTEXT_QUESTIONS.condition);
    expect(CONTEXT_STEP_QUESTIONS.damage).toBe('What damage can you see?');
    expect(CONTEXT_STEP_QUESTIONS.parts).toBe('What’s missing?');
  });
});

describe('what damage (owner, 2026-10-21)', () => {
  it('offers the six kinds in the server’s order, each in plain words', () => {
    // The steps offer DAMAGE_KINDS itself — the one list, no second copy.
    expect(DAMAGE_KINDS).toEqual([
      'smashed_window',
      'dents_scrapes',
      'broken_lights',
      'missing_wheels',
      'missing_parts',
      'fire_damage',
    ]);
    expect(DAMAGE_KINDS.map((kind) => DAMAGE_KIND_LABELS[kind])).toEqual([
      'Smashed window',
      'Dents or scrapes',
      'Broken lights',
      'Missing wheels',
      'Missing panels or parts',
      'Fire damage',
    ]);
  });

  it('puts the damage seen on the "Damage visible" line — for the owner and the spotter alike', () => {
    const source = {
      contextFlags: ['damage_visible', 'plate_changed'] as const,
      damageKinds: ['smashed_window', 'dents_scrapes'],
    };
    expect(sightingAnswerGroups({ ...source, contextFlags: [...source.contextFlags] })).toEqual([
      {
        key: 'condition',
        label: 'Condition',
        answers: ['Damage visible · Smashed window, Dents or scrapes', 'Plate changed or missing'],
      },
    ]);
    expect(
      asRows({
        contextFlags: [...source.contextFlags],
        damageKinds: ['smashed_window', 'dents_scrapes'],
      }),
    ).toEqual([
      {
        key: 'condition',
        label: 'Its condition',
        value: 'Damage visible · Smashed window, Dents or scrapes · Plate changed or missing',
      },
    ]);
  });

  it('⚠️ skips a kind this app doesn’t know (a newer server’s) — never a crash', () => {
    expect(
      sightingAnswerGroups({
        contextFlags: ['damage_visible'],
        damageKinds: ['flood_damage', 'broken_lights', 'toString'],
      }),
    ).toEqual([
      { key: 'condition', label: 'Condition', answers: ['Damage visible · Broken lights'] },
    ]);
    // Nothing known at all: the plain flag, as before.
    expect(
      sightingAnswerGroups({ contextFlags: ['damage_visible'], damageKinds: ['flood_damage'] }),
    ).toEqual([{ key: 'condition', label: 'Condition', answers: ['Damage visible'] }]);
    expect(sightingAnswerGroups({ contextFlags: ['damage_visible'], damageKinds: null })).toEqual([
      { key: 'condition', label: 'Condition', answers: ['Damage visible'] },
    ]);
  });

  it('gives their words about the damage a row of their own, after the condition', () => {
    expect(
      asRows({
        contextFlags: ['damage_visible'],
        damageNote: '  Driver’s mirror hanging off  ',
        note: 'By the bins',
      }),
    ).toEqual([
      { key: 'condition', label: 'Its condition', value: 'Damage visible' },
      { key: 'damage', label: 'About the damage', value: 'Driver’s mirror hanging off' },
      { key: 'note', label: 'Your note', value: 'By the bins' },
    ]);
    expect(asRows({ contextFlags: ['damage_visible'], damageNote: '   ' })).toEqual([
      { key: 'condition', label: 'Its condition', value: 'Damage visible' },
    ]);
  });
});

describe('what’s missing (owner, 2026-10-21)', () => {
  it('offers six parts you can see from where you stand, in the server’s order', () => {
    expect(MISSING_PARTS).toEqual([
      'bumpers',
      'bonnet',
      'doors',
      'lights',
      'wing_mirrors',
      'number_plates',
    ]);
    expect(MISSING_PARTS.map((part) => MISSING_PART_LABELS[part])).toEqual([
      'Bumpers',
      'Bonnet',
      'Doors',
      'Lights',
      'Wing mirrors',
      'Number plates',
    ]);
  });

  const source = {
    contextFlags: ['damage_visible' as const],
    damageKinds: ['smashed_window', 'missing_parts'],
    missingParts: ['bumpers', 'doors'],
  };

  it('names the parts in brackets on "Missing panels or parts" for the owner', () => {
    expect(sightingAnswerGroups(source)).toEqual([
      {
        key: 'condition',
        label: 'Condition',
        answers: ['Damage visible · Smashed window, Missing panels or parts (Bumpers, Doors)'],
      },
    ]);
  });

  it('⚠️ never shows empty brackets — no parts, or none this app knows, read plain', () => {
    const plain = [
      {
        key: 'condition',
        label: 'Condition',
        answers: ['Damage visible · Smashed window, Missing panels or parts'],
      },
    ];
    expect(sightingAnswerGroups({ ...source, missingParts: null })).toEqual(plain);
    expect(sightingAnswerGroups({ ...source, missingParts: [] })).toEqual(plain);
    expect(sightingAnswerGroups({ ...source, missingParts: ['spoiler', 'toString'] })).toEqual(
      plain,
    );
    // A known part beside an unknown one: the known one alone.
    expect(
      sightingAnswerGroups({ ...source, missingParts: ['spoiler', 'bonnet'] })[0].answers,
    ).toEqual(['Damage visible · Smashed window, Missing panels or parts (Bonnet)']);
  });

  it('puts the parts on the "Damage visible" card and their words in a block of their own', () => {
    expect(
      asRows({
        ...source,
        contextFlags: ['damage_visible'],
        damageKinds: ['smashed_window', 'missing_parts'],
        missingParts: ['bumpers', 'doors'],
        damageNote: 'Glass everywhere',
        missingPartsNote: '  Rear bumper on the pavement ',
      }),
    ).toEqual([
      {
        key: 'condition',
        label: 'Its condition',
        // The card shows what was tapped, parts and all (owner, 2026-10-22).
        value: 'Damage visible · Smashed window, Missing panels or parts (Bumpers, Doors)',
      },
      { key: 'damage', label: 'About the damage', value: 'Glass everywhere' },
      { key: 'parts', label: 'About what’s missing', value: 'Rear bumper on the pavement' },
    ]);
    // The words alone make the block; parts alone ride on the card only.
    const block = (answers: object) =>
      asRows({ contextFlags: ['damage_visible'], ...answers }).find(
        (candidate) => candidate.key === 'parts',
      )?.value;
    expect(block({ missingPartsNote: 'Both mirrors' })).toBe('Both mirrors');
    expect(block({ missingParts: ['lights'] })).toBeUndefined();
    expect(block({ missingParts: [], missingPartsNote: '   ' })).toBeUndefined();
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

  it('counts each kind of damage, and their words about it once — a blank box not at all', () => {
    expect(
      contextDetailCount({
        contextFlags: ['damage_visible'],
        damageKinds: ['smashed_window', 'fire_damage'],
        damageNote: 'Scorched bonnet',
      }),
    ).toBe(4);
    expect(contextDetailCount({ contextFlags: ['damage_visible'], damageNote: '  ' })).toBe(1);
  });

  it('counts each missing part, and their words about it once', () => {
    expect(
      contextDetailCount({
        contextFlags: ['damage_visible'],
        damageKinds: ['missing_parts'],
        missingParts: ['doors', 'bonnet'],
        missingPartsNote: 'Bonnet on the verge',
      }),
    ).toBe(5);
    expect(
      contextDetailCount({
        contextFlags: ['damage_visible'],
        damageKinds: ['missing_parts'],
        missingPartsNote: '  ',
      }),
    ).toBe(2);
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
    const spotter = asRows({ ...answers, contextFlags: [...answers.contextFlags] });
    const shared = ['state', 'people', 'condition'];
    expect(owner.map((group) => group.answers.join(' · '))).toEqual(
      spotter.filter((row) => shared.includes(row.key)).map((row) => row.value),
    );
    expect(owner.map((group) => group.label)).toEqual(['Doing', 'People', 'Condition']);
  });

  it('shows only the questions that were answered', () => {
    expect(sightingAnswerGroups({ contextFlags: [] })).toEqual([]);
    expect(sightingAnswerGroups({ contextFlags: [], peoplePresence: 'nobody' })).toEqual([
      { key: 'people', label: 'People', answers: ['No one seen'] },
    ]);
  });
});

describe('sightingAnswerGroups — pinned literally (both sides now build on the same cards)', () => {
  it('reads exactly as it did before the cards, legacy rows included', () => {
    expect(
      sightingAnswerGroups({
        contextFlags: ['parked', 'driving', 'people_nearby', 'damage_visible', 'being_stripped'],
        parkedLikelihood: 'settled',
        direction: 'SW',
        damageKinds: ['missing_parts', 'flood_damage', 'broken_lights'],
        missingParts: ['bonnet', 'spoiler'],
      }),
    ).toEqual([
      {
        key: 'state',
        label: 'Doing',
        answers: ['Parked', 'Looks parked up', 'Moving', 'Heading south-west'],
      },
      { key: 'people', label: 'People', answers: ['People nearby'] },
      {
        key: 'condition',
        label: 'Condition',
        answers: [
          'Damage visible · Missing panels or parts (Bonnet), Broken lights',
          'Being stripped',
        ],
      },
    ]);
  });
});

describe('contextReviewGroups — check-and-send shows the cards they tapped', () => {
  it('gives each answer as its card: the question it came from, the value, the title, its line', () => {
    expect(
      contextReviewGroups({
        contextFlags: ['parked', 'damage_visible'],
        parkedLikelihood: 'settled',
        peoplePresence: 'nearby',
        damageKinds: ['fire_damage'],
        confirmableFeatures: [
          { id: 'm1', description: 'Bee sticker', photoUrl: 'https://example.test/m1.jpg' },
        ],
        confirmedFeatureIds: ['m1'],
      }),
    ).toEqual([
      {
        key: 'state',
        label: 'What it was doing',
        cards: [{ question: 'state', value: 'parked', label: 'Parked', detail: 'Looks parked up' }],
      },
      {
        key: 'people',
        label: 'Anyone in or near it',
        cards: [{ question: 'people', value: 'nearby', label: 'People near it' }],
      },
      {
        key: 'condition',
        label: 'Its condition',
        cards: [
          {
            question: 'condition',
            value: 'damage_visible',
            label: 'Damage visible',
            detail: 'Fire damage',
            items: [{ value: 'fire_damage', label: 'Fire damage' }],
          },
        ],
      },
      {
        key: 'marks',
        label: 'Marks you could see',
        marks: [{ id: 'm1', description: 'Bee sticker', photoUrl: 'https://example.test/m1.jpg' }],
      },
    ]);
  });
});

describe('contextReviewGroups — the damage as rows (owner, 2026-10-22)', () => {
  it('gives each kind a row and the parts as rows under "Missing panels or parts"', () => {
    const [condition] = contextReviewGroups({
      contextFlags: ['damage_visible'],
      damageKinds: ['smashed_window', 'missing_parts'],
      missingParts: ['bumpers', 'doors'],
    });
    expect(condition.cards?.[0].items).toEqual([
      { value: 'smashed_window', label: 'Smashed window' },
      {
        value: 'missing_parts',
        label: 'Missing panels or parts',
        items: [
          { value: 'bumpers', label: 'Bumpers' },
          { value: 'doors', label: 'Doors' },
        ],
      },
    ]);
  });

  it('⚠️ leaves out a kind or part this app doesn’t know — never a crash, never a raw key', () => {
    // Values a newer server might hold — not this app's types, hence the cast.
    const [condition] = contextReviewGroups({
      contextFlags: ['damage_visible'],
      damageKinds: ['flood_damage', 'missing_parts'],
      missingParts: ['spoiler', 'toString'],
    } as unknown as Parameters<typeof contextReviewGroups>[0]);
    // No known part: "Missing panels or parts" stands alone, no empty rows.
    expect(condition.cards?.[0].items).toEqual([
      { value: 'missing_parts', label: 'Missing panels or parts' },
    ]);
    // Nothing known at all: the plain card, no rows.
    const [plain] = contextReviewGroups({
      contextFlags: ['damage_visible'],
      damageKinds: ['flood_damage'],
    } as unknown as Parameters<typeof contextReviewGroups>[0]);
    expect(plain.cards?.[0].items).toBeUndefined();
  });
});

describe('contextReviewGroups — as the lines they read as', () => {
  const MARKS = [
    { id: 'm1', description: 'Bee sticker' },
    { id: 'm2', description: 'Roof rack' },
  ];

  it('labels every answered question, in the chip words, marks in the owner’s order', () => {
    expect(
      asRows({
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
    expect(asRows({})).toEqual([]);
    expect(
      asRows({
        contextFlags: [],
        note: '   ',
        confirmedFeatureIds: [],
        contextUnsure: ['state', 'people', 'direction'],
      }),
    ).toEqual([]);
  });

  it('reads a legacy people flag only when there is no 3-way answer', () => {
    expect(asRows({ contextFlags: ['people_nearby'] })).toEqual([
      { key: 'people', label: 'Anyone in or near it', value: 'People nearby' },
    ]);
    expect(
      asRows({ contextFlags: ['people_nearby'], peoplePresence: 'nobody' }),
    ).toEqual([{ key: 'people', label: 'Anyone in or near it', value: 'No one seen' }]);
  });

  it('what the spotter checks is what the owner reads (one vocabulary)', () => {
    const answers = {
      contextFlags: ['parked', 'looks_intact'] as const,
      parkedLikelihood: 'settled' as const,
      peoplePresence: 'nearby' as const,
    };
    const checked = asRows({ ...answers, contextFlags: [...answers.contextFlags] });
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
