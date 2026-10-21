/**
 * WHAT:  The one vocabulary for a sighting's structured context: the labels
 *        for every flag, follow-up, presence answer and kind of damage
 *        (DAMAGE_KIND_LABELS, 2026-10-21); the option lists the
 *        context steps render as cards, each card's one short line
 *        (CONTEXT_OPTION_DESCRIPTIONS), and every step's question
 *        (CONTEXT_STEP_QUESTIONS; CONTEXT_QUESTIONS for the shared three);
 *        contextReviewRows(), the answers as labelled rows for the
 *        check-and-send step, and sightingAnswerGroups(), the same answers per
 *        question under short labels (CONTEXT_SHORT_LABELS) for the owner's
 *        sighting page ("What they saw", a label | answers table); and
 *        contextDetailCount(), how many details a report carries.
 * WHY:   The context steps, the confirm step and the owner's sighting page all
 *        describe the same facts. One module keeps
 *        the words identical everywhere: the step used to keep its own copies,
 *        so the spotter tapped "Being loaded or towed" and the owner read
 *        "Being loaded/towed" (2026-10-01 redesign). The cards' titles ARE
 *        these labels (one question per step since 2026-10-20).
 *        WORDING is neutral and describes what was seen (eyewitness research:
 *        a leading word changes what people remember; a prediction is a guess).
 *        So "Looks about to move", not "Likely to stay?". Stored values never
 *        change: only the words do.
 * LINKS: src/features/sightings/types.ts (the vocabularies);
 *        src/features/sightings/components/contextSteps.tsx (the steps),
 *        components/ConfirmStep.tsx (contextReviewRows),
 *        components/SightingSeenSection.tsx (sightingAnswerGroups).
 */

import {
  CONDITION_FLAGS,
  VEHICLE_STATE_FLAGS,
  type ConditionFlag,
  type DamageKind,
  type DrivingDirection,
  type ParkedLikelihood,
  type PeoplePresence,
  type ReportSightingAnswers,
  type SightingContextFlag,
  type VehicleStateFlag,
} from '../types';
import type { ContextStepId } from './contextAnswers';
import { cleanSpotterWords } from './withdrawReasons';

export const FLAG_LABELS: Record<SightingContextFlag, string> = {
  parked: 'Parked',
  // Stored as `driving`; "moving" is what a spotter on the pavement sees.
  driving: 'Moving',
  being_loaded: 'Being loaded or towed',
  people_nearby: 'People nearby',
  plate_changed: 'Plate changed or missing',
  damage_visible: 'Damage visible',
  being_stripped: 'Being stripped',
  looks_intact: 'Looks intact',
};

export const PARKED_LIKELIHOOD_LABELS: Record<ParkedLikelihood, string> = {
  settled: 'Looks parked up',
  // No longer offered (it answered "where", not "staying"); old rows keep it.
  street: 'Street parked',
  moving: 'Looks about to move',
};

export const PEOPLE_PRESENCE_LABELS: Record<PeoplePresence, string> = {
  nobody: 'No one seen',
  nearby: 'People near it',
  in_vehicle: 'Someone in it',
};

/** What the context step offers, in order. Labels come from the tables above. */
export const STATE_OPTIONS: readonly VehicleStateFlag[] = ['parked', 'driving', 'being_loaded'];
// `street` is left out on purpose: it answered "where", not "staying".
export const STAYING_OPTIONS: readonly ParkedLikelihood[] = ['settled', 'moving'];
export const PEOPLE_OPTIONS: readonly PeoplePresence[] = ['nobody', 'nearby', 'in_vehicle'];
export const CONDITION_OPTIONS: readonly ConditionFlag[] = [
  'plate_changed',
  'damage_visible',
  'being_stripped',
  'looks_intact',
];

/** What damage was seen — the cards' titles after "Damage visible" (owner,
 *  2026-10-21), and the words the owner reads after it. What it LOOKS like
 *  from where they stand: "Missing panels or parts", not "Stripped". */
export const DAMAGE_KIND_LABELS: Record<DamageKind, string> = {
  smashed_window: 'Smashed window',
  dents_scrapes: 'Dents or scrapes',
  broken_lights: 'Broken lights',
  missing_wheels: 'Missing wheels',
  missing_parts: 'Missing panels or parts',
  fire_damage: 'Fire damage',
};
// The cards are offered in DAMAGE_KINDS' order (types.ts) — the one list,
// which mirrors the server's whitelist — so there is no second copy here.

/** The damage kinds' words, in the order given, skipping any this app
 *  doesn't know (a newer server's kind is left out, never a crash). */
function damageKindLabels(kinds: readonly string[] | null | undefined): string[] {
  return (kinds ?? [])
    .filter((kind): kind is DamageKind => Object.hasOwn(DAMAGE_KIND_LABELS, kind))
    .map((kind) => DAMAGE_KIND_LABELS[kind]);
}

const DIRECTION_LABELS: Record<DrivingDirection, string> = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west',
};

