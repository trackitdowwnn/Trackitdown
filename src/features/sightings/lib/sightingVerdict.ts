/**
 * WHAT:  sightingVerdict — the owner's decision on a sighting, in words: the
 *        label each surface shows ("Confirmed", "Credited", "Not your car"),
 *        its tone, and whether the page should treat the sighting as gone.
 *        Exhaustive over the status union, so a new status can't fall
 *        through into the wrong label.
 * WHY:   Two surfaces had drifted into two vocabularies ("✓ Helpful" on the
 *        timeline, a two-way branch on the detail page that called a
 *        REJECTED sighting "Marked helpful" — the exact opposite of the
 *        owner's answer). One map, one set of words (review of #145).
 *
 *        'withdrawn' never reaches an owner (get_post_sightings filters it),
 *        but it is in the union, so it is answered here too: as gone.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/features/sightings/components/SightingTimeline.tsx;
 *        src/features/sightings/types.ts (OwnerSighting['status']).
 */

import type { OwnerSighting } from '../types';

export type SightingStatus = OwnerSighting['status'];

/** null = undecided (no label) or gone. */
const VERDICT_LABELS: Record<SightingStatus, string | null> = {
  unverified: null,
  helpful: 'Confirmed',
  credited: 'Credited',
  not_mine: 'Not your car',
  withdrawn: null,
};

/** The owner's decision in words, or null while undecided. */
export function sightingVerdictLabel(status: SightingStatus): string | null {
  return VERDICT_LABELS[status];
}

/** "Not your car" is the quietest outcome — muted, never a tick; the rest
 *  are confirmations. */
export function isConfirmedVerdict(status: SightingStatus): boolean {
  return status === 'helpful' || status === 'credited';
}

/** A withdrawn sighting is "do not act on this": the page shows it as gone. */
export function isGoneSighting(status: SightingStatus): boolean {
  return status === 'withdrawn';
}
