/**
 * WHAT:  BountyEditor — edits how the listing is paid for: a reward, or the flat
 *        listing fee. DRAFT ONLY (the price is frozen once the charge is taken,
 *        server-enforced); the pencil only shows on a draft.
 * WHY:   Reuses the wizard's own steps — PricingModeStep and, when a reward is
 *        chosen, BountyStep (MoneySlider) — so the editor and the flow can never
 *        describe the same choice differently. Unlike the wizard, which asks the
 *        two questions on separate screens, this shows them STACKED: an editor is
 *        opened to change one known thing, and paging inside an overlay to reach
 *        the slider would be a worse version of the flow the owner already left.
 *        The slider is bounded by MIN/MAX_BOUNTY_PENCE (the ONE mirror, never a
 *        literal), so any value is valid → Save is
 *        always available once a mode is chosen. MONEY: re-validated server-side
 *        (BOUNTY_OUT_OF_RANGE), and the fee price is stamped by the server, never
 *        sent from here.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx
 *          (PricingModeStep, BountyStep);
 *        src/features/vehicles/post/api/editSectionApi.ts (saveBounty);
 *        docs/decisions/ADR-0014-no-bounty-listings.md.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { saveBounty } from '../../post/api/editSectionApi';
import {
  BountyStep,
  DEFAULT_BOUNTY_PENCE,
  PricingModeStep,
} from '../../post/components/postSteps';
import type { PostACarAnswers } from '../../post';
import { spacing } from '@/shared/theme';

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
    // The post's null bounty IS its pricing mode (ADR-0014) — the same
    // discriminator the rest of the app reads, so the editor opens on the truth
    // rather than on a guess.
    pricingMode: post.bountyPence === null ? 'fee' : 'bounty',
    // Seed the slider even in fee mode, so choosing "offer a reward" lands on a
    // sensible figure instead of an empty control.
    bountyAmountPence: post.bountyPence ?? DEFAULT_BOUNTY_PENCE,
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  const noReward = answers.pricingMode === 'fee';

  return (
    <PostSectionEditor
      title="Reward"
      onClose={onClose}
      onSaved={onSaved}
      canSave
      // MONEY: null is the no-reward mode. Sending the slider's retained value
      // in fee mode would silently re-add a bounty the owner just removed.
      onSave={() =>
        saveBounty(post.id, noReward ? null : (answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE))
      }
    >
      <View style={styles.stack}>
        <PricingModeStep answers={answers} setAnswers={setAnswers} />
        {noReward ? null : <BountyStep answers={answers} setAnswers={setAnswers} />}
      </View>
    </PostSectionEditor>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
});
