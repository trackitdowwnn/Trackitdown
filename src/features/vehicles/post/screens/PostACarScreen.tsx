/**
 * WHAT:  The post-a-car wizard screen — renders the flow via the shared
 *        WizardScreen, seeds the starting bounty, and owns the final submit:
 *        create the draft (submitPost), take the bounty into escrow via Stripe
 *        PaymentSheet, then route to the new post. On failure it re-throws so the
 *        framework keeps the wizard fully intact with an inline error for retry —
 *        and it remembers the created draft so a retry never makes a second draft
 *        or a second charge.
 * WHY:   The route file stays thin (ARCHITECTURE.md rule 3); this is where the
 *        flow meets the data + payments layers. Submission is the money/safety
 *        moment — a completed wizard must survive a failed submit OR a cancelled
 *        payment, so onComplete awaits each step and lets the error propagate to
 *        the wizard's error surface. createdPostIdRef holds the draft's id across
 *        retries: the draft is created ONCE, and the (server-idempotent)
 *        PaymentIntent reuses that id, so a declined-then-retried card can't
 *        double-charge or orphan a second draft. The authoritative
 *        draft→active transition (live-on-payment) is the Stripe webhook, not
 *        this screen — 'paid' here only means it's safe to route away. (Editing
 *        an existing post is NOT here — it's per-section on the post detail.)
 * LINKS: src/app/post-a-car.tsx (route + BountyPaymentProvider);
 *        src/features/vehicles/post/postACarFlow.tsx (the "Post & pay £X" CTA);
 *        src/features/vehicles/post/api/postApi.ts (submitPost);
 *        src/features/payments (createBountyPaymentIntent, useBountyPayment);
 *        src/shared/wizard/WizardScreen.tsx.
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { PaymentError, createBountyPaymentIntent, useBountyPayment } from '@/features/payments';
import { DEFAULT_BOUNTY_PENCE } from '@/shared/lib/bountyBounds';
import { successHaptic } from '@/shared/lib/haptics';
import { chargeBreakdown, formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';
import { useToast } from '@/shared/ui';
import { WizardScreen, type WizardFlow } from '@/shared/wizard';

import { fetchBountyGuidance, logBountyRecommendation } from '../api/bountyGuidanceApi';
import { saveBounty } from '../api/editSectionApi';
import { recommendBounty } from '../lib/bountyRecommendation';
import { clearPostDraft, loadPostDraft, savePostDraft } from '../lib/postDraftStorage';
import { submitPost } from '../api/postApi';
import { POST_A_CAR_INITIAL_ANSWERS, postACarFlow } from '../postACarFlow';
import type { PostACarAnswers } from '../types';

export interface PostACarScreenProps {
  /**
   * Override the wizard flow. The garage passes a variant whose vehicle phase is
   * collapsed to a confirm step, for a report started from a saved car. Defaults
   * to the ordinary postACarFlow. Kept as a plain WizardFlow so this screen never
   * learns what a saved vehicle is (ARCHITECTURE.md rule 1).
   */
  flow?: WizardFlow<PostACarAnswers>;
  /** Seed answers; defaults to the starting-bounty seed. */
  initialAnswers?: Partial<PostACarAnswers>;
  /**
   * Fired when the user leaves the wizard WITHOUT creating a post — the signal
   * that they were exploring rather than reporting a theft. The /post-a-car
   * route uses it to offer the garage; a report started FROM the garage passes
   * nothing, which is how that path is excluded. A plain callback, so this
   * screen still never learns the garage exists (ARCHITECTURE.md rule 1).
   */
  onAbandon?: () => void;
}

