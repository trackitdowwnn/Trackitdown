/**
 * WHAT:  The post-a-car WizardFlow — the config table that turns the step
 *        components into the 3-phase / review flow: phase intros, per-step
 *        questions, zod gating, review labels/values, and the plate step's
 *        onContinue availability check. Plus the initial answers (a sensible
 *        starting bounty so the slider and its schema begin valid).
 * WHY:   Flows are DATA, not code (the framework renders everything else). One
 *        readable table keeps the whole flow — order, gating, review copy — in
 *        one auditable place. DVLA lookup is stubbed this build, so the plate
 *        step's onContinue only re-checks availability (create_post re-validates
 *        everything at submit); the manual make/model/colour/year path is what
 *        ships. Copy follows DESIGN_SYSTEM tone — calm, practical, no dwelling.
 * LINKS: src/features/vehicles/post/components/postSteps.tsx (the components);
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (renders this);
 *        src/features/vehicles/post/lib/featureTaxonomy.ts (feature labels);
 *        src/features/vehicles/post/api/postApi.ts (checkPlateAvailable).
 */

import { z } from 'zod';

import { photoListSchema } from '@/shared/ui';
import { formatDateTimeLabel } from '@/shared/lib/dateTimeLabel';
// Direct path (not the '@/shared/lib' barrel) to keep this config's module graph
// off the supabase client, mirroring the dateTimeLabel import above.
import { formatPounds } from '@/shared/lib/money';
import type { WizardFlow } from '@/shared/wizard';

import { checkPlateAvailable, plateCanon } from './api/postApi';
import {
  BountyStep,
  CarDetailsStep,
  FeaturesStep,
  LastSeenWhenStep,
  LastSeenWhereStep,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
  DEFAULT_BOUNTY_PENCE,
  PhotosStep,
  PlateStep,
  TheftContextStep,
  VerificationStep,
} from './components/postSteps';
import { featureLabel } from './lib/featureTaxonomy';
import type { PostACarAnswers } from './types';

