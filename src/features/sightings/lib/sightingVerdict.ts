/**
 * WHAT:  sightingVerdict — the owner's decision on a sighting, in words: the
 *        label each surface shows ("Confirmed", "Credited", "Not your car"),
 *        its tone, whether the page should treat the sighting as gone, the
 *        timeline card's pill (with "Needs your answer" while undecided), and
 *        when the car was seen (sightingSeenAt).
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

/** The pill an owner's timeline card wears — including the undecided state,
 *  which the timeline must SAY ("Needs your answer", warning ink) so the
 *  owner can tell at a glance which sightings are waiting on them. */
export function sightingCardStatus(
  status: SightingStatus,
): { label: string; tone: 'warning' | 'primary' | 'neutral' } | null {
  if (status === 'unverified') return { label: 'Needs your answer', tone: 'warning' };
  const label = sightingVerdictLabel(status);
  if (!label) return null;
  return { label, tone: isConfirmedVerdict(status) ? 'primary' : 'neutral' };
}

/** When the car was SEEN: the first in-app photo's capture moment. A library
 *  photo's time says nothing about when the car was there (ADR-0003), so
 *  without a live photo this is when the sighting was sent. One rule, so the
 *  timeline card and the sighting page say the same time. */
export function sightingSeenAt(sighting: Pick<OwnerSighting, 'photos' | 'createdAt'>): string {
  return sighting.photos.find((photo) => photo.source === 'live')?.capturedAt ?? sighting.createdAt;
}
