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
  /**
   * Bug-report screenshot thumbnail (added 2026-08-27).
   *
   * ⚠️ ITS OWN TOKEN, NOT `touchTarget * 2`, which is what it was first. This
   * file keeps drawn geometry separate from the touch floor on purpose (see the
   * note above `control`), and deriving a picture size FROM the tap minimum
   * inverts that — adopt Android's 48dp target one day and every screenshot
   * silently grows to 96.
   *
   * ⚠️ RECOGNISABILITY, NOT LEGIBILITY, and the first version of this comment
   * claimed the second. No 104pt tile shows an address readably — the tile's
   * job is to let someone tell their screenshots apart and spot that one of
   * them is the wrong picture; the ACTUAL check is the tap-through to
   * PhotoPreviewModal, which is why the step's copy says "tap one to check it".
   * At 88 the 44pt remove button owned a quarter of the tile, which is what
   * this size fixes.
   */
  screenshotThumb: 104,
  /**
   * ⚠️ PORTRAIT, BECAUSE IT IS A SCREENSHOT. A square tile forces a choice
   * between cropping the frame and shrinking it, and BOTH lose: a 9:19.5 phone
   * screenshot cropped square shows the middle ~46% (an address in a bottom
   * sheet disappears), and the same frame letterboxed into a square draws ~48pt
   * wide with a third of the tile empty down each side. Shipping `cover` was
   * the first mistake and `contain` on a square was the second. At 104×185 the
   * whole frame draws ~85pt wide — 3.5× the area — with the letterboxing nearly
   * gone, so nothing is cropped out of the picture the user is asked to check.
   *
   * width/height, per RN's aspectRatio.
   */
  screenshotThumbAspect: 9 / 16,
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
  /** SurfaceTabs' active-tab underline — a drawn stroke sitting ON the row's
   *  hairline, so it must read as deliberate ink rather than a thick border. */
  surfaceTabUnderline: 2,
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
  /** Distinctive-feature card thumbnail (post detail 5b) — the mark's photo
   *  inset in its row, at the 4:3 the photo grid uses (height via
   *  aspectRatio, so the crop can never drift from the width). */
  featureThumb: 112,
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
  /**
   * The onboarding hero's sighting trail: the dashed run of reports closing on
   * the posted car, and the dots marking each one.
   *
   * ⚠️ ITS OWN TOKENS rather than `timelineDot`/`timelineDash`, which mean the
   * same thing. Those are the sighting timeline's LIST geometry — sized against
   * a 24px rail column running beside text. These are drawn into a 360×440
   * illustration that is then stretched to whatever band the handset gives it.
   * Same concept, different constraint, and the day the timeline's dot grows to
   * suit a text row is not the day this one should.
   */
  onboardingTrailDot: 8,
  onboardingTrailDotRing: 2,
  onboardingTrailStroke: 2,
  /** The hero's alert and home rings. Was a bare `1.5` written twice in the
   *  file that minted every other number here — lighter than the trail, which
   *  is the point: the rings are a moment, the trail is the record. */
  onboardingRingStroke: 1.5,
  /** Dash rhythm (on/off, svg units) — see the trail's own note in
   *  OnboardingMap for why it is dashed rather than solid. */
  onboardingTrailDash: 6,
  onboardingTrailGap: 5,
  /** The stats screen's sightings-per-day chart. `Min` is the floor a day WITH
   *  sightings never draws below — without it a quiet day beside a busy one
   *  rounds to a hairline and reads as empty. `Empty` is the stub an EMPTY day
   *  draws: the gap between bursts is the information, so the quiet days have
   *  to form a visible axis rather than leaving the busy ones floating.
   *  `Gap` is 2 on purpose — the only subdivision of the 4pt scale here, the
   *  same exception indexRailLetterPad takes, because 4pt gaps across 28 bars
   *  leave the bars thinner than the spaces and the row reads as a comb. */
  sparklineHeight: 64,
  sparklineMin: 4,
  sparklineEmpty: 2,
  sparklineGap: 2,
  /** Reserved heights for the stats screen's loading blocks, so the real
   *  content lands in place instead of shifting the page under a reader. */
  statsSkeletonHead: 96,
  statsSkeletonBlock: 180,
  /* `fab` / `fabRing` / `fabRingGap` lived here for the onboarding ring FAB —
   * a circular next control carrying its own progress arc. The Life360 rebuild
   * (2026-09-03) replaced it with a full-width Button and a row of dots, and
   * these were its ONLY consumers, so they went with it. Nothing else in the
   * app is round-and-64; if a FAB returns, it should argue its own size from
   * its own context rather than inherit a dead one. */
  /** Non-interactive context pill height (timeline cards). */
  pillHeight: 24,
  /** The camera-as-step canvas (report-sighting photos step): viewfinder +
   *  thumb rail + shutter row as one fixed-height block inside the wizard's
   *  scroll — fixed so the step never reflows as photos arrive. */
  cameraStep: 520,
  /**
   * The alert-zone thumbnail on an alert row (added 2026-08-27).
   *
   * An alert IS a place, and the list previously showed five identical grey
   * text blocks. This is the smallest square that can carry a legible radius
   * circle beside two lines of text without the row growing taller than the
   * text needs — it matches `avatarLg` on purpose, so a row of alerts and a row
   * of people share one silhouette.
   */
  alertThumb: 72,
  /** The zone glyph's rings, drawn when there is no map (the empty state's
   *  illustration, and the thumbnail's fallback). `glyphRing` is the outer
   *  circle inside an `alertThumb` square; `alertGlyphDot` is the point at its
   *  centre — the same two marks the real map draws. */
  alertGlyphRing: 44,
  alertGlyphDot: 10,
  /** The ring's drawn stroke. A stroke, not a spacing value — same reason
   *  timelineRailStroke and mapPinRing are tokens rather than literals. */
  alertGlyphStroke: 1,
  /**
   * The colour tile leading a report card (added 2026-08-27) — the car's own
   * paint, standing in for the photograph this screen is not allowed to have.
   *
   * ⚠️ ITS OWN TOKEN, NOT `avatarLg`, which is the same 72 today. `alertThumb`
   * exists for exactly this reason one screen over, and `screenshotThumb` spends
   * a paragraph on it: a car tile is not an avatar, and a file that spells it
   * `avatarLg` breaks the day the profile photo grows.
   */
  carTile: 72,
  /**
   * The car silhouette drawn inside a `carTile` (added 2026-08-27).
   *
   * Bigger than `icon` (24) on purpose: at 24 the glyph reads as a small badge
   * sitting on a colour, and the tile's job is the opposite — the COLOUR is the
   * information and the silhouette only says what kind of thing is that colour.
   * A stroke-drawn glyph over a solid DATA fill, so it is geometry, not an icon
   * button; `icon`/`iconSm` are for icons that stand alone.
   */
  carTileGlyph: 32,
  /**
   * The leading visual on BOTH inbox faces (added 2026-08-28) — the car photo
   * on a conversation row, the icon box on a notification row.
   *
   * ⚠️ 48 SINCE 2026-09-04, down from 64 (owner's call: "make the icons
   * smaller"). The rule the old value protected still holds and is why it did
   * not go lower: the tile must sit UNDER the text column's intrinsic height so
   * the TEXT drives the row height and the picture never does. Dropping to 48
   * moves further inside that bound, not outside it, so the rhythm is still the
   * content's.
   *
   * ⚠️ NOT `avatarMd`, which is also 48. That is a person's photograph; this
   * leads a row with a car or an event icon in it, and the two are free to
   * diverge — the same rule `screenshotThumb` and `carTile` spend paragraphs on.
   *
   * ⚠️ AND STILL NOT `carTile`/`alertThumb` (72). Those lead a card inside a
   * `cardSurface` box with 16pt padding; this leads a bare row on the 24pt
   * gutter.
   *
   * ⚠️ 44 IS THE FLOOR IF THIS EVER SHRINKS AGAIN. Below a touch target the
   * picture stops being something you can recognise a car in, which is the
   * whole reason the leading slot holds the car rather than an initial — see
   * ThreadRow's header for the 24pt badge that failed exactly that way.
   */
  inboxRowTile: 48,
  /**
   * The notification glyph drawn inside an `inboxRowTile`. Held at the same
   * half-of-tile ratio `carTileGlyph` uses (32-in-64), so shrinking the tile to
   * 48 takes the glyph to 24 with it — at 32 the mark would now crowd its box
   * instead of sitting in it.
   */
  inboxRowGlyph: 24,
  /** The timestamp bar in an inbox row skeleton. A fixed width because the
   *  thing it stands in for is a fixed-ish string ("2h ago", "just now") and a
   *  percentage would make it grow with the screen, which timestamps do not. */
  skeletonTimeBar: 40,
  /**
   * The needs-attention mark beside its label on a notification row, and the
   * stroke of that ring.
   *
   * ⚠️ ITS OWN TOKENS rather than borrowing `progressDot` (a wizard header) and
   * `timelineDotStroke` (sighting-timeline geometry). Same reason `carTile` is
   * not `avatarLg`: a shared number is not a shared meaning, and the day a
   * wizard's progress dot changes size is not the day this ring should.
   */
  attentionRing: 8,
  attentionRingStroke: 1.5,
  /**
   * The unread badge's slot on an inbox row — a FIXED width, not a minimum.
   * Wide enough for the "9+" pill (16pt minimum + spacing.xs either side plus
   * the numeral), so a dot, a count and an empty slot all end at the same x and
   * the text column beside them never changes width.
   */
  unreadSlot: 26,
  /** A message bubble's placeholder height while a thread loads. Its own token
   *  rather than `avatarLg`, which is 72 for reasons about faces. */
  skeletonBubble: 72,
  /**
   * The collapsed SafetyNotice's row — a floor, not a fit.
   *
   * ⚠️ Its only consumer was the chat thread, which dropped the notice on
   * 2026-08-29, so this token is currently unused. Kept with the variant it
   * belongs to rather than deleted separately — see SafetyNotice.tsx.
   *
   * ⚠️ A NUMBER, NOT A DERIVATION. It used to be written
   * `touchTarget - 2 * spacing.sm`, which silently stopped meaning anything the
   * moment that padding changed.
   *
   * ⚠️ AND IT IS NOT "two lines of label" — that would be 36 (14/18 × 2), a
   * claim this comment made for a few hours until a review did the arithmetic.
   * 28 is one line plus air; the row GROWS past it whenever the title wraps,
   * which at large type it should.
   */
  safetyStripRow: 28,
  /**
   * The car's tile in a chat thread's header (added 2026-08-29).
   *
   * ⚠️ 44, NOT `inboxRowTile` (64) — the inbox tile leads a list row where the
   * picture is how you pick one conversation out of many. In a thread you are
   * already inside the conversation: the tile is confirming which car, beside a
   * 44pt back button, in a row whose whole purpose was to stop being 136pt
   * tall. It matches the touch targets either side of it.
   */
  threadHeaderTile: 44,
} as const;

export type SizeToken = keyof typeof sizes;
