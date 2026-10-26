/**
 * WHAT:  The "T" mark's geometry, for the PDF writer's page header.
 * WHY:   Edge Functions can't import the app's src/ — this is a COPY of
 *        src/shared/brand/markGeometry.ts (units of half the mark's width,
 *        about its centre, y down as in SVG). ./brandMark.test.ts fails if the
 *        two ever differ, so the PDF always wears the app's own mark.
 * LINKS: src/shared/brand/markGeometry.ts; ./pdfDocument.ts (headerOps).
 */

export const MARK_BARS = [
  // crossbar
  { cx: -0.045139, cy: -0.666667, hw: 0.954861, hh: 0.288194, r: 0.288194 },
  // stem
  { cx: -0.045139, cy: 0.0, hw: 0.288194, hh: 0.954861, r: 0.288194 },
] as const;

export const MARK_DOTS = [{ cx: 0.732639, cy: 0.6875, r: 0.267361 }] as const;

export const MARK_ASPECT = 0.954861;
