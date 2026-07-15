/**
 * WHAT:  OtpInput — the 8-digit code entry: a row of boxes driven by ONE hidden
 *        TextInput. Auto-advances as you type, accepts a full pasted code, auto-
 *        submits on the last digit, and shakes (then the parent clears) on a
 *        wrong code.
 * WHY:   A single real input (not six) is what makes paste + iOS's "from Mail"
 *        one-time-code autofill work, while the boxes are the calm visual. The
 *        shake + "check the latest email" copy keep a wrong code gentle — never
 *        lock-out language (SECURITY_AND_TRUST tone). Submitting state lives on
 *        the boxes, not a fullscreen loader, so the screen stays put.
 * LINKS: src/features/auth/components/AuthSheet.tsx (consumer);
 *        docs/DESIGN_SYSTEM.md (Forms, Motion, Accessibility).
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '@/shared/theme';
import { HostTextInput } from '@/shared/ui';

// Must match Supabase's `otp_length` (supabase/config.toml + the hosted
// dashboard). Both are 8 — a code shorter than this never auto-submits.
const DEFAULT_LENGTH = 8;
const SHAKE_MS = 60;
// A brief left-right nudge — RN's Animated (not reanimated) keeps this one-off
// dependency-light and jest-friendly, and it needs no shared values. Not gated
// on reduce-motion: it's essential, sub-quarter-second error feedback ("that
// code was wrong"), not decorative motion.
const SHAKE_SEQUENCE = [-8, 8, -6, 0];

export interface OtpInputProps {
  /** Controlled value — digits entered so far. */
  value: string;
  onChangeText: (value: string) => void;
  /** Fires once the code reaches full length (auto-submit). */
  onComplete: (code: string) => void;
  length?: number;
  /** Boxes read as busy while the code is being verified. */
  submitting?: boolean;
  /** Bump this to shake (a wrong code); the parent clears `value` alongside. */
  errorNonce?: number;
  autoFocus?: boolean;
}

export function OtpInput({
  value,
  onChangeText,
  onComplete,
  length = DEFAULT_LENGTH,
  submitting = false,
  errorNonce = 0,
  autoFocus = true,
}: OtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  // Lazy useState (not useRef().current) so the value is created once without
  // reading a ref during render (react-compiler lint).
  const [shakeX] = useState(() => new Animated.Value(0));

  // Shake on each new error nonce (skip the initial 0).
  useEffect(() => {
    if (errorNonce === 0) return;
    Animated.sequence(
      SHAKE_SEQUENCE.map((toValue) =>
        Animated.timing(shakeX, { toValue, duration: SHAKE_MS, useNativeDriver: true }),
      ),
    ).start();
  }, [errorNonce, shakeX]);

  const handleChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, length);
    onChangeText(digits);
    if (digits.length === length) {
      onComplete(digits);
    }
  };

  // Tap-to-focus with a keyboard guard: on Android, Back dismisses the
  // keyboard WITHOUT blurring the input, so a plain focus() would no-op and
  // the number pad would never come back. Cycle blur → focus when already
  // focused to force the keyboard up again.
  const refocus = () => {
    const input = inputRef.current;
    if (!input) return;
    if (input.isFocused()) {
      input.blur();
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      input.focus();
    }
  };

  const activeIndex = value.length;

  return (
    <Pressable onPress={refocus}>
      <Animated.View style={[styles.row, { transform: [{ translateX: shakeX }] }]}>
        {Array.from({ length }).map((_, index) => {
          const filled = index < value.length;
          const active = index === activeIndex;
          return (
            <View
              key={index}
              style={[
                styles.box,
                filled && styles.boxFilled,
                active && !submitting && styles.boxActive,
                submitting && styles.boxSubmitting,
              ]}
              importantForAccessibility="no"
            >
              <Text style={styles.digit}>{value[index] ?? ''}</Text>
            </View>
          );
        })}
      </Animated.View>

      {/* The one real input — hidden over the boxes so a tap focuses it and
          iOS/Android can autofill the emailed code. HostTextInput (not a raw
          TextInput) so that inside a BottomSheet it renders the sheet-aware
          input and the sheet rises clear of the keyboard on iOS. */}
      <HostTextInput
        ref={inputRef}
        testID="otp-hidden-input"
        style={[
          StyleSheet.absoluteFill,
          Platform.OS === 'android' ? styles.hiddenInputAndroid : styles.hiddenInput,
        ]}
        value={value}
        onChangeText={handleChange}
        editable={!submitting}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        caretHidden
        autoFocus={autoFocus}
        accessibilityLabel={`${length}-digit verification code`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  box: {
    flex: 1,
    height: sizes.control,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: {
    borderColor: colors.borderStrong,
  },
  boxActive: {
    borderColor: colors.primary,
  },
  boxSubmitting: {
    opacity: opacity.disabled,
  },
  // iOS: text/background transparent — NOT opacity: 0 — so iOS still treats
  // the input as visible and offers one-time-code autofill; the boxes render
  // the digits instead.
  hiddenInput: {
    color: 'transparent',
    backgroundColor: 'transparent',
  },
  // Android: opacity 0 — transparent color is NOT enough there: IMEs (seen on
  // the Samsung keyboard) draw the composing text themselves, ignoring the
  // input's text color, which piles every typed digit visibly over the first
  // box. opacity: 0 hides the IME's drawing too, still receives taps, and
  // costs nothing: Android's code assist lives in the keyboard's suggestion
  // strip, which doesn't require a visible input.
  hiddenInputAndroid: {
    opacity: 0,
  },
  digit: {
    ...typography.title,
    color: colors.textPrimary,
  },
});
