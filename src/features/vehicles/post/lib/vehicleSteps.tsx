/**
 * WHAT:  The shared VEHICLE-IDENTITY step list — make, model, colour, body type,
 *        year, distinctive features, photos — plus the `VehicleAnswers` slice
 *        they read and write. Built by `buildVehicleSteps()` so each consumer can
 *        set the one thing that legitimately differs: how many photos it demands.
 * WHY:   The posting wizard's `car` phase and the garage's add-a-car flow collect
 *        EXACTLY the same data, and two copies of a seven-step table would drift
 *        the moment either changed — a car saved in the garage would stop being a
 *        car you could post. So this table lives here once and both flows spread
 *        it in. It sits in features/vehicles (not features/garage) because
 *        vehicles already owns the step components and the answer type; the
 *        garage imports it, and vehicles must never import the garage back or the
 *        two features form a cycle (ARCHITECTURE.md rule 1).
 *
 *        NOT a wizard-framework change: these are plain data. `shared/wizard`
 *        gains no notion of sub-flows or conditional steps, so the money flow's
 *        navigation is untouched.
 * LINKS: src/features/vehicles/post/postACarFlow.tsx (consumer — phase `car`);
 *        src/features/garage/lib/addVehicleFlow.tsx (consumer);
 *        src/features/vehicles/post/components/postSteps.tsx (the components);
 *        src/features/garage/README.md (why the slice is shared).
 */

import { z } from 'zod';

import { photoListSchema, type PickedPhoto } from '@/shared/ui';
import type { WizardStep } from '@/shared/wizard';

import {
  BodyTypeStep,
  ColourStep,
  DistinctiveFeaturesStep,
  MakeStep,
  ModelStep,
  PhotosStep,
  YearStep,
} from '../components/postSteps';
import type { DistinctiveFeature } from './distinctiveFeatures';

/**
 * The answer fields the vehicle-identity steps own. Both `PostACarAnswers` and
 * the garage's `AddVehicleAnswers` extend this, which is what lets one step
 * table serve both flows: a step typed against the slice accepts any answers
 * object that contains it.
 */
export interface VehicleAnswers {
  make: string;
  model: string;
  /** Canonical colour NAME from the swatch grid (a clean enum, not a hex). */
  colour: string;
  /** Free-text specifics for an escape colour ("Multicolour / wrapped"). */
  colourNote: string;
  year: number | null;
  bodyType: string | null;
  distinctiveFeatures: DistinctiveFeature[];
  photos: PickedPhoto[];
}

export interface VehicleStepsOptions {
  /**
   * Minimum photos before the photos step's Next unlocks.
   *
   * POSTING passes 3: a spotter needs several angles to recognise a car.
   * The GARAGE passes 0 — adding a car must stay a 60-second job or nobody
   * does it, and a saved car with too few photos simply keeps the real photos
   * step when it is later used to start a post (it is never posted short).
   */
  minPhotos: number;
  /** Maximum photos; 6 everywhere today (create_post's PHOTO_COUNT ceiling). */
  maxPhotos?: number;
}

/**
 * The seven vehicle-identity steps, in order. Generic over the consuming flow's
 * answers so each flow's own fields stay visible to its other steps.
 */
export function buildVehicleSteps<TAnswers extends VehicleAnswers>({
  minPhotos,
  maxPhotos = 6,
}: VehicleStepsOptions): WizardStep<TAnswers>[] {
  const steps: WizardStep<VehicleAnswers>[] = [
    {
      // Make — the full-screen searchable picker (MakeField) earns a screen;
      // make is always collected (create_post requires make/model/colour).
      id: 'make',
      question: 'What make is your car?',
      component: MakeStep,
      schema: z.object({ make: z.string().trim().min(1) }),
      reviewLabel: 'Make',
      reviewValue: (answers) => answers.make ?? '',
    },
    {
      // Model — dependent on the make: the picker lists that make's models (free
      // text for an unlisted make). Changing the make clears the model
      // (makeChangePatch), so this step re-gates as incomplete. The title folds
      // in the chosen make ("Which BMW model?").
      id: 'model',
      question: (answers) =>
        answers.make?.trim() ? `Which ${answers.make.trim()} model?` : 'Which model?',
      component: ModelStep,
      schema: z.object({ model: z.string().trim().min(1) }),
      reviewLabel: 'Model',
      reviewValue: (answers) => answers.model ?? '',
    },
    {
      // Colour — a named-swatch grid producing a canonical colour NAME. The
      // escape colours capture a free-text note stored separately (colourNote →
      // owner_note), keeping the colour value a clean enum for cards and filters.
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
      // Body type — icon cards (CardSelect). REQUIRED: Next is gated on a pick;
      // a "Not sure" card is the escape for an owner who doesn't know.
      id: 'body-type',
      question: 'What type of car is it?',
      component: BodyTypeStep,
      schema: z.object({ bodyType: z.string().trim().min(1) }),
      reviewLabel: 'Body type',
      reviewValue: (answers) => answers.bodyType?.trim() || 'Not provided',
    },
    {
      // Year — optional. Bounded to the posts.year CHECK (1900–2100) so an
      // out-of-range year is caught here, not as a raw CHECK violation at submit.
      id: 'year',
      question: 'What year is it?',
      component: YearStep,
      schema: z.object({ year: z.number().int().min(1900).max(2100).nullish() }),
      reviewLabel: 'Year',
      reviewValue: (answers) => (answers.year ? String(answers.year) : 'Not provided'),
    },
    {
      // Distinctive features — owner photo+description evidence pairs. Optional
      // (many cars have none). Next requires at least one; a car with none uses
      // the "None to add" link. `optional` so skipping never blocks the final CTA
      // — the schema gates only THIS step's Next, not submission.
      id: 'distinctive-features',
      question: 'Any distinctive features?',
      component: DistinctiveFeaturesStep,
      optional: true,
      schema: z.object({ distinctiveFeatures: z.array(z.unknown()).min(1) }),
      reviewLabel: 'Distinctive features',
      reviewValue: (answers) => {
        const count = answers.distinctiveFeatures?.length ?? 0;
        return count > 0 ? `${count} added` : 'None added';
      },
    },
    {
      id: 'photos',
      question: 'Add photos of your car',
      component: PhotosStep,
      schema: z.object({ photos: photoListSchema(minPhotos, maxPhotos) }),
      // Zero required (the garage) means the step must not block its own Next.
      optional: minPhotos === 0,
      reviewLabel: 'Photos',
      reviewValue: (answers) => `${answers.photos?.length ?? 0} added`,
    },
  ];

  // The ONE cast in this feature, and it is a widening, not a lie. Every step
  // above is typed WizardStep<VehicleAnswers> and its component takes
  // VehicleStepProps, so the COMPILER has already proved none of them can read
  // or write a field outside the shared slice — and TAnswers is constrained to
  // contain that slice. TypeScript still refuses the assignment because
  // `setAnswers: (patch: Partial<T>) => void` makes WizardStep invariant in T,
  // so it cannot see that a step which only ever patches vehicle fields is safe
  // for any wider answers object. Narrowing this cast away would mean making
  // setAnswers covariant, which would be unsound for real.
  return steps as unknown as WizardStep<TAnswers>[];
}
