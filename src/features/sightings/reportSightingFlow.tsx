/**
 * WHAT:  The report-sighting WizardFlow — one intro-less phase: photos, then
 *        the optional context one question per step (state → staying /
 *        direction → people → condition → damage → parts → marks → note,
 *        2026-10-20; damage, after "Damage visible", and parts, after "Missing
 *        panels or parts", 2026-10-21), then
 *        confirm. No built-in review (the confirm step IS the review), final
 *        CTA "Send report". The safety gate comes BEFORE it, as
 *        ReportSafetySheet (2026-09-30).
 * WHY:   A SPEED flow: the spotter may be near the vehicle, so the config is
 *        the framework's lightest shape — no phase intros, every context step
 *        optional with Skip, a single pick moving on by itself, per-step
 *        funnel logging via onContinue. The photos step derives
 *        the coarse area label on continue so the confirm screen can say
 *        where the report reads as from.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (photos);
 *        src/features/sightings/components/contextSteps.tsx (the context);
 *        src/features/sightings/lib/contextAnswers.ts (its rules);
 *        src/features/sightings/components/ConfirmStep.tsx (check and send);
 *        src/features/sightings/screens/ReportSightingScreen.tsx (renders);
 *        src/features/sightings/lib/areaLabel.ts; docs/DOMAIN.md.
 */

import { z } from 'zod';

import { createLogger } from '@/shared/lib/logger';
import type { WizardStep, WizardFlow } from '@/shared/wizard';

import { ConfirmStep, REPORT_PRIVACY_LINE } from './components/ConfirmStep';
import {
  ConditionStep,
  DamageStep,
  DirectionStep,
  MarksStep,
  NoteStep,
  PartsStep,
  PeopleStep,
  StateStep,
  StayingStep,
} from './components/contextSteps';
import { PhotosStep } from './components/sightingSteps';
import { derivePlaceLabels } from './lib/areaLabel';
import {
  CONTEXT_STEP_IDS,
  hasDamage,
  hasMissingParts,
  isMoving,
  isParked,
  stepApplies,
  stepTouched,
  type ContextStepId,
} from './lib/contextAnswers';
import { CONTEXT_STEP_QUESTIONS, contextDetailCount } from './lib/contextLabels';
import { cleanSpotterWords } from './lib/withdrawReasons';
import {
  DAMAGE_KINDS,
  DRIVING_DIRECTIONS,
  MAX_DAMAGE_NOTE_LENGTH,
  MAX_MISSING_PARTS_NOTE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  MIN_SIGHTING_PHOTOS,
  MISSING_PARTS,
  PARKED_LIKELIHOOD,
  PEOPLE_PRESENCE,
  SIGHTING_CONTEXT_FLAGS,
  type ReportSightingAnswers,
} from './types';

const log = createLogger('sightings');

const contextFlagsSchema = z.array(z.enum(SIGHTING_CONTEXT_FLAGS)).optional();

/**
 * One optional context step: its question from contextLabels, shown only
 * where it applies (stepApplies — the one source "Add details" reads too),
 * and "Skip" until answered then "Continue". `rest` adds the step's own parts.
 *
 * ⚠️ NO onContinue here: the wizard runs one as a busy action, so every Skip
 * flashed a spinner and dropped Back for a frame — seven times in a row. The
 * funnel reads ONE event instead, from the last step (see `note`).
 */
function contextStep(
  id: ContextStepId,
  rest: Omit<WizardStep<ReportSightingAnswers>, 'id' | 'question'>,
): WizardStep<ReportSightingAnswers> {
  return {
    id,
    question: CONTEXT_STEP_QUESTIONS[id],
    optional: true,
    when: (answers) => stepApplies(answers, id),
    ctaLabel: (answers) => (stepTouched(answers, id) ? 'Continue' : 'Skip'),
    ...rest,
  };
}

