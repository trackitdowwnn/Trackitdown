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
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.regular },
  label: { fontSize: 14, lineHeight: 18, fontFamily: fontFamilies.medium },
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
