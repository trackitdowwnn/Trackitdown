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
  /** Drag-handle grabber bar on sheets (BottomSheet). */
  grabberWidth: 32,
  grabberHeight: 4,
  /** Wizard header progress: resting dot and the stretched current-step pill. */
  progressDot: 8,
  progressPill: 24,
  /** Minimum touch target (DESIGN_SYSTEM Accessibility). */
  touchTarget: 44,
  /** FullscreenLoader wave dot. */
  loaderDot: 12,
  /** MoneySlider: thumb diameter and rail thickness (the touchable row is
   *  padded to touchTarget; these are the drawn sizes). */
  sliderThumb: 28,
  sliderTrack: 6,
  /** Standard icon size (tab bar, action rows). */
  icon: 24,
  /** Small inline icon (inside pills/chips, beside label-size text). */
  iconSm: 18,
  /** Small circled icon button (feed see-all chevron, future photo-corner
   *  buttons). Drawn size only — pad the pressable up to touchTarget. */
  circleButtonSm: 28,
  /** Avatar diameters: list rows / sheets / profile header. */
  avatarSm: 32,
  avatarMd: 48,
  avatarLg: 72,
  /** AppTabBar content height, above the safe-area inset. */
  tabBar: 56,
  /** AppTabBar badge: dot diameter and count-pill height. */
  badgeDot: 8,
  badgePill: 16,
  /** Embedded map picker height (e.g. the post-a-car "last seen where" step). */
  mapPickerHeight: 340,
} as const;

export type SizeToken = keyof typeof sizes;
