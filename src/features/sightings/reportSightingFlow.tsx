/**
 * WHAT:  The report-sighting WizardFlow — one intro-less phase, three steps
 *        (photos → context → confirm), no built-in review (the confirm step
 *        IS the review), final CTA "Send report". The safety gate comes
 *        BEFORE it, as ReportSafetySheet (2026-09-30).
 * WHY:   A SPEED flow: the spotter may be near the vehicle, so the config is
 *        the framework's lightest shape — no phase intros, one optional step,
 *        per-step funnel logging via onContinue. The photos step derives
 *        the coarse area label on continue so the confirm screen can say
 *        where the report reads as from.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (photos,
 *        context); src/features/sightings/components/ConfirmStep.tsx (check
 *        and send);
 *        src/features/sightings/screens/ReportSightingScreen.tsx (renders);
 *        src/features/sightings/lib/areaLabel.ts; docs/DOMAIN.md.
 */

import { z } from 'zod';

import { createLogger } from '@/shared/lib/logger';
import type { WizardFlow } from '@/shared/wizard';

import { ConfirmStep, REPORT_PRIVACY_LINE } from './components/ConfirmStep';
import { ContextStep, PhotosStep } from './components/sightingSteps';
import { derivePlaceLabels } from './lib/areaLabel';
import { contextDetailCount } from './lib/contextLabels';
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
        {
          id: 'context',
          question: 'Anything else that helps?',
          helper: 'All optional. Tap what you saw.',
          component: ContextStep,
          // Everything optional: an empty step must never cost a report, and
          // `optional` keeps the final gate from ever demanding it. ONE way on
          // (2026-10-01): the footer says "Skip" until something is added, then
          // "Continue", so it is always labelled for what it will do.
          optional: true,
          ctaLabel: (answers) => (contextDetailCount(answers) > 0 ? 'Continue' : 'Skip'),
          schema: z.object({
            contextFlags: z.array(z.enum(SIGHTING_CONTEXT_FLAGS)).optional(),
            note: z.string().max(MAX_NOTE_LENGTH).optional(),
          }),
          onContinue: async (answers) => {
            // Skip and Continue are the same button now, so both are counted:
            // `details: 0` is a skip.
            log.info('step_completed', {
              step: 'context',
              details: contextDetailCount(answers),
              flags: answers.contextFlags?.length ?? 0,
              hasNote: Boolean(answers.note?.trim()),
              unsure: answers.contextUnsure?.length ?? 0,
            });
          },
        },
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
