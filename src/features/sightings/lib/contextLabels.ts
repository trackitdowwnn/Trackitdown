/**
 * WHAT:  The one vocabulary for rendering a sighting's structured context —
 *        flag/likelihood/direction/presence labels plus contextSummary(),
 *        which turns any sighting-ish shape into friendly display parts.
 * WHY:   The confirm step, the owner's timeline rows, and the sighting detail
 *        page all narrate the same facts; one module keeps the copy identical
 *        everywhere and spares each screen its own Record<> drift (the detail
 *        screen used to render the raw enum — "Likely: settled").
 * LINKS: src/features/sightings/types.ts (the vocabularies);
 *        src/features/sightings/components/sightingSteps.tsx,
 *        SightingTimeline.tsx, screens/SightingDetailScreen.tsx (consumers).
 */

import type {
  DrivingDirection,
  ParkedLikelihood,
  PeoplePresence,
  SightingContextFlag,
} from '../types';

export const FLAG_LABELS: Record<SightingContextFlag, string> = {
  parked: 'Parked',
  driving: 'Driving',
  being_loaded: 'Being loaded/towed',
  people_nearby: 'People nearby',
  plate_changed: 'Plate changed or missing',
  damage_visible: 'Damage visible',
  being_stripped: 'Being stripped',
  looks_intact: 'Looks intact',
};

export const PARKED_LIKELIHOOD_LABELS: Record<ParkedLikelihood, string> = {
  settled: 'Looks settled to stay',
  street: 'Street parked',
  moving: 'About to move',
};

export const PEOPLE_PRESENCE_LABELS: Record<PeoplePresence, string> = {
  nobody: 'Nobody around',
  nearby: 'People near it',
  in_vehicle: 'Someone in it',
};

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
