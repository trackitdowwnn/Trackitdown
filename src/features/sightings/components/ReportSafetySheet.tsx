/**
 * WHAT:  ReportSafetySheet — the safety moment before a sighting report. A
 *        bottom sheet over the car's page, titled "Stay safe — report, don't
 *        approach": three rows (the rule, how to keep it, 999), then
 *        "Continue" and a secondary "Call 999". Opened with
 *        `open({ postId, onContinue })`. The report starts only from the
 *        primary button.
 * WHY:   Replaces the wizard's first screen, "Before you report" (2026-09-30,
 *        owner's request, after research). What the research said:
 *          - A SHEET, OVER THE LISTING. The notice is short, the user asked for
 *            it, and the car it's about is still behind it (Apple HIG sheets;
 *            NN/g). Never over the camera: Apple puts camera views full
 *            screen, and sheets mustn't stack.
 *          - DISMISSING IS "NOT NOW". A swipe, a scrim tap or Android Back
 *            closes the sheet and leaves the user on the listing. None of them
 *            counts as having read it.
 *          - The research suggested phrasing the primary as a commitment ("I'm
 *            at a safe distance", like Waze's "I'm a passenger"); the owner
 *            chose a plain "Continue" (2026-09-30). The three points above it
 *            carry the message.
 *          - 999 VISIBLE, NOT DOMINANT. A red outline, not a red slab
 *            competing with the primary. The OS guards a mis-tap (iOS
 *            confirms a tel: link; Android opens the dialer), so there's no
 *            dialog of ours.
 *          - NO checkbox, NO countdown: they cost seconds next to the car.
 *        Shown EVERY time (owner's call; SECURITY_AND_TRUST §1). What happens
 *        is logged (shown / continued / dismissed / call_999) so habituation
 *        can be seen rather than guessed.
 *        THE PROOF IS IN MEMORY, NOT THE URL: a confirm marks lib/safetyAck.ts,
 *        and the report screen checks it. A route param could be forged in a
 *        deep link (security review, 2026-09-30).
 *        The report starts from onDismiss, AFTER the sheet has closed: its
 *        portal sits above every screen, so pushing mid-close would slide it
 *        down over the camera coming up.
 *        ONE OPEN AT A TIME, ONE ANSWER EACH: a second open() while it's up
 *        is ignored (a double tap on "I've seen this car"), a second tap on
 *        the primary does nothing, and a close only counts once. The review
 *        found a stray second onDismiss would otherwise read as a cancel and
 *        send the user back out of a report they'd started.
 * LINKS: src/shared/ui/SafetyNotice.tsx (the copy, `points` layout);
 *        src/shared/ui/BottomSheet.tsx; ../lib/safetyAck.ts;
 *        docs/SECURITY_AND_TRUST.md §1;
 *        src/features/vehicles/screens/PostDetailScreen.tsx and
 *        src/features/search-map/screens/MapSearchScreen.tsx (entries);
 *        src/features/sightings/screens/ReportSightingScreen.tsx (deep links).
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { AccessibilityInfo, Linking, StyleSheet, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { spacing } from '@/shared/theme';
import {
  BottomSheet,
  Button,
  SAFETY_NOTICE_TITLE,
  SAFETY_POINTS_LABEL,
  SafetyNotice,
  useOptionalToast,
  type BottomSheetRef,
} from '@/shared/ui';

import { markSafetyAck } from '../lib/safetyAck';

const log = createLogger('sightings');

/** How long a pending open blocks another (see open()). */
const STALE_OPEN_MS = 3_000;

/** The primary button's words, exported for the tests that press it.
 *  "Continue" by the owner's call (2026-09-30), over the research's
 *  commitment phrasing ("I'm at a safe distance"). */
export const SAFETY_CONTINUE_LABEL = 'Continue';

export interface ReportSafetySheetRef {
  /** Show the sheet for a post. `onContinue` runs only if they confirm, once
   *  the sheet has closed. Ignored while the sheet is already up. */
  open: (request: { postId: string; onContinue: () => void }) => void;
}

