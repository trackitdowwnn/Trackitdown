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
import { useRef } from 'react';

import { PaymentError, createBountyPaymentIntent, useBountyPayment } from '@/features/payments';
import { successHaptic } from '@/shared/lib/haptics';
import { useToast } from '@/shared/ui';
import { WizardScreen, type WizardFlow } from '@/shared/wizard';

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

  const handleComplete = async (answers: Partial<PostACarAnswers>) => {
    // 1. Create the draft ONCE. On a retry the id is already known — skip
    //    submitPost (and its uploads) and go straight to payment.
    let postId = createdPostIdRef.current;
    if (!postId) {
      const result = await submitPost(answers);
      postId = result.postId;
      createdPostIdRef.current = postId;
    }

    // 2. Open (or reuse) the escrow PaymentIntent — the server reads the
    //    authoritative bounty amount; this call carries only the id.
    const clientSecret = await createBountyPaymentIntent(postId);

    // 3. Present Stripe's PaymentSheet.
    const { outcome, message } = await payBounty(clientSecret);
    if (outcome === 'cancelled') {
      throw new PaymentError('Payment not completed. Tap to try again when ready.', 'CANCELLED');
    }
    if (outcome === 'failed') {
      throw new PaymentError(message ?? 'Your payment didn’t go through. Please try again.', 'FAILED');
    }

    // 4. Paid — the webhook flips the post to ACTIVE (live-on-payment). Route to
    //    it (replace so back doesn't return into the finished wizard).
    successHaptic();
    toast.show('Payment received — your car is going live for spotters now.', 'success');
    router.replace(`/post/${postId}`);
  };

  return (
    <WizardScreen
      flow={flow ?? postACarFlow}
      initialAnswers={initialAnswers ?? POST_A_CAR_INITIAL_ANSWERS}
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
    />
  );
}
