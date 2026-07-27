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
import { WizardScreen } from '@/shared/wizard';

import { submitPost } from '../api/postApi';
import { POST_A_CAR_INITIAL_ANSWERS, postACarFlow } from '../postACarFlow';
import type { PostACarAnswers } from '../types';

export function PostACarScreen() {
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
      flow={postACarFlow}
      initialAnswers={POST_A_CAR_INITIAL_ANSWERS}
      onExit={() => router.back()}
      onComplete={handleComplete}
    />
  );
}
