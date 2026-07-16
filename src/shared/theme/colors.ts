/**
 * WHAT:  Colour tokens for the app, straight from docs/DESIGN_SYSTEM.md.
 * WHY:   UI code imports these names and never hard-codes hex values, so a
 *        palette change happens in one place and stays on-brand. Airbnb-style
 *        system (ADR-0005): cool near-white surfaces + grey ink, ONE vivid
 *        accent (orange) reserved for the primary action, terracotta kept for
 *        bounty/value only, photography carries the colour.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour palette);
 *        docs/decisions/ADR-0005-airbnb-orange-theme.md (supersedes ADR-0004).
 */

export const colors = {
  background: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceSubtle: '#EEEEEE',
  // Pressed state of surfaceSubtle fills (chips) — border stays for hairlines.
  surfaceSubtlePressed: '#E0E0E0',
  // Deep Arches orange — the single primary accent (buttons, active states,
  // links). Airbnb's vivid Arches #FC642D fails AA on white text (3:1), so this
  // is deepened: white-on-primary = 5.18:1 and orange-as-text = 4.83:1, both AA.
  primary: '#C2410C',
  primaryPressed: '#A8380A',
  // Terracotta — RESERVED for bounty/value moments (ADR-0005). Now the app's
  // only warm colour, so "value" stands out. accent is fills/large type only.
  accent: '#C97B5D',
  // Darkened terracotta for bounty TEXT at label/body sizes (4.88:1 AA on the
  // near-white background — accent itself is ~3:1, large/fill only).
  accentText: '#A05A3B',
  textPrimary: '#222222',
  textSecondary: '#6A6A6A',
  border: '#DDDDDD',
  // Stronger hairline for small elements that must stay visible (e.g. the
  // wizard's empty progress track) — ≥3:1 on the background.
  borderStrong: '#949494',
  success: '#4F8A5B',
  // Amber for pending/expiring — dot/icon/border only, never body text.
  warning: '#A9762A',
  // Clearer muted red for destructive/error UI. Kept distinct from the orange
  // primary on purpose: a brick-red would blur with the CTA colour, so
  // destructive actions must not look like the primary action.
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
