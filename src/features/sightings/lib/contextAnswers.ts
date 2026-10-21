/**
 * WHAT:  The rules of the report's optional context questions — what was it
 *        doing (and its follow-up), anyone in or near it, its condition, the
 *        owner's marks — as pure functions over the wizard's answers. Each
 *        `select…` returns the PATCH to apply; nothing here renders.
 * WHY:   The rules cross questions: a new state clears the old state's
 *        follow-up and its "Not sure"; "Looks intact" excludes every other
 *        condition; contextFlags is the state plus the conditions. While every
 *        question sat on one page, the step component could hold them. Split
 *        into a step per question (owner, 2026-10-20), no single component
 *        sees them all — so they live here, once, and every step calls them.
 *        What reaches create_sighting must not change: sightingApi.test's
 *        golden payload pins it.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (the steps);
 *        src/features/sightings/lib/contextLabels.ts (the words);
 *        src/features/sightings/types.ts (ReportSightingAnswers).
 */

import {
  CONDITION_FLAGS,
  VEHICLE_STATE_FLAGS,
  type ConditionFlag,
  type ContextQuestion,
  type DrivingDirection,
  type ParkedLikelihood,
  type PeoplePresence,
  type ReportSightingAnswers,
  type VehicleStateFlag,
} from '../types';

/** "Not sure"'s value in a control: never stored, only remembered (contextUnsure). */
export const UNSURE = '__unsure__';
/** A control's value: one of the question's answers, or "Not sure". */
export type MaybeUnsure<V extends string> = V | typeof UNSURE;

type Answers = Partial<ReportSightingAnswers>;
/** What a pick changes — merged into the wizard's answers by setAnswers. */
export type ContextPatch = Partial<ReportSightingAnswers>;

/** The vehicle state picked, if any. */
export function stateOf(answers: Answers): VehicleStateFlag | null {
  const flags = answers.contextFlags ?? [];
  return VEHICLE_STATE_FLAGS.find((flag) => flags.includes(flag)) ?? null;
}

/** The conditions ticked, in the order they were ticked. */
export function conditionsOf(answers: Answers): ConditionFlag[] {
  return (answers.contextFlags ?? []).filter((flag): flag is ConditionFlag =>
    (CONDITION_FLAGS as readonly string[]).includes(flag),
  );
}

// Which optional steps apply — the split steps' `when` (from the next PR).
/** Parked was picked: its "staying?" follow-up applies. */
export const isParked = (answers: Answers) => stateOf(answers) === 'parked';
/** Moving was picked: its "which way?" follow-up applies. */
export const isMoving = (answers: Answers) => stateOf(answers) === 'driving';
/** Whether the post has marks to offer (the seed; empty or absent = none). */
export const hasMarks = (answers: Answers) => (answers.confirmableFeatures ?? []).length > 0;

/** Whether "Not sure" is this question's answer. */
export function isUnsure(answers: Answers, question: ContextQuestion): boolean {
  return (answers.contextUnsure ?? []).includes(question);
}

/** What a single-answer question shows as chosen: the stored answer, else
 *  "Not sure" if that was picked, else nothing. */
export function shownAnswer<V extends string>(
  answers: Answers,
  question: ContextQuestion,
  stored: V | null | undefined,
): MaybeUnsure<V> | null {
  return stored ?? (isUnsure(answers, question) ? UNSURE : null);
}

/** contextUnsure with these questions set to not-sure (true) or cleared (false). */
export function withUnsure(
  answers: Answers,
  changes: Partial<Record<ContextQuestion, boolean>>,
): ContextQuestion[] {
  const next = new Set(answers.contextUnsure ?? []);
  for (const [question, on] of Object.entries(changes) as [ContextQuestion, boolean][]) {
    if (on) next.add(question);
    else next.delete(question);
  }
  return [...next];
}

/**
 * The vehicle's state. Picking the chosen one again clears it; a new state
 * clears the OLD state's follow-up (and its "Not sure") so "Parked · looks
 * parked up" can't linger under "Moving".
 * NOTE: contextFlags is rebuilt as state ∪ conditions, so any OTHER flag seeded
 * into the answers (a legacy people_nearby) is dropped on the first pick; fine
 * for the wizard's always-fresh answers.
 */
export function selectState(answers: Answers, picked: MaybeUnsure<VehicleStateFlag>): ContextPatch {
  const cleared = picked === shownAnswer(answers, 'state', stateOf(answers));
  const next = cleared || picked === UNSURE ? null : picked;
  return {
    contextFlags: [...(next ? [next] : []), ...conditionsOf(answers)],
    parkedLikelihood: next === 'parked' ? answers.parkedLikelihood : undefined,
    direction: next === 'driving' ? answers.direction : undefined,
    contextUnsure: withUnsure(answers, {
      state: picked === UNSURE && !cleared,
      // A follow-up's "Not sure" belongs to the state it followed.
      ...(next !== 'parked' ? { staying: false } : {}),
      ...(next !== 'driving' ? { direction: false } : {}),
    }),
  };
}

