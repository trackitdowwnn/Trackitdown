/**
 * WHAT:  AlertNudgeSheet — the one-time offer to set an alert area, made after
 *        someone finishes their third listing. Mounted once at the app root,
 *        driven entirely by the alert-nudge intent store.
 * WHY:   Setting an alert area is the app's core loop — nobody is notified about
 *        anything until one exists — and a quiet feed row is easy to scroll
 *        past. This spends one interruption, once per install, at a moment the
 *        user has earned it: three listings opened says they are watching cars
 *        near them.
 *
 *        Deliberately NOT on a timer. A clock does not know what someone is
 *        doing; three post exits do. It fires as they LEAVE the third listing,
 *        so the sheet opens over the feed rather than over the thing they just
 *        tapped (garage/README.md: "fires on EXIT, never on entry").
 *
 *        Mounted at the root, like SaveYourCarSheet, because the post route
 *        unmounts as they back out and cannot host its own sheet.
 *
 *        BottomSheet + two Buttons rather than ConfirmDialog: that component's
 *        cancel only closes and carries no handler, so it cannot express
 *        "Set my alert area" and "Not now" as two distinct outcomes.
 * LINKS: ../lib/alertNudgeIntent.ts (the store);
 *        ../lib/alertNudgeStorage.ts (the once-only flag);
 *        ../hooks/useCountPostViewForAlertNudge.ts (raises the intent);
 *        src/features/garage/components/SaveYourCarSheet.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, Text, View } from 'react-native';

import { useSaveCarNudgeIntent } from '@/features/garage';
import { createLogger } from '@/shared/lib/logger';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, type BottomSheetRef } from '@/shared/ui';

import { useMyAlerts } from '../hooks/useMyAlerts';
import { clearAlertNudge, useAlertNudgeIntent } from '../lib/alertNudgeIntent';
import { hasOfferedAlertNudge, markAlertNudgeOffered } from '../lib/alertNudgeStorage';

const log = createLogger('notifications');

export function AlertNudgeSheet() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const intent = useAlertNudgeIntent();
  const sheetRef = useRef<BottomSheetRef>(null);

  // No auth import needed: useMyAlerts already reports 'signedOut' for a guest
  // and 'ready' with an empty list for exactly the person this offer is for.
  //
  // Narrowed to PRIMITIVES before the effect below depends on them. useMyAlerts
  // returns a fresh object literal every render, so depending on it directly
  // re-runs the effect on every render — and the effect's cleanup cancels the
  // deferred open(), so the sheet logged its impression, wrote its once-only
  // flag, and then never appeared. SaveYourCarSheet only ever depends on
  // primitives, which is why it has never had this.
  const alerts = useMyAlerts();
  const alertsStatus = alerts.status;
  const alertCount = alerts.status === 'ready' ? alerts.alerts.length : -1;

  // Two root sheets presenting at once would stack. The garage's offer is
  // raised by a different journey and both are one-shot per install, so a
  // collision is unlikely — but gorhom would happily show both, so yield.
  const garageIntent = useSaveCarNudgeIntent();

  // Guards against presenting twice for one intent; reset when the intent goes.
  const presentedRef = useRef(false);
  useEffect(() => {
    if (intent === null) {
      presentedRef.current = false;
    }
  }, [intent]);

  // null = still reading. Never decide on null: opening and then closing would
  // flash a sheet at someone who has already declined.
  const [alreadyOffered, setAlreadyOffered] = useState<boolean | null>(null);
  useEffect(() => {
    if (intent === null) {
      return;
    }
    let active = true;
    void hasOfferedAlertNudge().then((offered) => {
      if (active) {
        setAlreadyOffered(offered);
      }
    });
    return () => {
      active = false;
    };
  }, [intent]);

  const suppress = useCallback((reason: string) => {
    log.debug('alert_nudge_suppressed', { surface: 'exit_sheet', reason });
    clearAlertNudge();
  }, []);

  useEffect(() => {
    if (intent === null) {
      return;
    }
    if (garageIntent !== null) {
      suppress('garage_sheet_pending');
      return;
    }
    if (alertsStatus === 'signedOut') {
      suppress('signed_out');
      return;
    }
    // A FAILED alert fetch must clear the intent, not hold it. Holding was
    // right for 'loading' (the answer is coming) but wrong for 'error': the
    // intent would sit pending forever, the sheet would never open, and the
    // offer would be stuck in limbo rather than simply retried on a later
    // listing.
    if (alertsStatus === 'error') {
      suppress('alerts_unavailable');
      return;
    }
    if (alreadyOffered === null || alertsStatus !== 'ready') {
      return; // still resolving — hold rather than flash
    }
    if (alreadyOffered) {
      suppress('already_offered');
      return;
    }
    if (alertCount > 0) {
      suppress('already_has_alert');
      return;
    }

    // Present once per intent. A ref, not state: this is the effect's own
    // bookkeeping, and setting state here would cascade a render for nothing.
    if (presentedRef.current) {
      return;
    }
    presentedRef.current = true;

    // Marked the moment it PRESENTS, not on the user's answer: the flag means
    // "we asked". So this appears at most once per install however they respond.
    void markAlertNudgeOffered();
    log.info('alert_nudge_shown', { surface: 'exit_sheet' });

    // The post route's back navigation is still animating; presenting into that
    // transition drops the animation. Wait for it to settle.
    const task = InteractionManager.runAfterInteractions(() => {
      sheetRef.current?.open();
    });
    return () => task.cancel();
    // PRIMITIVES ONLY. An object dep here re-runs this effect every render and
    // the cleanup above cancels the pending open() — see the note at alertsStatus.
  }, [intent, garageIntent, alertsStatus, alertCount, alreadyOffered, suppress]);

  const onSetArea = useCallback(() => {
    log.info('alert_nudge_accepted', { surface: 'exit_sheet' });
    clearAlertNudge();
    sheetRef.current?.close();
    router.push('/alerts/new');
  }, [router]);

  const onNotNow = useCallback(() => {
    log.info('alert_nudge_dismissed', { surface: 'exit_sheet' });
    clearAlertNudge();
    sheetRef.current?.close();
  }, []);

  return (
    <BottomSheet
      ref={sheetRef}
      title="Know when a car goes missing near you"
      // Covers the swipe and scrim-tap exits too — all three mean "no".
      onDismiss={clearAlertNudge}
    >
      <View style={styles.content} testID="alert-nudge-sheet">
        {/* A dedicated moment can carry the two reassurances the feed row had
            no room for: how often, and how little location it costs them. */}
        <Text style={styles.body}>
          Pick an area and we&apos;ll notify you when a car is reported stolen inside it. A
          few a day at most — and you can save a rough area rather than your exact
          address.
        </Text>
        <Button label="Set my alert area" onPress={onSetArea} />
        <Button label="Not now" variant="ghost" onPress={onNotNow} />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: c.textSecondary,
  },
});
