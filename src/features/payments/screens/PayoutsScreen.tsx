/**
 * WHAT:  PayoutsScreen — where a spotter gives their bounty somewhere to land,
 *        and then reports honestly where they stand: not started, part way,
 *        being checked, or ready.
 *
 *        THREE FLOWS LIVE HERE, in this order of preference:
 *          1. `PayoutDetailsForm` — our own native form. Stripe allows us to
 *             submit bank details and identity fields only while the prefill
 *             window is open, so this runs FIRST and the server refuses to mint
 *             a session (`details_required`) until it has.
 *          2. `ConnectAccountOnboarding` — Stripe's embedded component, in-app,
 *             for whatever our form could not say and the liveness check only
 *             they can do.
 *          3. The browser — for changing details on an account that already
 *             works (Stripe has no React Native component for it) and as the
 *             fallback if a session cannot be minted.
 *        Our form cannot describe a company or a non-UK account, so a
 *        `DETAILS_REJECTED` offers "Continue with Stripe", which spends the
 *        prefill window deliberately rather than leaving someone permanently
 *        unpayable behind a form that can never satisfy Stripe.
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
 *        ../components/PayoutDetailsForm.tsx (flow 1);
 *        supabase/functions/submit-payout-details/index.ts (where it goes);
 *        supabase/functions/connect-onboarding/index.ts (session, link, gate);
 *        src/app/payouts.tsx; docs/DESIGN_SYSTEM.md (tone).
 */

import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { useRequireAuth } from '@/features/auth';
import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import { formatPounds } from '@/shared/lib/money';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Button, EmptyState, ErrorState, Screen, useToast } from '@/shared/ui';

import { PaymentError } from '../api/functionError';
import {
  fetchMyPendingCredit,
  startConnectOnboarding,
  submitPayoutTokens,
  type PayoutDetails,
} from '../api/payoutsApi';
import { createBankToken, createIdentityToken } from '../api/stripeTokens';
import { PayoutDetailsForm } from '../components/PayoutDetailsForm';
import { usePayoutAccount, type PayoutAccountStatus } from '../hooks/usePayoutAccount';

const log = createLogger('payments');

/** The bare prefix, deliberately without the query string — see the header. */
const RETURN_PREFIX = 'trackitdown://payouts';

/** PUBLIC key — it can open a flow, never move money. Same one the escrow
 *  PaymentSheet uses; see BountyPaymentProvider for why bundling it is safe. */
const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** What each state says. Calm, and never blaming someone for Stripe's queue. */
const COPY: Record<
  Exclude<PayoutAccountStatus, 'loading' | 'guest' | 'error'>,
  { title: string; body: string; action: string }
> = {
  notStarted: {
    // The title asks; the button answers. Repeating the button's words as the
    // heading reads as a form with a stutter.
    title: 'Where should your bounties go?',
    // Not "we never see them" — they pass through our server on the way to
    // Stripe. And not "you only do it once": this screen itself models Stripe
    // coming back for more.
    body: 'Stripe handles the payments and the ID check, and we never store your bank details. It’s a one-off setup and takes about five minutes.',
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
    // "Any bounty you earn goes to..." implied it arrives by itself. It does
    // not: the owner releases it from their listing, so a spotter who onboarded
    // to collect an already-credited bounty would have sat here waiting.
    body: 'Bounties you earn will be sent to the account you set up with Stripe, once the owner releases them.',
    action: 'Update bank details',
  },
};