/** "Did it look like it was staying?" — pick, "Not sure", or tap again to clear. */
export function selectStaying(
  answers: Answers,
  picked: MaybeUnsure<ParkedLikelihood>,
): ContextPatch {
  const cleared = picked === shownAnswer(answers, 'staying', answers.parkedLikelihood);
  return {
    parkedLikelihood: cleared || picked === UNSURE ? undefined : picked,
    contextUnsure: withUnsure(answers, { staying: picked === UNSURE && !cleared }),
  };
}

/** A compass pick (or its clearing — undefined) replaces "Not sure which way". */
export function selectDirection(
  answers: Answers,
  direction: DrivingDirection | undefined,
): ContextPatch {
  return { direction, contextUnsure: withUnsure(answers, { direction: false }) };
}

/** "Not sure which way" on clears the heading; off leaves it as it was. */
export function setDirectionUnsure(answers: Answers, on: boolean): ContextPatch {
  return {
    direction: on ? undefined : answers.direction,
    contextUnsure: withUnsure(answers, { direction: on }),
  };
}

/** "Anyone in or near it?" — pick, "Not sure", or tap again to clear. The
 *  caller announces the safety line (peopleShowSafetyLine) as it appears. */
export function selectPeople(answers: Answers, picked: MaybeUnsure<PeoplePresence>): ContextPatch {
  const cleared = picked === shownAnswer(answers, 'people', answers.peoplePresence);
  return {
    peoplePresence: cleared || picked === UNSURE ? undefined : picked,
    contextUnsure: withUnsure(answers, { people: picked === UNSURE && !cleared }),
  };
}

/** "Looks intact" is exclusive: it can't stand beside damage, stripping or a
 *  changed plate, so ticking it clears them and ticking any of them clears it. */
export function changeConditions(answers: Answers, next: ConditionFlag[]): ContextPatch {
  const current = conditionsOf(answers);
  const added = next.find((flag) => !current.includes(flag));
  const resolved =
    added === 'looks_intact'
      ? (['looks_intact'] as ConditionFlag[])
      : added
        ? next.filter((flag) => flag !== 'looks_intact')
        : next;
  const state = stateOf(answers);
  return { contextFlags: [...(state ? [state] : []), ...resolved] };
}

/** Ticks or unticks one of the owner's marks. */
export function toggleMark(answers: Answers, id: string): ContextPatch {
  const confirmed = answers.confirmedFeatureIds ?? [];
  return {
    confirmedFeatureIds: confirmed.includes(id)
      ? confirmed.filter((existing) => existing !== id)
      : [...confirmed, id],
  };
}

/** The report's context steps, one question each (reportSightingFlow). */
export type ContextStepId =
  'state' | 'staying' | 'direction' | 'people' | 'condition' | 'marks' | 'note';

/** The context steps in the order the spotter meets them. */
export const CONTEXT_STEP_IDS: readonly ContextStepId[] = [
  'state',
  'staying',
  'direction',
  'people',
  'condition',
  'marks',
  'note',
];

/**
 * Whether a step has been answered — "Not sure" included, since it IS an
 * answer to the spotter (the button then says "Continue", not "Skip"), even
 * though it sends nothing.
 */
export function stepTouched(answers: Answers, id: ContextStepId): boolean {
  switch (id) {
    case 'state':
      return stateOf(answers) !== null || isUnsure(answers, 'state');
    case 'staying':
      return Boolean(answers.parkedLikelihood) || isUnsure(answers, 'staying');
    case 'direction':
      return Boolean(answers.direction) || isUnsure(answers, 'direction');
    case 'people':
      return Boolean(answers.peoplePresence) || isUnsure(answers, 'people');
    case 'condition':
      return conditionsOf(answers).length > 0;
    case 'marks':
      return (answers.confirmedFeatureIds ?? []).length > 0;
    case 'note':
      return Boolean(answers.note?.trim());
  }
}

/** Whether a step is shown at all for these answers (the flow's `when`). */
export function stepApplies(answers: Answers, id: ContextStepId): boolean {
  if (id === 'staying') return isParked(answers);
  if (id === 'direction') return isMoving(answers);
  if (id === 'marks') return hasMarks(answers);
  return true;
}

/** SAFETY: the people answers that bring up "Don't approach". "Not sure"
 *  counts: a spotter who can't tell is the one tempted to step closer. */
export function peopleShowSafetyLine(answers: Answers): boolean {
  return (
    answers.peoplePresence === 'nearby' ||
    answers.peoplePresence === 'in_vehicle' ||
    isUnsure(answers, 'people')
  );
}

/** SAFETY: the condition that brings up "Don't approach" — a car being
 *  stripped has people working on it (owner, 2026-10-20). NEW, not
 *  extracted: unused until the condition step gets its own screen. */
export function conditionShowsSafetyLine(answers: Answers): boolean {
  return conditionsOf(answers).includes('being_stripped');
}
