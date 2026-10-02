/**
 * WHAT:  The one vocabulary for a sighting's structured context: the labels
 *        for every flag, follow-up and presence answer; the option lists the
 *        context step renders as chips; contextSummary(), which narrates any
 *        sighting-ish shape for the owner; and contextDetailCount(), how many
 *        details a report carries.
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
 *        src/features/sightings/components/sightingSteps.tsx (ContextStep,
 *        ConfirmStep), SightingTimeline.tsx, screens/SightingDetailScreen.tsx.
 */

import type {
  ConditionFlag,
  DrivingDirection,
  ParkedLikelihood,
  PeoplePresence,
  ReportSightingAnswers,
  SightingContextFlag,
  VehicleStateFlag,
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
