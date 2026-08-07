/**
 * WHAT:  useAlertReach — how many spotters a bounty at this location would
 *        reach, debounced for a slider being dragged. Returns null when there
 *        is nothing to say.
 * WHY:   A spotter's alert zone carries a `min_bounty_pence`, so the bounty a
 *        posting owner chooses decides how many people the post reaches. That
 *        is the one honest argument for a higher bounty, and it was invisible
 *        at the moment of choosing.
 *
 *        NULL, not 0, when there is nothing to show. The RPC returns 0 both for
 *        "nobody" and for "fewer than the reportable floor", and an owner hours
 *        from a theft must never be told "0 spotters are watching" — it is
 *        demoralising, unactionable, and a map of where nobody is looking.
 *        Collapsing both to null makes the render site's job "show it or don't"
 *        rather than "interpret a number".
 * LINKS: supabase/migrations/20260807120000_alert_reach_count.sql (the count,
 *          its floor and its grid snap);
 *        src/features/notifications/api/alertsApi.ts (fetchAlertReach);
 *        src/features/vehicles/post/components/postSteps.tsx (BountyStep).
 */

import { useEffect, useState } from 'react';

import { fetchAlertReach } from '../api/alertsApi';

/** One request per settled drag, not one per snap crossing. */
const DEBOUNCE_MS = 300;

export function useAlertReach(
  latitude: number | null,
  longitude: number | null,
  bountyPence: number,
): number | null {
  const [reach, setReach] = useState<number | null>(null);

  useEffect(() => {
    if (latitude === null || longitude === null) {
      return; // the location step has not resolved yet
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchAlertReach(latitude, longitude, bountyPence).then((count) => {
        if (!cancelled) {
          // 0 means "nothing to say" — see the header.
          setReach(count > 0 ? count : null);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Primitives only: an object of coordinates would re-fire on every render
    // (this repo's identity-keyed-effect hazard).
  }, [latitude, longitude, bountyPence]);

  return reach;
}
