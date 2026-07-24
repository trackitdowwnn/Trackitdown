/**
 * WHAT:  The four onboarding slides as data — copy, placeholder emoji, and
 *        the spot-it slide's fixed safety line.
 * WHY:   This copy is the product's first impression AND its first safety
 *        utterance, so it lives as data the tests can pin word-for-word
 *        (docs/DESIGN_SYSTEM.md tone: calm, human, plain English; the safety
 *        line is firm and unmissable per docs/SECURITY_AND_TRUST.md).
 * LINKS: src/features/auth/types.ts; docs/SECURITY_AND_TRUST.md;
 *        src/features/auth/screens/OnboardingScreen.tsx.
 */

import type { OnboardingSlideData } from '../types';

// SAFETY: this exact wording seeds the report-don't-approach rule and is
// pinned by tests — do not soften or reword casually.
export const ONBOARDING_SAFETY_LINE = 'Never approach or follow a vehicle.';

/** TODO(art): emoji are placeholders for final illustrations. */
export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    key: 'post',
    emoji: '🚗',
    headline: 'Your car, stolen? Post it.',
    body: 'Post your car’s details and photos with a cash bounty — it takes minutes.',
  },
  {
    key: 'alert',
    emoji: '📣',
    headline: 'People nearby get alerted.',
    body: 'Spotters in the area get a notification and know exactly what to look for.',
  },
  {
    key: 'spot',
    emoji: '📸',
    headline: 'Spot it? Report it — from a distance.',
    body: 'Snap a photo in the app and we handle the rest.',
    safetyLine: ONBOARDING_SAFETY_LINE,
  },
  {
    key: 'recovered',
    emoji: '🎉',
    headline: 'Recovered —',
    // The payoff phrase carries the value accent (near-black): onboarding is
    // where the bounty ↔ accent association gets seeded.
    headlineAccent: 'bounty paid.',
    body: 'When a sighting leads to recovery, the spotter earns the bounty.',
  },
];