export interface ReportSafetySheetProps {
  ref?: Ref<ReportSafetySheetRef>;
  /** Where it opened from, for the funnel log. */
  source: 'detail' | 'map' | 'direct';
  /** Fires when it closes WITHOUT a confirm (swipe, scrim, Back). */
  onCancel?: () => void;
}

/** The safety sheet before a sighting report (see the file header). */
export function ReportSafetySheet({ ref, source, onCancel }: ReportSafetySheetProps) {
  const toast = useOptionalToast();
  const sheetRef = useRef<BottomSheetRef>(null);
  // The open request, and whether it was confirmed. Refs, not state: onDismiss
  // reads them after the close, and nothing renders from them.
  const request = useRef<{ postId: string; onContinue: () => void } | null>(null);
  const confirmed = useRef(false);
  const openedAt = useRef(0);
  // A close that lands after unmount (the route popped under the sheet) must
  // not navigate for a screen that's gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    open: (next) => {
      // A second open while this one is up is a double tap: ignore it. But
      // only for a few seconds: if a close never reported back (gorhom can
      // skip a present), a request held forever would make "I've seen this
      // car" dead on this screen until it remounted. A CONFIRMED request is
      // never stale: its close is in flight and will report back, and
      // replacing it would read that close as a cancel.
      // SAFETY: a new request never inherits an old one's confirm.
      if (request.current && (confirmed.current || Date.now() - openedAt.current < STALE_OPEN_MS)) {
        return;
      }
      openedAt.current = Date.now();
      request.current = next;
      confirmed.current = false;
      sheetRef.current?.open();
      log.info('safety_sheet', { action: 'shown', source });
      // A static alert isn't announced, and the sheet doesn't take focus, so
      // a screen-reader user would otherwise hear nothing change.
      AccessibilityInfo.announceForAccessibility(`${SAFETY_NOTICE_TITLE}. ${SAFETY_POINTS_LABEL}`);
    },
  }));

  // SAFETY: the ONLY place a report is confirmed. Every other close cancels.
  const onSafe = () => {
    if (confirmed.current || !request.current) return;
    confirmed.current = true;
    log.info('safety_sheet', { action: 'continued', source });
    sheetRef.current?.close();
  };

  const onDismiss = () => {
    const closing = request.current;
    if (!closing) return; // already answered: a stray second close
    request.current = null;
    const wasConfirmed = confirmed.current;
    confirmed.current = false;
    // SAFETY: the proof is left only for a confirmed close, for its own post.
    if (wasConfirmed) {
      markSafetyAck(closing.postId);
      if (mounted.current) closing.onContinue();
      return;
    }
    log.info('safety_sheet', { action: 'dismissed', source });
    if (mounted.current) onCancel?.();
  };

  const call999 = () => {
    // The sheet stays open: when they come back from the call, it's where they
    // left it, and the report is still one tap away if it's safe.
    log.info('safety_sheet', { action: 'call_999', source });
    Linking.openURL('tel:999').catch(() => {
      // A Wi-Fi tablet or a simulator can't dial. Silence on a safety control
      // is the worst answer, so say what to do instead.
      log.warn('call_999_failed', { source });
      toast?.show('This device can’t make calls. Call 999 from a phone.', 'error');
    });
  };

  return (
    <BottomSheet ref={sheetRef} title={SAFETY_NOTICE_TITLE} onDismiss={onDismiss}>
      <View style={styles.body} testID="report-safety-sheet">
        <SafetyNotice layout="points" />
        <View style={styles.actions}>
          <Button label={SAFETY_CONTINUE_LABEL} onPress={onSafe} />
          <Button
            label="Call 999"
            variant="dangerOutline"
            icon="phone"
            // Spaced digits: screen readers read "999" as "nine hundred and
            // ninety-nine". Still starts with the visible words for voice control.
            accessibilityLabel="Call 9 9 9, emergency"
            accessibilityHint="Opens your phone to call emergency services"
            onPress={call999}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

// Rhythm: header 16, points 16 apart, 24 to the actions, 12 between them. At
// 12 to the actions (ConfirmDialog's flat gap) the buttons would sit closer
// to the list than its items are to each other, and read as part of it.
const styles = StyleSheet.create({
  body: {
    gap: spacing.xl,
  },
  actions: {
    gap: spacing.md,
  },
});
