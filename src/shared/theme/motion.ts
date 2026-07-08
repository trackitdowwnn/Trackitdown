/**
 * WHAT:  Motion tokens — the design system's animation durations and the
 *        card press scale, as named values.
 * WHY:   The 200–250ms ease-out rule (docs/DESIGN_SYSTEM.md, Motion) was
 *        living as per-file magic numbers; naming the two sanctioned
 *        durations and the 0.98 press scale keeps every animation on the
 *        same clock. Easing functions stay per-library (RN Animated and
 *        Reanimated export incompatible types) — the RULE is ease-out;
 *        these tokens carry the numbers.
 * LINKS: docs/DESIGN_SYSTEM.md (Motion); consumers across src/shared/ui.
 */

export const motion = {
  /** Micro-interactions: fades, label floats, press feedback. */
  fast: 200,
  /** Screen-scale moves: modals, sheets, wizard slides. */
  standard: 250,
  /** "Subtle scale on card press" (DESIGN_SYSTEM Motion). */
  pressScale: 0.98,
} as const;

export type MotionToken = keyof typeof motion;
