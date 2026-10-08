/**
 * WHAT:  The post-a-car WizardFlow — the config table that turns the step
 *        components into the 3-phase / review flow: per-step questions, zod
 *        gating, and review labels/values. Plus the initial answers (a
 *        sensible starting bounty so the slider and its schema begin valid).
 * WHY:   Flows are DATA, not code (the framework renders everything else). One
 *        readable table keeps the whole flow — order, gating, review copy — in
 *        one auditable place. Plate capture is deferred (removed for now), so
 *        the manual make/model/colour/year path is what identifies the car;
 *        create_post re-validates everything at submit. Copy follows
 *        DESIGN_SYSTEM tone — calm, practical, no dwelling.
 *
 *        NO PHASE INTROS (2026-10-08). Three screens that only said what was
 *        coming stood between someone whose car was just stolen and the
 *        questions ("janky, slow and not smooth" — the owner chose to trim).
 *        What the first intro said that mattered is kept as ONE line on the
 *        first step (EMPATHY_LINE); the segmented progress bar shows how far
 *        through the phases they are instead.
 * LINKS: src/features/vehicles/post/components/postSteps.tsx (the components);
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (renders this);
 *        src/features/vehicles/post/api/postApi.ts (buildCreatePostParams).
 */

import { z } from 'zod';