export function PayoutsScreen() {
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const { status, settling, refresh, settleReturn } = usePayoutAccount();
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const [opening, setOpening] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // Stripe refused what our form can describe. Offers the way past.
  const [detailsRejected, setDetailsRejected] = useState(false);
  // The earn moment's context: "You've earned £X". Server-derived via
  // payout_split, so the push and this line can never disagree on the number.
  const [pendingCreditPence, setPendingCreditPence] = useState<number | null>(null);
  useEffect(() => {
    if (status === 'guest' || status === 'loading') {
      return;
    }
    let cancelled = false;
    void fetchMyPendingCredit().then((credit) => {
      if (!cancelled) {
        setPendingCreditPence(credit?.transferPence ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status]);
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

  // The secret the SDK is about to ask for. Deciding WHICH flow to run costs one
  // call, and throwing its answer away would make the component fetch a second
  // secret a heartbeat later; priming it means one round trip, once.
  const primedSecret = useRef<string | null>(null);
  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);

  /**
   * Called by the SDK, now and again later — a session is short-lived and it
   * will come back for a fresh one. So this re-invokes rather than caching, and
   * only ever hands back a secret it was actually given.
   */
  const fetchClientSecret = useCallback(async () => {
    const primed = primedSecret.current;
    primedSecret.current = null;
    if (primed) {
      return primed;
    }
    const result = await startConnectOnboarding();
    if (result.status !== 'onboarding_session') {
      // The account became payable (or the server fell back to a link) between
      // opening the component and it asking. Returning '' ends the session
      // cleanly; `onExit` then settles and the screen re-reads the truth.
      log.warn('payout session no longer available', { status: result.status });
      return '';
    }
    return result.clientSecret;
  }, []);

  const open = useCallback(
    async (options: { skipPrefill?: boolean } = {}) => {
    if (opening) {
      return;
    }
    setOpening(true);
    setBrowserSaidExpired(false);
    try {
      const result = await startConnectOnboarding(options);
      if (result.status === 'already_enabled') {
        // Nothing to open — the server had nothing left to ask for. Re-read so
        // the screen agrees with it.
        refresh();
        return;
      }

      // OUR FORM FIRST. The server refuses to mint a session until it has run,
      // because doing so would permanently close the window in which we are
      // allowed to submit bank details at all.
      if (result.status === 'details_required') {
        setShowForm(true);
        return;
      }

      // THE IN-APP PATH. Stripe's embedded component, rendered over this
      // screen — no browser, no bounce page, no deep link.
      if (result.status === 'onboarding_session') {
        primedSecret.current = result.clientSecret;
        setConnectInstance(
          loadConnectAndInitialize({
            publishableKey,
            fetchClientSecret,
            appearance: { variables: { colorPrimary: colors.primary } },
          }),
        );
        return;
      }

      // Everything below is the browser: `update_available` (Stripe has no
      // React Native component for managing an existing account) and the
      // hosted-link fallback the server uses if minting a session failed.
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
    },
    [fetchClientSecret, opening, refresh, settleReturn, toast],
  );

  /**
   * The credit-time path (ADR-0010): everything they typed becomes two Stripe
   * tokens ON THE PHONE — identity via the publishable key, bank via the SDK —
   * and our server receives two opaque ids. Compare the previous generation,
   * which POSTed the raw sort code through our Edge Function: with this,
   * nothing sensitive touches our infrastructure at all.
   *
   * On success the settling machinery takes over: Stripe usually activates a
   * clean GB individual in seconds, and the bounded re-check window catches it.
   */
  const onSubmitDetails = useCallback(
    async (details: PayoutDetails) => {
      setOpening(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const email = userData.user?.email;
        if (!email) {
          throw new PaymentError('Please sign in again, then try once more.', 'NOT_AUTHENTICATED');
        }

        const accountToken = await createIdentityToken(details, email);
        const bankToken = await createBankToken(details);
        await submitPayoutTokens({ accountToken, bankToken });

        setShowForm(false);
        settleReturn();
      } catch (error) {
        // Stripe would not take what our form can describe — a company, a
        // non-UK account, something these fields have no word for. Without a
        // way past, that spotter is gated forever behind a form that can never
        // satisfy it. The "Continue with Stripe" card offers the legacy hosted
        // path, which can ask for anything.
        if (error instanceof PaymentError && error.code === 'DETAILS_REJECTED') {
          setDetailsRejected(true);
        }
        toast.show(
          error instanceof PaymentError
            ? error.message
            : 'We couldn’t save your details. Please try again.',
          'error',
        );
      } finally {
        setOpening(false);
      }
    },
    [settleReturn, toast],
  );

  /** Spend the prefill window deliberately and let Stripe ask instead. */
  const onSkipPrefill = useCallback(async () => {
    setShowForm(false);
    setDetailsRejected(false);
    await open({ skipPrefill: true });
  }, [open]);

  /**
   * The embedded component has closed. This is EXACTLY as much of a promise as
   * the browser redirect was — which is to say none: `payouts_enabled` is
   * written only by Stripe's `account.updated` webhook, and someone can exit
   * this component half way through. So it settles, and the account decides.
   */
  const onOnboardingExit = useCallback(() => {
    setConnectInstance(null);
    primedSecret.current = null;
    settleReturn();
  }, [settleReturn]);

  // Leaving mid-session must not strand an orphaned iOS sheet behind us.
  //
  // iOS ONLY, and the guard is load-bearing: `dismissAuthSession` EXISTS on
  // Android — so the optional call `?.()` never skipped it — and throws
  // "WebBrowser.dismissBrowser is not available on android" the moment it runs.
  // Without this check it logged an error every single time anyone left the
  // screen, on the platform where there is no sheet to dismiss in the first
  // place.
  useEffect(
    () => () => {
      if (Platform.OS === 'ios') {
        WebBrowser.dismissAuthSession();
      }
    },
    [],
  );

  // Stripe's own full-screen modal (a native UIKit sheet on iOS, an RN Modal on
  // Android), so it is rendered instead of the page rather than inside it.
  if (connectInstance) {
    return (
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          title="Set up payouts"
          onExit={onOnboardingExit}
          onLoadError={(event) => {
            // Never surface Stripe's internals; the screen behind is intact and
            // the button is still there.
            log.warn('payout onboarding load failed', { type: event?.error?.type });
            setConnectInstance(null);
            toast.show('We couldn’t open Stripe. Please try again.', 'error');
          }}
        />
      </ConnectComponentsProvider>
    );
  }

  return (
    <Screen
      scroll
      contentContainerStyle={styles.scroll}
      // The form is ten fields deep; without this the last two sit under the
      // keyboard and the first tap on Continue is spent dismissing it.
      keyboardAware
      // The settling window stops after ~14s. Without a pull-to-refresh,
      // "Stripe is checking your details" is a dead end until the screen is
      // left and re-entered — which the hook's own comment already assumed
      // existed.
      onRefresh={refresh}
      refreshing={status === 'loading'}
    >
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          Payouts
        </Text>
      </View>

      {/* The earn moment. The push said "You've earned £X — tell us where to
          send it"; the screen must greet them with the same sentence, not with
          generic setup copy. Rendered for every non-terminal state — the
          amount is WHY they are here. */}
      {pendingCreditPence !== null && status !== 'guest' && status !== 'ready' ? (
        <View style={styles.earnedCard} testID="payouts-earned">
          <Text style={styles.earnedTitle} accessibilityRole="header">
            You’ve earned {formatPounds(pendingCreditPence)}
          </Text>
          <Text style={styles.earnedBody}>
            Your sighting led to a recovery. Tell us where to send it.
          </Text>
        </View>
      ) : null}

      {/* ONE body, chosen once. This was five independently-gated blocks whose
          exclusivity was maintained by hand, and it did not hold: a refresh
          error while the form was open stacked an EmptyState over the fields,
          and a deep-link return while signed out rendered the guest state and
          "Nearly there" together for the whole settling window. Priority
          order, early returns, structurally impossible to show two. */}
      {renderBody()}
    </Screen>
  );

  function renderBody() {
    if (status === 'guest') {
      // Reachable: /payouts is deep-linkable and the app is guest-first.
      return (
        <EmptyState
          title="Get paid for what you spot"
          body="Log in to set up payouts, so a bounty has somewhere to land."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'payouts' })}
        />
      );
    }
    if (showForm) {
      return (
        <>
          <PayoutDetailsForm
            onSubmit={onSubmitDetails}
            onCancel={() => setShowForm(false)}
            busy={opening}
          />
          {detailsRejected ? (
            <View style={styles.card} testID="payouts-details-rejected">
              <Text style={styles.cardTitle} accessibilityRole="header">
                Stripe needs something else
              </Text>
              <Text style={styles.cardBody}>
                This form covers a UK account in your own name. If that isn’t you — a
                company, or an account elsewhere — Stripe can ask for the right details
                directly.
              </Text>
              <Button
                label="Continue with Stripe"
                variant="secondary"
                onPress={() => void onSkipPrefill()}
                loading={opening}
              />
            </View>
          ) : null}
        </>
      );
    }
    if (settling) {
      // ABOVE `error` on purpose: the settling window issues its own re-reads,
      // and one transient failure among them must not flip "Nearly there" into
      // an error that blames the spotter for Stripe's queue.
      // Outranks the derived state, and this is the whole point: until the
      // webhook lands, someone who just finished is indistinguishable from
      // someone who gave up, and guessing wrong blames the wrong person.
      return (
        <View style={styles.card} testID="payouts-settling">
          <Text style={styles.cardTitle} accessibilityRole="header">
            Nearly there
          </Text>
          <Text style={styles.cardBody}>
            We’re waiting for Stripe to confirm. This usually takes a moment.
          </Text>
          {/* Skips the wait rather than escaping a dead end — the window ends
              by itself, and once it does this card is gone. It is here so
              somebody who knows they finished need not watch a spinner. */}
          <Button label="Check again" variant="secondary" onPress={refresh} />
        </View>
      );
    }
    if (status === 'error') {
      return (
        <ErrorState
          title="Couldn't load your payout details"
          body="Check your connection and try again."
          onRetry={refresh}
        />
      );
    }
    if (status === 'loading') {
      return <PayoutsSkeleton />;
    }
    return (
      <View style={styles.card} testID={`payouts-${status}`}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {COPY[status].title}
        </Text>
        <Text style={styles.cardBody}>{COPY[status].body}</Text>
        {linkExpired ? (
          <Text style={styles.note}>
            That link expired — they only last a few minutes. Start again for a fresh one.
          </Text>
        ) : null}
        <Button
          label={COPY[status].action}
          loading={opening}
          onPress={() => void open()}
          variant={status === 'ready' ? 'secondary' : 'primary'}
        />
      </View>
    );
  }
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
  earnedCard: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceInverse,
  },
  earnedTitle: {
    ...typography.title,
    color: colors.textOnPrimary,
  },
  earnedBody: {
    ...typography.body,
    // On the inverse surface, secondary-grey text would fail contrast.
    color: colors.textOnPrimary,
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