const evidenceShape = z
  .object({
    uri: z.string().min(1),
    capturedAt: z.string().min(1),
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracyM: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    source: z.enum(['live', 'gallery']).optional(),
  })
  // A located photo is located by a complete fix: lat and lng arrive together
  // or not at all (mirrors the sighting_photos both-or-neither CHECK).
  // CameraCapture already spreads the fix atomically; this stops any future
  // caller from half-locating a photo client-side.
  .refine((photo) => (photo.lat === undefined) === (photo.lng === undefined), {
    message: 'lat and lng must both be set or both be absent',
  })
  // ...and accuracy only makes sense ON a located photo (mirrors the
  // sighting_photos accuracy-located CHECK; sightingApi re-checks at submit).
  .refine((photo) => photo.accuracyM === undefined || photo.lat !== undefined, {
    message: 'accuracyM is only allowed on a located photo',
  })
  // ADR-0003: a gallery photo carries no location, ever.
  .refine((photo) => photo.source !== 'gallery' || photo.lat === undefined, {
    message: 'a gallery photo carries no location',
  });

/** ADR-0003 rule 1 (the wizard's gate; sightingApi and the RPC re-enforce):
 *  1–3 photos, at least one a LIVE in-app capture. */
const evidencePhotos = z
  .array(evidenceShape)
  .min(MIN_SIGHTING_PHOTOS)
  .max(MAX_SIGHTING_PHOTOS)
  .refine((photos) => photos.some((photo) => photo.source !== 'gallery'), {
    message: 'At least one photo must be taken in the app',
  });

export const REPORT_SIGHTING_INITIAL_ANSWERS: Partial<ReportSightingAnswers> = {
  photos: [],
  contextFlags: [],
  note: '',
};