import { formatDateTimeLabel } from '@/shared/lib/dateTimeLabel';
// Direct path (not the '@/shared/lib' barrel) to keep this config's module graph
// off the supabase client, mirroring the dateTimeLabel import above.
import { formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';
import { deriveLocalityForCoord } from '@/shared/lib/location/placeLabels';
import type { WizardFlow } from '@/shared/wizard';

import { motion } from '@/shared/theme/motion';

import { fetchBountyGuidance } from './api/bountyGuidanceApi';
import { ReviewCostPanel } from './components/ReviewCostPanel';
import {
  PREVIEW_EDIT_STEP_ID,
  ReviewListingPreview,
} from './components/ReviewListingPreview';
import {
  BountyStep,
  DescriptionStep,
  LastSeenWhenStep,
  LastSeenWhereStep,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
  DEFAULT_BOUNTY_PENCE,
  PricingModeStep,
} from './components/postSteps';
import { buildVehicleSteps } from './lib/vehicleSteps';
import type { PostACarAnswers } from './types';

/** Seed the slider mid-range so the bounty step starts valid and non-dirty.
 *  pricingMode is deliberately NOT seeded — see the pricing-mode step. */
export const POST_A_CAR_INITIAL_ANSWERS: Partial<PostACarAnswers> = {
  bountyAmountPence: DEFAULT_BOUNTY_PENCE,
};

/**
 * The one line of comfort left from the old "Sorry this happened" intro,
 * under the first question (owner's call, 2026-10-08). Post a car ONLY: the
 * garage's add-a-car flow shares these steps (buildVehicleSteps) and nothing
 * has happened to anyone there. The one exception to this flow's "no helper"
 * rule (post README).
 */
export const EMPATHY_LINE = 'Sorry this happened — let’s get the details.';

/** The shared vehicle steps, with the empathy line on the first. */
function carSteps() {
  return buildVehicleSteps<PostACarAnswers>({ minPhotos: 3 }).map((step, index) =>
    index === 0 ? { ...step, helper: EMPATHY_LINE } : step,
  );
}

export const postACarFlow: WizardFlow<PostACarAnswers> = {
  id: 'post-a-car',
  // The final CTA names the amount the owner is about to pay ("Post & pay
  // £250" / "Post & pay £5") — a payment button must never be vague about
  // the sum, and that holds for both pricing modes. Reads the current answers
  // (falls back to the seed so it's never blank). formatPounds here is DISPLAY
  // ONLY; the charge amount is server-read from the post's own price column,
  // never this label — see create-payment-intent.
  finalCtaLabel: (answers) =>
    answers.pricingMode === 'fee'
      ? `Post & pay ${formatPounds(LISTING_FEE_PENCE)}`
      : `Post & pay ${formatPounds(answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE)}`,
  review: {
    title: 'Check your report',
    // The listing preview leads, because the question this screen really asks
    // is "would a stranger recognise this car?" and a row reading
    // "Photos — 5 added" cannot answer it. Edit jumps to the photos step by
    // id, so this config never has to know its own flat index.
    header: (answers, editStep) => (
      <ReviewListingPreview
        answers={answers}
        onEditPhotos={() => editStep(PREVIEW_EDIT_STEP_ID)}
      />
    ),
    // The sum, restated where it is committed to. Everything it prints is
    // borrowed from shared/lib/money — see the panel.
    footer: (answers) => <ReviewCostPanel answers={answers} />,
  },
  phases: [
    {
      id: 'car',
      title: 'Your car',
      // The SHARED vehicle-identity slice — the same seven steps the garage
      // collects (lib/vehicleSteps.tsx). Posting demands 3–6 photos: a spotter
      // needs several angles to recognise a car.
      steps: carSteps(),
    },
    {
      id: 'when-where',
      title: 'When and where',
      steps: [
        {
          id: 'last-seen-when',
          question: 'When did you last see it?',
          component: LastSeenWhenStep,
          schema: z.object({ lastSeenAt: z.string().min(1) }),
          reviewLabel: 'Last seen',
          reviewValue: (answers) =>
            answers.lastSeenAt ? formatDateTimeLabel(answers.lastSeenAt) : '',
        },
        {
          id: 'last-seen-where',
          question: 'Where did you last see it?',
          // The map IS the step: it takes the height between the headline and
          // the footer instead of sitting in a fixed frame. See WizardStep.fills.
          fills: true,
          component: LastSeenWhereStep,
          schema: z.object({
            location: z.object({
              latitude: z.number(),
              longitude: z.number(),
              addressLabel: z.string(),
            }),
          }),
          reviewLabel: 'Last seen near',
          reviewValue: (answers) => answers.location?.addressLabel ?? '',
          // Derive the PUBLIC place grain once, here, rather than at submit.
          // SAFETY: posts.last_seen_locality is what a spotter-alert push is
          // allowed to name; lastSeenArea (the label above) is the raw
          // reverse-geocode and can be street-grain — for a driveway theft
          // that is the victim's own street. Never blocks: the helper swallows
          // geocode failures and the column is nullable, so the push falls
          // back to "your area".
          onContinue: async (answers) => {
            if (!answers.location) return;
            return { lastSeenLocality: await deriveLocalityForCoord(answers.location) };
          },
        },
        {
          // Free-text description of the car (→ desc_recognise), shown in the
          // post detail's "About this car" section. Optional; the wizard's old
          // theft-context chips (stolen-from / keys-taken) moved off the flow —
          // they stay editable post-hoc via the post's theft-context pencil.
          id: 'description',
          question: 'Describe your car',
          component: DescriptionStep,
          // Next needs 20+ characters — a two-word description helps nobody
          // pick this car out of a car park. Max mirrors posts.desc_recognise's
          // own CHECK (1000), so the client can never compose a row the
          // database will reject.
          schema: z.object({
            descRecognise: z.string().trim().min(20).max(1000),
          }),
          // ...but the step is SKIPPABLE, so that minimum gates the Next button
          // WITHOUT trapping someone who has nothing to add: `optional` is what
          // stops the review screen re-checking this schema at submit. Without
          // it a skipped description could never be posted at all.
          optional: true,
          reviewLabel: 'Description',
          reviewValue: (answers) => answers.descRecognise?.trim() || 'Not added',
        },
      ],
    },
    {
      id: 'bounty',
      title: 'Reward',
      steps: [
        {
          id: 'pricing-mode',
          question: 'Do you want to offer a reward?',
          component: PricingModeStep,
          // No default: the owner must choose. Seeding 'bounty' would make the
          // £50 minimum feel pre-agreed, which is the barrier this change exists
          // to remove; seeding 'fee' would nudge them off a reward that makes
          // their car more likely to be found. Next stays disabled until they say.
          schema: z.object({ pricingMode: z.enum(['bounty', 'fee']) }),
          // Choosing a reward: wait a moment for the reward guidance, so the
          // next step arrives WITH it rather than having it pop in above the
          // slider (2026-10-08). Usually already here — the map step warmed
          // it — and never longer than motion.skeletonGrace; a slow answer
          // simply fades in later.
          onContinue: async (answers) => {
            if (answers.pricingMode !== 'bounty' || !answers.location) return;
            await Promise.race([
              fetchBountyGuidance(answers.location.latitude, answers.location.longitude),
              new Promise((resolve) => setTimeout(resolve, motion.skeletonGrace)),
            ]);
          },
          reviewLabel: 'Listing',
          reviewValue: (answers) =>
            answers.pricingMode === 'fee'
              ? `No reward · ${formatPounds(LISTING_FEE_PENCE)} fee`
              : 'Reward offered',
        },
        {
          id: 'bounty',
          question: 'Set a reward',
          component: BountyStep,
          // WALKED PAST entirely when there is no reward to set — the wizard's
          // own `when` gating, so the step contributes no screen and no schema
          // check. bountyAmountPence keeps whatever the slider last held, so
          // switching back restores the owner's own figure.
          when: (answers) => answers.pricingMode !== 'fee',
          // ⚠️ And no review row either — which it DID until 2026-08-22, because
          // reviewGroups filtered on reviewValue alone. bountyAmountPence is
          // seeded to £250, so a no-reward listing showed "Bounty £250" directly
          // above "Post & pay £5": a sum nobody chose and nobody would be
          // charged, on the one screen that has to be exact about money.
          //
          // Opt-in rather than the framework default, because a surviving row
          // is usually right — see `when` in shared/wizard/types.ts.
          hideReviewWhenSkipped: true,
          schema: z.object({
            bountyAmountPence: z.number().int().min(MIN_BOUNTY_PENCE).max(MAX_BOUNTY_PENCE),
          }),
          reviewLabel: 'Reward',
          reviewValue: (answers) =>
            answers.bountyAmountPence ? formatPounds(answers.bountyAmountPence) : '',
        },
      ],
    },
  ],
};
