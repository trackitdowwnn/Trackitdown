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
  /** Placeholder illustration. TODO(art): replace with final artwork slot. */
  emoji: string;
  headline: string;
  /** Optional trailing headline phrase set in terracotta — the bounty/value
   *  accent (docs/DESIGN_SYSTEM.md: accent is reserved for value moments). */
  headlineAccent?: string;
  body: string;
  /** Fixed safety wording rendered in SafetyNotice visual language
   *  (docs/SECURITY_AND_TRUST.md) — only the spot-it slide carries one. */
  safetyLine?: string;
}
