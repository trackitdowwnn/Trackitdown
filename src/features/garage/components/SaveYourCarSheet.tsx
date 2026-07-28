/**
 * WHAT:  SaveYourCarSheet — the offer made when someone opens the post-a-car
 *        wizard and leaves WITHOUT posting, having no saved car. Mounted once at
 *        the app root, driven entirely by the exit-nudge intent store.
 * WHY:   Backing out of the report flow is the clearest signal in the app that
 *        someone is exploring rather than in trouble — the perfect moment to
 *        offer the garage. The mirror image (prompting when they TAP report) was
 *        deliberately rejected: whoever taps that button has very likely just
 *        had their car stolen, and an interstitial would cost them time at the
 *        exact moment the garage exists to save it.
 *
 *        Mounted at the root, like AuthSheet, because the wizard route unmounts
 *        on exit and cannot host its own sheet.
 *
 *        Uses BottomSheet + two Buttons rather than ConfirmDialog: that
 *        component's cancel button only closes and carries no handler, so it
 *        cannot express "Save my car" and "Not now" as two distinct outcomes.
 *
 *        Uses useSession, NOT useAuthStanding: the latter fires a hasProfile
 *        select per hook instance, and this is mounted at the root on every
 *        cold start for a check it doesn't need.
 * LINKS: src/features/garage/lib/exitNudgeIntent.ts (the store);
 *        src/features/garage/lib/garageNudgeStorage.ts (the shared once-only flag);
 *        src/app/post-a-car.tsx (the only place the intent is raised);
 *        src/features/auth/components/AuthSheet.tsx (the root-mounted pattern).
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { colors, spacing, typography } from '@/shared/theme';
import { BottomSheet, Button, type BottomSheetRef } from '@/shared/ui';

import { useHasSavedCar } from '../hooks/useHasSavedCar';
import { clearSaveCarNudge, useSaveCarNudgeIntent } from '../lib/exitNudgeIntent';
import { hasOfferedGarageNudge, markGarageNudgeOffered } from '../lib/garageNudgeStorage';

const log = createLogger('garage');

export function SaveYourCarSheet() {
  const router = useRouter();
  const session = useSession();
  const intent = useSaveCarNudgeIntent();
  const sheetRef = useRef<BottomSheetRef>(null);

  const signedIn = session.status === 'signedIn';
  // Only ask the garage anything once there IS an intent — this is mounted for
  // the whole app lifetime and must cost nothing the rest of the time.
  const savedCar = useHasSavedCar({ enabled: intent !== null && signedIn });

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
    void hasOfferedGarageNudge().then((offered) => {
      if (active) {
        setAlreadyOffered(offered);
      }
    });
    return () => {
      active = false;
    };
  }, [intent]);

  const suppress = useCallback((reason: string) => {
    log.debug('garage_nudge_suppressed', { surface: 'exit_sheet', reason });
    clearSaveCarNudge();
  }, []);

  useEffect(() => {
    if (intent === null) {
      return;
    }
    // The __DEV__ tab-bar branch lets a GUEST reach the wizard; offering them a
    // garage they can't write to would be a dead end. This check also keeps
    // working when that branch is eventually deleted.
    if (!signedIn) {
      suppress('signed_out');
      return;
    }
    if (alreadyOffered === null || savedCar === 'unknown') {
      return; // still resolving — hold rather than flash
    }
    if (alreadyOffered) {
      suppress('already_offered');
      return;
    }
    if (savedCar === 'some') {
      suppress('already_has_car');
      return;
    }

    // Present once per intent. A ref, not state: this is the effect's own
    // bookkeeping, and setting state here would cascade a render for something
    // nothing renders.
    if (presentedRef.current) {
      return;
    }
    presentedRef.current = true;

    // Marked the moment it PRESENTS, not on the user's answer: the flag means
    // "we asked". So this appears at most once per install however they respond,
    // and it also silences the Explore card — the same offer, asked twice, is a
    // nag.
    void markGarageNudgeOffered();
    log.info('garage_nudge_shown', { surface: 'exit_sheet' });

    // The wizard route is a slide_from_bottom dismissal in flight right now;
    // presenting a modal into that transition drops the animation. Wait for the
    // navigation to settle first.
    const task = InteractionManager.runAfterInteractions(() => {
      sheetRef.current?.open();
    });
    return () => task.cancel();
  }, [intent, signedIn, alreadyOffered, savedCar, suppress]);

  const onAdd = useCallback(() => {
    log.info('garage_nudge_accepted', { surface: 'exit_sheet' });
    clearSaveCarNudge();
    sheetRef.current?.close();
    router.push('/add-vehicle');
  }, [router]);

  const onNotNow = useCallback(() => {
    log.info('garage_nudge_dismissed', { surface: 'exit_sheet' });
    clearSaveCarNudge();
    sheetRef.current?.close();
  }, []);

  return (
    <BottomSheet
      ref={sheetRef}
      title="Not reporting one today?"
      // Covers the swipe and scrim-tap exits too — all three mean "no".
      onDismiss={clearSaveCarNudge}
    >
      <View style={styles.content} testID="garage-exit-nudge">
        <Text style={styles.body}>
          Save your car now and it takes seconds to report, instead of minutes — we&apos;ll
          already have the details.
        </Text>
        <Button label="Save my car" onPress={onAdd} />
        <Button label="Not now" variant="ghost" onPress={onNotNow} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
