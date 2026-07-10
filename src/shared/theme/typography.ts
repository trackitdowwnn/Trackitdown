/**
 * WHAT:  Type-scale tokens from docs/DESIGN_SYSTEM.md, as ready-to-spread
 *        TextStyle fragments (size / line-height / weight).
 * WHY:   Every piece of text picks a named role instead of raw font sizes, so
 *        the scale stays consistent. Font family is intentionally omitted for
 *        now — the system font honours these weights; Inter is wired in at the
 *        app level later (per-weight variants) without touching UI code.
 * LINKS: docs/DESIGN_SYSTEM.md (Typography).
 */

import type { TextStyle } from 'react-native';

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  /** Number-plate styling: bold, letter-spaced (matches the PlateChip look). */
  plate: { fontSize: 16, lineHeight: 24, fontWeight: '700', letterSpacing: 2 },
  /** Tab-bar item labels — the one sanctioned size below caption; nothing
   *  else should use it (labels under 24pt icons need to stay compact). */
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;

/** Dynamic-type cap for display-size hero text (MoneySlider's amount readout):
 *  it may grow with the user's setting, but never so far the row bursts. */
export const displayFontScaleCap = 1.3;

/** Dynamic-type cap for tab-bar labels: one step of growth, then truncate —
 *  the bar itself never gets taller. */
export const tabLabelFontScaleCap = 1.2;
