/**
 * WHAT:  Motion tokens — the design system's animation durations, the card
 *        press scale, and the FullscreenLoader's choreography values.
 * WHY:   The 200–250ms ease-out rule (docs/DESIGN_SYSTEM.md, Motion) was
 *        living as per-file magic numbers; naming the sanctioned durations
 *        and scales keeps every animation on the same clock. Easing
 *        functions stay per-library (RN Animated and Reanimated export
 *        incompatible types) — the RULE is ease-out; these tokens carry
 *        the numbers.
 * LINKS: docs/DESIGN_SYSTEM.md (Motion); consumers across src/shared/ui.
 */

export const motion = {
  /** Micro-interactions: fades, label floats, press feedback. */
  fast: 200,
  /** Screen-scale moves: modals, sheets, wizard slides. */
  standard: 250,
  /** Map fly-to (LocationPicker search pick / locate). A geographic camera
   *  move legitimately runs longer than UI motion — a sanctioned exception to
   *  the 200–250ms rule, named so it doesn't read as a magic number. */
  mapFly: 500,
  /** Shorter map follow-pan (search map: card swipe nudges the camera to the
   *  next pin without a full fly-to). Also a sanctioned camera-move exception. */
  mapPan: 350,
  /** "Subtle scale on card press" (DESIGN_SYSTEM Motion). */
  pressScale: 0.98,
  /** MoneySlider: thumb scale-up while grabbed. */
  grabScale: 1.15,
  /** PhotoGridPicker: tile scale-up while lifted for drag-to-reorder. */
  liftScale: 1.05,
  /** AppTabBar: peak of the gentle icon spring on tab press. */
  tabPressScale: 1.15,
  /** Toast: how long a toast stays before auto-dismissing. */
  toastVisible: 2500,
  /** Hold duration (ms) before a long-press lifts an element into a drag. */
  longPress: 350,
  /** FullscreenLoader: minimum time shown, so instant ops don't flash. */
  loaderMinVisible: 600,
  /** FullscreenLoader: one cycle of the calm three-dot wave. */
  loaderLoop: 1200,
  /** FullscreenLoader: how far a dot swells at the top of its wave. */
  loaderWaveScale: 1.4,
} as const;

export type MotionToken = keyof typeof motion;
