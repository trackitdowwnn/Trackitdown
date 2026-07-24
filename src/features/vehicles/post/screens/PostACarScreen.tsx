/**
 * WHAT:  The post-a-car wizard screen — renders the flow via the shared
 *        WizardScreen, seeds the starting bounty, and owns submit: create the
 *        draft (submitPost), then route to the new post. On failure it does
 *        nothing but re-throw, so the framework keeps the wizard fully intact
 *        with an inline error for retry.
 * WHY:   The route file stays thin (ARCHITECTURE.md rule 3); this is where the
 *        flow meets the data layer. Submission is the money/safety moment — a
 *        completed wizard must survive a failed submit, so onComplete awaits
 *        submitPost and lets its PostSubmissionError propagate to the wizard's
 *        error surface rather than swallowing it. PAYMENT IS STUBBED this build:
 *        the post is created as a draft and the toast says so; the escrow charge
 *        + draft→pending_verification transition arrive with the payments
 *        feature (see the feature README handoff contract).
 * LINKS: src/app/post-a-car.tsx (route); src/features/vehicles/post/postACarFlow.tsx;
 *        src/features/vehicles/post/api/postApi.ts (submitPost);
 *        src/shared/wizard/WizardScreen.tsx.
 */

import { useRouter } from 'expo-router';

import { successHaptic } from '@/shared/lib/haptics';
import { useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { submitPost } from '../api/postApi';
import { POST_A_CAR_INITIAL_ANSWERS, postACarFlow } from '../postACarFlow';
import type { PostACarAnswers } from '../types';

export function PostACarScreen() {
  const router = useRouter();
  const toast = useToast();

  const handleComplete = async (answers: Partial<PostACarAnswers>) => {
    // Any failure throws a PostSubmissionError; NOT caught here so the wizard
    // stays intact and shows the message for retry (losing a completed wizard
    // to a blip is the failure this flow guards against).
    const result = await submitPost(answers);
    // PAYMENT STUB: draft created, no charge taken yet. A gentle success buzz
    // confirms the completion moment alongside the toast.
    successHaptic();
    toast.show(
      'Your report is saved. Payment and verification are coming soon.',
      'success',
    );
    // replace() so the back gesture doesn't return into the finished wizard.
    router.replace(`/post/${result.postId}`);
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
