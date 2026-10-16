/**
 * WHAT:  PayoutsScreen — where a spotter gives their bounty somewhere to land,
 *        and then reports honestly where they stand: nothing to set up yet
 *        (credit-time setup means exactly that), a bounty waiting for details,
 *        part way, being checked, or ready.
 *
 *        FOUR FLOWS START HERE, in this order of preference:
 *          1. The payout-setup WIZARD (`/payout-setup`, 2026-10-13; it was the
 *             single-page PayoutDetailsForm) — our own native steps. Stripe
 *             allows us to submit bank details and identity fields only while
 *             the prefill window is open, so this runs FIRST and the server
 *             refuses to mint a session (`details_required`) until it has. It
 *             is its own pushed screen and hands its ending back through
 *             payoutSetupOutcome, read here on focus.
 *          2. `ConnectAccountOnboarding` — Stripe's embedded component, in-app,
 *             for whatever our steps could not say and the liveness check only
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
 *        Our steps cannot describe a company or a non-UK account, so a refusal
 *        there leaves 'rejected' behind, and this screen offers "Continue with
 *        Stripe", which spends the prefill window deliberately rather than
 *        leaving someone permanently unpayable behind steps that can never
 *        satisfy Stripe — but only while nothing has reached Stripe yet.
 *
 *        WHAT IT SAYS IS NOT DECIDED HERE (redesign, 2026-10-14). This file
 *        owns the flows and the reads; `payoutView` turns them into the hero
 *        (the amount, the car, one status line, the chip) and the road (each
 *        step, its date, its one action as an intent), and PayoutsHero /
 *        PayoutsBody draw that. A state worded here as well would be the
 *        three-places drift the redesign removed.
 * WHY:  `release-payout` refuses to transfer until Stripe says a spotter is
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
 *        ./PayoutSetupScreen.tsx + ../lib/payoutSetupOutcome.ts (flow 1);
 *        supabase/functions/submit-payout-details/index.ts (where it goes);
 *        supabase/functions/connect-onboarding/index.ts (session, link, gate);
 *        src/app/payouts.tsx; docs/DESIGN_SYSTEM.md (tone).
 */

// ⚠️ ConnectAccountOnboarding renders in `react-native-webview`, a PEER
// dependency the SDK imports lazily. Until 2026-10-13 it wasn't installed: the
// import failed with only a console.error, `onLoadError` never fired, and the
// ID check opened onto a blank modal on every device. It is native — removing
// it, or an APK built before it, brings that back, and no OTA can fix it.
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from '@stripe/stripe-react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRequireAuth, useSession } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, ErrorState, Screen, useToast } from '@/shared/ui';

import { PaymentError } from '@/shared/lib/functionError';
import {
  fetchMyLatestPayout,
  fetchMyPendingCredit,
  syncMyPayoutAccount,
  startConnectOnboarding,
  submitPayoutTokens,
} from '../api/payoutsApi';
import { createBankToken } from '../api/stripeTokens';
import { BankDetailsForm } from '../components/BankDetailsForm';
import {
  BankRejectedCard,
  DetailsRejectedCard,
  IdCheckIntroCard,
  PayoutsJourneyCard,
  PayoutsReadyCard,
  PayoutsSkeleton,
} from '../components/PayoutsBody';
import { PayoutsHero } from '../components/PayoutsHero';
import { usePollWhileChecking } from '../hooks/usePollWhileChecking';
import { usePayoutAccount, type PayoutAccountStatus } from '../hooks/usePayoutAccount';
import { hasCelebratedPayout, markPayoutCelebrated } from '../lib/paidMomentStorage';
import { takePayoutSetupOutcome } from '../lib/payoutSetupOutcome';
import { payoutView, type PayoutIntent, type PendingCreditInput } from '../lib/payoutView';
import { ensureStripeReady } from '../lib/stripeReady';

const log = createLogger('payments');

/** The bare prefix, deliberately without the query string — see the header. */
const RETURN_PREFIX = 'trackitdown://payouts';

/** PUBLIC key — it can open a flow, never move money. Same one the escrow
 *  PaymentSheet uses; see BountyPaymentProvider for why bundling it is safe. */
const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** While "being checked" is on screen: ask the server every POLL_MS, at most
 *  POLL_LIMIT times per visit — two minutes, then pull-to-refresh is there. */
const POLL_MS = 10_000;
const POLL_LIMIT = 12;

