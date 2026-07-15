/**
 * WHAT:  The report-sighting WizardFlow — one intro-less phase, four steps
 *        (safety gate → photos → context → confirm), no built-in review
 *        (the confirm step IS the review), final CTA "Send report".
 * WHY:   A SPEED flow: the spotter may be near the vehicle, so the config is
 *        the framework's lightest shape — no phase intros, one optional step,
 *        per-step funnel logging via onContinue. The safety step gates on an
 *        always-true schema (fast to pass, impossible to skip); the photos
 *        step derives the coarse area label on continue so the confirm screen
 *        can say where the report reads as from.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (the screens);
 *        src/features/sightings/screens/ReportSightingScreen.tsx (renders);
 *        src/features/sightings/lib/areaLabel.ts; docs/DOMAIN.md.
 */

import { z } from 'zod';

import { createLogger } from '@/shared/lib/logger';
import type { WizardFlow } from '@/shared/wizard';

import { ConfirmStep, ContextStep, PhotosStep, SafetyStep } from './components/sightingSteps';
import { deriveAreaLabel } from './lib/areaLabel';
import {
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  MIN_SIGHTING_PHOTOS,
  SIGHTING_CONTEXT_FLAGS,
  type ReportSightingAnswers,
} from './types';

const log = createLogger('sightings');

const evidenceShape = z
  .object({
    uri: z.string().min(1),
    capturedAt: z.string().min(1),
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracyM: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
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
      // No intro — this is a speed flow; the safety gate is screen one.
      steps: [
        {
          id: 'safety',
          question: 'Before you report',
          helper: 'Three seconds — it matters.',
          component: SafetyStep,
          // Always valid: the gate is about READING, not input. It cannot be
          // skipped (it is the first screen) but must never cost time.
          schema: z.object({}),
          ctaLabel: 'Continue',
          onContinue: async () => {
            log.info('step_completed', { step: 'safety' });
          },
        },
        {
          id: 'photos',
          question: 'Photograph the car',
          helper: 'From a distance. One photo is enough — three max.',
          component: PhotosStep,
          schema: z.object({
            photos: z.array(evidenceShape).min(MIN_SIGHTING_PHOTOS).max(MAX_SIGHTING_PHOTOS),
          }),
          ctaLabel: 'Continue',
          // Derive the coarse area label from the first located photo now so
          // the confirm screen renders instantly. Never blocks: null is fine.
          onContinue: async (answers) => {
            const areaLabel = await deriveAreaLabel(answers.photos ?? []);
            log.info('step_completed', {
              step: 'photos',
              photoCount: answers.photos?.length ?? 0,
              located: Boolean(areaLabel) || (answers.photos ?? []).some((p) => p.lat !== undefined),
            });
            return { areaLabel: areaLabel ?? undefined };
          },
        },
        {
          id: 'context',
          question: 'Anything else that helps?',
          helper: 'All optional — continue straight past if not.',
          component: ContextStep,
          // Everything optional: an empty step must never cost a report.
          schema: z.object({
            contextFlags: z.array(z.enum(SIGHTING_CONTEXT_FLAGS)).optional(),
            note: z.string().max(MAX_NOTE_LENGTH).optional(),
          }),
          ctaLabel: 'Continue',
          onContinue: async (answers) => {
            log.info('step_completed', {
              step: 'context',
              flags: answers.contextFlags?.length ?? 0,
              hasNote: Boolean(answers.note?.trim()),
            });
          },
        },
        {
          id: 'confirm',
          question: 'Check and send',
          component: ConfirmStep,
          // The final gate re-asserts the photo rule; send itself is the
          // screen's onComplete (submitSighting).
          schema: z.object({
            photos: z.array(evidenceShape).min(MIN_SIGHTING_PHOTOS).max(MAX_SIGHTING_PHOTOS),
          }),
        },
      ],
    },
  ],
};
