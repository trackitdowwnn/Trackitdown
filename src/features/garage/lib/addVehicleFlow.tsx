/**
 * WHAT:  The add-a-car WizardFlow — one phase: the SHARED vehicle-identity
 *        steps, then the plate, then an optional nickname. Plus the empty
 *        initial answers.
 * WHY:   This is the whole point of the shared slice: the garage collects
 *        exactly what the posting wizard's `car` phase collects, so it spreads
 *        `buildVehicleSteps()` in rather than restating seven steps that would
 *        drift. The ONLY differences are the two garage-only steps either side
 *        and `minPhotos: 0` — adding a car must stay a 60-second job or nobody
 *        does it, and posting re-demands 3–6 later, so a sparse saved car is
 *        never posted short.
 *
 *        Deliberately ONE phase with no intro: this is a calm peacetime task,
 *        not the posting wizard's "Sorry this happened" moment. A phase without
 *        an intro contributes only its steps (navigation.ts), which is the same
 *        speed-flow shape report-sighting uses.
 * LINKS: src/features/vehicles/post/lib/vehicleSteps.tsx (the shared seven);
 *        src/features/garage/components/garageSteps.tsx (plate + nickname);
 *        src/features/garage/screens/AddVehicleScreen.tsx (renders this).
 */

import { z } from 'zod';

import { buildVehicleSteps } from '@/features/vehicles';
import type { WizardFlow } from '@/shared/wizard';

import { NicknameStep, PlateStep } from '../components/garageSteps';
import { PhotosWithPlateScanStep } from '../components/PhotosWithPlateScanStep';
import type { AddVehicleAnswers } from '../types';

/** Everything starts empty — there is no equivalent of the bounty seed here. */
export const ADD_VEHICLE_INITIAL_ANSWERS: Partial<AddVehicleAnswers> = {};

export function buildAddVehicleFlow(): WizardFlow<AddVehicleAnswers> {
  return {
    id: 'add-vehicle',
    finalCtaLabel: 'Save to my garage',
    review: { title: 'Check your car' },
    phases: [
      {
        id: 'vehicle',
        title: 'Your car',
        steps: [
          // The SHARED slice — identical to the posting wizard's `car` phase.
          // minPhotos: 0 because a photo-less saved car is still worth having.
          //
          // ...except the photos step, whose COMPONENT is swapped for the
          // garage's wrapper, so the photos an owner adds are quietly read for
          // a registration. The swap lives HERE rather than as an option on
          // buildVehicleSteps because `features/vehicles` must not learn that
          // plates or the garage exist (ARCHITECTURE rule 1) — and this way the
          // posting wizard's photo step is untouched BY CONSTRUCTION, not by a
          // flag someone could later flip.
          ...buildVehicleSteps<AddVehicleAnswers>({ minPhotos: 0 }).map((step) =>
            step.id === 'photos' ? { ...step, component: PhotosWithPlateScanStep } : step,
          ),
          {
            // Plate AFTER the photos (moved 2026-08-02; it used to be first).
            // The scan reads the photos an owner adds anyway, so asking first
            // meant typing a registration that was about to be offered for
            // free. Asking after means the question is only ever put to people
            // the scan could not answer it for.
            //
            // And when it DID answer — a reading the owner confirmed — `when`
            // walks straight past this step. It stays on the review screen, so
            // a misread is still correctable; `plateFromScan` rather than a
            // non-empty `plate`, so editing a saved car still reaches it.
            id: 'plate',
            question: "What's the number plate?",
            helper: 'Optional — you can add it later.',
            component: PlateStep,
            optional: true,
            when: (answers) => !answers.plateFromScan,
            schema: z.object({ plate: z.string().trim().min(1) }),
            reviewLabel: 'Plate',
            reviewValue: (answers) => answers.plate?.trim() || 'Not provided',
          },
          {
            id: 'nickname',
            question: 'Give it a name?',
            helper: 'Optional.',
            component: NicknameStep,
            optional: true,
            schema: z.object({ nickname: z.string().trim().min(1) }),
            reviewLabel: 'Nickname',
            reviewValue: (answers) => answers.nickname?.trim() || 'Not provided',
          },
        ],
      },
    ],
  };
}
