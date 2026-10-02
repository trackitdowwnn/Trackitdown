/**
 * WHAT:  The one vocabulary for a sighting's structured context: the labels
 *        for every flag, follow-up and presence answer; the option lists the
 *        context step renders as chips; contextSummary(), which narrates any
 *        sighting-ish shape for the owner; contextReviewRows(), the same facts
 *        as labelled rows for the check-and-send step; and
 *        contextDetailCount(), how many details a report carries.
 * WHY:   The context step, the confirm step, the owner's timeline rows and the
 *        sighting detail page all describe the same facts. One module keeps
 *        the words identical everywhere: the step used to keep its own copies,
 *        so the spotter tapped "Being loaded or towed" and the owner read
 *        "Being loaded/towed" (2026-10-01 redesign). The step's chips ARE these
 *        labels now.
 *        WORDING is neutral and describes what was seen (eyewitness research:
 *        a leading word changes what people remember; a prediction is a guess).
 *        So "Looks about to move", not "Likely to stay?". Stored values never
 *        change: only the words do.
 * LINKS: src/features/sightings/types.ts (the vocabularies);
 *        src/features/sightings/components/sightingSteps.tsx (ContextStep),
 *        components/ConfirmStep.tsx (contextReviewRows), SightingTimeline.tsx,
 *        screens/SightingDetailScreen.tsx.
 */

import {
  CONDITION_FLAGS,
  VEHICLE_STATE_FLAGS,
  type ConditionFlag,
  type DrivingDirection,
  type ParkedLikelihood,
  type PeoplePresence,
  type ReportSightingAnswers,
  type SightingContextFlag,
  type VehicleStateFlag,
} from '../types';

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

/** The subset of a sighting the summary needs — answers (undefined) and
 *  OwnerSighting (null) both satisfy it. */
export interface ContextSummarySource {
  contextFlags?: SightingContextFlag[] | null;
  parkedLikelihood?: ParkedLikelihood | null;
  direction?: DrivingDirection | null;
  peoplePresence?: PeoplePresence | null;
}

/**
 * Friendly display parts. New reports narrate state → its follow-up →
 * condition → people (the wizard stores flags in that order); legacy rows
 * narrate in their stored flag order. The people_nearby FLAG renders only
 * when no presence field exists (old sightings) — a new report narrates
 * people via the 3-way answer.
 */
export function contextSummary(source: ContextSummarySource): string[] {
  const flags = source.contextFlags ?? [];
  const parts: string[] = [];
  for (const flag of flags) {
    if (flag === 'people_nearby' && source.peoplePresence) continue;
    parts.push(FLAG_LABELS[flag] ?? flag);
    if (flag === 'parked' && source.parkedLikelihood) {
      parts.push(PARKED_LIKELIHOOD_LABELS[source.parkedLikelihood]);
    }
    if (flag === 'driving' && source.direction) {
      parts.push(directionLabel(source.direction));
    }
  }
  if (source.peoplePresence) {
    parts.push(PEOPLE_PRESENCE_LABELS[source.peoplePresence]);
  }
  return parts;
}

/** One labelled row of the check-and-send step's "What you saw". */
export interface ContextReviewRow {
  key: 'state' | 'people' | 'condition' | 'marks' | 'note';
  label: string;
  value: string;
}

/**
 * Everything the spotter said, as labelled rows for the check-and-send step:
 * the state with its follow-up, the people, the condition, the marks they
 * saw, and the note. The SAME words as contextSummary (what they check is
 * what the owner reads); only answered questions appear, and "Not sure"
 * appears nowhere (it stores nothing). The marks keep the owner's order.
 */
export function contextReviewRows(answers: Partial<ReportSightingAnswers>): ContextReviewRow[] {
  const flags = answers.contextFlags ?? [];
  const rows: ContextReviewRow[] = [];

  const state: string[] = [];
  for (const flag of flags) {
    if (!(VEHICLE_STATE_FLAGS as readonly string[]).includes(flag)) continue;
    state.push(FLAG_LABELS[flag]);
    if (flag === 'parked' && answers.parkedLikelihood) {
      state.push(PARKED_LIKELIHOOD_LABELS[answers.parkedLikelihood]);
    }
    if (flag === 'driving' && answers.direction) state.push(directionLabel(answers.direction));
  }
  if (state.length > 0) {
    rows.push({ key: 'state', label: 'What it was doing', value: state.join(' · ') });
  }

  // The 3-way answer; the legacy people_nearby flag only when it's absent.
  const people = answers.peoplePresence
    ? PEOPLE_PRESENCE_LABELS[answers.peoplePresence]
    : flags.includes('people_nearby')
      ? FLAG_LABELS.people_nearby
      : null;
  if (people) rows.push({ key: 'people', label: 'Anyone in or near it', value: people });

  const condition = flags
    .filter((flag) => (CONDITION_FLAGS as readonly string[]).includes(flag))
    .map((flag) => FLAG_LABELS[flag]);
  if (condition.length > 0) {
    rows.push({ key: 'condition', label: 'Its condition', value: condition.join(' · ') });
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
 * How many details the context step has captured: each answered question,
 * each condition, each confirmed mark, and a note. "Not sure" isn't a detail
 * (it sends nothing), so it doesn't count. Drives "3 details added" and the
 * step's Skip / Continue label.
 * Trusts the step to keep the answers consistent (a follow-up only under its
 * state, marks only from the offered list): ContextStep clears on every
 * change, so nothing stale is counted.
 */
export function contextDetailCount(answers: Partial<ReportSightingAnswers>): number {
  const flags = answers.contextFlags ?? [];
  return (
    flags.length +
    (answers.parkedLikelihood ? 1 : 0) +
    (answers.direction ? 1 : 0) +
    (answers.peoplePresence ? 1 : 0) +
    (answers.confirmedFeatureIds?.length ?? 0) +
    (answers.note?.trim() ? 1 : 0)
  );
}
