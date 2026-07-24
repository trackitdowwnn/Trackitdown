/**
 * WHAT:  Colour tokens for the app, straight from docs/DESIGN_SYSTEM.md.
 * WHY:   UI code imports these names and never hard-codes hex values, so a
 *        palette change happens in one place and stays on-brand. MONOCHROME
 *        scheme (2026-07-24): cool near-white surfaces + grey ink, the primary
 *        action + bounty/value both rendered in near-BLACK (the previous Arches
 *        orange / terracotta warmth was dropped at the owner's request);
 *        semantic status hues (success/warning/danger) stay distinct;
 *        photography carries the colour.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour palette);
 *        docs/decisions/ADR-0005-airbnb-orange-theme.md (the superseded
 *          orange theme — this monochrome pass replaces its primary/accent).
 */

export const colors = {
  background: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceSubtle: '#EEEEEE',
  // Pressed state of surfaceSubtle fills (chips) — border stays for hairlines.
  surfaceSubtlePressed: '#E0E0E0',
  // Soft near-black — the single primary accent (buttons, active states, links,
  // selection rings/checks). Monochrome scheme; white-on-primary is ~16:1 (AAA),
  // and primary-as-text on the near-white background is far above AA.
  primary: '#1A1A1A',
  // Pressed lightens (can't go darker than near-black) so a tap still registers.
  primaryPressed: '#333333',
  // Bounty/value fill + large value type. Monochrome: shares the near-black, so
  // the bounty reads as "value" via its bold black fill (white text) + weight,
  // not hue. accent is fills/large type only.
  accent: '#1A1A1A',
  // Bounty TEXT at label/body sizes on the near-white background — near-black,
  // far above AA. (Was a darkened terracotta; now monochrome.)
  accentText: '#1A1A1A',
  textPrimary: '#222222',
  textSecondary: '#6A6A6A',
  border: '#DDDDDD',
  // Stronger hairline for small elements that must stay visible (e.g. the
  // wizard's empty progress track) — ≥3:1 on the background.
  borderStrong: '#949494',
  success: '#4F8A5B',
  // Amber for pending/expiring — dot/icon/border only, never body text.
  warning: '#A9762A',
  // Clearer muted red for destructive/error UI — the one hue that survived the
  // monochrome swap for actions, so destructive actions stay unmistakably
  // distinct from the near-black primary (a destructive tap must never read as
  // the primary action).
  danger: '#C0281E',
  dangerPressed: '#A21F16',
  textOnPrimary: '#FFFFFF',
  // The rare dark floating surface (feed map pill, photo viewer). Same ink as
  // textPrimary but named as a SURFACE so a text-colour tweak never silently
  // restyles a fill.
  surfaceInverse: '#222222',
  surfaceInversePressed: '#3A3A3A',
  overlay: 'rgba(0,0,0,0.45)',
} as const;

export type ColorToken = keyof typeof colors;
