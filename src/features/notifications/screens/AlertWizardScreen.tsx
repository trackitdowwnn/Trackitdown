/**
 * WHAT:  Hosts the alert wizard for BOTH creating and editing — `alertId`
 *        present means edit, absent means create. Opens on the matcher picker
 *        ("What should this alert match?"), then runs the wizard those ticks
 *        describe.
 * WHY:   One flow, two jobs, exactly as AddVehicleScreen does for the garage.
 *        An alert is small enough that editing it through the same questions is
 *        clearer than a per-section editor (which is what posts get, because a
 *        live post is big and partially frozen).
 *
 *        THE PICKER IS A SEPARATE SCREEN, NOT A WIZARD STEP. `useWizardController`
 *        resets navigation whenever the flattened screen list changes identity,
 *        and its indices are positions into that list, so a step that added or
 *        removed later steps would bounce the user back to itself. Choosing
 *        first and memoising the built flow keeps it stable for the whole run —
 *        see the header of ../lib/alertFlow.tsx.
 *
 *        In EDIT mode the screen holds a loader until the alert arrives: the
 *        wizard must never mount with blank answers and be re-seeded
 *        underneath the user, because `update_my_alert` is a FULL REPLACE and
 *        blank answers would quietly wipe their criteria. The picker is
 *        pre-ticked from the saved criteria for the same reason, and so that
 *        editing can ADD a criterion the alert didn't have.
 * LINKS: ../lib/alertFlow.tsx; ../lib/alertMatchers.ts;
 *        ../components/AlertMatcherPicker.tsx; ../api/alertsApi.ts;
 *        ../hooks/useMyAlerts.ts;
 *        src/features/garage/screens/AddVehicleScreen.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';
import { EmptyState, ErrorState, FullscreenLoader, useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { createAlert, updateAlert } from '../api/alertsApi';
import { AlertMatcherPicker } from '../components/AlertMatcherPicker';
import { ALERT_INITIAL_ANSWERS, buildAlertFlow } from '../lib/alertFlow';
import { criteriaForMatchers, matchersForCriteria } from '../lib/alertMatchers';
import { useDefaultAlertCentre } from '../hooks/useDefaultAlertCentre';
import { invalidateMyAlerts, useMyAlerts } from '../hooks/useMyAlerts';
import {
  DEFAULT_ALERT_RADIUS_MILES,
  MAX_ALERTS_PER_USER,
  REQUIRED_MATCHERS,
  type Alert,
  type AlertAnswers,
  type AlertMatcher,
} from '../types';

const log = createLogger('notifications');

/** Server error tokens this screen turns into copy. */
const ERROR_COPY: Record<string, string> = {
  ALERT_LIMIT_REACHED: `You can have up to ${MAX_ALERTS_PER_USER} alerts. Delete one to add another.`,
  ALERT_NOT_FOUND: "That alert no longer exists — it may have been deleted on another device.",
};

function toAnswers(alert: Alert): Partial<AlertAnswers> {
  return {
    location: { latitude: alert.latitude, longitude: alert.longitude },
    approximate: alert.approximate,
    radiusMiles: alert.radiusMiles,
    make: alert.criteria.make,
    model: alert.criteria.model,
    colour: alert.criteria.colour,
    bodyType: alert.criteria.bodyType,
    minBountyPence: alert.criteria.minBountyPence,
    recencyDays: alert.criteria.recencyDays,
    name: alert.name,
    // No placeLabel: we store a point, not a name. The review line falls back
    // to "the pin" until the user moves the map and a fresh geocode lands.
    placeLabel: null,
  };
}

export interface AlertWizardScreenProps {
  /** Present = edit that alert; absent = create a new one. */
  alertId?: string;
}

