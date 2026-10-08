/**
 * WHAT:  spokenAgo — turns a compact "time ago" ("5m ago", "2h ago") into
 *        the words a screen reader should say ("5 minutes ago").
 * WHY:   VoiceOver reads "5m" as "five metres" (DESIGN_SYSTEM.md,
 *        Accessibility). Promoted from the report flow's check-and-send step
 *        (2026-10-08) when the owner's sighting page needed the same thing.
 * LINKS: src/shared/hooks/useTimeAgo.ts (the compact form);
 *        src/features/sightings/components/ConfirmStep.tsx;
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

/** "5m ago" → "5 minutes ago"; anything else comes back unchanged. */
export function spokenAgo(ago: string): string {
  return ago
    .replace(/^([0-9]+)m ago$/, (_, n) => `${n} ${n === '1' ? 'minute' : 'minutes'} ago`)
    .replace(/^([0-9]+)h ago$/, (_, n) => `${n} ${n === '1' ? 'hour' : 'hours'} ago`)
    .replace(/^([0-9]+)d ago$/, (_, n) => `${n} ${n === '1' ? 'day' : 'days'} ago`)
    .replace(/^([0-9]+)w ago$/, (_, n) => `${n} ${n === '1' ? 'week' : 'weeks'} ago`);
}
