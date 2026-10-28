/**
 * WHAT:  SaveYourCarSheet — the offer made when someone opens the post-a-car
 *        wizard and leaves WITHOUT posting, or (since 2026-10-27) has just
 *        marked a listing recovered — either way having no saved car. Mounted
 *        once at the app root, driven entirely by the exit-nudge intent store.
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
 *        the two places the intent is raised: StartReportScreen.tsx (the
 *        wizard's onAbandon) and src/app/recover-post.tsx (after a recovery);
 *        src/features/auth/components/AuthSheet.tsx (the root-mounted pattern).
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, type BottomSheetRef } from '@/shared/ui';

import { useHasSavedCar } from '../hooks/useHasSavedCar';
import { clearSaveCarNudge, useSaveCarNudgeIntent } from '../lib/exitNudgeIntent';
import { hasOfferedGarageNudge, markGarageNudgeOffered } from '../lib/garageNudgeStorage';

const log = createLogger('garage');

export function SaveYourCarSheet() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const session = useSession();
  const intent = useSaveCarNudgeIntent();
  const sheetRef = useRef<BottomSheetRef>(null);

  const signedIn = session.status === 'signedIn';
  // A listing just closed as recovered (first-login welcome, 2026-10-27): the
  // car is back and they have just seen why a fast report matters. Its own
  // moment, so it does not defer to the once-flag the wizard exit spent.
  const recoveredPostId = intent?.source === 'recovered' ? intent.postId : null;
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
    // Defence in depth. This existed because a __DEV__ tab-bar branch let a
    // GUEST reach the wizard (that branch was deleted 2026-08-01); the entry
    // point gates properly now, but offering a garage to someone who cannot
    // write to it would be a dead end however they arrived, so the check stays.
    if (!signedIn) {
      suppress('signed_out');
      return;
    }
    if (alreadyOffered === null || savedCar === 'unknown') {
      return; // still resolving — hold rather than flash
    }
    if (alreadyOffered && recoveredPostId === null) {
      suppress('already_offered');
      return;
    }
    // Also covers a listing started FROM My cars: that car is already saved.
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
    log.info('garage_nudge_shown', { surface: 'exit_sheet', source: intent.source });

    // Opened on the next tick, not in this commit. That is all RN 0.86's
    // runAfterInteractions did (a deprecation stub): it does NOT wait for the
    // wizard's slide-down dismissal to finish.
    const timer = setTimeout(() => {
      sheetRef.current?.open();
    }, 0);
    return () => clearTimeout(timer);
  }, [intent, signedIn, alreadyOffered, savedCar, suppress, recoveredPostId]);

  const onAdd = useCallback(() => {
    log.info('garage_nudge_accepted', { surface: 'exit_sheet' });
    // close() fires onDismiss, which clears the intent AFTER the slide-down —
    // clearing it first flipped the copy to the wizard-exit words mid-close.
    sheetRef.current?.close();
    // From a recovery, the wizard starts from the listing's details — the
    // owner checks them and saves; nothing is saved behind their back.
    router.push(
      recoveredPostId
        ? { pathname: '/add-vehicle', params: { fromPost: recoveredPostId } }
        : '/add-vehicle',
    );
  }, [router, recoveredPostId]);

  const onNotNow = useCallback(() => {
    log.info('garage_nudge_dismissed', { surface: 'exit_sheet' });
    sheetRef.current?.close(); // onDismiss clears the intent, as above

  }, []);

  return (
    <BottomSheet
      ref={sheetRef}
      title={recoveredPostId ? 'Glad it’s back' : 'Not reporting one today?'}
      // Covers the swipe and scrim-tap exits too — all three mean "no".
      onDismiss={clearSaveCarNudge}
    >
      <View style={styles.content} testID="garage-exit-nudge">
        <Text style={styles.body}>
          {recoveredPostId
            ? 'Save it to My cars so you can report it in seconds next time.'
            : 'Save your car now and it takes seconds to report, instead of minutes — we’ll already have the details.'}
        </Text>
        <Button label="Save my car" onPress={onAdd} />
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
