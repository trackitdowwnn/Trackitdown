/**
 * WHAT:  useTimeAgo — the timeAgo formatter as a live hook: re-renders the
 *        consuming component every minute so relative times stay honest.
 * WHY:   Cards in a long-lived feed are memoised; a plain timeAgo() call
 *        would show "2m ago" forever. A one-minute tick matches the
 *        formatter's finest visible unit; the tick is not aligned to the
 *        timestamp's minute boundary, so a label can lag by up to 59s —
 *        acceptable for "how fresh is this sighting" copy.
 * LINKS: src/shared/lib/timeAgo.ts (the pure formatter);
 *        src/shared/ui/VehicleCard.tsx (first consumer).
 */

import { useEffect, useReducer } from 'react';

import { timeAgo } from '../lib';

const TICK_MS = 60_000;

/** Live relative-time label for `timestamp`, re-rendering each minute. */
export function useTimeAgo(timestamp: Date | string | number): string {
  const [, tick] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  return timeAgo(timestamp);
}
