/**
 * WHAT:  BountyEditor — edits the reward. DRAFT ONLY (the bounty is frozen once
 *        escrow is held, server-enforced); the pencil only shows on a draft.
 * WHY:   Reuses the wizard's BountyStep (MoneySlider). The slider is bounded to
 *        £50–£5,000, so any value is valid → Save is always available. MONEY:
 *        the amount is re-validated server-side (BOUNTY_OUT_OF_RANGE).
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx (BountyStep);
 *        src/features/vehicles/post/api/editSectionApi.ts (saveBounty).
 */

import { useState } from 'react';

import { saveBounty } from '@/features/vehicles/post/api/editSectionApi';
import { BountyStep, DEFAULT_BOUNTY_PENCE } from '@/features/vehicles/post/components/postSteps';
import type { PostACarAnswers } from '@/features/vehicles/post';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

export function BountyEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setLocal] = useState<Partial<PostACarAnswers>>({
    bountyAmountPence: post.bountyPence,
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  return (
    <PostSectionEditor
      title="Bounty"
      onClose={onClose}
      onSaved={onSaved}
      canSave
      onSave={() => saveBounty(post.id, answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE)}
    >
      <BountyStep answers={answers} setAnswers={setAnswers} />
    </PostSectionEditor>
  );
}
