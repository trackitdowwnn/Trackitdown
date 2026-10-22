/**
 * WHAT:  The one vocabulary for a sighting's structured context: the labels
 *        for every flag, follow-up, presence answer, kind of damage
 *        (DAMAGE_KIND_LABELS, 2026-10-21) and missing part
 *        (MISSING_PART_LABELS, 2026-10-21); the option lists the
 *        context steps render as cards, each card's one short line
 *        (CONTEXT_OPTION_DESCRIPTIONS), and every step's question
 *        (CONTEXT_STEP_QUESTIONS; CONTEXT_QUESTIONS for the shared three);
 *        contextReviewGroups(), the answers as the cards the spotter tapped
 *        (grouped by question) for the check-and-send step, and
 *        sightingAnswerGroups(), the same answers per question under short
 *        labels (CONTEXT_SHORT_LABELS) for the owner's
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
 *        components/ConfirmStep.tsx (contextReviewGroups),
 *        components/SightingSeenSection.tsx (sightingAnswerGroups).
 */

import {
  CONDITION_FLAGS,
  VEHICLE_STATE_FLAGS,
  type ConditionFlag,
  type ConfirmableFeature,
  type DamageKind,
  type DrivingDirection,
  type MissingPart,
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

/** Which parts are missing — the cards' titles after "Missing panels or
 *  parts" (owner, 2026-10-21), and the words the owner reads in brackets
 *  after it. Only parts seen from where the spotter stands. */
export const MISSING_PART_LABELS: Record<MissingPart, string> = {
  bumpers: 'Bumpers',
  bonnet: 'Bonnet',
  doors: 'Doors',
  lights: 'Lights',
  wing_mirrors: 'Wing mirrors',
  number_plates: 'Number plates',
};
// Offered in MISSING_PARTS' order (types.ts), the server's whitelist's.

/** The values this app has words for, in the order given, skipping any it
 *  doesn't know (a newer server's value is left out, never a crash). */
function knownValues<K extends string>(
  table: Record<K, string>,
  values: readonly string[] | null | undefined,
): K[] {
  return (values ?? []).filter((value): value is K => Object.hasOwn(table, value));
}

/** The missing parts' words, for the brackets on "Missing panels or parts". */
function missingPartLabels(parts: readonly string[] | null | undefined): string[] {
  return knownValues(MISSING_PART_LABELS, parts).map((part) => MISSING_PART_LABELS[part]);
}

/** The damage kinds' words. With `parts`, "Missing panels or parts" names
 *  them in brackets — "Missing panels or parts (Bumpers, Doors)" — and stays
 *  plain when none are known (never "()"). */
function damageKindLabels(
  kinds: readonly string[] | null | undefined,
  parts?: readonly string[] | null,
): string[] {
  const named = missingPartLabels(parts);
  return knownValues(DAMAGE_KIND_LABELS, kinds).map((kind) =>
    kind === 'missing_parts' && named.length > 0
      ? `${DAMAGE_KIND_LABELS[kind]} (${named.join(', ')})`
      : DAMAGE_KIND_LABELS[kind],
  );
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
  /** Plain strings, likewise (2026-10-21). */
  missingParts?: readonly string[] | null;
}

type ContextQuestionKey = 'state' | 'people' | 'condition';

/** One answer as the card the spotter tapped (check-and-send shows them as
 *  those cards, owner, 2026-10-22): the question whose card set it comes
 *  from, the stored value, the card's title, and what it led to as a line
 *  under it ("Looks parked up"; the damage seen). */
export interface ContextReviewCard {
  question: ContextQuestionKey;
  /** The stored value — a context flag, or a people answer. */
  value: string;
  label: string;
  detail?: string;
}

/** One answered question under check-and-send's "What you saw": its label,
 *  then the chosen cards — or the spotter's words, or the marks they saw.
 *  `key` is the step its Edit opens. */
export interface ContextReviewGroup {
  key: 'state' | 'people' | 'condition' | 'damage' | 'parts' | 'marks' | 'note';
  label: string;
  cards?: ContextReviewCard[];
  text?: string;
  marks?: ConfirmableFeature[];
}

/**
 * The questions' labels for the check-and-send step's "What you saw"
 * (contextReviewGroups) — a summary, so statements, not questions.
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

/** "Missing panels or parts"'s follow-up — its own step (owner, 2026-10-21). */
export const PARTS_QUESTION = 'What’s missing?';

/** The last two context steps' questions. */
export const MARKS_QUESTION = 'Could you see any of these?';
// The note: 'Anything else?' (owner, 2026-10-22), as the damage and
// missing-parts steps' own boxes ask — every free-text question reads alike.
export const NOTE_QUESTION = 'Anything else?';

/** Every context step's question, by step id — the flow asks them, and the
 *  check-and-send step's "Add details" names the one it opens. */
export const CONTEXT_STEP_QUESTIONS: Record<ContextStepId, string> = {
  state: CONTEXT_QUESTIONS.state,
  staying: FOLLOW_UP_QUESTIONS.staying,
  direction: FOLLOW_UP_QUESTIONS.direction,
  people: CONTEXT_QUESTIONS.people,
  condition: CONTEXT_QUESTIONS.condition,
  damage: DAMAGE_QUESTION,
  parts: PARTS_QUESTION,
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
 * state, and which parts ride in brackets on "Missing panels or parts":
 * "Damage visible · Smashed window, Missing panels or parts (Bumpers,
 * Doors)" (2026-10-21).
 *
 * Built from the same cards check-and-send shows (answeredCards), so the two
 * sides of a sighting cannot say different things.
 */
function answeredContext(source: ContextSummarySource): Record<ContextQuestionKey, string[]> {
  const cards = answeredCards(source);
  return {
    // The follow-up is its own entry: the owner's table puts it on the
    // state's line ("Parked · Looks settled").
    state: cards.state.flatMap((card) => (card.detail ? [card.label, card.detail] : [card.label])),
    people: cards.people.map((card) => card.label),
    condition: cards.condition.map((card) =>
      card.detail ? `${card.label} · ${card.detail}` : card.label,
    ),
  };
}

/**
 * Each answered question's chosen cards, in the words of the cards tapped —
 * what it was doing (its follow-up the line under it), who was with it, and
 * its condition ("Damage visible" carrying the damage seen, which parts in
 * brackets). "Not sure" stores nothing, so it is never a card. Legacy rows
 * are shown as stored: two states (the old multi-select) are two cards; the
 * old `people_nearby` flag stands in for the 3-way answer only when that is
 * absent, as the "People near it" card.
 */
function answeredCards(
  source: ContextSummarySource,
): Record<ContextQuestionKey, ContextReviewCard[]> {
  const flags = source.contextFlags ?? [];

  const state: ContextReviewCard[] = [];
  for (const flag of flags) {
    if (!(VEHICLE_STATE_FLAGS as readonly string[]).includes(flag)) continue;
    const detail =
      flag === 'parked' && source.parkedLikelihood
        ? PARKED_LIKELIHOOD_LABELS[source.parkedLikelihood]
        : flag === 'driving' && source.direction
          ? directionLabel(source.direction)
          : undefined;
    state.push({
      question: 'state',
      value: flag,
      label: FLAG_LABELS[flag],
      ...(detail ? { detail } : {}),
    });
  }

  const people: ContextReviewCard[] = source.peoplePresence
    ? [
        {
          question: 'people',
          value: source.peoplePresence,
          label: PEOPLE_PRESENCE_LABELS[source.peoplePresence],
        },
      ]
    : flags.includes('people_nearby')
      ? [{ question: 'people', value: 'nearby', label: FLAG_LABELS.people_nearby }]
      : [];

  const damage = damageKindLabels(source.damageKinds, source.missingParts);
  const condition: ContextReviewCard[] = flags
    .filter((flag) => (CONDITION_FLAGS as readonly string[]).includes(flag))
    .map((flag) => ({
      question: 'condition',
      value: flag,
      label: FLAG_LABELS[flag],
      ...(flag === 'damage_visible' && damage.length > 0 ? { detail: damage.join(', ') } : {}),
    }));

  return { state, people, condition };
}

const QUESTION_ORDER: readonly ContextQuestionKey[] = ['state', 'people', 'condition'];

/**
 * The owner's "What they saw" on the sighting page: each question the spotter
 * answered, under its short label, with their answers in the words of the
 * chips they tapped — the page sets them out as a label | answers table
 * (owner, 2026-10-20; chips under the full questions before that). Only what
 * was chosen, so a skipped question isn't there at all. Which parts are
 * missing ride in brackets on "Missing panels or parts". The marks, the words
 * about the damage and about what's missing, and the note have blocks of
 * their own.
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
 * Everything the spotter said, for the check-and-send step's "What you saw":
 * each answered question with the CARDS they tapped (owner, 2026-10-22 — "in
 * the form of the card"), what an answer led to as a line on its card; then
 * their words about the damage and about what's missing, the marks they saw
 * (in the owner's order), and the note. The SAME answers the owner reads
 * (sightingAnswerGroups); only answered questions appear, and "Not sure"
 * appears nowhere (it stores nothing). Words are cleaned as they are sent, so
 * a note that only looks written shows nothing.
 */
export function contextReviewGroups(answers: Partial<ReportSightingAnswers>): ContextReviewGroup[] {
  const cards = answeredCards(answers);
  const groups: ContextReviewGroup[] = QUESTION_ORDER.filter((key) => cards[key].length > 0).map(
    (key) => ({ key, label: CONTEXT_ROW_LABELS[key], cards: cards[key] }),
  );

  // The kinds and parts ride on the "Damage visible" card; their words about
  // them, a block each whose Edit opens that step.
  const damageNote = cleanSpotterWords(answers.damageNote);
  if (damageNote !== null)
    groups.push({ key: 'damage', label: 'About the damage', text: damageNote });
  const partsNote = cleanSpotterWords(answers.missingPartsNote);
  if (partsNote !== null) {
    groups.push({ key: 'parts', label: 'About what’s missing', text: partsNote });
  }

  const confirmed = answers.confirmedFeatureIds ?? [];
  const marks = (answers.confirmableFeatures ?? []).filter((mark) => confirmed.includes(mark.id));
  if (marks.length > 0) groups.push({ key: 'marks', label: 'Marks you could see', marks });

  const note = answers.note?.trim();
  if (note) groups.push({ key: 'note', label: 'Your note', text: note });

  return groups;
}

/**
 * How many details the context steps captured: each answered question, each
 * condition, each kind of damage, each missing part, each confirmed mark,
 * the words about the damage and about what's missing, and a note. "Not sure" isn't a detail (it
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
    (answers.missingParts?.length ?? 0) +
    (cleanSpotterWords(answers.missingPartsNote) !== null ? 1 : 0) +
    (answers.confirmedFeatureIds?.length ?? 0) +
    (answers.note?.trim() ? 1 : 0)
  );
}
