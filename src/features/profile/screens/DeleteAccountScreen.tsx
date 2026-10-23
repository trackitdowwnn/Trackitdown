/**
 * WHAT:  DeleteAccountScreen — one push from Profile's Danger zone. Reads what
 *        still stops the deletion; if anything does, lists it (one line each,
 *        saying what to do) and offers no button. Otherwise says what goes and
 *        what's kept, and deletes once they type DELETE.
 * WHY:   Owner's picks (2026-10-23): delete STRAIGHT AWAY, no grace period,
 *        but only when nothing is pending; confirm on a full screen by typing
 *        DELETE, not a one-tap dialog. Apple 5.1.1(v) and Google Play want an
 *        in-app path that actually completes — before 20261023120000 anyone
 *        with money history got "try again" for ever.
 *
 *        The blockers read is ADVISORY (it can be a beat stale, and the payout
 *        balance is only checked at the server). A refusal from the server
 *        shows its own reason and re-reads the list, so the screen catches up
 *        with what stopped it.
 *
 *        No "Stripe" anywhere (owner: say "payouts"). Minimal words. The back
 *        arrow is the way out — no second Cancel beside the button.
 * LINKS: src/features/profile/api/profileApi.ts (fetchDeletionBlockers,
 *        requestAccountDeletion); ../lib/deletionReasons.ts;
 *        supabase/functions/delete-account/index.ts; src/app/delete-account.tsx.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  spacing,
  sizes,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Button, ErrorState, Screen, StickyActionBar, TextField, useToast } from '@/shared/ui';

import {
  AccountDeletionError,
  fetchDeletionBlockers,
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

export function DeleteAccountScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = useState<Status>('loading');
  const [blockers, setBlockers] = useState<DeletionBlocker[]>([]);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The re-entry guard, as a REF: two taps in one tick both read `deleting`
  // from the same render (BlockedAccountsScreen records the same lesson).
  const inFlight = useRef(false);

  // Doesn't set 'loading' itself — `status` starts there, and a setState in an
  // effect's synchronous body is what react-hooks/set-state-in-effect forbids.
  const load = useCallback(() => {
    fetchDeletionBlockers()
      .then((rows) => {
        setBlockers(rows);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(load, [load]);

  const retry = useCallback(() => {
    setStatus('loading');
    load();
  }, [load]);

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const remove = useCallback(async () => {
    if (inFlight.current || !confirmed) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      await requestAccountDeletion(); // also clears the local session
      toast.show('Your account has been deleted');
      // Guest mode now; the feed is the one surface that works with no
      // account (the same landing as Log out).
      router.navigate('/(tabs)/explore');
    } catch (error) {
      toast.show(
        error instanceof AccountDeletionError
          ? error.message
          : "We couldn't delete your account. Please try again.",
        'error',
      );
      // Something changed since the list was read — show what it is now.
      load();
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }, [confirmed, load, router, toast]);

  const clear = status === 'ready' && blockers.length === 0;

  return (
    <Screen
      scroll
      keyboardAware
      footer={
        clear ? (
          <StickyActionBar>
            <Button
              label="Delete account"
              variant="danger"
              disabled={!confirmed}
              loading={deleting}
              onPress={() => void remove()}
            />
          </StickyActionBar>
        ) : undefined
      }
    >
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="delete-account-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Delete account
        </Text>
      </View>

      {status === 'error' ? (
        <ErrorState
          title="We couldn’t check your account"
          body="Check your connection and try again."
          onRetry={retry}
        />
      ) : status === 'loading' ? null : blockers.length > 0 ? (
        <View style={styles.body} testID="delete-account-blocked">
          <Text style={styles.lead}>You can’t delete your account yet.</Text>
          {blockers.map((blocker) => (
            <Text key={blocker.code} style={styles.line}>
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
                snapshot keeps the plate, so this promises no more than is
                true. */}
            <Text style={styles.line}>Payment records, for 6 years as the law requires</Text>
          </View>
          <Text style={styles.warning}>This can’t be undone.</Text>
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
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xl,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
    },
    body: {
      gap: spacing.lg,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    lead: {
      ...typography.heading,
      color: c.textPrimary,
    },
    group: {
      gap: spacing.xs,
    },
    groupTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
    line: {
      ...typography.body,
      color: c.textSecondary,
    },
    warning: {
      ...typography.body,
      color: c.textPrimary,
    },
  });
