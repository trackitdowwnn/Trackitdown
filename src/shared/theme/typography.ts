/**
 * WHAT:  Type-scale tokens from docs/DESIGN_SYSTEM.md, as ready-to-spread
 *        TextStyle fragments (size / line-height / family), all set in
 *        Satoshi (Fontshare, FFL licence — src/assets/fonts/FFL.txt).
 * WHY:   Every piece of text picks a named role instead of raw font sizes, so
 *        the scale stays consistent. Weights are expressed as FAMILIES
 *        (Satoshi-Regular/Medium/Bold/Black), not fontWeight: with statically
 *        loaded faces Android would synthesize fake bolds on top of an
 *        already-bold face. The old weight tiers map 400→Regular, 500→Medium,
 *        600/700→Bold, display/plate→Black. Anything needing a weight tweak
 *        switches fontFamily via these tokens, never sets fontWeight.
 * LINKS: docs/DESIGN_SYSTEM.md (Typography); src/app/_layout.tsx (useFonts
 *        loads the faces before first render).
 */

import type { TextStyle } from 'react-native';

/** The loaded Satoshi faces (keys must match the useFonts map in _layout). */
export const fontFamilies = {
  regular: 'Satoshi-Regular',
  medium: 'Satoshi-Medium',
  bold: 'Satoshi-Bold',
  black: 'Satoshi-Black',
} as const;

export const typography = {
  /** The onboarding headline, and NOTHING else — scoped to one consumer the way
   *  tabLabel and mapPin are (2026-08-08, docs/design-refs/onboarding/).
   *
   *  Onboarding is the one surface with a single sentence and a whole screen to
   *  say it in: no list competes with it, no chrome frames it, and the reader
   *  has not yet been given anything to do. The reference sets that moment far
   *  above its body scale, and `display` (32) is shared with in-page hero
   *  numbers like MoneySlider's readout — raising IT would drag those up too.
   *  Hence a role, not a bigger `display`. */
  displayHero: { fontSize: 40, lineHeight: 46, fontFamily: fontFamilies.black },
  display: { fontSize: 32, lineHeight: 38, fontFamily: fontFamilies.black },
  title: { fontSize: 24, lineHeight: 30, fontFamily: fontFamilies.bold },
  /** Feed section headers — between heading and title so a scrolling feed
   *  reads in clear bands without every header shouting at screen-title size. */
  sectionTitle: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold },
  heading: { fontSize: 18, lineHeight: 24, fontFamily: fontFamilies.bold },
  /** Card titles in feeds — body-size but semibold, so the photo stays the
   *  hero and the title reads as a caption to it, not a heading over it. */
  cardTitle: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.bold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamilies.regular },
  /**
   * Long-form documents ONLY — the legal pages today (added 2026-08-26).
   *
   * Body size at looser leading: 16/26 rather than 16/24. `body` is tuned for
   * interface text, which arrives in one- or two-line runs where 1.5 is
   * comfortable and tighter keeps a row compact. Legal prose arrives in
   * paragraphs of six or eight lines, and at 1.5 the eye loses its place
   * returning to the left margin — the single change that most improves
   * sustained reading.
   *
   * ⚠️ A SEPARATE ROLE RATHER THAN LOOSENING `body`, which is used by roughly
   * every screen in the app: widening its leading would add two points to the
   * height of every ListRow subtitle, every card line and every empty state, to
   * fix a problem only three pages have.
   */
  prose: { fontSize: 16, lineHeight: 26, fontFamily: fontFamilies.regular },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.regular },
  label: { fontSize: 14, lineHeight: 18, fontFamily: fontFamilies.medium },
  /** Map-pin bounties — label-size but BOLD. The reference sets its price pins
   *  a weight above its own body label (docs/design-refs/map/): a pin has to
   *  hold its own against map tiles and its overlapping neighbours, but going
   *  up a SIZE instead would make the pill tall enough to turn a dense area
   *  into a wall of type. Weight, not size. */
  mapPin: { fontSize: 14, lineHeight: 18, fontFamily: fontFamilies.bold },
  /** Number-plate styling: heavy but compact (label-size, no letter spacing
   *  — tightened 2026-07-23 so the chip sits quietly beside titles). */
  plate: { fontSize: 14, lineHeight: 18, fontFamily: fontFamilies.black },
  /** Tab-bar item labels — the one sanctioned size below caption; nothing
   *  else should use it (labels under 24pt icons need to stay compact). */
  tabLabel: { fontSize: 11, lineHeight: 14, fontFamily: fontFamilies.medium },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;

/** Dynamic-type cap for display-size hero text (MoneySlider's amount readout):
 *  it may grow with the user's setting, but never so far the row bursts. */
export const displayFontScaleCap = 1.3;

/** Dynamic-type cap for tab-bar labels: one step of growth, then truncate —
 *  the bar itself never gets taller. */
export const tabLabelFontScaleCap = 1.2;

/** Dynamic-type cap for map-pin bounties. Uncapped, the OS 200% setting turns
 *  14pt into 28pt, roughly doubling each pill in both axes — twelve of those
 *  overlapping is precisely the wall of type the `mapPin` token chose weight
 *  over size to avoid, and it would bury the map it labels. Costs nothing:
 *  the bounty is fully scalable in the sheet list, in the peek card, and in
 *  the marker's own accessibilityLabel. */
export const mapPinFontScaleCap = 1.3;

/**
 * Above this, a ListRow puts its trailing value UNDER the title instead of
 * beside it.
 *
 * ⚠️ A LAYOUT THRESHOLD, NOT A CAP — nothing is stopped from growing. Side by
 * side, Yoga gives the value its intrinsic width first and the title's
 * `flex: 1` (basis 0) leaves it no shrink weight at all, so at 200% text a
 * settings row rendered "Not allowed" in full beside "Notific…". Losing the
 * NAME of a setting while keeping its status is the wrong half to lose.
 */
export const listRowStackFontScale = 1.3;
