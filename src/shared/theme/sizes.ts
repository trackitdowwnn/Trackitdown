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
  /** Colour-swatch diameter for the post-a-car colour grid (circular fill +
   *  name label beneath; the pressable cell is padded well past touchTarget). */
  colourSwatch: 56,
  /** Colour-swatch selection chrome — the active ring stroke, its breathing gap
   *  to the swatch, and the corner check badge (diameter + glyph). Mirrors the
   *  tab-avatar ring tokens (tabAvatarRing / tabAvatarRingGap). */
  colourSwatchRing: 2,
  colourSwatchRingGap: 3,
  colourSwatchBadge: 20,

  /** The selection-stroke width for a bordered selectable card (CardSelect):
   *  constant, colour-only change on select. Matches the swatch/avatar rings. */
  selectBorder: 2,
  colourSwatchBadgeIcon: 12,
  /** A–Z index-rail letter vertical padding — iOS section-index rhythm,
   *  deliberately below the 4pt scale so ~20 letters fit as one tidy column. */
  indexRailLetterPad: 2,
  /** Standard icon size (tab bar, action rows). */
  icon: 24,
  /** Small inline icon (inside pills/chips, beside label-size text). */
  iconSm: 18,
  /** Small circled icon button (feed see-all chevron, future photo-corner
   *  buttons). Drawn size only — pad the pressable up to touchTarget. */
  circleButtonSm: 28,
  /** Avatar diameters: list rows / sheets / compact headers / the profile
   *  hero + passport card (the Airbnb passport avatar is 100–104pt;
   *  docs/design-refs/profile/REFERENCE_SPEC.md). */
  avatarSm: 32,
  avatarMd: 48,
  avatarLg: 72,
  avatarXl: 96,
  /** AppTabBar content height, above the safe-area inset. */
  tabBar: 56,
  /** Profile-tab avatar diameter — slightly over `icon` (24) so the photo sits
   *  optically level with the outline icons beside it. */
  tabAvatar: 26,
  /** Active ring around the tab avatar: stroke width and the breathing gap
   *  between ring and photo. */
  tabAvatarRing: 2,
  tabAvatarRingGap: 2,
  /** The slot EVERY tab centres its glyph in — sized to contain the ringed
   *  avatar (tabAvatar + 2×(tabAvatarRingGap + tabAvatarRing) = 34) so the
   *  ring never overflows into the bar's overflow-hidden clip and labels
   *  align across icon and photo tabs. */
  tabIconSlot: 34,
  /** AppTabBar badge: dot diameter and count-pill height. */
  badgeDot: 8,
  badgePill: 16,
  /** The needs-attention accent bar on notification-center rows — a drawn
   *  stroke, like timelineRailStroke, not a spacing value. */
  attentionBar: 3,
  /** Skeleton-placeholder line height — a drawn dimension, not a spacing gap. */
  skeletonLine: 12,
  /** Embedded map picker height (e.g. the post-a-car "last seen where" step). */
  mapPickerHeight: 340,
  /** Large in-page map preview (post detail "Last seen here") — the reference
   *  treats location as a headline-size element, not a thumbnail
   *  (docs/design-refs/post-detail/REFERENCE_SPEC.md §9). */
  mapPreview: 340,
  /** Compact confirm-screen map (report-sighting "Check and send") — placement
   *  context, deliberately smaller than the headline mapPreview. */
  mapConfirmPreview: 160,
  /** Sighting-timeline drawn geometry (researched treatment, 2026-07-30):
   *  a 24px node column carrying a 2px rail; 12px sighting dots with a 2px
   *  page-colour ring so they sit crisply ON the rail; 16px newest dot;
   *  24px icon-in-circle anchor nodes. Content offset from the rail is the
   *  column + spacing.xxl gap (~44px, inside the researched 40–60 range). */
  timelineRailColumn: 24,
  timelineRailStroke: 2,
  timelineDot: 12,
  timelineDotNewest: 16,
  timelineDotRing: 2,
  timelineDotStroke: 1.5,
  timelineAnchor: 24,
  /** Day-group stop on the rail — a micro-tick, not an event node. */
  timelineTick: 6,
  /** Dash rhythm (on/off, svg units) for the uncertainty segment. */
  timelineDash: 4,
  /** Map-pin family (drawn geometry; the PRESSABLE around a tappable pin is
   *  padded up to touchTarget — same rule as sliderThumb). */
  mapPin: 14,
  mapPinNewest: 20,
  mapPinOrigin: 12,
  mapPinConfirm: 16,
  mapPinRing: 2,
  /** Non-interactive context pill height (timeline cards). */
  pillHeight: 24,
  /** The camera-as-step canvas (report-sighting photos step): viewfinder +
   *  thumb rail + shutter row as one fixed-height block inside the wizard's
   *  scroll — fixed so the step never reflows as photos arrive. */
  cameraStep: 520,
} as const;

export type SizeToken = keyof typeof sizes;
