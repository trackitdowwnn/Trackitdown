/**
 * WHAT:  Relative-time formatting — a past timestamp rendered as a short
 *        human phrase ("just now", "5m ago", "2h ago", "3d ago", "2w ago").
 * WHY:   Last-seen times appear wherever a post or sighting does (cards,
 *        detail, chat); one helper keeps the phrasing consistent and the
 *        thresholds honest. Short units (not "hours") because the strings
 *        sit inline in dense card rows. Future timestamps clamp to
 *        "just now" rather than lying about the future.
 * LINKS: src/shared/ui/VehicleCard.tsx (consumer); docs/TESTING.md (Tier 2).
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** "just now" under a minute; then 59m / 23h / 6d / Nw ago. */
export function timeAgo(timestamp: Date | string | number, now: Date = new Date()): string {
  const then = new Date(timestamp).getTime();
  const elapsed = now.getTime() - then;

  if (Number.isNaN(then)) {
    throw new Error(`timeAgo got an unparseable timestamp: ${String(timestamp)}`);
  }
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  }
  if (elapsed < WEEK_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
  }
  return `${Math.floor(elapsed / WEEK_MS)}w ago`;
}
