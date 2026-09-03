/**
 * WHAT:  PayoutsScreen — where a spotter gives their bounty somewhere to land,
 *        and then reports honestly where they stand: nothing to set up yet
 *        (credit-time setup means exactly that), a bounty waiting for details,
 *        part way, being checked, or ready.
 *
 *        THREE FLOWS LIVE HERE, in this order of preference:
 *          1. `PayoutDetailsForm` — our own native form. Stripe allows us to
 *             submit bank details and identity fields only while the prefill
 *             window is open, so this runs FIRST and the server refuses to mint
 *             a session (`details_required`) until it has.
 *          2. `ConnectAccountOnboarding` — Stripe's embedded component, in-app,
 *             for whatever our form could not say and the liveness check only
 *             they can do.
 *          3. `BankDetailsForm` — changing WHERE the money lands on a working
 *             account: three fields, in-app, both account generations (the
 *             server's RE-BANK branch takes one bank token).
 *          4. The browser — the fallback of last resort: a session that cannot
 *             be minted, or a bank change Stripe refuses to take through our
 *             form. For legacy Express accounts the server answers with a
 *             LOGIN LINK (account_update links are refused when Stripe
 *             collects requirements — found as a spinner-to-nowhere,
 *             2026-08-04).
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRequireAuth } from '@/features/auth';
import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import { formatPounds } from '@/shared/lib/money';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  Button,
  EmptyState,
  ErrorState,
  Screen,
  StatusPill,
  useToast,
  type BadgeTone,
} from '@/shared/ui';

import { PaymentError } from '@/shared/lib/functionError';
import {
  fetchMyPendingCredit,
  startConnectOnboarding,
  submitPayoutTokens,
  type PayoutDetails,
} from '../api/payoutsApi';
import { createBankToken, createIdentityToken } from '../api/stripeTokens';
import { BankDetailsForm } from '../components/BankDetailsForm';
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
    // Only ever shown WITH a credited bounty above it now — a spotter with
    // nothing waiting gets the nothing-to-set-up state instead (see
    // renderBody). The title asks; the button answers. Repeating the button's
    // words as the heading reads as a form with a stutter.
    title: 'Where should your bounties go?',
    // "Straight to Stripe" became literally true with client-side tokenisation
    // (ADR-0010): the details never touch our server. And not "you only do it
    // once": this screen itself models Stripe coming back for more.
    body: 'Your details go straight to Stripe — we never see or store your bank details. It takes about a minute.',
    action: 'Add your details',
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
    // "Automatically" became true on 2026-08-04: the release runs the moment a
    // sighting is credited (or the moment this account becomes payable, if the
    // credit came first). Before that, this line carefully said "once the
    // owner releases them" — and now saying that would be the stale claim.
    body: 'Bounties you earn are sent to your account automatically. Nothing to do here unless your bank details change.',
    action: 'Update bank details',
  },
};

/**
 * The chip beside each state (Airbnb pass, 2026-08-26).
 *
 * ⚠️ TONE IS NOT SEVERITY, it is what the spotter should DO. `unfinished` and
 * `verifying` both sit at `warning`, but for opposite reasons: unfinished is
 * warning because it is waiting on THEM, verifying because it is waiting on
 * Stripe and saying "all good" would be a promise we cannot keep — Stripe can
 * still come back for more. `notStarted` is neutral rather than warning
 * because nothing has gone wrong: credit-time setup means not-set-up is the
 * expected state, not a lapse.
 *
 * ⚠️ NO TONE READS AS AN ERROR. `danger` is deliberately unused here even for
 * the rejected paths, which render their own cards above this one. A red chip
 * on a screen about money someone is owed says "your money is in trouble" when
 * what is true is "Stripe needs a different form".
 */
const STATUS_PILL: Record<keyof typeof COPY, { label: string; tone: BadgeTone }> = {
  notStarted: { label: 'Not set up', tone: 'neutral' },
  unfinished: { label: 'Action needed', tone: 'warning' },
  verifying: { label: 'Being checked', tone: 'warning' },
  ready: { label: 'Ready', tone: 'success' },
};

