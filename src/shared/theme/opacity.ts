/**
 * WHAT:  Opacity tokens for muted/disabled states.
 * WHY:   Keeps the "dimmed" look consistent and out of component code as a raw
 *        number, so every disabled control fades by the same amount.
 * LINKS: docs/DESIGN_SYSTEM.md.
 */

export const opacity = {
  /** Disabled interactive elements. */
  disabled: 0.6,
  /** Resting state of paired indicators (inactive carousel dots). */
  inactive: 0.5,
  /** Floor of the loader dots' wave/pulse — dimmer than inactive so the
   *  rise reads clearly at a slow tempo. */
  loaderRest: 0.35,
} as const;

export type OpacityToken = keyof typeof opacity;
