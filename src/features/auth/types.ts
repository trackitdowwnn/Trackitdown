/**
 * WHAT:  Types owned by the auth feature — currently the onboarding intro's
 *        slide shape, including the headline's weight runs.
 * WHY:   Slides are data, not JSX (src/features/auth/lib/onboardingSlides.ts),
 *        so copy is pinned by tests word-for-word rather than buried in layout.
 * LINKS: src/features/auth/lib/onboardingSlides.ts;
 *        src/features/auth/components/OnboardingSlide.tsx.
 */

import type { OnboardingMapStage } from './components/OnboardingMap';

/**
 * One stretch of headline at one weight.
 *
 * ⚠️ RUNS CARRY THEIR OWN SPACES and are joined with '' — never ' '. The
 * accessibility label is built by concatenating these, so a join(' ') would
 * double every space in every spoken label while looking perfectly fine on
 * screen. `headlineText` is the only sanctioned way to flatten them.
 */
export interface HeadlineRun {
  text: string;
  /** Satoshi-Black. Runs without it are set in Satoshi-Regular. */
  emphasis?: boolean;
}

/**
 * A headline as alternating weights.
 *
 * This replaced a `headline` string plus an optional trailing `headlineAccent`
 * (2026-08-08). Two reasons: the accent could only ever mark the END of a
 * sentence, where the design needs emphasis MID-sentence ("People **nearby**
 * get **alerted**"); and the accent was a COLOUR — `colors.accent` #1A1A1A
 * against `colors.textPrimary` #222222, a difference no eye can see. The
 * emphasis it was supposed to carry was never actually visible.
 */
export type OnboardingHeadline = readonly HeadlineRun[];

/** One onboarding slide. Copy is pinned by tests — it is product wording. */
export interface OnboardingSlideData {
  key: string;
  headline: OnboardingHeadline;
  body: string;
  /**
   * Which state the shared map hero shows while this slide is up.
   *
   * Art direction as DATA, the way the removed `stamp` field carried the
   * registration plate's status. The difference from `stamp` is that the map is
   * NOT remounted per slide — the screen holds one and hands it this — so the
   * story accumulates rather than cutting between four pictures, which is the
   * objection that killed the last two heroes.
   */
  mapStage: OnboardingMapStage;
  /** Fixed safety wording rendered in SafetyNotice visual language
   *  (docs/SECURITY_AND_TRUST.md) — only the spot-it slide carries one. */
  safetyLine?: string;
}
