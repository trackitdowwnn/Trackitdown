/**
 * WHAT:  The four onboarding slides as data — copy as weight runs, plus the
 *        spot-it slide's fixed safety line. Plus `headlineText`, the one
 *        sanctioned way to flatten a headline back to a string.
 * WHY:   This copy is the product's first impression AND its first safety
 *        utterance, so it lives as data the tests can pin word-for-word
 *        (docs/DESIGN_SYSTEM.md tone: calm, human, plain English; the safety
 *        line is firm and unmissable per docs/SECURITY_AND_TRUST.md).
 *
 *        The four slides are one car's story, not four unrelated pitches, and
 *        the WORDS are now the only thing telling it. Two attempts at an
 *        accompanying object have come and gone. Until 2026-08-06 each slide
 *        showed a placeholder emoji in a grey circle — including a 🎉 on the
 *        recovery slide, the wrong register entirely for someone whose car had
 *        just been stolen. That gave way to a registration plate pinned above
 *        the pager whose STATUS changed as you swiped — reported, broadcast,
 *        sighted, recovered — carried here as a `stamp` on each slide. The
 *        plate went on 2026-08-08 along with the swipe itself, and `stamp` went
 *        with it rather than linger as data nothing reads. The headline takes
 *        that room now, at 40pt, which is what the design reference's own
 *        opening slide does. (The reference also puts a 📖 in its headline;
 *        that part was left where it was found.)
 *
 *        HEADLINES ARE RUNS, NOT STRINGS (2026-08-08). Emphasis is carried by
 *        WEIGHT now — Satoshi-Black against Satoshi-Regular — because it has to
 *        land mid-sentence, and because the accent COLOUR it replaced was
 *        invisible (see types.ts). The words themselves did not change.
 * LINKS: src/features/auth/types.ts; docs/SECURITY_AND_TRUST.md;
 *        src/features/auth/screens/OnboardingScreen.tsx.
 */

import type { OnboardingHeadline, OnboardingSlideData } from '../types';

// SAFETY: this exact wording seeds the report-don't-approach rule and is
// pinned by tests — do not soften or reword casually.
export const ONBOARDING_SAFETY_LINE = 'Never approach or follow a vehicle.';

/**
 * A headline as one plain string, for accessibility labels.
 *
 * ⚠️ join('') — the runs carry their own leading/trailing spaces. Joining on a
 * space instead would double every gap in every spoken label while the screen
 * still looked correct, which is exactly the kind of defect nobody reports.
 * onboardingSlides.test.ts pins each result character for character.
 */
export function headlineText(runs: OnboardingHeadline): string {
  return runs.map((run) => run.text).join('');
}

export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    key: 'post',
    // "Your car, stolen?" is the reader's situation and is left plain; the
    // emphasis lands on the instruction, which is the only part they can act on.
    headline: [{ text: 'Your car, stolen?' }, { text: ' Post it.', emphasis: true }],
    body: 'Post your car’s details and photos with a cash bounty — it takes minutes.',
  },
  {
    key: 'alert',
    headline: [
      { text: 'People ' },
      { text: 'nearby', emphasis: true },
      { text: ' get ' },
      { text: 'alerted.', emphasis: true },
    ],
    body: 'Spotters in the area get a notification and know exactly what to look for.',
  },
  {
    key: 'spot',
    // Both halves of the safety bargain are emphasised: what to do, and the
    // distance to do it from. The connective tissue between them is not.
    headline: [
      { text: 'Spot it?', emphasis: true },
      { text: ' Report it — ' },
      { text: 'from a distance.', emphasis: true },
    ],
    body: 'Snap a photo in the app and we handle the rest.',
    safetyLine: ONBOARDING_SAFETY_LINE,
  },
  {
    key: 'recovered',
    // The payoff phrase keeps the emphasis the old headlineAccent marked —
    // as weight, which is visible, rather than as a near-black on near-black.
    headline: [{ text: 'Recovered — ' }, { text: 'bounty paid.', emphasis: true }],
    body: 'When a sighting leads to recovery, the spotter earns the bounty.',
  },
];
