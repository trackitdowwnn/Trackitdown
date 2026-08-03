/**
 * WHAT:  PayoutsScreen — where a spotter gives their bounty somewhere to land.
 *        Opens Stripe's hosted onboarding, then reports honestly where they
 *        stand: not started, part way, being checked, or ready.
 * WHY:   `release-payout` refuses to transfer until Stripe says a spotter is
 *        payable, and nothing in the app could create that account. Every
 *        credited bounty sat on the platform balance while both parties were
 *        told it was on its way. This is the missing screen.
 *
 * THE RETURN FROM THE BROWSER IS A HINT, NEVER TRUTH.
 *        `openAuthSessionAsync` behaves differently on each platform. On iOS
 *        ASWebAuthenticationSession claims the whole `trackitdown:` scheme, so
 *        the redirect is intercepted, the promise resolves, and the app NEVER
 *        navigates — the route's `?onboarding=` param is never seen. On Android
 *        the polyfill is a Promise.race over a Linking listener, so the deep
 *        link navigates AND the promise resolves; worse, the same intent flips
 *        AppState, so a perfectly successful return can arrive as
 *        `{ type: 'dismiss' }`. And on either, if the OS killed the app behind
 *        the browser, only the route sees anything and the promise never
 *        settles at all.
 *
 *        So: one idempotent `settleReturn()`, called from BOTH paths, and no
 *        product decision is ever made from the result type. The only thing
 *        read out of the result is whether the link expired. What actually
 *        decides anything is a re-read of the account — which is exactly what
 *        connect-onboarding's own header demands, because "trusting the
 *        redirect would create a spotter who looks payable and is not".
 *
 *        The redirect passed to the browser is the BARE PREFIX
 *        `trackitdown://payouts`. Android matches it with `startsWith`, so
 *        including the query string would fail to match the expiry redirect and
 *        hang the session with no way out but the back button.
 * LINKS: ../api/payoutsApi.ts; ../hooks/usePayoutAccount.ts;
 *        supabase/functions/connect-onboarding/index.ts (the hosted link);
 *        src/app/payouts.tsx; docs/DESIGN_SYSTEM.md (tone).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { useRequireAuth } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Button, EmptyState, Screen, useToast } from '@/shared/ui';

import { PaymentError } from '../api/functionError';
import { startConnectOnboarding } from '../api/payoutsApi';
import { usePayoutAccount, type PayoutAccountStatus } from '../hooks/usePayoutAccount';

const log = createLogger('payments');

/** The bare prefix, deliberately without the query string — see the header. */
const RETURN_PREFIX = 'trackitdown://payouts';

/** What each state says. Calm, and never blaming someone for Stripe's queue. */
const COPY: Record<
  Exclude<PayoutAccountStatus, 'loading' | 'guest' | 'error'>,
  { title: string; body: string; action: string }
> = {
  notStarted: {
    // The title asks; the button answers. Repeating the button's words as the
    // heading reads as a form with a stutter.
    title: 'Where should your bounties go?',
    body: 'Stripe handles the bank details and the ID check — we never see them. It takes about five minutes, and you only do it once.',
    action: 'Set up payouts',
  },
  unfinished: {
    title: 'Pick up where you left off',
    body: 'Stripe still needs a few details before a bounty can reach you. Your progress is saved.',
    action: 'Continue setting up',
  },
  verifying: {
    title: 'Stripe is checking your details',
    body: 'This usually takes a few minutes — sometimes a day if they need a closer look. You don’t need to wait here; we’ll switch payouts on the moment they’re done.',
    action: 'Add or update details',
  },
  ready: {
    title: 'Payouts are on',
    body: 'Any bounty you earn goes to the account you set up with Stripe.',
    action: 'Update bank details',
  },
};

