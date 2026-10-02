/**
 * WHAT:  useTimeAgo — the timeAgo formatter as a live hook: re-renders the
 *        consuming component every minute so relative times stay honest.
 * WHY:   Cards in a long-lived feed are memoised; a plain timeAgo() call
 *        would show "2m ago" forever. A one-minute tick matches the
 *        formatter's finest visible unit; the tick is not aligned to the
 *        timestamp's minute boundary, so a label can lag by up to 59s —
 *        acceptable for "how fresh is this sighting" copy.
 *        ⚠️ The tick's Date is PASSED to timeAgo (2026-10-02). It used to
 *        re-render with a bare counter and let timeAgo read the clock
 *        itself, and the React Compiler memoised timeAgo(timestamp) on the
 *        timestamp alone: on device the label never moved, while Jest (no
 *        compiler) passed. Same trap as LastSeenTimeField's.
 * LINKS: src/shared/lib/timeAgo.ts (the pure formatter);
 *        src/shared/hooks/useNow.ts (the ticking clock);
 *        src/shared/ui/VehicleCard.tsx (first consumer).
 */

import { timeAgo } from '../lib';

import { useNow } from './useNow';

const TICK_MS = 60_000;

/** Live relative-time label for `timestamp`, re-rendering each minute. */
export function useTimeAgo(timestamp: Date | string | number): string {
  const now = useNow(TICK_MS);
  return timeAgo(timestamp, now);
}