export function directionLabel(direction: DrivingDirection): string {
  return `Heading ${DIRECTION_LABELS[direction]}`;
}

/** The subset of a sighting the rows need — answers (undefined) and
 *  OwnerSighting (null) both satisfy it. */
export interface ContextSummarySource {
  contextFlags?: SightingContextFlag[] | null;
  parkedLikelihood?: ParkedLikelihood | null;
  direction?: DrivingDirection | null;
  peoplePresence?: PeoplePresence | null;
  /** Plain strings: the owner's list keeps a kind this app doesn't know. */
  damageKinds?: readonly string[] | null;
}

/** One labelled row of the check-and-send step's "What you saw". */
export interface ContextReviewRow {
  key: 'state' | 'people' | 'condition' | 'damage' | 'marks' | 'note';
  label: string;
  value: string;
}

type ContextQuestionKey = 'state' | 'people' | 'condition';

/**
 * The questions' row labels for the check-and-send step's "What you saw"
 * (contextReviewRows) — a summary, so statements, not questions.
 */
const CONTEXT_ROW_LABELS: Record<ContextQuestionKey, string> = {
  state: 'What it was doing',
  people: 'Anyone in or near it',
  condition: 'Its condition',
};

/**
 * The three questions every summary shares, word for word, ONE copy — the
 * spotter is asked them (CONTEXT_STEP_QUESTIONS reads them from here).
 */
export const CONTEXT_QUESTIONS: Record<ContextQuestionKey, string> = {
  state: 'What was it doing?',
  people: 'Anyone in or near it?',
  condition: 'Its condition',
};

/** The follow-ups' questions — each its own step since 2026-10-20 (one
 *  question per screen), shown only after the state they follow. */
export const FOLLOW_UP_QUESTIONS = {
  staying: 'Did it look like it was staying?',
  direction: 'Which way was it heading?',
} as const;

/** "Damage visible"'s follow-up — its own step (owner, 2026-10-21). */
export const DAMAGE_QUESTION = 'What damage can you see?';

/** The last two context steps' questions. */
export const MARKS_QUESTION = 'Could you see any of these?';
export const NOTE_QUESTION = 'A note for the owner';

/** Every context step's question, by step id — the flow asks them, and the
 *  check-and-send step's "Add details" names the one it opens. */
export const CONTEXT_STEP_QUESTIONS: Record<ContextStepId, string> = {
  state: CONTEXT_QUESTIONS.state,
  staying: FOLLOW_UP_QUESTIONS.staying,
  direction: FOLLOW_UP_QUESTIONS.direction,
  people: CONTEXT_QUESTIONS.people,
  condition: CONTEXT_QUESTIONS.condition,
  damage: DAMAGE_QUESTION,
  marks: MARKS_QUESTION,
  note: NOTE_QUESTION,
};

/**
 * One short line under each card's title on the context steps (owner,
 * 2026-10-20: "more detail on each step", as cards rather than chips). What
 * the option LOOKS like from the pavement — never a guess at what happens
 * next, and never a cue that needs a close look (no "forced lock").
 */
export const CONTEXT_OPTION_DESCRIPTIONS = {
  state: {
    parked: 'Standing still in a space',
    driving: 'Being driven on the road',
    being_loaded: 'On a trailer, truck or tow',
  } satisfies Record<VehicleStateFlag, string>,
  staying: {
    settled: 'Settled, as if left there',
    // Seen from the pavement — not "engine on", which needs you close by.
    moving: 'Lights on, or pulling out',
  } satisfies Partial<Record<ParkedLikelihood, string>>,
  people: {
    nobody: 'Nobody in or around it',
    nearby: 'Someone standing close by',
    in_vehicle: 'A person inside the car',
  } satisfies Record<PeoplePresence, string>,
  // No `condition`: its cards are title-only (owner, 2026-10-21 — the titles
  // say it, and "Damage visible" now opens its own "What damage?" step).
} as const;

/**
 * The same questions as a table's left-hand labels on the owner's sighting
 * page (sightingAnswerGroups) — one word, like a spec sheet, so the answers
 * keep the width on a small phone (owner's pick, 2026-10-20).
 */
export const CONTEXT_SHORT_LABELS: Record<ContextQuestionKey, string> = {
  state: 'Doing',
  people: 'People',
  condition: 'Condition',
};

/** One question the spotter answered, under its short label, and their
 *  answers in the words of the chips they tapped (the state's follow-up
 *  rides with it). */
export interface ContextAnswerGroup {
  key: ContextQuestionKey;
  label: string;
  answers: string[];
}

/**
 * What the car was doing, who was with it, and its condition — the answers as
 * the chips' own labels, per question, only the questions that were answered
 * ("Not sure" stores nothing, so it never appears). The one reading both
 * sides of a sighting build on.
 *
 * Legacy rows are shown as stored, never guessed at: two state flags (from
 * the old multi-select) list both; the old `people_nearby` flag stands in for
 * the 3-way answer only when that is absent.
 *
 * The damage seen rides on "Damage visible", as a follow-up rides on its
 * state: "Damage visible · Smashed window, Dents or scrapes" (2026-10-21).
 */
