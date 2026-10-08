/**
 * WHAT:  StartReportScreen — the ONE screen behind the + button. It slides up
 *        once and shows, in place: the blank report (no cars to offer), the
 *        "Which car?" chooser (cars to offer), a quiet pending state while it
 *        can't yet tell, or the chooser's error view. Choosing a car or "a
 *        different car" dissolves into that report — no navigation.
 * WHY:   "Janky, slow and not smooth" (owner, 2026-10-07). The + used to push
 *        a chooser route, which then REPLACED itself with the form: two
 *        full-screen transitions back to back, the second starting on a blank
 *        page, and a garage fetch in between. Now the + button waits briefly
 *        for the garage answer and the saved draft BEFORE it navigates
 *        (useStartReport), so this screen usually renders its real stage on
 *        its first frame, during its one slide-up.
 *
 *        ⚠️ THE FIRST REAL STAGE IS FIXED FOR THE VISIT. Once the blank report
 *        or the chooser is on screen, a background revalidation can't swap it
 *        out from under someone — a garage that loads "some cars" a moment
 *        after the blank form appeared must not yank the form away.
 *
 *        ⚠️ "Which car?" IS NEVER DRAWN WITHOUT CARS. A confirmed empty garage
 *        (or nothing offerable) goes straight to the blank report; an unknown
 *        one shows ReportPending, which has no title and no car-shaped rows
 *        (#140, folded in here).
 * LINKS: src/app/post-a-car.tsx (the route); ../hooks/useStartReport.ts (the
 *        + button's wait); ../components/StageCover.tsx (the dissolve);
 *        ../components/ChooseCarStage.tsx, ../components/PrefilledReport.tsx,
 *        ../components/ReportPending.tsx; ../lib/exitNudgeIntent.ts.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { PostACarScreen } from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';

import { ChooseCarStage } from '../components/ChooseCarStage';
import { PrefilledReport } from '../components/PrefilledReport';
import { ReportPending } from '../components/ReportPending';
import { StageCover } from '../components/StageCover';
import { useMyVehicles } from '../hooks/useMyVehicles';
import { requestSaveCarNudge } from '../lib/exitNudgeIntent';
import type { SavedVehicle } from '../types';

const log = createLogger('garage');

/** What the garage answer, on its own, says to show. */
type NaturalStage = 'pending' | 'blank' | 'choose' | 'error';

export function StartReportScreen() {
  const router = useRouter();
  // `?start=blank` opens the blank report directly — for exits that must
  // never land on the chooser (a saved-car report that failed: offering the
  // chooser again would be a loop at the worst moment).
  const { start } = useLocalSearchParams<{ start?: string }>();
  const { status, vehicles, retry } = useMyVehicles();

  // A car with a live listing can't be reported again (create_post refuses
  // it as PLATE_IN_USE), so it is never offered.
  const offerable = vehicles.filter((v) => !v.isCurrentlyPosted);

  const natural: NaturalStage =
    status === 'ready'
      ? offerable.length > 0
        ? 'choose'
        : 'blank'
      : status === 'error'
        ? 'error'
        : 'pending';

  // The owner's own choice from the chooser (or its error view) beats
  // everything else.
  const [picked, setPicked] = useState<{ kind: 'blank' } | { kind: 'car'; vehicle: SavedVehicle } | null>(
    () => (start === 'blank' ? { kind: 'blank' } : null),
  );
  // The first real stage shown is fixed for the visit (see the header). Set
  // during render — React's pattern for state derived from props — so the
  // commit and the stage land in the same frame.
  const [committed, setCommitted] = useState<'blank' | 'choose' | null>(null);
  if (committed === null && (natural === 'blank' || natural === 'choose')) {
    setCommitted(natural);
  }
  // Once the page has shown any answer (an error, say), a retry must not blank
  // it again — the pending stage then shows its quiet line at once.
  const [hadAnswer, setHadAnswer] = useState(false);
  if (!hadAnswer && natural !== 'pending') {
    setHadAnswer(true);
  }

  const startBlank = useCallback(() => setPicked({ kind: 'blank' }), []);
  const choose = useCallback((vehicle: SavedVehicle) => {
    // The same event the /my-cars entry fires, so the add → post funnel
    // stays ONE metric across both entry points.
    log.info('garage_prefilled_post_launched', { vehicleId: vehicle.id });
    setPicked({ kind: 'car', vehicle });
  }, []);
  const goBack = useCallback(() => router.back(), [router]);

  const stage =
    picked?.kind === 'car'
      ? `car:${picked.vehicle.id}`
      : picked?.kind === 'blank'
        ? 'blank'
        : (committed ?? natural);

  // Ids and counts only — never a plate or a nickname (docs/LOGGING.md).
  useEffect(() => {
    if (committed === 'choose') {
      log.info('garage_choose_car_shown', { vehicleCount: offerable.length });
    } else if (committed === 'blank' && status === 'ready') {
      log.debug('garage_choose_car_skipped', { reason: 'no_offerable_cars' });
    }
    // Once per visit: the commit happens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);

  return (
    <StageCover stageKey={stage}>
      {picked?.kind === 'car' ? (
        <PrefilledReport vehicle={picked.vehicle} />
      ) : stage === 'blank' ? (
        // The garage's exit nudge: only the blank report offers it — someone
        // reporting a saved car is never asked to save one.
        <PostACarScreen onAbandon={requestSaveCarNudge} />
      ) : stage === 'choose' ? (
        <ChooseCarStage
          mode="cars"
          vehicles={offerable}
          onChoose={choose}
          onDifferent={startBlank}
          onBack={goBack}
        />
      ) : stage === 'error' ? (
        <ChooseCarStage mode="error" onRetry={retry} onDifferent={startBlank} onBack={goBack} />
      ) : (
        <ReportPending onBack={goBack} immediate={hadAnswer} />
      )}
    </StageCover>
  );
}
