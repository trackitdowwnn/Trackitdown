/**
 * WHAT:  buildPrefilledPostFlow — the post-a-car flow with its vehicle phase
 *        collapsed to a single confirm step, for a report started from a saved
 *        car. Returns the flow AND the answers to seed it with.
 * WHY:   This is the compose-two-variants approach chosen at spec review over
 *        teaching `shared/wizard` a `skipIf` predicate: the framework also
 *        powers the money flow, so it gains nothing here. Swapping one phase's
 *        step array is plain data.
 *
 *        STILL TRUE after `WizardStep.when` arrived (2026-08-02, so the garage's
 *        plate step can retire once the photo scan answers it). That predicate
 *        hides ONE step from the walk; this swaps a whole PHASE, and decides it
 *        from the saved car BEFORE the wizard mounts rather than from answers
 *        mid-flow. Rewriting this on top of `when` would mean a predicate on
 *        every one of seven steps to express one either/or.
 *
 *        "Edit" is a flow swap, not a jump: the caller re-builds with
 *        `expanded: true`, which restores the full seven steps seeded with the
 *        SAME answers. The wizard has no jump-to-step API, and adding one for
 *        this would be the framework change we deliberately avoided — whereas
 *        swapping the step array is the mechanism already in use.
 *
 *        The ONE conditional: a saved car with fewer than 3 photos cannot
 *        satisfy create_post's PHOTO_COUNT, so its real photos step is KEPT
 *        rather than summarised. Honest — and still far faster than starting
 *        cold, because everything else is already answered.
 *
 *        DEPENDENCY DIRECTION: this lives in the garage, not in
 *        features/vehicles, precisely so vehicles never has to import a
 *        SavedVehicle. The garage maps its row down to the plain VehicleAnswers
 *        shape and hands that over (ARCHITECTURE.md rule 1).
 * LINKS: src/features/garage/screens/ReportSavedCarScreen.tsx (the caller);
 *        src/features/vehicles/post/postACarFlow.tsx (the flow being adapted);
 *        src/features/garage/components/VehicleSummaryStep.tsx.
 */

import { z } from 'zod';

import { buildVehicleSteps, type PostACarAnswers } from '@/features/vehicles';
import type { WizardFlow, WizardStep } from '@/shared/wizard';

import { VehicleSummaryStep } from '../components/VehicleSummaryStep';
import type { SavedVehicle } from '../types';
import { hasEnoughPhotosToPost, toAnswers, vehicleSummaryLine } from './vehicleAnswers';

export interface PrefilledPostFlowOptions {
  /** The ordinary post-a-car flow, passed in so this stays pure and testable. */
  baseFlow: WizardFlow<PostACarAnswers>;
  /** The flow's own seed (the starting bounty) — the car's answers layer on top. */
  baseInitialAnswers: Partial<PostACarAnswers>;
  vehicle: SavedVehicle;
  /**
   * When true the vehicle phase renders its full seven steps instead of the
   * confirm. Set after the user taps Edit.
   */
  expanded: boolean;
  /** Tapping Edit on the confirm step. */
  onEdit: () => void;
}

export interface PrefilledPostFlow {
  flow: WizardFlow<PostACarAnswers>;
  initialAnswers: Partial<PostACarAnswers>;
}

export function buildPrefilledPostFlow({
  baseFlow,
  baseInitialAnswers,
  vehicle,
  expanded,
  onEdit,
}: PrefilledPostFlowOptions): PrefilledPostFlow {
  const answers = toAnswers(vehicle);
  const initialAnswers = { ...baseInitialAnswers, ...answers };

  if (expanded) {
    // The full flow, seeded — every prefilled value editable, exactly as if they
    // had typed it. This is the escape hatch that makes the prefill safe.
    return { flow: baseFlow, initialAnswers };
  }

  // The confirm step stands in for the whole identity phase. `schema: z.object({})`
  // always passes: those fields were validated when the car was saved, they are
  // seeded into the answers here, and create_post re-validates the lot at submit.
  const summaryStep: WizardStep<PostACarAnswers> = {
    id: 'vehicle-summary',
    question: 'Is this the car?',
    // NO helper, deliberately (product call 2026-07-29): the question and the
    // photo carry the moment; explanatory subtext between them slowed it
    // down. The Edit affordance sits at the top of the step body instead.
    component: () => <VehicleSummaryStep vehicle={vehicle} onEdit={onEdit} />,
    schema: z.object({}),
    ctaLabel: 'Yes, continue',
    reviewLabel: 'Car',
    reviewValue: () => vehicleSummaryLine(vehicle),
  };

  // Only the photos step survives when the saved car is short of create_post's
  // 3-photo minimum — everything else is already answered.
  const photoStep = buildVehicleSteps<PostACarAnswers>({ minPhotos: 3 }).find(
    (step) => step.id === 'photos',
  );
  const carSteps: WizardStep<PostACarAnswers>[] =
    hasEnoughPhotosToPost(vehicle) || !photoStep ? [summaryStep] : [summaryStep, photoStep];

  return {
    flow: {
      ...baseFlow,
      // The base flow's review preview offers an Edit that jumps to the photos
      // step — which THIS composition drops whenever the saved car already has
      // enough, leaving a control that silently did nothing. Append the confirm
      // step as a fallback (its own Edit expands the flow into the full seven
      // steps, which is where photos live), rather than replacing the base's
      // choice: when the photos step did survive it is still the better target.
      review: baseFlow.review && {
        ...baseFlow.review,
        header: (answers, editStep) =>
          baseFlow.review?.header?.(answers, (stepId) =>
            editStep([...(Array.isArray(stepId) ? stepId : [stepId]), summaryStep.id]),
          ),
      },
      phases: baseFlow.phases.map((phase) =>
        phase.id === 'car'
          ? {
              ...phase,
              // The reassuring intro is wrong here: they came from their own
              // garage and know what they're doing. Straight to the confirm.
              intro: undefined,
              steps: carSteps,
            }
          : phase,
      ),
    },
    initialAnswers,
  };
}
