/**
 * WHAT:  Tests for the onboarding progress dots — the position they report, the
 *        single node they report it through, and the fact that the current dot
 *        is a different SHAPE and not merely a different colour.
 * WHY:   This row exists because the rebuild deleted the ring FAB, which was
 *        the only thing telling a reader the intro had a length. It arrived
 *        with no test of its own while the ring it replaced had 124 lines of
 *        them. The two decisions its header calls load-bearing — width as well
 *        as tone, and one accessibility node rather than four — are exactly the
 *        kind that a later tidy-up removes without noticing, so they are
 *        asserted here rather than left to the screen suite.
 * LINKS: ./OnboardingDots.tsx; ../screens/OnboardingScreen.tsx (the consumer);
 *        docs/DESIGN_SYSTEM.md (never encode by colour alone).
 */

import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { OnboardingDots } from './OnboardingDots';

const widthsOf = (view: Awaited<ReturnType<typeof render>>) =>
  view
    .getByTestId('onboarding-dots')
    .children.map((child) =>
      typeof child === 'string'
        ? null
        : (StyleSheet.flatten(child.props.style as StyleProp<ViewStyle>)?.width as
            | number
            | undefined) ?? null,
    );

describe('what it reports', () => {
  it('renders one dot per slide', async () => {
    const view = await render(<OnboardingDots page={0} total={4} />);

    expect(widthsOf(view)).toHaveLength(4);
  });

  it('names the position for a screen reader', async () => {
    const view = await render(<OnboardingDots page={2} total={4} />);

    expect(view.getByTestId('onboarding-dots').props.accessibilityLabel).toBe('Step 3 of 4');
  });

  // ⚠️ VALUE AS WELL AS LABEL. `progressbar` with no value is announced as an
  // INDETERMINATE bar — a spinner — which is the opposite of what a four-step
  // row is for. WizardProgressBar states the same rule for the same role.
  it('carries a value, so it is not announced as indeterminate', async () => {
    const view = await render(<OnboardingDots page={1} total={4} />);

    expect(view.getByTestId('onboarding-dots').props.accessibilityValue).toEqual({
      min: 1,
      max: 4,
      now: 2,
    });
  });

  // ⚠️ ONE NODE, NOT FOUR. A reader should hear the position once, never four
  // unlabelled decorations between the copy and the button.
  it('hides the individual dots from the accessibility tree', async () => {
    const view = await render(<OnboardingDots page={0} total={4} />);

    for (const child of view.getByTestId('onboarding-dots').children) {
      if (typeof child === 'string') continue;
      expect(child.props.importantForAccessibility).toBe('no');
    }
  });
});

// ⚠️ THE POINT OF THIS FILE. DESIGN_SYSTEM forbids encoding state by colour
// alone, and the current dot's tone against the resting one is the kind of
// difference a reader with low vision or a colour deficiency may not resolve.
// The width is the redundant channel, and nothing else in the app would fail if
// it were quietly dropped in favour of "just make it darker".
describe('⚠️ the current dot differs by SHAPE, not only tone', () => {
  it.each([0, 1, 2, 3])('is wider than its neighbours on slide %i', async (page) => {
    const view = await render(<OnboardingDots page={page} total={4} />);
    const widths = widthsOf(view);
    const current = widths[page];

    expect(current).toBeDefined();
    widths.forEach((width, index) => {
      if (index === page) return;
      expect(current as number).toBeGreaterThan(width as number);
    });
  });

  it('gives exactly one dot the wide treatment', async () => {
    const view = await render(<OnboardingDots page={2} total={4} />);
    const widths = widthsOf(view);
    const widest = Math.max(...(widths as number[]));

    expect(widths.filter((width) => width === widest)).toHaveLength(1);
  });
});
