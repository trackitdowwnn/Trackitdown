/**
 * WHAT:  Tests for OtpInput — typing advances the value, a full pasted code
 *        auto-submits via onComplete, non-digits are stripped, and a submitting
 *        input is not editable.
 * WHY:   The one-hidden-input design is what makes paste + autofill work; if it
 *        mis-handled a paste or fired onComplete at the wrong length, sign-in
 *        would stall on the last screen before the app.
 * LINKS: src/features/auth/components/OtpInput.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import { OtpInput } from './OtpInput';

/** Render inside act so the RN Animated node settles before the next test. */
async function renderOtp(props: Partial<React.ComponentProps<typeof OtpInput>> = {}) {
  const onChangeText = jest.fn();
  const onComplete = jest.fn();
  await act(async () => {
    render(
      <OtpInput
        value=""
        onChangeText={onChangeText}
        onComplete={onComplete}
        autoFocus={false}
        {...props}
      />,
    );
  });
  return { onChangeText, onComplete };
}

const type = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('otp-hidden-input'), text);
  });
};

describe('OtpInput', () => {
  it('reports typed digits and auto-submits the full code', async () => {
    const { onChangeText, onComplete } = await renderOtp();

    await type('1234');
    expect(onChangeText).toHaveBeenLastCalledWith('1234');
    expect(onComplete).not.toHaveBeenCalled();

    await type('12345678');
    expect(onComplete).toHaveBeenCalledWith('12345678');
  });

  it('accepts a full pasted code and strips non-digits', async () => {
    const { onChangeText, onComplete } = await renderOtp();

    // A pasted "1 2-3.4 5 6 7 8" arrives as one change event.
    await type('1 2-3.4 5 6 7 8');
    expect(onChangeText).toHaveBeenLastCalledWith('12345678');
    expect(onComplete).toHaveBeenCalledWith('12345678');
  });

  it('caps input at the code length', async () => {
    const { onComplete } = await renderOtp();
    await type('123456789');
    expect(onComplete).toHaveBeenCalledWith('12345678');
  });

  it('is not editable while submitting', async () => {
    await renderOtp({ value: '12345678', submitting: true });
    expect(screen.getByTestId('otp-hidden-input').props.editable).toBe(false);
  });

  // Regression: the real input must be hidden differently per platform.
  // Android IMEs (Samsung keyboard) draw composing text in their own color,
  // ignoring `color: 'transparent'` — every typed digit piled up visibly over
  // the first box. iOS must KEEP transparent-color hiding (not opacity: 0) or
  // it stops offering one-time-code autofill.
  describe('hidden-input visibility', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const hiddenInputStyle = () =>
      StyleSheet.flatten(screen.getByTestId('otp-hidden-input').props.style);

    it('hides via opacity on Android, where the IME ignores transparent text color', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      await renderOtp();
      expect(hiddenInputStyle().opacity).toBe(0);
    });

    it('hides via transparent color (never opacity) on iOS to keep autofill', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      await renderOtp();
      const style = hiddenInputStyle();
      expect(style.color).toBe('transparent');
      expect(style.opacity).toBeUndefined();
    });
  });
});
