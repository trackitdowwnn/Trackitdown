/**
 * WHAT:  Control-sizing tokens (heights that recur across interactive
 *        elements).
 * WHY:   Inputs and buttons share a 52pt control height (>= the 44pt minimum
 *        touch target in DESIGN_SYSTEM). Naming it keeps those heights in sync
 *        and out of component code as magic numbers.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components: Button height 52; Accessibility
 *        44pt touch targets).
 */

export const sizes = {
  /** Single-line control height for buttons and plain (label-less) inputs. */
  control: 52,
  /** Single-line height for an input with a floating label (needs room for the
   *  label to sit above the text once it floats up). */
  input: 56,
  /** Minimum height for a multiline input (~3 lines). */
  multilineMin: 96,
} as const;

export type SizeToken = keyof typeof sizes;