export function PayoutsScreen() {
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const { status, settling, refresh, settleReturn } = usePayoutAccount();
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const [opening, setOpening] = useState(false);
  const [browserSaidExpired, setBrowserSaidExpired] = useState(false);
  // Two ways to learn the link expired, and only one of them needs storing.
  // Deriving the deep-link half keeps the effect below free of any setState —
  // the compiler forbids a synchronous one there, and chasing a param into
  // state would be storing something we can already see.
  const linkExpired = browserSaidExpired || params.onboarding === 'refresh';

  // The deep-link half of the return — the only half on Android, and the only
  // half at all if the OS killed us behind the browser.
  //
  // The ref, not `router.setParams`, is what stops this firing twice. Clearing
  // the param would be a navigation side effect for a problem that does not
  // exist: reaching this screen from the Profile row carries no param at all,
  // and while one IS present the effect's deps never change, so it runs once.
  const consumedParam = useRef(false);
  useEffect(() => {
    if (!params.onboarding || consumedParam.current) {
      return;
    }
    consumedParam.current = true;
    settleReturn();
  }, [params.onboarding, settleReturn]);

  const open = useCallback(async () => {
    if (opening) {
      return;
    }
    setOpening(true);
    setBrowserSaidExpired(false);
    try {
      const result = await startConnectOnboarding();
      if (result.status === 'already_enabled') {
        // Nothing to open — the server had nothing left to ask for. Re-read so
        // the screen agrees with it.
        refresh();
        return;
      }

      const outcome = await WebBrowser.openAuthSessionAsync(result.url, RETURN_PREFIX);
      // Compared as a string literal on purpose: importing WebBrowserResultType
      // would drag the enum into every test's mock for no benefit.
      if (outcome.type === 'success' && outcome.url.includes('onboarding=refresh')) {
        setBrowserSaidExpired(true);
      }
      // EVERY outcome settles, including 'dismiss' and 'cancel'. On Android a
      // successful return frequently arrives as 'dismiss', so branching on the
      // type here would drop real completions on the floor.
      settleReturn();
    } catch (error) {
      // Includes the Android re-entry throw ("WebBrowser is already open").
      const message =
        error instanceof PaymentError
          ? error.message
          : 'We couldn’t open Stripe. Please try again.';
      log.warn('payout onboarding failed', {
        code: error instanceof PaymentError ? error.code : 'BROWSER',
      });
      toast.show(message, 'error');
    } finally {
      setOpening(false);
    }
  }, [opening, refresh, settleReturn, toast]);

  // Leaving mid-session must not strand an orphaned iOS sheet behind us.
  useEffect(() => () => void WebBrowser.dismissAuthSession?.(), []);

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          Payouts
        </Text>
      </View>

      {status === 'loading' ? <PayoutsSkeleton /> : null}

      {status === 'error' ? (
        <EmptyState
          title="Couldn't load your payout details"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={refresh}
        />
      ) : null}

      {status === 'guest' ? (
        // Reachable: /payouts is deep-linkable and the app is guest-first.
        <EmptyState
          title="Get paid for what you spot"
          body="Log in to set up payouts, so a bounty has somewhere to land."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'payouts' })}
        />
      ) : null}

      {settling ? (
        // Outranks the derived state, and this is the whole point: until the
        // webhook lands, someone who just finished is indistinguishable from
        // someone who gave up, and guessing wrong blames the wrong person.
        <View style={styles.card} testID="payouts-settling">
          <Text style={styles.cardTitle}>Nearly there</Text>
          <Text style={styles.cardBody}>
            We’re waiting for Stripe to confirm. This usually takes a moment.
          </Text>
        </View>
      ) : null}

      {!settling && status !== 'loading' && status !== 'error' && status !== 'guest' ? (
        <View style={styles.card} testID={`payouts-${status}`}>
          <Text style={styles.cardTitle}>{COPY[status].title}</Text>
          <Text style={styles.cardBody}>{COPY[status].body}</Text>
          {linkExpired ? (
            <Text style={styles.note}>
              That link expired — they only last a few minutes. Tap below for a fresh one.
            </Text>
          ) : null}
          <Button
            label={opening ? 'Opening Stripe…' : COPY[status].action}
            onPress={() => void open()}
            disabled={opening}
            variant={status === 'ready' ? 'secondary' : 'primary'}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      // A deep link can land here with nothing behind it, so back must have a
      // destination of its own rather than doing nothing.
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="payouts-back"
    >
      <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
    </Pressable>
  );
}

/** House skeleton idiom — surfaceSubtle blocks on a surface card, never a spinner. */
function PayoutsSkeleton() {
  return (
    <View style={styles.card} testID="payouts-skeleton">
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  cardBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonTitle: {
    width: '55%',
  },
  skeletonShort: {
    width: '70%',
  },
});
