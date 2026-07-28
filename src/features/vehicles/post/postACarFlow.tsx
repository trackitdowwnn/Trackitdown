/**
 * WHAT:  The post-a-car WizardFlow — the config table that turns the step
 *        components into the 3-phase / review flow: phase intros, per-step
 *        questions, zod gating, and review labels/values. Plus the initial
 *        answers (a sensible starting bounty so the slider and its schema begin
 *        valid).
 * WHY:   Flows are DATA, not code (the framework renders everything else). One
 *        readable table keeps the whole flow — order, gating, review copy — in
 *        one auditable place. Plate capture is deferred (removed for now), so
 *        the manual make/model/colour/year path is what identifies the car;
 *        create_post re-validates everything at submit. Copy follows
 *        DESIGN_SYSTEM tone — calm, practical, no dwelling.
 * LINKS: src/features/vehicles/post/components/postSteps.tsx (the components);
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (renders this);
 *        src/features/vehicles/post/api/postApi.ts (buildCreatePostParams).
 */

import { z } from 'zod';

import { formatDateTimeLabel } from '@/shared/lib/dateTimeLabel';
// Direct path (not the '@/shared/lib' barrel) to keep this config's module graph
// off the supabase client, mirroring the dateTimeLabel import above.
import { formatPounds } from '@/shared/lib/money';
import type { WizardFlow } from '@/shared/wizard';

import {
  BountyStep,
  DescriptionStep,
  LastSeenWhenStep,
  LastSeenWhereStep,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
  DEFAULT_BOUNTY_PENCE,
} from './components/postSteps';
import { buildVehicleSteps } from './lib/vehicleSteps';
import type { PostACarAnswers } from './types';

/** Seed the slider mid-range so the bounty step starts valid and non-dirty. */
export const POST_A_CAR_INITIAL_ANSWERS: Partial<PostACarAnswers> = {
  bountyAmountPence: DEFAULT_BOUNTY_PENCE,
};

export const postACarFlow: WizardFlow<PostACarAnswers> = {
  id: 'post-a-car',
  // The final CTA takes the bounty into escrow, so it names the amount the
  // owner is about to pay ("Post & pay £250") — a payment button must never be
  // vague about the sum. Reads the current bounty answer (falls back to the
  // seed so it's never blank). formatPounds here is DISPLAY ONLY; the charge
  // amount is server-read from posts.bounty_amount_pence, never this label.
  finalCtaLabel: (answers) =>
    `Post & pay ${formatPounds(answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE)}`,
  review: { title: 'Check your report' },
  phases: [
    {
      id: 'car',
      title: 'Your car',
      intro: {
        headline: 'Sorry this happened',
        body: "Let's get the details spotters need — it takes about five minutes.",
        ctaLabel: 'Get started',
      },
      // The SHARED vehicle-identity slice — the same seven steps the garage
      // collects (lib/vehicleSteps.tsx). Posting demands 3–6 photos: a spotter
      // needs several angles to recognise a car.
      steps: buildVehicleSteps<PostACarAnswers>({ minPhotos: 3 }),
    },
    {
      id: 'when-where',
      title: 'When and where',
      intro: {
        headline: 'Where it was last seen',
        body: 'The last place and time you saw it helps spotters look in the right area.',
      },
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
        },
        {
          // Free-text description of the car (→ desc_recognise), shown in the
          // post detail's "About this car" section. Optional; the wizard's old
          // theft-context chips (stolen-from / keys-taken) moved off the flow —
          // they stay editable post-hoc via the post's theft-context pencil.
          id: 'description',
          question: 'Describe your car',
          component: DescriptionStep,
          schema: z.object({}),
          reviewLabel: 'Description',
          reviewValue: (answers) => answers.descRecognise?.trim() || 'Not added',
        },
      ],
    },
    {
      id: 'bounty',
      title: 'Bounty',
      intro: {
        headline: 'Set the reward',
        body: 'Set a reward for the spotter who finds it.',
      },
      steps: [
        {
          id: 'bounty',
          question: 'Set a bounty',
          component: BountyStep,
          schema: z.object({
            bountyAmountPence: z.number().int().min(MIN_BOUNTY_PENCE).max(MAX_BOUNTY_PENCE),
          }),
          reviewLabel: 'Bounty',
          reviewValue: (answers) =>
            answers.bountyAmountPence ? formatPounds(answers.bountyAmountPence) : '',
        },
      ],
    },
  ],
};