export const reportSightingFlow: WizardFlow<ReportSightingAnswers> = {
  id: 'report-sighting',
  finalCtaLabel: 'Send report',
  phases: [
    {
      id: 'report',
      title: 'Report a sighting',
      // No intro — this is a speed flow. The safety gate is NOT a step: it's
      // ReportSafetySheet, shown over the listing before this route opens (or
      // by ReportSightingScreen for a deep link), so the camera is screen one.
      // ⚠️ Don't bring it back as a `when`-hidden step 0: the navigation
      // reducer starts at index 0 without checking visibility.
      steps: [
        {
          id: 'photos',
          question: 'Photograph the car',
          helper: 'From a distance. One photo is enough — three max.',
          component: PhotosStep,
          schema: z.object({
            photos: evidencePhotos,
          }),
          ctaLabel: 'Continue',
          // Derive the coarse area label from the first located photo now so
          // the confirm screen renders instantly. Never blocks: null is fine.
          onContinue: async (answers) => {
            const { areaLabel, locality } = await derivePlaceLabels(answers.photos ?? []);
            log.info('step_completed', {
              step: 'photos',
              photoCount: answers.photos?.length ?? 0,
              located: Boolean(areaLabel) || (answers.photos ?? []).some((p) => p.lat !== undefined),
            });
            return { areaLabel: areaLabel ?? undefined, locality: locality ?? undefined };
          },
        },
        // The optional context, ONE QUESTION PER STEP, as cards (owner,
        // 2026-10-20; one page of chips before). Every one is optional — an
        // empty answer must never cost a report, and `optional` keeps the
        // final gate from demanding it — and labelled for what it will do:
        // "Skip" until answered, then "Continue". The rules that tie them
        // together are lib/contextAnswers'; what is sent is unchanged.
        contextStep('state', {
          helper: 'All optional.',
          component: StateStep,
          schema: z.object({ contextFlags: contextFlagsSchema }),
          // Changing what it was doing from Confirm asks its follow-up too.
          editContinuesTo: (answers) =>
            isParked(answers) ? 'staying' : isMoving(answers) ? 'direction' : undefined,
        }),
        contextStep('staying', {
          component: StayingStep,
          schema: z.object({ parkedLikelihood: z.enum(PARKED_LIKELIHOOD).optional() }),
        }),
        contextStep('direction', {
          helper: 'Tap where it went.',
          component: DirectionStep,
          schema: z.object({ direction: z.enum(DRIVING_DIRECTIONS).optional() }),
        }),
        contextStep('people', {
          component: PeopleStep,
          schema: z.object({ peoplePresence: z.enum(PEOPLE_PRESENCE).optional() }),
        }),
        contextStep('condition', {
          helper: 'Any that apply.',
          component: ConditionStep,
          schema: z.object({ contextFlags: contextFlagsSchema }),
          // Ticking "Damage visible" from Confirm asks what damage too.
          editContinuesTo: (answers) => (hasDamage(answers) ? 'damage' : undefined),
        }),
        // "Damage visible"'s follow-up, its own step as Parked's is (owner,
        // 2026-10-21). The words are the spotter's own, unmoderated: never
        // logged (the funnel event below carries only whether there are any).
        contextStep('damage', {
          helper: 'Any you can see from where you are.',
          component: DamageStep,
          schema: z.object({
            damageKinds: z.array(z.enum(DAMAGE_KINDS)).optional(),
            damageNote: z.string().max(MAX_DAMAGE_NOTE_LENGTH).optional(),
          }),
          // Ticking "Missing panels or parts" from Confirm asks which, too —
          // also when the edit opened on the condition (follow-ups chain forward).
          editContinuesTo: (answers) => (hasMissingParts(answers) ? 'parts' : undefined),
        }),
        // "Missing panels or parts"'s follow-up, its own step as the damage
        // step is (owner, 2026-10-21). The same rules: never logged.
        contextStep('parts', {
          helper: 'Any you can see from where you are.',
          component: PartsStep,
          schema: z.object({
            missingParts: z.array(z.enum(MISSING_PARTS)).optional(),
            missingPartsNote: z.string().max(MAX_MISSING_PARTS_NOTE_LENGTH).optional(),
          }),
        }),
        contextStep('marks', {
          helper: 'The owner’s marks. Tick any you could see from where you were.',
          component: MarksStep,
          schema: z.object({ confirmedFeatureIds: z.array(z.string()).optional() }),
        }),
        contextStep('note', {
          helper: 'What you noticed. A line is plenty.',
          component: NoteStep,
          schema: z.object({ note: z.string().max(MAX_NOTE_LENGTH).optional() }),
          // The context's ONE funnel event (no per-step onContinue — see
          // contextStep): the old one-page step's summary, plus which steps
          // were answered ("Not sure" counts) and which were walked past.
          onContinue: async (answers) => {
            log.info('context_summary', {
              details: contextDetailCount(answers),
              flags: answers.contextFlags?.length ?? 0,
              hasNote: Boolean(answers.note?.trim()),
              // How many kinds, and whether they added words — never the words.
              damageKinds: answers.damageKinds?.length ?? 0,
              // Judged as it is sent: blank-looking words are no words.
              hasDamageNote: cleanSpotterWords(answers.damageNote) !== null,
              missingParts: answers.missingParts?.length ?? 0,
              hasMissingPartsNote: cleanSpotterWords(answers.missingPartsNote) !== null,
              unsure: answers.contextUnsure?.length ?? 0,
              answered: CONTEXT_STEP_IDS.filter(
                (id) => stepApplies(answers, id) && stepTouched(answers, id),
              ),
            });
          },
        }),
        {
          id: 'confirm',
          question: 'Check and send',
          component: ConfirmStep,
          // Who sees what, beside the commitment (one short true sentence;
          // a long assurance reads as a warning).
          footerNote: REPORT_PRIVACY_LINE,
          // The final gate re-asserts the photo rule (incl. ≥1 live); send
          // itself is the screen's onComplete (submitSighting).
          schema: z.object({
            photos: evidencePhotos,
          }),
        },
      ],
    },
  ],
};
