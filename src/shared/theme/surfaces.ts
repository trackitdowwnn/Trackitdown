/**
 * WHAT:  `cardSurface(palette)` — the box every resting card in this app is
 *        made of: `surface`, a `lg` radius, and a hairline border. No shadow.
 * WHY:   ⚠️ IT EXISTS BECAUSE THE SAME PARAGRAPH WAS BEING WRITTEN TWICE. Six
 *        Airbnb passes (settings, legal, payouts, spotter story, bug report,
 *        alerts, my reports) each arrived at the same flat box, and the last two
 *        — AlertCard and ReportCard — carried near-identical comments
 *        apologising for disagreeing with DESIGN_SYSTEM's Card entry, which
 *        still specified a soft shadow. That is the point at which the cost
 *        stops being "a doc is stale" and becomes "every new card author writes
 *        an essay to justify following the house style".
 *
 *        Resolved 2026-08-28 in the doc rather than in a seventh comment: cards
 *        that REST on a page are flat with a hairline; `shadows.soft` is for
 *        things that FLOAT over content — map chrome, sheets, slider thumbs,
 *        toasts. Both were always in the codebase; only one was written down.
 *
 *        ⚠️ THE HAIRLINE IS NOT DECORATION, and dark mode is why. `surface` on
 *        `background` is #1E1E1E on #141414 — a 1.1:1 step. Without an edge a
 *        dark-mode card has no boundary at all, which is the same reason
 *        elevation there is carried by the surface ladder rather than by shadow.
 *
 *        A FUNCTION, not a `StyleSheet.create` entry: it needs the palette in
 *        effect, and every `makeStyles(c)` in the app already has one. Spread it
 *        and add the layout — padding and direction are the caller's, because a
 *        row card and a section panel share the box and nothing else.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components → Card);
 *        src/features/notifications/components/AlertCard.tsx,
 *        src/features/sightings/components/ReportCard.tsx (first two consumers);
 *        ./shadows.ts (what to use when something genuinely floats).
 */

import { StyleSheet, type ViewStyle } from 'react-native';

import { radii } from './radii';
import type { Palette } from './colors';

/**
 * The resting-card box. Spread it into a style and add your own layout:
 *
 *   card: { ...cardSurface(c), flexDirection: 'row', padding: spacing.lg },
 */
export function cardSurface(c: Palette): ViewStyle {
  return {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  };
}
