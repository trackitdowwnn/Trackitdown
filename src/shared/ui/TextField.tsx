/**
 * WHAT:  TextField — the app's controlled text-input primitive. A themed
 *        wrapper around React Native's TextInput with a FLOATING label,
 *        helper/error text, focus states, and keyboard/format variants (text,
 *        multiline, email, plate).
 * WHY:   Forms are everywhere (posting stepper, auth, chat, bounty entry) and
 *        must look and behave identically. The `label` doubles as the
 *        placeholder: it rests inside the field and floats up (200ms ease-out)
 *        when the field is focused or holds a value. A separate `placeholder`
 *        is an optional format hint shown only while focused. The component is
 *        presentational and form-library-agnostic (value/onChangeText/onBlur/
 *        error), so a react-hook-form <Controller> can drive it later. Styling
 *        is tokens-only (docs/DESIGN_SYSTEM.md): border on default, sage
 *        `primary` on focus, muted `danger` on error. The `plate` variant only
 *        *formats* input (uppercase + letter-spacing); plate validation lives at
 *        the form layer.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour, Typography, Forms, Accessibility);
 *        src/shared/theme.
 *
 * Usage:
 *   <TextField
 *     label="Number plate"        // floats up on focus / when filled
 *     variant="plate"
 *     value={plate}
 *     onChangeText={setPlate}
 *     placeholder="AB12 CDE"       // hint shown only while focused
 *     error={errors.plate}
 *     helperText="As shown on the car"
 *   />
 */

import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';

// Derive the focus/blur event types from TextInput itself so we stay correct
// across React Native versions (RN split these into FocusEvent/BlurEvent).
type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

export type TextFieldVariant = 'text' | 'multiline' | 'email' | 'plate';

export interface TextFieldProps
  extends Omit<TextInputProps, 'value' | 'onChangeText' | 'editable' | 'style'> {
  /** Floating label — rests as the placeholder, floats up on focus/value. */
  label?: string;
  /** Controlled value. */
  value: string;
  /** Change handler. For the `plate` variant the text is uppercased first. */
  onChangeText: (text: string) => void;
  /** Error message. When set, styles the field as invalid and replaces helperText. */
  error?: string;
  /** Hint shown below the input when there is no error. */
  helperText?: string;
  /** Keyboard + formatting preset. */
  variant?: TextFieldVariant;
  /** Disables input and mutes the field. */
  disabled?: boolean;
}

/** Per-variant TextInput defaults; callers can still override via ...rest. */
const VARIANT_PROPS: Record<TextFieldVariant, Partial<TextInputProps>> = {
  text: {},
  multiline: { multiline: true, textAlignVertical: 'top' },
  email: {
    keyboardType: 'email-address',
    autoCapitalize: 'none',
    autoComplete: 'email',
    autoCorrect: false,
  },
  plate: { autoCapitalize: 'characters', autoCorrect: false, maxLength: 8 },
};

// Floating-label geometry (component-internal animation, derived from tokens).
// Resting Y centres the label in a single-line control; multiline rests at the
// top where typing begins; both float to `spacing.sm` from the top edge.
const LABEL_FLOAT_Y = spacing.sm;
const LABEL_REST_Y_SINGLE = (sizes.input - typography.body.lineHeight) / 2;
const LABEL_REST_Y_MULTILINE = spacing.xl;

