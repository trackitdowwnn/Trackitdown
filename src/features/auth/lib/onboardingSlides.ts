/**
 * WHAT:  The four onboarding slides as data — copy, the status stamped on the
 *        hero registration plate, the footer step name, and the spot-it
 *        slide's fixed safety line.
 * WHY:   This copy is the product's first impression AND its first safety
 *        utterance, so it lives as data the tests can pin word-for-word
 *        (docs/DESIGN_SYSTEM.md tone: calm, human, plain English; the safety
 *        line is firm and unmissable per docs/SECURITY_AND_TRUST.md).
 *
 *        The four slides are one car's story, not four unrelated pitches —
 *        which is why they carry a `stamp` rather than an illustration each.
 *        A single plate sits above the pager and only its STATUS changes as
 *        you swipe: reported, broadcast, sighted, recovered. (Until 2026-08-06
 *        each slide showed a placeholder emoji in a grey circle instead —
 *        including a 🎉 on the recovery slide, which is the wrong register
 *        entirely for someone whose car was stolen.)
 * LINKS: src/features/auth/types.ts; docs/SECURITY_AND_TRUST.md;
 *        src/features/auth/components/OnboardingPlate.tsx (the hero);
 *        src/features/auth/screens/OnboardingScreen.tsx.
 */

import type { OnboardingSlideData } from '../types';

// SAFETY: this exact wording seeds the report-don't-approach rule and is
// pinned by tests — do not soften or reword casually.
export const ONBOARDING_SAFETY_LINE = 'Never approach or follow a vehicle.';

/** The demonstration registration. Matches the plate our own seed data uses
 *  for Beth's BMW, so the story onboarding tells is the same one every
 *  fixture and SQL suite tells. NOTE: it is a well-formed current-style UK
 *  mark, so it could in principle belong to a real vehicle — swap it for a
 *  cleared demonstration plate before any public release. */
export const ONBOARDING_PLATE = 'BD21 WSE';

/** What the spotter earns on the payoff slide. A concrete number does the job
 *  the old 🎉 could not: it names the actual incentive. */
export const ONBOARDING_BOUNTY = '£500';

export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    key: 'post',
    stamp: 'Reported',
    step: 'Post',
    headline: 'Your car, stolen? Post it.',
    body: 'Post your car’s details and photos with a cash bounty — it takes minutes.',
  },
  {
    key: 'alert',
    stamp: 'Broadcast',
    step: 'Alert',
    headline: 'People nearby get alerted.',
    body: 'Spotters in the area get a notification and know exactly what to look for.',
  },
  {
    key: 'spot',
    stamp: 'Sighted',
    step: 'Spot',
    headline: 'Spot it? Report it — from a distance.',
    body: 'Snap a photo in the app and we handle the rest.',
    safetyLine: ONBOARDING_SAFETY_LINE,
  },
  {
    key: 'recovered',
    stamp: 'Recovered',
    step: 'Paid',
    headline: 'Recovered —',
    // The payoff phrase carries the value accent (near-black): onboarding is
    // where the bounty ↔ accent association gets seeded.
    headlineAccent: 'bounty paid.',
    body: 'When a sighting leads to recovery, the spotter earns the bounty.',
  },
];
