/**
 * WHAT:  StartReportScreen — the ONE screen behind the + button. It slides up
 *        once and shows, in place: the blank report (no cars to offer), the
 *        "Which car?" chooser (cars to offer), a quiet pending state while it
 *        can't yet tell, the chooser's error view, or — for a guest who got
 *        here without the + button's gate — a sign-in stage. Choosing a car
 *        or "a different car" dissolves into that report — no navigation.
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
 *        after the blank form appeared must not yank the form away. The one
 *        exception runs the other way: a chooser left with NO car to offer
 *        (the last one was just reported) gives way to the blank report.
 *
 *        ⚠️ SIGNED OUT BEATS EVERYTHING — BUT ONLY BEFORE THE VISIT WAS EVER
 *        SIGNED IN. A guest sees the sign-in stage, even with ?start=blank.
 *        A session that ends MID-visit (a token that expired) changes
 *        nothing on screen: swapping the form for a sign-in page would throw
 *        away every typed answer — and, after create_post, the draft's id,
 *        so paying again would make a second post (review of #141). Its
 *        submit fails with the sign-in-again copy, and Save and exit still
 *        keeps the draft for its owner. A DIFFERENT account appearing
 *        mid-visit closes the screen: nothing of the first one's — a chosen
 *        car's plate, typed answers — may be shown to the second.
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
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRequireAuth, useSession } from '@/features/auth';
import { PostACarScreen } from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';
import { EmptyState, Screen } from '@/shared/ui';

import { ChooseCarStage } from '../components/ChooseCarStage';
import { PrefilledReport } from '../components/PrefilledReport';
import { ReportHeader } from '../components/ReportHeader';
import { ReportPending } from '../components/ReportPending';
import { StageCover } from '../components/StageCover';
import { useMyVehicles } from '../hooks/useMyVehicles';
import { requestSaveCarNudge } from '../lib/exitNudgeIntent';
import type { SavedVehicle } from '../types';

const log = createLogger('garage');

/** What the garage answer, on its own, says to show. */
type NaturalStage = 'signin' | 'pending' | 'blank' | 'choose' | 'error';

export function StartReportScreen() {
  const router = useRouter();
  // `?start=blank` opens the blank report directly — for exits that must
  // never land on the chooser (a saved-car report that failed: offering the
  // chooser again would be a loop at the worst moment).
  const { start } = useLocalSearchParams<{ start?: string }>();
  const session = useSession();
  const requireAuth = useRequireAuth();
  const { status, vehicles, retry } = useMyVehicles();

  // A GUEST can arrive here without the + button's gate — a deep link to
  // /post-a-car (review of #141). The form would only fail at create_post, so
  // they're shown the sign-in sheet once, over a sign-in stage that asks
  // again if they close it; once signed in, this screen carries on.
  const askToSignIn = useCallback(() => requireAuth({ context: 'post_car' }), [requireAuth]);
  //
  // "Guest" means never signed in during THIS visit — see the header for
  // why a session that ends mid-visit doesn't count. Held in state, set
  // during render, so the first signed-in frame already knows.
  const userId = session.status === 'signedIn' ? session.userId : null;
  const [visitUser, setVisitUser] = useState(userId);
  if (visitUser === null && userId !== null) {
    setVisitUser(userId);
  }
  const isGuest = visitUser === null;
  // SAFETY: another account mid-visit — leave (see the header).
  const switched = visitUser !== null && userId !== null && userId !== visitUser;
  useEffect(() => {
    if (switched) {
      router.back();
    }
  }, [switched, router]);
  const askedRef = useRef(false);
  useEffect(() => {
    if (isGuest && session.status === 'signedOut' && !askedRef.current) {
      askedRef.current = true;
      askToSignIn();
    }
  }, [isGuest, session.status, askToSignIn]);

  // A car with a live listing can't be reported again (create_post refuses
  // it as PLATE_IN_USE), so it is never offered.
  const offerable = vehicles.filter((v) => !v.isCurrentlyPosted);

  const natural: NaturalStage = isGuest
    ? session.status === 'signedOut'
      ? 'signin'
      : 'pending'
    : status === 'ready'
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
  // commit and the stage land in the same frame. Each update is guarded by
  // the condition it makes false, so it settles.
  const [committed, setCommitted] = useState<'blank' | 'choose' | null>(null);
  if (committed === null && (natural === 'blank' || natural === 'choose')) {
    setCommitted(natural);
  } else if (
    committed === 'choose' &&
    session.status === 'signedIn' &&
    status === 'ready' &&
    offerable.length === 0
  ) {
    // The ONE allowed swap: a revalidation left the chooser with nothing to
    // offer (the car was just reported elsewhere). "Which car?" is never
    // drawn without cars, so it gives way to the blank report. (Not on a
    // sign-out: a signed-out garage reads as empty, and that isn't news.)
    setCommitted('blank');
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

  // Signed out (or not yet known) beats even ?start=blank: a guest can't post.
  const stage = switched
    ? 'pending'
    : isGuest
      ? natural
    : picked?.kind === 'car'
      ? `car:${picked.vehicle.id}`
      : picked?.kind === 'blank'
        ? 'blank'
        : (committed ?? natural);
  // The chooser announces itself only when it REPLACES another stage — as
  // the first thing on screen, the screen reader already lands on it.
  const [firstStage] = useState(stage);

  // Funnel events, once each per visit. Ids and counts only — never a plate
  // or a nickname (docs/LOGGING.md). "Skipped" means the GARAGE sent them
  // straight to the blank report — not an owner's pick, not ?start=blank.
  const loggedRef = useRef({ shown: false, skipped: false });
  const offerableCount = offerable.length;
  useEffect(() => {
    if (stage === 'choose' && !loggedRef.current.shown) {
      loggedRef.current.shown = true;
      log.info('garage_choose_car_shown', { vehicleCount: offerableCount });
    } else if (stage === 'blank' && picked === null && status === 'ready' && !loggedRef.current.skipped) {
      loggedRef.current.skipped = true;
      log.debug('garage_choose_car_skipped', { reason: 'no_offerable_cars' });
    }
  }, [stage, picked, status, offerableCount]);

  return (
    <StageCover stageKey={stage}>
      {stage === 'signin' ? (
        <Screen>
          <ReportHeader onBack={goBack} />
          <EmptyState
            title="Sign in to report a stolen car"
            body="You'll need an account so spotters can reach you."
            actionLabel="Sign in"
            actionVariant="primary"
            onAction={askToSignIn}
          />
        </Screen>
      ) : picked?.kind === 'car' && stage === `car:${picked.vehicle.id}` ? (
        <PrefilledReport vehicle={picked.vehicle} />
      ) : stage === 'blank' ? (
        // The garage's exit nudge: only the blank report offers it — someone
        // reporting a saved car is never asked to save one.
        // No onPostCreated: a car reported from scratch isn't in the garage.
        <PostACarScreen onAbandon={requestSaveCarNudge} />
      ) : stage === 'choose' ? (
        <ChooseCarStage
          mode="cars"
          vehicles={offerable}
          announce={firstStage !== 'choose'}
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
