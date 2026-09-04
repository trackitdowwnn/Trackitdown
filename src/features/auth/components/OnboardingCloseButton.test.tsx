/**
 * WHAT:  Tests for the intro's X — that it announces the ACTION rather than the
 *        glyph, that it is a full touch target, and that it carries its own
 *        edge rather than relying on a shadow.
 * WHY:   It is the only way out of a four-slide intro, so "can a user find it
 *        and hit it" is the whole contract. The border is here because shipping
 *        without it left the chip at 1.11:1 against the dark map field —
 *        invisible except for a shadow that DESIGN_SYSTEM says "barely
 *        registers" on dark. That is not a detail a screen-level test would
 *        ever notice.
 * LINKS: ./OnboardingCloseButton.tsx; ../screens/OnboardingScreen.tsx;
 *        src/shared/ui/PlateChip.tsx (the hairline precedent);
 *        docs/DESIGN_SYSTEM.md (shadows on dark; touch targets).
 */

import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { sizes } from '@/shared/theme';

import { OnboardingCloseButton } from './OnboardingCloseButton';

const styleOf = (view: Awaited<ReturnType<typeof render>>) => {
  const node = view.getByTestId('onboarding-skip');
  const style = node.props.style as unknown;
  // Pressable takes a style FUNCTION; resolve the resting state.
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style);
};

describe('the way out', () => {
  it('calls back when pressed', async () => {
    const onPress = jest.fn();
    const view = await render(<OnboardingCloseButton onPress={onPress} />);

    fireEvent.press(view.getByTestId('onboarding-skip'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // ⚠️ "Skip", NOT "Close". The glyph is an X but the ACTION is leaving the
  // intro; "Close" would suggest a dialog the reader had opened, which they had
  // not. The screen suite presses this control by exactly this name.
  it('announces the action rather than the glyph', async () => {
    const view = await render(<OnboardingCloseButton onPress={jest.fn()} />);
    const node = view.getByTestId('onboarding-skip');

    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityLabel).toBe('Skip');
    expect(node.props.accessibilityHint).toBe('Skips the intro and opens the app');
  });

  it('is a full touch target', async () => {
    const view = await render(<OnboardingCloseButton onPress={jest.fn()} />);
    const style = styleOf(view);

    expect(style.width).toBe(sizes.touchTarget);
    expect(style.height).toBe(sizes.touchTarget);
  });
});

describe('⚠️ it holds its own edge', () => {
  // Shipped without this the chip was a #222222 square on a #2A2A2A map field —
  // 1.11:1, no edge at all in dark mode, leaning entirely on a shadow that
  // casts black. The hairline is what makes it a button rather than a hole.
  it('draws a hairline, not just a shadow', async () => {
    const view = await render(<OnboardingCloseButton onPress={jest.fn()} />);
    const style = styleOf(view);

    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.borderColor).toBeTruthy();
    expect(style.borderColor).not.toBe(style.backgroundColor);
  });

  // ⚠️ A ROUNDED SQUARE, NOT A PILL. Every other floating element over this
  // hero is full-radius; the difference is what separates chrome from content.
  it('is a rounded square rather than a circle', async () => {
    const view = await render(<OnboardingCloseButton onPress={jest.fn()} />);
    const style = styleOf(view);

    expect(style.borderRadius).toBeLessThan(sizes.touchTarget / 2);
  });
});