export function PostACarScreen({
  flow,
  initialAnswers,
  onAbandon,
}: PostACarScreenProps = {}) {
  const router = useRouter();
  const toast = useToast();
  const { payBounty } = useBountyPayment();

  // The draft's id, kept across retries: created once, then reused so a retry
  // after a cancelled/declined payment never creates a second draft and (with
  // the server idempotency key) never double-charges.
  const createdPostIdRef = useRef<string | null>(null);
  // The price the draft holds on the SERVER: what it was created with, then
  // whatever a retry last saved. `null` means the £5 listing fee. A retry
  // re-saves only when the answers differ from this — never blindly.
  const savedRewardRef = useRef<number | null | undefined>(undefined);

  /**
   * A saved draft, restored once on open (review #19).
   *
   * ⚠️ 'checking' IS ITS OWN STATE, and the wizard does not mount until it
   * resolves. Mounting on the defaults and then swapping answers underneath
   * would restart the flow at step one with values the owner never typed, and
   * `useWizardController` seeds from `initialAnswers` ONCE — a later change to
   * that prop is ignored by design, so a late restore would silently do
   * nothing at all.
   *
   * ⚠️ SKIPPED ENTIRELY when the caller supplied answers: that is the garage's
   * prefilled path (report THIS saved car), and a stale draft about a different
   * car must never overwrite the one they just chose.
   */
  const [draft, setDraft] = useState<{ answers: Partial<PostACarAnswers> } | 'checking' | null>(
    initialAnswers ? null : 'checking',
  );

  useEffect(() => {
    if (initialAnswers) {
      return;
    }
    let cancelled = false;
    (async () => {
      const saved = await loadPostDraft();
      if (!cancelled) {
        setDraft(saved ? { answers: saved } : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialAnswers]);

  /** A payment that landed after all: the same ending as a paid sheet. */
  const goToPaidListing = (postId: string) => {
    successHaptic();
    toast.show('Your payment went through — your car is going live for spotters now.', 'success');
    router.replace(`/post/${postId}`);
  };

  const handleComplete = async (answers: Partial<PostACarAnswers>) => {
    // 1. Create the draft ONCE. On a retry the id is already known — skip
    //    submitPost (and its uploads) and go straight to payment.
    const feeMode = answers.pricingMode === 'fee';
    const rewardPence = answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE;
    // The price these answers ask for: a reward in pence, or null for the fee.
    const askedReward = feeMode ? null : rewardPence;

    let postId = createdPostIdRef.current;
    if (!postId) {
      const result = await submitPost(answers);
      postId = result.postId;
      createdPostIdRef.current = postId;
      savedRewardRef.current = askedReward;

      // ⚠️ CLEARED THE MOMENT THE POST EXISTS, not after payment (review #19).
      // From here the report lives on the server as a draft post with its own
      // manage/delete path, so a local copy is a second, diverging record of
      // the same thing — and if payment then fails, the retry reuses
      // createdPostIdRef rather than the answers, so the draft could only
      // resurface as a stale duplicate of a car already listed.
      void clearPostDraft();

      // Record what we ADVISED against what they CHOSE, once, on first
      // creation only — a retry after a declined card must not log a second
      // row for the same decision.
      //
      // ⚠️ WHY THIS EXISTS AT ALL: the outcome half of the join (a credited
      // sighting on a recovered post) is already computable from the schema.
      // The advice half was not recorded anywhere, and without it a future
      // analysis cannot separate "high bounties recover cars" from "we told
      // people to set high bounties". A NULL recommendation is logged too —
      // those rows are the control group.
      //
      // Fire-and-forget, and the RPC is built to be: it returns SILENTLY when
      // the caller does not own the post, because an error there would make an
      // analytics endpoint into an ownership oracle. Nothing here may ever
      // surface to someone who is one tap from paying.
      const chosenPence = answers.bountyAmountPence;
      const lat = answers.location?.latitude;
      const lng = answers.location?.longitude;
      if (answers.pricingMode !== 'fee' && chosenPence != null && lat != null && lng != null) {
        const loggedPostId = postId;
        // ⚠️ NOT AWAITED, and it must never be. The next line of the caller
        // opens a PaymentIntent; putting a round trip in front of that would
        // delay the payment sheet to write an analytics row.
        //
        // ⚠️ THE ADVICE IS RE-DERIVED, NOT CAPTURED. recommendBounty is pure
        // and the RPC is `stable` and grid-snapped, so the same inputs give the
        // same range the owner was shown minutes earlier on the bounty step.
        // The honest limit: if a neighbour posted in between, the recorded band
        // could differ slightly from the one displayed. That is a small,
        // recorded imprecision — the alternative was threading shown-state
        // through the wizard, which means setting state from an effect in the
        // one screen where that is least welcome.
        void fetchBountyGuidance(lat, lng).then((g) =>
          logBountyRecommendation(loggedPostId, chosenPence, recommendBounty(g), g.local?.sample ?? null),
        );
      }
    }

    // 2. On a RETRY whose price CHANGED, bring the draft in line first. The
    //    draft holds the price it was created with; if a payment failed and
    //    the owner changed the reward on the review before trying again, the
    //    server would price the OLD reward while the button names the new one.
    //    That used to charge the old sum silently; with the price check below
    //    it would refuse forever.
    //
    //    ⚠️ ONLY when it changed, and only reward-to-reward. The draft RPC
    //    takes a reward and refuses NULL, so a £5 listing (whose price never
    //    moves) is never re-saved, and switching between a reward and the £5
    //    fee after the draft exists is refused in words rather than attempted.
    if (savedRewardRef.current !== askedReward) {
      if (savedRewardRef.current === null || askedReward === null) {
        const savedAs =
          savedRewardRef.current === null
            ? `a ${formatPounds(LISTING_FEE_PENCE)} listing`
            : 'a listing with a reward';
        throw new PaymentError(
          `This was saved as ${savedAs}. Switch back to finish, or start a new listing.`,
          'PRICING_LOCKED',
        );
      }
      try {
        await saveBounty(postId, askedReward);
      } catch (error) {
        // POST_NOT_EDITABLE here means the draft is no longer a draft — the
        // earlier attempt was paid after all and the webhook got there first.
        if (error instanceof Error && 'code' in error && error.code === 'POST_NOT_EDITABLE') {
          goToPaidListing(postId);
          return;
        }
        throw error;
      }
      savedRewardRef.current = askedReward;
    }

    // 3. Open (or reuse) the PaymentIntent. The server derives the charge; the
    //    total passed here is only what the pay button SHOWED, and the call
    //    refuses to proceed if the server priced anything else (ADR-0020).
    const displayedChargePence = feeMode
      ? LISTING_FEE_PENCE
      : chargeBreakdown(rewardPence).chargePence;
    let clientSecret: string;
    try {
      clientSecret = await createBountyPaymentIntent(postId, displayedChargePence);
    } catch (error) {
      // An earlier attempt the sheet reported as failed was in fact paid. That
      // is good news, not an error: take them to the listing.
      if (error instanceof PaymentError && error.code === 'PAYMENT_ALREADY_TAKEN') {
        goToPaidListing(postId);
        return;
      }
      throw error;
    }

    // 4. Present Stripe's PaymentSheet.
    const { outcome, message } = await payBounty(clientSecret);
    if (outcome === 'cancelled') {
      throw new PaymentError('Payment not completed. Tap to try again when ready.', 'CANCELLED');
    }
    if (outcome === 'failed') {
      throw new PaymentError(message ?? 'Your payment didn’t go through. Please try again.', 'FAILED');
    }

    // 5. Paid — the webhook flips the post to ACTIVE (live-on-payment). Route to
    //    it (replace so back doesn't return into the finished wizard).
    successHaptic();
    toast.show('Payment received — your car is going live for spotters now.', 'success');
    router.replace(`/post/${postId}`);
  };

  // ⚠️ NOTHING RENDERS UNTIL THE DRAFT CHECK RESOLVES, and it is a blank rather
  // than a spinner: the read is one AsyncStorage hit and typically lands in the
  // same frame, so a loader would be a flash of chrome nobody asked for. The
  // wizard's own entrance animation then plays once, over the right answers.
  if (draft === 'checking') {
    return null;
  }

  return (
    <WizardScreen
      flow={flow ?? postACarFlow}
      // A restored draft overlays the seeds rather than replacing them: it holds
      // only the whitelisted keys, so the bounty seed (and anything else the
      // flow expects to exist) survives a draft that never reached that step.
      initialAnswers={
        initialAnswers ?? { ...POST_A_CAR_INITIAL_ANSWERS, ...(draft?.answers ?? {}) }
      }
      onExit={() => {
        // requestExit is the ONLY route to onExit, and the success path leaves
        // via router.replace without touching it — so reaching here means the
        // wizard was abandoned. Guarded on the draft id because someone who got
        // as far as creating one and then hit a payment problem HAS had a car
        // stolen; "save one for next time" is the wrong sentence for them.
        if (!createdPostIdRef.current) {
          onAbandon?.();
        }
        router.back();
      }}
      onComplete={handleComplete}
      // ⚠️ ONLY THIS FLOW GETS IT. Nine steps ending in a card charge is the
      // one place in the app where losing the answers is a real loss; report-a-
      // sighting and add-a-vehicle keep the plain discard prompt.
      onSaveAndExit={savePostDraft}
    />
  );
}
