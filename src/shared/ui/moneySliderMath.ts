/**
 * WHAT:  Pure maths for MoneySlider — the non-linear track curve
 *        (position ↔ pence), tiered snap-step grids, clamping, and a
 *        worklet-safe whole-pound formatter for the animated readout.
 * WHY:   The mapping is the part of a slider that silently corrupts money if
 *        it drifts, so it lives here as pure exported functions the tests can
 *        hammer without rendering anything (precedent: selectOptions.ts).
 *        The power curve gives more track distance to lower amounts (most
 *        bounties are £50–£500), and every function is a worklet so the
 *        gesture can call them on the UI thread. All amounts are integer
 *        pence — floats never represent money (docs/DOMAIN.md).
 * LINKS: src/shared/ui/MoneySlider.tsx (consumer);
 *        src/shared/lib/money.ts (formatting + the 95/5 split);
 *        docs/DOMAIN.md (Money & fees).
 */

/** One tier of a snap grid: `stepPence` applies up to and including
 *  `upToPence`; omit `upToPence` on the final tier (open-ended). */
export interface SnapStep {
  upToPence?: number;
  stepPence: number;
}

/** The slider's value space and curve shape. */
export interface CurveConfig {
  minPence: number;
  maxPence: number;
  /** >1 gives more track distance to lower amounts; 1 is linear. */
  curveExponent: number;
}

/** Clamp to [minPence, maxPence] and force integer pence. */
export function clampPence(pence: number, minPence: number, maxPence: number): number {
  'worklet';
  return Math.min(maxPence, Math.max(minPence, Math.round(pence)));
}

/** Map pence to a 0–1 track position along the power curve. */
export function penceToPosition(pence: number, config: CurveConfig): number {
  'worklet';
  const { minPence, maxPence, curveExponent } = config;
  if (maxPence <= minPence) {
    return 0; // degenerate range — pin to the start
  }
  const clamped = clampPence(pence, minPence, maxPence);
  const fraction = (clamped - minPence) / (maxPence - minPence);
  return Math.pow(fraction, 1 / curveExponent);
}

/** Map a 0–1 track position back to integer pence (inverse of the curve). */
export function positionToPence(position: number, config: CurveConfig): number {
  'worklet';
  const { minPence, maxPence, curveExponent } = config;
  const clamped = Math.min(1, Math.max(0, position));
  return Math.round(minPence + (maxPence - minPence) * Math.pow(clamped, curveExponent));
}

/** The step size that applies at a given amount (first tier whose
 *  `upToPence` covers it, else the final tier). */
export function stepAtPence(pence: number, steps: SnapStep[]): number {
  'worklet';
  for (let index = 0; index < steps.length; index += 1) {
    const tier = steps[index];
    if (tier.upToPence === undefined || pence <= tier.upToPence) {
      return tier.stepPence;
    }
  }
  return steps[steps.length - 1].stepPence;
}

/** Snap pence onto its tier's grid. Each tier's grid is anchored at the tier's
 *  lower bound (minPence for the first, the previous `upToPence` after), so
 *  crossing a tier boundary never produces off-grid values, and the result is
 *  always clamped so min and max stay exactly reachable. */
export function snapPence(
  pence: number,
  steps: SnapStep[],
  minPence: number,
  maxPence: number,
): number {
  'worklet';
  const clamped = clampPence(pence, minPence, maxPence);
  if (steps.length === 0) {
    return clamped;
  }
  let anchor = minPence;
  let step = steps[steps.length - 1].stepPence;
  for (let index = 0; index < steps.length; index += 1) {
    const tier = steps[index];
    if (tier.upToPence === undefined || clamped <= tier.upToPence) {
      step = tier.stepPence;
      break;
    }
    anchor = tier.upToPence;
  }
  const snapped = anchor + Math.round((clamped - anchor) / step) * step;
  return clampPence(snapped, minPence, maxPence);
}

/** Format pence as whole pounds ("£1,250") for the animated readout. Worklet
 *  twin of lib/money's formatPounds (which can't run on the UI thread);
 *  intermediate drag values round to the nearest pound — committed values are
 *  whole pounds anyway. Parity with formatPounds is locked by tests. */
export function formatWholePounds(pence: number): string {
  'worklet';
  const pounds = Math.abs(Math.round(pence / 100));
  const sign = pence < 0 ? '-' : '';
  const digits = String(pounds);
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    const fromEnd = digits.length - index;
    grouped += digits[index];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) {
      grouped += ',';
    }
  }
  return `${sign}£${grouped}`;
}
