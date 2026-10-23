/**
 * WHAT:  DeleteAccountSheet — the bottom sheet behind Profile's red "Delete
 *        account" row. On open it reads what still stops the deletion; if
 *        anything does, it lists it (one line each, saying what to do) and
 *        offers no button. Otherwise it says what goes and what's kept, and
 *        deletes once they type DELETE.
 * WHY:   Owner, 2026-10-23: a bottom sheet rather than a whole page, and
 *        "type in a word to confirm" — DELETE, the common convention — in
 *        place of the emailed code (#266, removed with its server check at
 *        the owner's call; SECURITY_AND_TRUST §3 records the trade-off).
 *        Delete straight away, but only when nothing is pending.
 *
 *        The blockers read is ADVISORY (it can be a beat stale, and the payout
 *        balance is only checked at the server). A refusal from the server
 *        shows its own reason and re-reads the list.
 *
 *        No "Stripe" anywhere (owner: say "payouts"). Minimal words. The X and
 *        a swipe are the way out — no second Cancel beside the button.
 * LINKS: ../api/profileApi.ts (fetchDeletionBlockers, fetchLiveListingCount,
 *        requestAccountDeletion); ../lib/deletionReasons.ts;
 *        supabase/functions/delete-account/index.ts; ../screens/ProfileScreen.tsx.
 */

import { useRouter } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { type Ref, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  spacing,
  sizes,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { BottomSheet, Button, TextField, useToast, type BottomSheetRef } from '@/shared/ui';

import {
  AccountDeletionError,
  fetchDeletionBlockers,
  fetchLiveListingCount,
  requestAccountDeletion,
  type DeletionBlocker,
} from '../api/profileApi';
import { deletionReason } from '../lib/deletionReasons';

const CONFIRM_WORD = 'DELETE';

const DELETED = [
  'Your profile and photos',
  'Your listings and sightings',
  'Your messages, alerts and payout details',
];

type Status = 'loading' | 'ready' | 'error';

export interface DeleteAccountSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** The signed-in user — whose live listings to count. */
  userId: string;
}

export function DeleteAccountSheet({ ref, userId }: DeleteAccountSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const sheetRef = useRef<BottomSheetRef>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [blockers, setBlockers] = useState<DeletionBlocker[]>([]);
  const [liveListings, setLiveListings] = useState(0);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The re-entry guard, as a REF: two taps in one tick both read `deleting`
  // from the same render (BlockedAccountsScreen records the same lesson).
  const inFlight = useRef(false);

  // Both, or neither: without the live-listing count the sheet can't warn that
  // deleting takes a listing down, so a failed read is an error, never a 0.
  const load = useCallback(() => {
    setStatus('loading');
    Promise.all([fetchDeletionBlockers(), fetchLiveListingCount(userId)])
      .then(([rows, live]) => {
        setBlockers(rows);
        setLiveListings(live);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [userId]);

  // Read fresh on every open — what blocks can change between visits.
  useImperativeHandle(ref, () => ({
    open: () => {
      setTyped('');
      load();
      sheetRef.current?.open();
    },
    close: () => sheetRef.current?.close(),
  }));

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const remove = useCallback(async () => {
    if (inFlight.current || !confirmed) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      await requestAccountDeletion(); // also clears the local session
      toast.show('Your account has been deleted', 'success');
      sheetRef.current?.close();
      // Guest mode now; the feed is the one surface that works with no
      // account (the same landing as Log out). The guard stays SET: a second
      // tap before the sheet goes would send a request with no session.
      router.navigate('/(tabs)/explore');
    } catch (error) {
      toast.show(
        error instanceof AccountDeletionError
          ? error.message
          : 'We couldn’t delete your account. Please try again.',
        'error',
      );
      inFlight.current = false;
      setDeleting(false);
      // Something changed since the list was read — show what it is now.
      load();
    }
  }, [confirmed, load, router, toast]);

  return (
    <BottomSheet
      ref={sheetRef}
      title="Delete account"
      titleIcon={
        <TriangleAlert
          size={sizes.iconSm}
          color={palette.danger}
          accessible={false}
          importantForAccessibility="no"
        />
      }
    >
      {status === 'loading' ? (
        <ActivityIndicator
          color={palette.textSecondary}
          style={styles.loading}
          accessibilityLabel="Checking your account"
          testID="delete-account-loading"
        />
      ) : status === 'error' ? (
        <View style={styles.body}>
          <Text style={styles.reason}>We couldn’t check your account.</Text>
          <Button label="Try again" variant="secondary" onPress={load} />
        </View>
      ) : blockers.length > 0 ? (
        <View style={styles.body} testID="delete-account-blocked">
          <Text style={styles.lead}>You can’t delete your account yet.</Text>
          {/* The main content here, so primary ink — each line says what to do. */}
          {blockers.map((blocker) => (
            <Text key={blocker.code} style={styles.reason}>
              {deletionReason(blocker)}
            </Text>
          ))}
        </View>
      ) : (
        <View style={styles.body} testID="delete-account-clear">
          <View style={styles.group}>
            <Text style={styles.groupTitle} accessibilityRole="header">
              Deleted
            </Text>
            {/* First, and in primary ink: a live listing comes down with the
                account (20261023140000) — the one item they might not expect. */}
            {liveListings > 0 ? (
              <Text style={styles.reason} testID="delete-account-live-listings">
                {liveListings === 1
                  ? 'Your live listing — taken down now'
                  : `Your ${liveListings} live listings — taken down now`}
              </Text>
            ) : null}
            {DELETED.map((item) => (
              <Text key={item} style={styles.line}>
                {item}
              </Text>
            ))}
          </View>
          <View style={styles.group}>
            <Text style={styles.groupTitle} accessibilityRole="header">
              Kept
            </Text>
            {/* The ledger survives, detached (20261023120000) — the tax
                records rule. Deliberately NOT "nothing identifies you": the
                snapshot keeps the plate. */}
            <Text style={styles.line}>Payment records, for 6 years as the law requires</Text>
          </View>
          <Text style={styles.reason}>This can’t be undone.</Text>
          <TextField
            label={`Type ${CONFIRM_WORD} to confirm`}
            labelPlacement="above"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            disabled={deleting}
            testID="delete-account-input"
          />
          <Button
            label="Delete account"
            variant="danger"
            disabled={!confirmed}
            loading={deleting}
            // Heard, not seen — why the button is dimmed.
            accessibilityHint={confirmed ? undefined : `Type ${CONFIRM_WORD} above first`}
            onPress={() => void remove()}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      gap: spacing.lg,
      paddingBottom: spacing.md,
    },
    loading: {
      paddingVertical: spacing.xxl,
    },
    lead: {
      ...typography.heading,
      color: c.textPrimary,
    },
    reason: {
      ...typography.body,
      color: c.textPrimary,
    },
    group: {
      gap: spacing.xs,
    },
    groupTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    line: {
      ...typography.body,
      color: c.textSecondary,
    },
  });