const photoShape = z.object({
  uri: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

/** Seed the slider mid-range so the bounty step starts valid and non-dirty. */
export const POST_A_CAR_INITIAL_ANSWERS: Partial<PostACarAnswers> = {
  featureKeys: [],
  bountyAmountPence: DEFAULT_BOUNTY_PENCE,
};

export const postACarFlow: WizardFlow<PostACarAnswers> = {
  id: 'post-a-car',
  finalCtaLabel: 'Post my car',
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
      steps: [
        {
          id: 'plate',
          question: "What's the number plate?",
          helper: "Optional — leave it blank if you don't have it, and we'll use the make and model instead.",
          component: PlateStep,
          // Optional: an empty canon (blank / punctuation-only) advances as
          // plate-less; a real plate must be 2–8 alphanumerics, matching the
          // server format gate. create_post re-validates + normalises at submit.
          schema: z.object({
            plate: z
              .string()
              .refine(
                (value) => {
                  const canon = plateCanon(value);
                  if (canon.length === 0) return true; // blank / punctuation → plate-less
                  // A real plate: 2–8 alphanumerics AND a bounded raw length
                  // (rejects padded junk like "AB----…"; posts.plate CHECK ≤ 15).
                  return canon.length >= 2 && canon.length <= 8 && value.trim().length <= 15;
                },
                { message: 'Enter a valid plate, or leave it blank' },
              )
              .optional(),
          }),
          // DVLA lookup is stubbed; onContinue re-checks availability ONLY when a
          // real plate was entered, so the owner learns early about a duplicate.
          onContinue: async (answers) => {
            if (plateCanon(answers.plate).length > 0) {
              await checkPlateAvailable((answers.plate ?? '').trim());
            }
          },
          reviewLabel: 'Number plate',
          reviewValue: (answers) =>
            plateCanon(answers.plate).length > 0 ? (answers.plate ?? '').trim() : 'No plate',
        },
        {
          id: 'details',
          question: 'Tell us about the car',
          component: CarDetailsStep,
          schema: z.object({
            make: z.string().trim().min(1),
            model: z.string().trim().min(1),
            colour: z.string().trim().min(1),
            // Bounded to the posts.year CHECK (1900–2100) so an out-of-range
            // year is caught here, not as a raw CHECK violation at submit.
            year: z.number().int().min(1900).max(2100).nullish(),
          }),
          reviewLabel: 'Car',
          reviewValue: (answers) => {
            const base = [answers.make, answers.model].filter(Boolean).join(' ');
            const colour = answers.colour ? `, ${answers.colour}` : '';
            const year = answers.year ? ` (${answers.year})` : '';
            return `${base}${colour}${year}`;
          },
        },
        {
          id: 'features',
          question: 'What makes it stand out?',
          helper: 'Pick anything that helps identify it. Optional but useful.',
          component: FeaturesStep,
          // Optional step — no field is required to advance.
          schema: z.object({}),
          reviewLabel: 'Distinguishing features',
          reviewValue: (answers) => {
            const keys = answers.featureKeys ?? [];
            const bits: string[] = [];
            if (keys.length > 0) bits.push(keys.map(featureLabel).join(', '));
            if (answers.descRecognise?.trim()) bits.push(answers.descRecognise.trim());
            return bits.length > 0 ? bits.join(' · ') : 'None added';
          },
        },
        {
          id: 'photos',
          question: 'Add photos of your car',
          helper: 'The first photo is what spotters will see. 3 to 6 photos.',
          component: PhotosStep,
          schema: z.object({ photos: photoListSchema(3, 6) }),
          reviewLabel: 'Photos',
          reviewValue: (answers) => `${answers.photos?.length ?? 0} added`,
        },
      ],
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
          helper: 'Move the map to the last place you saw it.',
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
          id: 'theft-context',
          question: 'What else can you tell us?',
          helper: 'Optional — "keys taken" tells spotters it\'s likely being driven, which helps them look.',
          component: TheftContextStep,
          schema: z.object({}),
          reviewLabel: 'Theft details',
          reviewValue: (answers) => {
            const from = answers.stolenFrom
              ? { driveway: 'Driveway', street: 'Street', car_park: 'Car park', other: 'Other' }[
                  answers.stolenFrom
                ]
              : null;
            const keys =
              answers.keysTaken === 'yes'
                ? 'keys taken'
                : answers.keysTaken === 'no'
                  ? 'keys not taken'
                  : null;
            const parts = [from, keys].filter(Boolean);
            if (answers.descDrives?.trim()) parts.push(answers.descDrives.trim());
            return parts.length > 0 ? parts.join(' · ') : 'Not added';
          },
        },
      ],
    },
    {
      id: 'bounty-proof',
      title: 'Bounty and proof',
      intro: {
        headline: 'Set the reward',
        body: 'Set a reward for the spotter who finds it, and confirm the car is yours.',
      },
      steps: [
        {
          id: 'bounty',
          question: 'Set a bounty',
          helper: 'Held safely in escrow — only paid out when your car is recovered.',
          component: BountyStep,
          schema: z.object({
            bountyAmountPence: z.number().int().min(MIN_BOUNTY_PENCE).max(MAX_BOUNTY_PENCE),
          }),
          reviewLabel: 'Bounty',
          reviewValue: (answers) =>
            answers.bountyAmountPence ? formatPounds(answers.bountyAmountPence) : '',
        },
        {
          id: 'verification',
          question: 'Confirm the car is yours',
          helper: 'Upload your V5C logbook. A moderator checks it before your post goes live.',
          component: VerificationStep,
          schema: z.object({ verification: photoShape }),
          reviewLabel: 'Proof of ownership',
          reviewValue: (answers) => (answers.verification ? 'V5C uploaded' : ''),
        },
      ],
    },
  ],
};