function answeredContext(source: ContextSummarySource): Record<ContextQuestionKey, string[]> {
  const flags = source.contextFlags ?? [];

  const state: string[] = [];
  for (const flag of flags) {
    if (!(VEHICLE_STATE_FLAGS as readonly string[]).includes(flag)) continue;
    state.push(FLAG_LABELS[flag]);
    if (flag === 'parked' && source.parkedLikelihood) {
      state.push(PARKED_LIKELIHOOD_LABELS[source.parkedLikelihood]);
    }
    if (flag === 'driving' && source.direction) state.push(directionLabel(source.direction));
  }

  // The 3-way answer; the legacy people_nearby flag only when it's absent.
  const people = source.peoplePresence
    ? PEOPLE_PRESENCE_LABELS[source.peoplePresence]
    : flags.includes('people_nearby')
      ? FLAG_LABELS.people_nearby
      : null;

  const damage = damageKindLabels(source.damageKinds);
  const condition = flags
    .filter((flag) => (CONDITION_FLAGS as readonly string[]).includes(flag))
    .map((flag) =>
      flag === 'damage_visible' && damage.length > 0
        ? `${FLAG_LABELS[flag]} · ${damage.join(', ')}`
        : FLAG_LABELS[flag],
    );

  return { state, people: people ? [people] : [], condition };
}

const QUESTION_ORDER: readonly ContextQuestionKey[] = ['state', 'people', 'condition'];

/** The check-and-send step's rows: each answered question, one line. */
function answeredContextRows(source: ContextSummarySource): ContextReviewRow[] {
  const answered = answeredContext(source);
  return QUESTION_ORDER.filter((key) => answered[key].length > 0).map((key) => ({
    key,
    label: CONTEXT_ROW_LABELS[key],
    value: answered[key].join(' · '),
  }));
}

/**
 * The owner's "What they saw" on the sighting page: each question the spotter
 * answered, under its short label, with their answers in the words of the
 * chips they tapped — the page sets them out as a label | answers table
 * (owner, 2026-10-20; chips under the full questions before that). Only what
 * was chosen, so a skipped question isn't there at all. The marks, the words
 * about the damage and the note have blocks of their own.
 */
export function sightingAnswerGroups(source: ContextSummarySource): ContextAnswerGroup[] {
  const answered = answeredContext(source);
  return QUESTION_ORDER.filter((key) => answered[key].length > 0).map((key) => ({
    key,
    label: CONTEXT_SHORT_LABELS[key],
    answers: answered[key],
  }));
}

/**
 * Everything the spotter said, as labelled rows for the check-and-send step:
 * the state with its follow-up, the people, the condition (with the damage
 * seen), their words about the damage, the marks they saw, and the note. The
 * SAME answers the owner reads (sightingAnswerGroups);
 * only answered questions appear, and "Not sure" appears nowhere (it stores
 * nothing). The marks keep the owner's order.
 */
export function contextReviewRows(answers: Partial<ReportSightingAnswers>): ContextReviewRow[] {
  const rows = answeredContextRows(answers);

  // The kinds ride on the condition row; their words about it, their own —
  // cleaned as they are sent, so a note that looks blank shows no row.
  const damageNote = cleanSpotterWords(answers.damageNote);
  if (damageNote !== null) {
    rows.push({ key: 'damage', label: 'About the damage', value: damageNote });
  }

  const confirmed = answers.confirmedFeatureIds ?? [];
  const marks = (answers.confirmableFeatures ?? [])
    .filter((mark) => confirmed.includes(mark.id))
    .map((mark) => mark.description);
  if (marks.length > 0) {
    rows.push({ key: 'marks', label: 'Marks you could see', value: marks.join(' · ') });
  }

  const note = answers.note?.trim();
  if (note) rows.push({ key: 'note', label: 'Your note', value: note });

  return rows;
}

/**
 * How many details the context steps captured: each answered question, each
 * condition, each kind of damage, each confirmed mark, the words about the
 * damage, and a note. "Not sure" isn't a detail (it
 * sends nothing), so it doesn't count. Feeds the funnel's `context_summary`
 * (each step's own Skip / Continue is contextAnswers' `stepTouched`).
 * Trusts the steps to keep the answers consistent (a follow-up only under its
 * state, marks only from the offered list): contextAnswers clears on every
 * change, so nothing stale is counted.
 */
export function contextDetailCount(answers: Partial<ReportSightingAnswers>): number {
  const flags = answers.contextFlags ?? [];
  return (
    flags.length +
    (answers.parkedLikelihood ? 1 : 0) +
    (answers.direction ? 1 : 0) +
    (answers.peoplePresence ? 1 : 0) +
    (answers.damageKinds?.length ?? 0) +
    (cleanSpotterWords(answers.damageNote) !== null ? 1 : 0) +
    (answers.confirmedFeatureIds?.length ?? 0) +
    (answers.note?.trim() ? 1 : 0)
  );
}
