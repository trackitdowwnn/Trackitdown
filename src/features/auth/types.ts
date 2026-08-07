/**
 * WHAT:  Types owned by the auth feature — currently the onboarding intro's
 *        slide shape.
 * WHY:   Slides are data, not JSX (src/features/auth/lib/onboardingSlides.ts),
 *        so copy is testable and final artwork can replace the placeholder
 *        emoji without touching layout code.
 * LINKS: src/features/auth/lib/onboardingSlides.ts;
 *        src/features/auth/components/OnboardingSlide.tsx.
 */

/** One onboarding slide. Copy is pinned by tests — it is product wording. */
export interface OnboardingSlideData {
  key: string;
  /** The status stamped under the registration plate as this slide centres —
   *  REPORTED → BROADCAST → SIGHTED → RECOVERED. Uppercase, one word: it is
   *  read as a record state, not a sentence. */
  stamp: string;
  /** The step's short name for the footer rail ("POST", "ALERT"…). These four
   *  slides are a genuine SEQUENCE (the product loop), which is the only
   *  reason numbering them is honest rather than decorative. */
  step: string;
  headline: string;
  /** Optional trailing headline phrase set in the accent (near-black) — the
   *  bounty/value colour (docs/DESIGN_SYSTEM.md: accent is reserved for value). */
  headlineAccent?: string;
  body: string;
  /** Fixed safety wording rendered in SafetyNotice visual language
   *  (docs/SECURITY_AND_TRUST.md) — only the spot-it slide carries one. */
  safetyLine?: string;
}