export function TextField({
  label,
  value,
  onChangeText,
  error,
  helperText,
  variant = 'text',
  disabled = false,
  placeholder,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hasFloatingLabel = Boolean(label);
  const isMultiline = variant === 'multiline';
  // The label floats up whenever the field is focused or already holds a value.
  const floated = focused || value.length > 0;

  // Two JS-driven animations (colour + layout can't use the native driver):
  // `floatAnim` moves/shrinks the label; `focusAnim` tints border + label.
  const [floatAnim] = useState(() => new Animated.Value(floated ? 1 : 0));
  const [focusAnim] = useState(() => new Animated.Value(focused ? 1 : 0));

  const animate = (v: Animated.Value, toValue: number) =>
    Animated.timing(v, {
      toValue,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();

  useEffect(() => {
    animate(floatAnim, floated ? 1 : 0);
  }, [floated, floatAnim]);

  useEffect(() => {
    animate(focusAnim, focused ? 1 : 0);
  }, [focused, focusAnim]);

  // iOS has no accessibilityLiveRegion; announce errors explicitly so VoiceOver
  // users hear them the moment they appear (Android also gets the live region).
  useEffect(() => {
    if (error) {
      AccessibilityInfo.announceForAccessibility(label ? `${label}: ${error}` : error);
    }
  }, [error, label]);

  const handleFocus = (e: FocusEvent) => {
    setFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: BlurEvent) => {
    setFocused(false);
    onBlur?.(e);
  };

  const handleChangeText = (text: string) =>
    onChangeText(variant === 'plate' ? text.toUpperCase() : text);

  // Error colour is static and wins over the focus transition.
  const borderColor = error
    ? colors.danger
    : focusAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.primary] });

  const labelColor = error
    ? colors.danger
    : focusAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.textSecondary, colors.primary],
      });

  const message = error ?? helperText;

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.inputWrap,
          hasFloatingLabel
            ? isMultiline
              ? styles.inputWrapFloatingMultiline
              : styles.inputWrapFloating
            : isMultiline
              ? styles.inputWrapPlainMultiline
              : styles.inputWrapPlain,
          { borderColor },
          disabled && styles.inputWrapDisabled,
        ]}
      >
        {hasFloatingLabel ? (
          <Animated.Text
            // Hidden from the a11y tree: the input's accessibilityLabel carries
            // this name. pointerEvents none lets taps fall through to the input.
            accessibilityElementsHidden
            importantForAccessibility="no"
            pointerEvents="none"
            numberOfLines={1}
            style={[
              styles.floatingLabel,
              {
                color: labelColor,
                fontSize: floatAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [typography.body.fontSize, typography.caption.fontSize],
                }),
                transform: [
                  {
                    translateY: floatAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [
                        isMultiline ? LABEL_REST_Y_MULTILINE : LABEL_REST_Y_SINGLE,
                        LABEL_FLOAT_Y,
                      ],
                    }),
                  },
                ],
              },
            ]}
          >
            {label}
          </Animated.Text>
        ) : null}

        <TextInput
          value={value}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          editable={!disabled}
          // With a floating label the label IS the placeholder; only surface the
          // format hint once focused. Without a label, show it as a normal placeholder.
          placeholder={hasFloatingLabel ? (focused ? placeholder : undefined) : placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[
            styles.input,
            hasFloatingLabel && styles.inputFloating,
            variant === 'plate' && styles.inputPlate,
          ]}
          accessibilityLabel={label ? (error ? `${label}, error: ${error}` : label) : undefined}
          accessibilityState={{ disabled }}
          aria-invalid={error ? true : undefined}
          {...VARIANT_PROPS[variant]}
          {...rest}
        />
      </Animated.View>

      {message ? (
        <Text
          style={[styles.message, error ? styles.messageError : styles.messageHelper]}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  inputWrap: {
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  // Floating-label modes reserve top room for the floated label via input padding.
  inputWrapFloating: {
    minHeight: sizes.input,
  },
  inputWrapFloatingMultiline: {
    minHeight: sizes.multilineMin,
  },
  // Plain (label-less) modes centre single-line text and pad multiline.
  inputWrapPlain: {
    minHeight: sizes.control,
    justifyContent: 'center',
  },
  inputWrapPlainMultiline: {
    minHeight: sizes.multilineMin,
    paddingVertical: spacing.md,
  },
  inputWrapDisabled: {
    backgroundColor: colors.surfaceSubtle,
    opacity: opacity.disabled,
  },
  floatingLabel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    fontWeight: typography.label.fontWeight,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    padding: 0,
  },
  // Push text into the lower part of the box so the floated label sits above it.
  inputFloating: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  inputPlate: {
    ...typography.plate,
  },
  message: {
    ...typography.caption,
  },
  messageHelper: {
    color: colors.textSecondary,
  },
  messageError: {
    color: colors.danger,
  },
});
