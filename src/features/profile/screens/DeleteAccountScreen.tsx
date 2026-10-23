/**
 * WHAT:  DeleteAccountScreen — one push from Profile's Danger zone. Reads what
 *        still stops the deletion; if anything does, lists it (one line each,
 *        saying what to do) and offers no button. Otherwise says what goes and
 *        what's kept, then asks them to PROVE IT'S THEM — a 6-digit code to
 *        their own email (or, for an Apple account, an Apple re-sign-in) — and
 *        deletes.
 * WHY:   Owner's picks (2026-10-23): delete STRAIGHT AWAY, no grace period,
 *        but only when nothing is pending. Apple 5.1.1(v) and Google Play want
 *        an in-app path that actually completes.
 *
 *        The code replaced typing DELETE (danger-zone research, 2026-10-23:
 *        re-verify before an irreversible step; an unlocked phone must not be
 *        enough). It is ENFORCED at the server — delete-account refuses unless
 *        this session verified within 5 minutes (REAUTH_REQUIRED) — so this
 *        screen is the way through, not the guard. Typing the code is the
 *        deliberate step; it never auto-submits.
 *
 *        The blockers read is ADVISORY (it can be a beat stale, and the payout
 *        balance is only checked at the server). A refusal from the server
 *        shows its own reason and re-reads the list.
 *
 *        No "Stripe" anywhere (owner: say "payouts"). Minimal words. The back
 *        arrow is the way out — no second Cancel beside the button.
 * LINKS: src/features/profile/api/profileApi.ts (fetchDeletionBlockers,
 *        fetchIdentityCheck, requestAccountDeletion); ../lib/deletionReasons.ts;
 *        src/features/auth (sendIdentityCode, confirmIdentityWith*, OtpInput);
 *        supabase/functions/delete-account/index.ts (+ _shared/recentSignIn).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AuthActionError,
  confirmIdentityWithApple,
  confirmIdentityWithCode,
  OtpInput,
  sendIdentityCode,
  useSession,
} from '@/features/auth';

import {
  spacing,
  sizes,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Button, EmptyState, ErrorState, Screen, StickyActionBar, useToast } from '@/shared/ui';

import {
  AccountDeletionError,
  fetchDeletionBlockers,
  fetchIdentityCheck,
  fetchLiveListingCount,
  requestAccountDeletion,
  type DeletionBlocker,
  type IdentityCheck,
} from '../api/profileApi';
import { deletionReason } from '../lib/deletionReasons';

const CODE_LENGTH = 6;

const DELETED = [
  'Your profile and photos',
  'Your listings and sightings',
  'Your messages, alerts and payout details',
];

type Status = 'loading' | 'ready' | 'error';

/** o•••@gmail.com — enough to recognise, not the whole address on screen. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function DeleteAccountScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = useState<Status>('loading');
  const [blockers, setBlockers] = useState<DeletionBlocker[]>([]);
  const [liveListings, setLiveListings] = useState(0);
  const [identity, setIdentity] = useState<IdentityCheck | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [deleting, setDeleting] = useState(false);
  // The re-entry guard, as a REF: two taps in one tick both read `deleting`
  // from the same render (BlockedAccountsScreen records the same lesson).
  const inFlight = useRef(false);

  // Only for a signed-in user: a guest reaching this by deep link would get
  // NOT_AUTHENTICATED, shown as a connection error Retry can never fix.
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  // All three, or none: without the live-listing count the screen can't warn
  // that deleting takes a listing down, and without the identity it can't
  // offer the way through — so a failed read is an error, never a guess.
  const load = useCallback(() => {
    if (!userId) return;
    Promise.all([fetchDeletionBlockers(), fetchLiveListingCount(userId), fetchIdentityCheck()])
      .then(([rows, live, check]) => {
        setBlockers(rows);
        setLiveListings(live);
        setIdentity(check);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [userId]);

  useEffect(load, [load]);

  const retry = useCallback(() => {
    setStatus('loading');
    load();
  }, [load]);

  const sendCode = useCallback(async () => {
    if (identity?.kind !== 'code' || sending) return;
    setSending(true);
    try {
      await sendIdentityCode(identity.email);
      setCodeSent(true);
      setCode('');
      setCodeError(null);
    } catch (error) {
      toast.show(
        error instanceof AuthActionError ? error.message : 'We couldn’t send the code.',
        'error',
      );
    } finally {
      setSending(false);
    }
  }, [identity, sending, toast]);

  const ready = identity?.kind === 'apple' || (codeSent && code.length === CODE_LENGTH);

  const remove = useCallback(async () => {
    if (inFlight.current || !identity || !ready) return;
    inFlight.current = true;
    setDeleting(true);
    const release = () => {
      inFlight.current = false;
      setDeleting(false);
    };

    // 1 — prove it's them. A wrong code or a cancelled Apple sheet stops here
    // with the account untouched.
    try {
      if (identity.kind === 'code') {
        await confirmIdentityWithCode(identity.email, code);
      } else if (!(await confirmIdentityWithApple())) {
        release();
        return;
      }
    } catch (error) {
      if (identity.kind === 'code') {
        setCodeError(error instanceof AuthActionError ? error.message : 'That code didn’t work.');
        setCode('');
        setErrorNonce((n) => n + 1);
      } else {
        toast.show('Apple sign-in didn’t complete. Please try again.', 'error');
      }
      release();
      return;
    }

    // 2 — delete.
    try {
      await requestAccountDeletion(); // also clears the local session
      toast.show('Your account has been deleted', 'success');
      // Guest mode now; the feed is the one surface that works with no
      // account (the same landing as Log out). The guard and spinner stay
      // SET: until this screen unmounts, a second tap would send a request
      // with no session and toast a false "couldn't delete".
      router.navigate('/(tabs)/explore');
    } catch (error) {
      toast.show(
        error instanceof AccountDeletionError
          ? error.message
          : 'We couldn’t delete your account. Please try again.',
        'error',
      );
      // The server wants a fresher proof: back to the code step.
      if (error instanceof AccountDeletionError && error.code === 'REAUTH_REQUIRED') {
        setCodeSent(false);
        setCode('');
      }
      release();
      // Something may have changed since the list was read — show it now.
      load();
    }
  }, [code, identity, load, ready, router, toast]);

  const clear = status === 'ready' && blockers.length === 0 && identity !== null;

  const footer = !clear ? undefined : identity.kind === 'code' && !codeSent ? (
    <StickyActionBar>
      <Button label="Email me a code" loading={sending} onPress={() => void sendCode()} />
    </StickyActionBar>
  ) : (
    <StickyActionBar>
      <Button
        label={identity.kind === 'apple' ? 'Confirm with Apple and delete' : 'Delete account'}
        variant="danger"
        disabled={!ready}
        loading={deleting}
        // Heard, not seen — why the button is dimmed.
        accessibilityHint={ready ? undefined : 'Enter the code from the email first'}
        onPress={() => void remove()}
      />
    </StickyActionBar>
  );

  return (
    <Screen scroll keyboardAware footer={footer}>
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

      {session.status === 'signedOut' ? (
        <EmptyState title="You’re logged out" />
      ) : status === 'error' ? (
        <ErrorState
          title="We couldn’t check your account"
          body="Check your connection and try again."
          onRetry={retry}
        />
      ) : status === 'loading' ? (
        <ActivityIndicator
          color={palette.textSecondary}
          style={styles.loading}
          accessibilityLabel="Checking your account"
          testID="delete-account-loading"
        />
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
                account (20261023140000) — the one item they might not expect,
                and the confirmation the owner asked for. */}
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
                snapshot keeps the plate, so this promises no more than is
                true. */}
            <Text style={styles.line}>Payment records, for 6 years as the law requires</Text>
          </View>
          <Text style={styles.warning}>This can’t be undone.</Text>

          {identity?.kind === 'code' ? (
            <View style={styles.group} testID="delete-account-identity">
              <Text style={styles.groupTitle} accessibilityRole="header">
                Confirm it’s you
              </Text>
              {codeSent ? (
                <>
                  <Text style={styles.line}>
                    Enter the code we sent to {maskEmail(identity.email)}.
                  </Text>
                  {/* Never auto-submits: pressing the red button is the
                      deliberate step. */}
                  <OtpInput
                    value={code}
                    onChangeText={(next) => {
                      setCode(next);
                      setCodeError(null);
                    }}
                    onComplete={() => {}}
                    submitting={deleting}
                    errorNonce={errorNonce}
                    autoFocus
                  />
                  {codeError ? (
                    <Text style={styles.error} accessibilityRole="alert">
                      {codeError}
                    </Text>
                  ) : null}
                  <Button
                    label="Send a new code"
                    variant="ghost"
                    fullWidth={false}
                    disabled={sending || deleting}
                    onPress={() => void sendCode()}
                  />
                </>
              ) : (
                <Text style={styles.line}>We’ll email a code to {maskEmail(identity.email)}.</Text>
              )}
            </View>
          ) : null}
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
      gap: spacing.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      // Clear of the sticky bar's edge when scrolled to the end.
      paddingBottom: spacing.xl,
    },
    loading: {
      paddingTop: spacing.xxl,
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
      gap: spacing.sm,
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
    error: {
      ...typography.caption,
      color: c.danger,
    },
  });