export function PayoutsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const { status, account, settling, refresh, settleReturn } = usePayoutAccount();
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  // "Update bank details" on a ready account: three fields, in the app. The
  // browser hop this replaced was a dead end for legacy Express accounts —
  // Stripe refuses `account_update` links when it collects requirements.
  const [showBankForm, setShowBankForm] = useState(false);
  // Stripe refused what the setup steps can describe. Offers the way past.
  const [detailsRejected, setDetailsRejected] = useState(false);
  const [bankRejected, setBankRejected] = useState(false);
  // The reward waiting: the amount, the car it was for, whether a check holds
  // it. Server-derived via payout_split, so the push and this screen can never
  // disagree on the number.
  //
  // TRI-STATE, and the third state is load-bearing: `undefined` means "still
  // asking", `null` means "asked — nothing waiting". payoutView draws no road
  // until it knows, so nobody sees "Nothing to set up" flash for one fetch.
  const [credit, setCredit] = useState<PendingCreditInput | null | undefined>(undefined);
  // The reward most recently SENT, within the window — the road's end.
  const [latestPayout, setLatestPayout] = useState<Awaited<
    ReturnType<typeof fetchMyLatestPayout>
  >>(null);
  // ⚠️ "COULDN'T CHECK" IS NOT "NOTHING OWED" (2026-10-14). A failed read
  // used to land as null — "Nothing to set up" to someone owed £190 on a bad
  // connection. It is remembered separately, and the one state that would
  // otherwise say "nothing" says "couldn't check" with a retry instead.
  const [creditCheckFailed, setCreditCheckFailed] = useState(false);
  const [creditAttempt, setCreditAttempt] = useState(0);
  // ⚠️ "NOW" IS STATE, NEVER A RENDER-TIME `new Date()`: the React Compiler
  // memoises that on device, and "expected by" would go stale. Taken when the
  // reads land and each time the screen comes back into view.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (status === 'guest' || status === 'loading') {
      return;
    }
    let cancelled = false;
    // Together, so the road never draws "nothing waiting" for a moment
    // before the sent reward arrives to end it.
    void Promise.all([
      fetchMyPendingCredit().then(
        (read) => ({ ok: true as const, credit: read }),
        () => ({ ok: false as const, credit: null }),
      ),
      fetchMyLatestPayout(),
    ]).then(([read, sent]) => {
      if (!cancelled) {
        setLatestPayout(sent);
        setCreditCheckFailed(!read.ok);
        setCredit(read.credit);
        setNow(new Date());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, creditAttempt]);
  const retryCreditCheck = useCallback(() => {
    setCredit(undefined);
    setCreditAttempt((attempt) => attempt + 1);
  }, []);
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

  // The setup wizard's ending, read once as this screen comes back into view
  // (see payoutSetupOutcome) — and only if THIS user left it. Sent → the
  // settling window, exactly as a return from Stripe arms it; refused → the
  // "Continue with Stripe" card.
  // ⚠️ CHECK WITH STRIPE, DON'T JUST WAIT (2026-10-13). "Being checked" used
  // to move only when the account.updated webhook arrived — and when it
  // didn't, the screen said "usually a few minutes" forever. So whenever this
  // screen shows a not-yet-ready account, it asks the server to read the
  // account from Stripe (sync-payout-account: read-only, never a session) and
  // then re-reads. Once per visit: on the first not-ready status, and again
  // each time the screen comes back into view.
  // Stripe is holding payouts until a bank is attached (from the check above).
  // Then the card asks for one in our own form — never Stripe's screen, which
  // is for what only Stripe can collect (2026-10-13).
  const [needsBank, setNeedsBank] = useState(false);
  // Stripe is waiting on THEM for something only its own screen collects
  // (2026-10-14) — said as "we need one more thing from you", never as
  // "being checked", which told people to wait for a check waiting on them.
  const [needsAction, setNeedsAction] = useState(false);
  // The last check itself failed (2026-10-16): the two flags above are then
  // unknown, and the screen says "couldn't check", never "being checked".
  const [checkFailed, setCheckFailed] = useState(false);
  // A check the spotter asked for by hand, once the automatic ones stopped.
  const [recheckingByHand, setRecheckingByHand] = useState(false);
  const checkWithStripe = useCallback(async () => {
    const result = await syncMyPayoutAccount();
    setNeedsBank(result.needsBank);
    setNeedsAction(result.needsAction);
    setCheckFailed(result.failed);
    refresh();
  }, [refresh]);
  const checkedThisVisit = useRef(false);
  const statusNow = useRef(status);
  useEffect(() => {
    statusNow.current = status;
  });
  const checkIfWaiting = useCallback(
    (current: PayoutAccountStatus) => {
      if (checkedThisVisit.current) return;
      if (current !== 'verifying' && current !== 'unfinished') return;
      checkedThisVisit.current = true;
      void checkWithStripe();
    },
    [checkWithStripe],
  );
  // The first not-ready status of a visit. Inlined rather than via
  // checkIfWaiting: the state lands in the promise's callback, never in the
  // effect body.
  useEffect(() => {
    if (checkedThisVisit.current) return;
    if (status !== 'verifying' && status !== 'unfinished') return;
    checkedThisVisit.current = true;
    void syncMyPayoutAccount().then((result) => {
      setNeedsBank(result.needsBank);
      setNeedsAction(result.needsAction);
      setCheckFailed(result.failed);
      refresh();
    });
  }, [status, refresh]);

  // KEEP ASKING WHILE IT SAYS "BEING CHECKED" (2026-10-14). One check on
  // arrival came seconds too early for a test-mode check that finishes in
  // seconds, and nothing asked again — the owner had to tap an unrelated
  // button to move on. So while this screen is in view and Stripe is the one
  // deciding, keep asking, a bounded number of times (the v2 account events
  // reach the server too; this is the screen's own backstop). Not while the
  // spotter is the one being waited on: nothing changes until they act.
  // ⚠️ Registered BEFORE the focus effect below, which the screen's tests
  // drive as "the latest focus effect".
  const needsActionNow = useRef(needsAction);
  useEffect(() => {
    needsActionNow.current = needsAction;
  });
  const stillBeingChecked = useCallback(
    () => statusNow.current === 'verifying' && !needsActionNow.current,
    [],
  );
  const checkAgain = useCallback(() => void checkWithStripe(), [checkWithStripe]);
  const { spent: pollSpent } = usePollWhileChecking(stillBeingChecked, checkAgain, {
    everyMs: POLL_MS,
    times: POLL_LIMIT,
  });

  useFocusEffect(
    useCallback(() => {
      const outcome = takePayoutSetupOutcome(userId);
      if (outcome === 'submitted') {
        setDetailsRejected(false);
        settleReturn();
      } else if (outcome === 'rejected') {
        setDetailsRejected(true);
      }
      // A new visit: check with Stripe again if it's still waiting.
      setNow(new Date());
      checkedThisVisit.current = false;
      checkIfWaiting(statusNow.current);
    }, [checkIfWaiting, settleReturn, userId]),
  );

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

  // Stripe's embedded step has been introduced and is waiting for "Continue".
  const [stripeIntro, setStripeIntro] = useState(false);
  // "Continue to Stripe" pressed, the SDK still warming: the heads-up stays
  // up with a busy button rather than blinking back to the status card.
  const [launching, setLaunching] = useState(false);

  /** Render Stripe's embedded onboarding over this screen, in the app. */
  const launchStripe = useCallback(async () => {
    setLaunching(true);
    // The embedded component calls native Stripe (bank-account collection, the
    // authenticated web view), which needs the SDK initialised — no longer
    // guaranteed by a StripeProvider on mount, so wait for it here. A failure
    // is left to the component's own error surface.
    await ensureStripeReady().catch(() => {});
    setLaunching(false);
    setStripeIntro(false);
    setConnectInstance(
      loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret,
        // Stripe's embedded UI takes a hex VALUE, so it reads the live palette —
        // the near-black in light, the near-white in dark.
        appearance: { variables: { colorPrimary: palette.primary } },
      }),
    );
  }, [fetchClientSecret, palette]);

  const open = useCallback(
    // `skipIntro` is the app's alone, never sent: the "one more thing from
    // you" card has already said what the check is, so a second card saying
    // it again would be a tap for nothing.
    async (options: { skipPrefill?: boolean; skipIntro?: boolean } = {}) => {
    if (opening) {
      return;
    }
    setOpening(true);
    setBrowserSaidExpired(false);
    try {
      const result = await startConnectOnboarding(
        options.skipPrefill ? { skipPrefill: true } : {},
      );
      if (result.status === 'already_enabled') {
        // Nothing to open — the server had nothing left to ask for. Re-read so
        // the screen agrees with it.
        refresh();
        return;
      }

      // OUR STEPS FIRST. The server refuses to mint a session until they have
      // run, because doing so would permanently close the window in which we
      // are allowed to submit bank details at all.
      if (result.status === 'details_required') {
        router.push('/payout-setup');
        return;
      }

      // THE IN-APP PATH. Stripe's embedded component, rendered over this
      // screen — no browser, no bounce page, no deep link.
      if (result.status === 'onboarding_session') {
        primedSecret.current = result.clientSecret;
        // ⚠️ A HEADS-UP FIRST (2026-10-13, PR2 of the payments UX plan):
        // Stripe's own screen used to arrive unannounced, in Stripe's styling,
        // asking for things our steps hadn't — which reads as "something went
        // wrong". The card says who, why and how long, and Continue opens it.
        // Not for someone who just chose "Continue with Stripe": they already
        // said yes to exactly this.
        if (options.skipPrefill || options.skipIntro) {
          await launchStripe();
        } else {
          setStripeIntro(true);
        }
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
          : 'We couldn’t open that just now. Please try again.';
      log.warn('payout onboarding failed', {
        code: error instanceof PaymentError ? error.code : 'BROWSER',
      });
      toast.show(message, 'error');
    } finally {
      setOpening(false);
    }
    },
    [launchStripe, opening, refresh, router, settleReturn, toast],
  );

  /**
   * Spend the prefill window deliberately and let Stripe ask instead — for a
   * spotter whose details Stripe refused in the setup wizard: a company, a
   * non-UK account, something its fields have no word for. Without this way
   * past, they are gated forever behind steps that can never satisfy Stripe.
   */
  const onSkipPrefill = useCallback(async () => {
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
        toast.show('Done — rewards will go to your new account.');
        // Ask Stripe, not just our row: a bank was what it was waiting for.
        void checkWithStripe();
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
    [checkWithStripe, toast],
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
    // And ask Stripe, not just our row: leaving the check is exactly when
    // what it wanted may have just been given (Stripe: re-fetch on exit).
    void checkWithStripe();
  }, [checkWithStripe, settleReturn]);

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

  // ⚠️ ONLY WHILE THERE IS STILL NOTHING TO LOSE. "Continue with Stripe" spends
  // the prefill window for good; once details have reached Stripe (verifying,
  // ready) the refusal card would offer a button with no purpose and one
  // irreversible effect, so the account's own state wins.
  const showRejected = detailsRejected && (status === 'notStarted' || status === 'unfinished');
  // "Something is happening" (owner, 2026-10-14) — and only while it is: the
  // bounded re-checks are running for an account Stripe is reviewing, not one
  // waiting on the spotter.
  const checkingNow =
    status === 'verifying' && !needsBank && !needsAction && (!pollSpent || recheckingByHand);

  // ONE decision about what this screen says (payoutView, 2026-10-14). The
  // hero, the chip, the road and its one button all come from here; nothing
  // below re-decides a state.
  const view = payoutView(
    {
      // The settle window issues its own re-reads, and one transient failure
      // among them must not flip "waiting for confirmation" into an error.
      status: settling && status === 'error' ? 'verifying' : status,
      settling,
      checkingNow,
      needsBank,
      needsAction,
      checkFailed,
      canCheckAgain: pollSpent && !recheckingByHand,
      creditCheckFailed,
      credit,
      latestPayout,
      account,
    },
    now,
  );

  // THE PAID MOMENT, once per payout: a tick, the amount, "Thanks for
  // helping", and the road unfolded. Every later visit gets the folded line.
  const celebrateKey = view.kind === 'journey' ? view.celebrateKey : null;
  const [celebrated, setCelebrated] = useState<string | null>(null);
  useEffect(() => {
    if (!celebrateKey) return;
    let cancelled = false;
    void hasCelebratedPayout(celebrateKey).then((seen) => {
      if (cancelled || seen) return;
      setCelebrated(celebrateKey);
      void markPayoutCelebrated(celebrateKey);
    });
    return () => {
      cancelled = true;
    };
  }, [celebrateKey]);
  const celebrating = celebrateKey !== null && celebrated === celebrateKey;

  /** The road's one button, by what it is for. */
  const onIntent = (intent: PayoutIntent) => {
    if (intent === 'bank') {
      // Our own three fields, never a session at Stripe.
      setShowBankForm(true);
    } else if (intent === 'retry') {
      retryCreditCheck();
    } else if (intent === 'recheck') {
      setRecheckingByHand(true);
      void checkWithStripe().finally(() => setRecheckingByHand(false));
    } else if (intent === 'idCheck') {
      // Straight to the check: the step has already said what it is.
      void open({ skipIntro: true });
    } else {
      void open();
    }
  };

  // Stripe's own full-screen modal (a native UIKit sheet on iOS, an RN Modal on
  // Android), so it is rendered instead of the page rather than inside it.
  if (connectInstance) {
    return (
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          title="Set up payouts"
          onExit={onOnboardingExit}
          // Only what is due NOW — what's blocking the reward — not everything
          // Stripe might want one day (2026-10-14). Least asked, soonest paid.
          collectionOptions={{ fields: 'currently_due' }}
          // Where people stop, for us to see; the step name only, never what
          // they typed. Not for logic: Stripe says not to rely on it.
          onStepChange={({ step }) => log.info('payout check step', { step })}
          onLoadError={(event) => {
            // Never surface Stripe's internals; the screen behind is intact and
            // the button is still there.
            log.warn('payout onboarding load failed', { type: event?.error?.type });
            setConnectInstance(null);
            toast.show('We couldn’t open the ID check. Please try again.', 'error');
          }}
        />
      </ConnectComponentsProvider>
    );
  }

  return (
    <Screen
      scroll
      // ⚠️ THE BOTTOM INSET, as on SettingsScreen and LegalDocumentScreen.
      // `Screen` pads only the top by default (tab screens run under the tab
      // bar); a pushed screen has no tab bar, so under SDK 57's edge-to-edge
      // Android the last button would sit beneath the navigation buttons.
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
      // The bank form's last field sits low; without this it hides under the
      // keyboard and the first tap on Save is spent dismissing it.
      keyboardAware
      // Pull to refresh asks Stripe too, not just our row — the way past any
      // wait, so no "Check again" button needs to compete with the road.
      onRefresh={() => void checkWithStripe()}
      refreshing={status === 'loading'}
    >
      {/* A plain back-and-title row, as BlockedAccountsScreen: AppHeader is
          the scroll-fade bar for photo heroes, and there is no photo here. */}
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          Payouts
        </Text>
      </View>

      {/* THE AMOUNT IS THE HERO (owner, 2026-10-14) — from "add your details"
          to "paid". It used to hide on `ready`, exactly when the money moved. */}
      {view.kind === 'journey' && status !== 'guest' ? (
        <PayoutsHero hero={view.hero} chip={view.chip} celebrating={celebrating} />
      ) : null}

      {/* ONE body, chosen once, in priority order — structurally impossible
          to show two (a refresh error once stacked over the bank form). */}
      {renderBody()}
    </Screen>
  );

  function renderBody() {
    if (status === 'guest') {
      // Reachable: /payouts is deep-linkable and the app is guest-first.
      return (
        <EmptyState
          title="Get paid for what you spot"
          body="Log in to set up payouts, so a reward has somewhere to land."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'payouts' })}
        />
      );
    }
    if (stripeIntro) {
      // The road stays in view as the check takes over: a step on it, not a
      // detour. Without its button — the heads-up has the one.
      return (
        <>
          {view.kind === 'journey' ? (
            <PayoutsJourneyCard view={view} onIntent={onIntent} inert />
          ) : null}
          <IdCheckIntroCard
            launching={launching}
            onStart={() => void launchStripe()}
            onNotNow={() => {
              setStripeIntro(false);
              primedSecret.current = null;
            }}
          />
        </>
      );
    }
    if (showRejected) {
      return (
        <DetailsRejectedCard
          busy={opening}
          onAnotherWay={() => void onSkipPrefill()}
          onTryAgain={() => {
            setDetailsRejected(false);
            router.push('/payout-setup');
          }}
        />
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
            <BankRejectedCard busy={opening} onAnotherWay={() => void onBankViaStripe()} />
          ) : null}
        </>
      );
    }
    switch (view.kind) {
      case 'error':
        return (
          <ErrorState
            title="Couldn’t load your payout details"
            body="Check your connection and try again."
            onRetry={refresh}
          />
        );
      case 'loading':
        return <PayoutsSkeleton />;
      case 'creditUnknown':
        // Never "nothing to set up" on a read we couldn't make.
        return (
          <ErrorState
            title="Couldn’t check for rewards"
            body="Check your connection and try again."
            onRetry={retryCreditCheck}
          />
        );
      case 'nothing':
        // Credit-time setup: with no account and no reward waiting there is
        // NOTHING to set up, and saying so beats a form about money that does
        // not exist.
        return (
          <EmptyState
            title="Nothing to set up"
            body="When a sighting of yours leads to a recovery, we’ll let you know you’ve earned the reward — and ask where to send it. That’s the whole setup."
          />
        );
      case 'ready':
        return (
          <PayoutsReadyCard
            view={view}
            onIntent={onIntent}
            busy={opening}
            linkExpired={linkExpired}
          />
        );
      case 'journey':
        return (
          <PayoutsJourneyCard
            view={view}
            onIntent={onIntent}
            busy={opening}
            linkExpired={linkExpired}
            celebrating={celebrating}
          />
        );
      default:
        return null;
    }
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

const makeStyles = (c: Palette) => StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.xl,
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
});
