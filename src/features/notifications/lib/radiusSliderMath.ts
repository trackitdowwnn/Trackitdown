/**
 * WHAT:  The radius slider's curve and snap grid, in MILES.
 * WHY:   A thin domain-named wrapper over shared/ui/moneySliderMath, whose
 *        maths is generic over numbers despite its money naming. Reusing it
 *        keeps one well-tested curve+snap implementation; wrapping it means no
 *        call site ever has to read `penceToPosition(radiusMiles)`, which is
 *        the kind of line that survives review and then confuses everyone.
 *
 *        GRANULARITY — steps scale with the AREA they add, not the distance:
 *        1→2 miles quadruples the area a spotter is asked to watch; 40→50 adds
 *        about 56%. Equal-mile steps would make the low end unusable and the
 *        high end tedious, so the grid coarsens as it climbs and the power
 *        curve gives the low miles more physical track — exactly what the
 *        exponent does for low bounties.
 * LINKS: src/shared/ui/moneySliderMath.ts (the maths);
 *        ../components/RadiusSlider.tsx; ../types.ts (the 1–50 bounds).
 */

import {
  clampPence,
  penceToPosition,
  positionToPence,
  snapPence,
  stepAtPence,
  type CurveConfig,
  type SnapStep,
} from '@/shared/ui/moneySliderMath';

import { MAX_RADIUS_MILES, MIN_RADIUS_MILES } from '../types';

/** "Pence" is the shared maths' unit name; here every value is MILES. */
const RADIUS_CURVE: CurveConfig = {
  minPence: MIN_RADIUS_MILES,
  maxPence: MAX_RADIUS_MILES,
  // >1 gives the low miles more of the track. Same reasoning as the bounty
  // slider, where most values sit at the bottom of the range.
  curveExponent: 2,
};

/** 1–5 in 1s, 5–20 in 5s, 20–50 in 10s. See the header for why. */
export const RADIUS_SNAP_STEPS: SnapStep[] = [
  { upToPence: 5, stepPence: 1 },
  { upToPence: 20, stepPence: 5 },
  { stepPence: 10 },
];

/** Miles → 0–1 track position. */
export function milesToPosition(miles: number): number {
  'worklet';
  return penceToPosition(miles, RADIUS_CURVE);
}

/** 0–1 track position → whole miles. */
export function positionToMiles(position: number): number {
  'worklet';
  return positionToPence(position, RADIUS_CURVE);
}

/** Snap to the tier grid, keeping 1 and 50 exactly reachable. */
export function snapMiles(miles: number): number {
  'worklet';
  return snapPence(miles, RADIUS_SNAP_STEPS, MIN_RADIUS_MILES, MAX_RADIUS_MILES);
}

/** Clamp into range without snapping (for a value arriving from the server). */
export function clampMiles(miles: number): number {
  'worklet';
  return clampPence(miles, MIN_RADIUS_MILES, MAX_RADIUS_MILES);
}

/** The step that applies at a given radius — one press of the accessibility
 *  increment/decrement action, so a screen-reader user moves by the same grid
 *  a dragging finger snaps to. */
export function stepAtMiles(miles: number): number {
  return stepAtPence(miles, RADIUS_SNAP_STEPS);
}

/** "1 mile" / "20 miles" — the readout beside the slider. */
export function formatMiles(miles: number): string {
  'worklet';
  return `${miles} ${miles === 1 ? 'mile' : 'miles'}`;
}
