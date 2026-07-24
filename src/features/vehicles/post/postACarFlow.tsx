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

import { photoListSchema } from '@/shared/ui';
import { formatDateTimeLabel } from '@/shared/lib/dateTimeLabel';
// Direct path (not the '@/shared/lib' barrel) to keep this config's module graph
// off the supabase client, mirroring the dateTimeLabel import above.
import { formatPounds } from '@/shared/lib/money';
import type { WizardFlow } from '@/shared/wizard';

import {
  BountyStep,
  ColourStep,
  DistinctiveMarksStep,
  LastSeenWhenStep,
  LastSeenWhereStep,
  MakeStep,
  ModelStep,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
  DEFAULT_BOUNTY_PENCE,
  PhotosStep,
  TheftContextStep,
  VerificationStep,
  YearStep,
} from './components/postSteps';
import type { PostACarAnswers } from './types';

const photoShape = z.object({
  uri: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

/** Seed the slider mid-range so the bounty step starts valid and non-dirty. */
export const POST_A_CAR_INITIAL_ANSWERS: Partial<PostACarAnswers> = {
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
          // Make — the first step of the flow. The full-screen searchable
          // picker (MakeField) earns a screen; make is always collected
          // (create_post requires make/model/colour).
          id: 'make',
          question: 'What make is your car?',
          component: MakeStep,
          schema: z.object({ make: z.string().trim().min(1) }),
          reviewLabel: 'Make',
          reviewValue: (answers) => answers.make ?? '',
        },
        {
          // Model — its own step (2026-07-23), dependent on the make: the
          // picker lists that make's models (free text for an unlisted make).
          // Changing the make clears the model (MakeStep/makeChangePatch), so
          // this step re-gates as incomplete and the review blocks submit until
          // a model under the new make is chosen. The title folds in the chosen
          // make ("Which BMW model?") so the context lives in the question
          // itself — no separate make chip in the body.
          id: 'model',
          question: (answers) =>
            answers.make?.trim() ? `Which ${answers.make.trim()} model?` : 'Which model?',
          component: ModelStep,
          schema: z.object({ model: z.string().trim().min(1) }),
          reviewLabel: 'Model',
          reviewValue: (answers) => answers.model ?? '',
        },
        {
          // Colour — its own step (2026-07-23): a named-swatch grid (ColourField)
          // producing a canonical colour NAME (a clean enum). The escape colours
          // ("Multicolour / wrapped" / "Other") capture a free-text note stored
          // separately (colourNote → owner_note), so the colour value stays a
          // clean enum for the card/detail text and future colour filters.
          id: 'colour',
          question: 'What colour is it?',
          component: ColourStep,
          schema: z.object({ colour: z.string().trim().min(1) }),
          reviewLabel: 'Colour',
          reviewValue: (answers) => {
            const colour = answers.colour ?? '';
            const noteText = answers.colourNote?.trim();
            return noteText ? `${colour} — ${noteText}` : colour;
          },
        },
        {
          // Year — its own step, optional. Bounded to the posts.year CHECK
          // (1900–2100) so an out-of-range year is caught here, not as a raw
          // CHECK violation at submit.
          id: 'year',
          question: 'What year is it?',
          component: YearStep,
          schema: z.object({
            year: z.number().int().min(1900).max(2100).nullish(),
          }),
          reviewLabel: 'Year',
          reviewValue: (answers) => (answers.year ? String(answers.year) : 'Not provided'),
        },
        {
          // Distinctive marks — owner photo+description evidence pairs (e.g.
          // "Cracked nearside wing mirror"). Optional (many cars have none);
          // each photo uploads on submit with the rest (atomic). Replaced BOTH
          // the old free-text "recognise it?" prompt AND the vehicle_feature
          // chip taxonomy step — a photographed mark identifies a car far better
          // than a checkbox. (post_feature/vehicle_feature stay for old posts;
          // create_post still accepts p_feature_keys, now always null here.)
          id: 'distinctive-marks',
          question: 'Any distinctive marks or features?',
          component: DistinctiveMarksStep,
          // Next requires at least one mark; a car with none uses the "None to
          // add" link, which advances marks-less.
          schema: z.object({ distinctiveFeatures: z.array(z.unknown()).min(1) }),
          reviewLabel: 'Distinctive marks',
          reviewValue: (answers) => {
            const count = answers.distinctiveFeatures?.length ?? 0;
            return count > 0 ? `${count} added` : 'None added';
          },
        },
        {
          id: 'photos',
          question: 'Add photos of your car',
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
          component: VerificationStep,
          schema: z.object({ verification: photoShape }),
          reviewLabel: 'Proof of ownership',
          reviewValue: (answers) => (answers.verification ? 'V5C uploaded' : ''),
        },
      ],
    },
  ],
};