export function PayoutsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const { status, settling, refresh, settleReturn } = usePayoutAccount();
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const [opening, setOpening] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // "Update bank details" on a ready account: three fields, in the app. The
  // browser hop this replaced was a dead end for legacy Express accounts —
  // Stripe refuses `account_update` links when it collects requirements.
  const [showBankForm, setShowBankForm] = useState(false);
  // Stripe refused what our form can describe. Offers the way past.
  const [detailsRejected, setDetailsRejected] = useState(false);
  const [bankRejected, setBankRejected] = useState(false);
  // The earn moment's context: "You've earned £X". Server-derived via
  // payout_split, so the push and this line can never disagree on the number.
  //
  // TRI-STATE, and the third state is load-bearing: `undefined` means "still
  // asking", `null` means "asked — nothing waiting". notStarted branches on
  // that difference (setup form vs nothing-to-set-up), and collapsing them
  // would flash the wrong screen at everyone for the length of one fetch.
  const [pendingCreditPence, setPendingCreditPence] = useState<number | null | undefined>(
    undefined,
  );
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
            // Stripe's embedded UI takes a hex VALUE, so it reads the live
            // palette — the near-black in light, the near-white in dark.
            appearance: { variables: { colorPrimary: palette.primary } },
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
    [fetchClientSecret, opening, palette, refresh, settleReturn, toast],
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
   * Replace only the bank on the existing account: one bank token on the
   * phone, one opaque id to the server's RE-BANK branch. Nothing sensitive
   * transits us, and nothing needs a browser.
   */
  const onSubmitBank = useCallback(
    async (details: { sortCode: string; accountNumber: string }) => {
      setOpening(true);
      try {
        const bankToken = await createBankToken(details);
        await submitPayoutTokens({ bankToken });
        setShowBankForm(false);
        setBankRejected(false);
        toast.show('Done — bounties will go to your new account.');
        refresh();
      } catch (error) {
        // A refusal our three fields cannot explain (an account Stripe cannot
        // pay, an API restriction on this account's generation): keep the form
        // up and offer Stripe's own surface as the way past, below.
        if (error instanceof PaymentError && error.code === 'DETAILS_REJECTED') {
          setBankRejected(true);
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
    [refresh, toast],
  );

  /** The Stripe-surface fallback for a bank change our form couldn't land. */
  const onBankViaStripe = useCallback(async () => {
    setShowBankForm(false);
    setBankRejected(false);
    await open();
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
      // ⚠️ THE BOTTOM INSET, as on SettingsScreen and LegalDocumentScreen —
      // this is the fourth pushed screen found with it and almost certainly not
      // the last. `Screen` pads only the top by default, deliberately, because
      // tab screens run under the tab bar; a pushed screen has no tab bar and
      // nothing else pays it, so under SDK 57's edge-to-edge Android the last
      // element sits beneath the navigation buttons. Here that element is a
      // Button — the one that starts the flow — so it was not merely clipped
      // but unreachable.
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
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
          amount is WHY they are here.

          ⚠️ THE FIGURE IS THE HERO SINCE 2026-08-26 (Airbnb pass). It used to
          be a sentence at title scale — "You've earned £250" — which made the
          number compete with its own preamble at the same weight. Split into a
          quiet label and the amount at `display`, so the thing they came to see
          is the thing they see. Same words, different hierarchy. */}
      {typeof pendingCreditPence === 'number' && status !== 'guest' && status !== 'ready' ? (
        <View style={styles.earnedCard} testID="payouts-earned">
          {/* ⚠️ ONE accessible node, not three. A screen reader reading
              "You've earned" / "£250" / "Your sighting led to a recovery" as
              separate stops turns one fact into three, and the amount arrives
              without the sentence that gives it meaning. The visual split is
              typographic only. */}
          <View
            accessible
            accessibilityRole="header"
            // The curly apostrophe, matching the visible text and the house
            // style — a label that reads differently from the words on screen
            // is the kind of drift nobody sees until someone compares them.
            accessibilityLabel={`You’ve earned ${formatPounds(pendingCreditPence)}. Your sighting led to a recovery. Tell us where to send it.`}
          >
            {/* ⚠️ NO `accessibilityElementsHidden` ON THE CHILDREN. It was
                here first and was both redundant and harmful: `accessible` on
                the wrapper already stops them being focused individually, and
                the flag additionally removes them from the accessibility tree
                — which took the visible amount out of RNTL's default queries
                and would take it from any tooling that reads the same tree. */}
            <Text style={styles.earnedLabel}>You’ve earned</Text>
            <Text style={styles.earnedAmount}>{formatPounds(pendingCreditPence)}</Text>
            <Text style={styles.earnedBody}>
              Your sighting led to a recovery. Tell us where to send it.
            </Text>
          </View>
        </View>
      ) : null}

      {/* ONE body, chosen once. This was five independently-gated blocks whose
          exclusivity was maintained by hand, and it did not hold: a refresh
          error while the form was open stacked an EmptyState over the fields,
          and a deep-link return while signed out rendered the guest state and
          "Nearly there" together for the whole settling window. Priority
          order, early returns, structurally impossible to show two. */}
      {renderBody()}

      {/* Every state in which details are being handed over or held. Absent for
          a guest (nothing has been asked of them) and once `ready` (the claim
          has been demonstrated rather than promised). */}
      {/* ⚠️ "PASS STRAIGHT ON" AND "NEVER STORE", NEVER "NEVER SEE". This line
          first read "we never see or store them" and a test caught it within
          the minute — PayoutDetailsForm:154 records why: the details are POSTed
          to our own Edge Function and held in memory on the way to Stripe, so
          "never store" is true and "never see" is the sentence a regulator
          would quote back. Worded to match the form exactly; two promises about
          the same data in different words is how one of them drifts.

          ⚠️ AND NOT WHILE EITHER FORM IS OPEN, which a second test caught by
          finding the sentence twice on one screen. Both forms already carry it
          beside the fields, which is the better place for it — a promise about
          what happens to a sort code belongs next to the sort code. This
          footnote exists only for the states where NO form is showing
          (unfinished, verifying), because that is where the reassurance used to
          disappear entirely: it lived in the `notStarted` copy alone, so it
          vanished the moment setup began and never returned while Stripe was
          holding things up. */}
      {status !== 'guest' && status !== 'loading' && status !== 'ready' && !showForm && !showBankForm && !connectInstance ? (
        <Text style={styles.trust} testID="payouts-trust">
          We pass your bank details straight to Stripe and never store them.
        </Text>
      ) : null}
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
    if (showBankForm) {
      return (
        <>
          <BankDetailsForm
            onSubmit={onSubmitBank}
            onCancel={() => {
              setShowBankForm(false);
              setBankRejected(false);
            }}
            busy={opening}
          />
          {bankRejected ? (
            <View style={styles.card} testID="payouts-bank-rejected">
              <Text style={styles.cardTitle} accessibilityRole="header">
                Stripe needs something else
              </Text>
              <Text style={styles.cardBody}>
                If Stripe can’t take that account here, their own page can sort it out
                directly.
              </Text>
              <Button
                label="Continue with Stripe"
                variant="secondary"
                onPress={() => void onBankViaStripe()}
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
    if (status === 'notStarted') {
      // Credit-time setup: with no account and no bounty waiting there is
      // NOTHING to set up, and saying so beats a form about money that does
      // not exist. The setup card renders only under a real credited amount.
      if (pendingCreditPence === undefined) {
        // Still asking which of those two this is — don't flash either.
        return <PayoutsSkeleton />;
      }
      if (pendingCreditPence === null) {
        return (
          <EmptyState
            title="Nothing to set up"
            body="When a sighting of yours leads to a recovery, we’ll let you know you’ve earned the bounty — and ask where to send it. That’s the whole setup."
          />
        );
      }
    }
    return (
      <View style={styles.card} testID={`payouts-${status}`}>
        {/* ⚠️ THE CHIP ARRIVES BEFORE THE PROSE, which is the point of it. The
            reference marks a payout method's state with a badge — Pending,
            Error, Default — so the state is legible before a word is read.
            Ours said the same things only in a heading and a paragraph, which
            is fine to read and slow to scan, and this is a screen people open
            to check one thing.

            ⚠️ IT DOES NOT REPLACE THE HEADING. "Being checked" is the state;
            "Stripe is checking your details" is who is doing it and therefore
            why the app cannot hurry it. Dropping the heading for the chip would
            trade an explanation for a label on the one screen where people are
            most inclined to suspect they are being stalled. */}
        <StatusPill
          label={STATUS_PILL[status].label}
          tone={STATUS_PILL[status].tone}
          testID={`payouts-pill-${status}`}
        />
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
          // Ready means "change where the money lands" — three fields, in the
          // app, both account generations. Every other state still needs a
          // Stripe surface of one kind or another, and `open` picks which.
          onPress={() => (status === 'ready' ? setShowBankForm(true) : void open())}
          variant={status === 'ready' ? 'secondary' : 'primary'}
        />
      </View>
    );
  }
}

function BackButton() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
      <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
    </Pressable>
  );
}

/** House skeleton idiom — surfaceSubtle blocks on a surface card, never a spinner. */
function PayoutsSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} testID="payouts-skeleton">
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
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
    color: c.textPrimary,
    flexShrink: 1,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: c.surface,
  },
  // surfaceInverse: this card is the page's one inverted block, so it flips
  // with the theme and stays the thing that stands out against the page.
  earnedCard: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: c.surfaceInverse,
  },
  // A quiet lead-in, so the amount below it is the first thing with weight.
  earnedLabel: {
    ...typography.caption,
    color: c.textOnPrimary,
  },
  // ⚠️ `display`, the app's big-moment scale, used here for the one number a
  // spotter opened this screen to see. DESIGN_SYSTEM reserves it for big
  // moments and in-page hero values (MoneySlider's readout is the other), which
  // is exactly what a credited bounty is.
  earnedAmount: {
    ...typography.display,
    color: c.textOnPrimary,
  },
  earnedBody: {
    ...typography.body,
    // On the inverse surface, secondary-grey text would fail contrast.
    color: c.textOnPrimary,
    marginTop: spacing.xs,
  },
  // ⚠️ SAYS SOMETHING THE INTERFACE CANNOT SHOW, which is the test for whether
  // a footnote earns its place. "We never see your bank details" was only ever
  // in the `notStarted` copy, so the moment someone started the form it
  // disappeared — leaving the reassurance absent from every state in which they
  // are actually handing over a sort code. It is the claim this screen most
  // needs to keep making, and no arrangement of cards and chips can imply it.
  trust: {
    ...typography.caption,
    color: c.textSecondary,
    paddingHorizontal: spacing.md,
  },
  cardTitle: {
    ...typography.heading,
    color: c.textPrimary,
  },
  cardBody: {
    ...typography.body,
    color: c.textSecondary,
  },
  note: {
    ...typography.caption,
    color: c.textSecondary,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
  skeletonTitle: {
    width: '55%',
  },
  skeletonShort: {
    width: '70%',
  },
});
