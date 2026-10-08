/**
 * WHAT:  PrefilledReport — the post-a-car wizard for ONE saved car: its
 *        vehicle phase collapsed to a confirm step (Edit expands it back to
 *        the full steps, seeded with the same answers), then the ordinary
 *        posting behaviour (create draft → escrow → live).
 * WHY:   Shared by both ways into a saved-car report — choosing it in the
 *        report host's chooser, and "Report stolen" on a /my-cars card — so
 *        the two can never drift. It is also what keeps the features acyclic:
 *        the GARAGE maps the SavedVehicle down to plain answers, so
 *        features/vehicles never imports a garage type (ARCHITECTURE.md
 *        rule 1). No onAbandon: someone reporting a saved car is never
 *        offered to save one.
 * LINKS: src/features/garage/lib/prefilledPostFlow.tsx;
 *        src/features/garage/screens/StartReportScreen.tsx,
 *        src/features/garage/screens/ReportSavedCarScreen.tsx (the two hosts);
 *        src/features/vehicles/post/screens/PostACarScreen.tsx.
 */

import { useCallback, useMemo, useState } from 'react';

import { POST_A_CAR_INITIAL_ANSWERS, PostACarScreen, postACarFlow } from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';

import { buildPrefilledPostFlow } from '../lib/prefilledPostFlow';
import { invalidateSavedCarSignal } from '../lib/savedCarSignal';
import type { SavedVehicle } from '../types';

const log = createLogger('garage');

export function PrefilledReport({ vehicle }: { vehicle: SavedVehicle }) {
  // Set when the owner taps Edit on the confirm step — restores the full
  // steps, seeded with the same answers.
  const [expanded, setExpanded] = useState(false);

  const onEdit = useCallback(() => {
    log.info('garage_prefill_expanded', { vehicleId: vehicle.id });
    setExpanded(true);
  }, [vehicle.id]);

  const prefilled = useMemo(
    () =>
      buildPrefilledPostFlow({
        baseFlow: postACarFlow,
        baseInitialAnswers: POST_A_CAR_INITIAL_ANSWERS,
        vehicle,
        expanded,
        onEdit,
      }),
    [vehicle, expanded, onEdit],
  );

  return (
    <PostACarScreen
      flow={prefilled.flow}
      initialAnswers={prefilled.initialAnswers}
      // This car now has a live report: drop the cached garage so the next +
      // never offers it again.
      onPostCreated={invalidateSavedCarSignal}
    />
  );
}