export function AlertWizardScreen({ alertId }: AlertWizardScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const state = useMyAlerts();

  /** What the picker has ticked. null until the user commits, which is what
   *  keeps the picker on screen; committing builds the flow exactly once. */
  const [confirmed, setConfirmed] = useState<AlertMatcher[] | null>(null);
  /** The picker's working selection. Held as a DERIVED DRAFT (`?? default`)
   *  rather than seeded by an effect, because in edit mode the saved alert
   *  arrives after mount and writing state from an effect is both a lint error
   *  here and a re-render loop waiting to happen. */
  const [draftMatchers, setDraftMatchers] = useState<AlertMatcher[] | null>(null);

  const existing =
    alertId && state.status === 'ready' ? state.alerts.find((a) => a.id === alertId) : undefined;

  // Resolved WHILE THE MATCHER PICKER IS ON SCREEN — which is the only reason
  // this is free. LocationPicker reads `initialLocation` once, on mount, so the
  // coordinate has to exist before the wizard renders; the picker gives us
  // those few seconds. Skipped when editing: that alert already has a point.
  const defaultCentre = useDefaultAlertCentre(!alertId);

  const initialAnswers = useMemo(
    () =>
      existing
        ? toAnswers(existing)
        : {
            ...ALERT_INITIAL_ANSWERS,
            // Opening ON the user's area also SETTLES the picker, so Next
            // unlocks without them touching the map. Deliberate: that is the
            // two-tap path this feature exists for, and it stays safe because
            // `approximate` defaults true and the server snaps the stored point
            // to the ~1km grid regardless of what we centre on.
            ...(defaultCentre.centre ? { location: defaultCentre.centre } : {}),
          },
    [existing, defaultCentre.centre],
  );

  // Editing re-opens the questions the alert already answers; a new alert
  // starts with only the mandatory area ticked.
  const defaultMatchers = useMemo(
    () => (existing ? matchersForCriteria(existing.criteria) : [...REQUIRED_MATCHERS]),
    [existing],
  );
  const matcherSelection = draftMatchers ?? defaultMatchers;

  // Memoised on the committed selection: the controller resets its navigation
  // whenever the flow's screen list changes identity, so an unstable flow would
  // bounce the user to step 1. `confirmed` only changes via the picker, which
  // is unmounted by then.
  const flow = useMemo(() => buildAlertFlow(confirmed ?? []), [confirmed]);

  // --- Edit-mode guards. Must not fall through to a blank wizard: the update
  // is a full replace, so mounting blank would offer to erase their alert.
  if (alertId) {
    if (state.status === 'loading') {
      return <FullscreenLoader visible message="Loading your alert" />;
    }
    if (state.status === 'error') {
      return <ErrorState title="We couldn't load that alert" onRetry={state.refresh} />;
    }
    if (state.status === 'signedOut' || !existing) {
      return (
        <EmptyState
          title="That alert isn't here"
          body="It may have been deleted. Your other alerts are unaffected."
          actionLabel="Back to alerts"
          onAction={() => router.back()}
        />
      );
    }
  }

  const handleComplete = async (answers: Partial<AlertAnswers>) => {
    if (!answers.location) {
      // Unreachable — the area step's schema gates this — but a full replace
      // with no point would be a corrupt row, so refuse loudly rather than
      // send it.
      throw new Error('Pick an area before saving.');
    }
    const draft = {
      name: (answers.name ?? '').trim(),
      latitude: answers.location.latitude,
      longitude: answers.location.longitude,
      radiusMiles: answers.radiusMiles ?? DEFAULT_ALERT_RADIUS_MILES,
      // Editing preserves the alert's paused state; a new alert starts on.
      enabled: existing ? existing.enabled : true,
      approximate: answers.approximate ?? true,
      // SAFETY: reduced through the CHOSEN matchers, not read straight off the
      // answers. A user can tick "A specific car", pick a BMW, back out and
      // untick it — the answers still hold the BMW, and this is a full replace,
      // so without the reduction the saved alert would stay BMW-only while
      // every screen said "any car". See lib/alertMatchers.ts.
      criteria: criteriaForMatchers(answers, confirmed ?? []),
    };

    try {
      const saved = existing ? await updateAlert(existing.id, draft) : await createAlert(draft);
      invalidateMyAlerts();
      toast.show(
        saved.approximate ? 'Alert saved to a rough area' : 'Alert saved',
      );
      // back(), not replace(): the list revalidates on focus, and Back from a
      // finished wizard should land on the list, not re-enter the wizard.
      router.back();
    } catch (error) {
      const token = error instanceof Error ? error.message.split(':')[0].trim() : '';
      log.warn('alert_save_failed', { editing: Boolean(existing) });
      // Thrown, not toasted: the wizard stays intact and shows this above the
      // footer, so nothing the user typed is lost.
      throw new Error(ERROR_COPY[token] ?? "We couldn't save that alert. Please try again.");
    }
  };

  // The picker owns the screen until it is committed. Rendered AFTER the
  // edit-mode guards above so an edit never picks matchers from a blank alert.
  if (confirmed === null) {
    return (
      <AlertMatcherPicker
        value={matcherSelection}
        onChange={setDraftMatchers}
        onContinue={() => setConfirmed(matcherSelection)}
        onExit={() => router.back()}
        editing={Boolean(existing)}
      />
    );
  }

  // The user got through the picker faster than the GPS fix. Hold briefly
  // rather than mount the map on the whole-UK view and be unable to move it —
  // `initialLocation` is read once, on mount.
  //
  // SAFETY: this can only be reached in create mode, and useDefaultAlertCentre
  // guarantees it resolves within RESOLVE_TIMEOUT_MS whatever the device does.
  // A guard that could spin for ever is exactly how AlertSettingsScreen hung on
  // this same feature — hence the test that this state always ends.
  if (defaultCentre.status === 'resolving') {
    return <FullscreenLoader visible message="Finding your area" />;
  }

  return (
    <WizardScreen
      flow={flow}
      initialAnswers={initialAnswers}
      // Leaves the flow rather than returning to the picker: the wizard holds
      // the answers, so stepping back to change what this alert matches would
      // discard them. Re-entering from the list is one tap and loses nothing.
      onExit={() => router.back()}
      onComplete={handleComplete}
    />
  );
}
