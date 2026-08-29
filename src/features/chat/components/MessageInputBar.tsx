/**
 * WHAT:  MessageInputBar — the thread's composer: a rounded pill holding a
 *        multiline TextInput that grows with the message up to a cap and then
 *        scrolls, plus a round send button that enables only when there is
 *        content.
 * WHY:   This used to wrap the shared form TextField, and a form control is
 *        the wrong object here. It brought a FLOATING LABEL reading "Message"
 *        (a chat box is identified by its placeholder, not a label that slides
 *        up and permanently steals a line) and reserved helper-text space that
 *        nothing ever filled — the send button carried a `marginBottom` fudge
 *        purely to sit level with the space that reservation created. Both are
 *        gone: the pill is exactly as tall as the text in it.
 *
 *        The height cap matters more than it looks. Unbounded, a pasted
 *        paragraph pushes the entire conversation off screen, so growth stops
 *        at COMPOSER_MAX_HEIGHT and the field scrolls inside itself — you can
 *        always still see who you are talking to. The input stays controlled
 *        by the SCREEN (text survives a failed send there, not here) and
 *        sending is delegated up, so the optimistic-send contract stays in
 *        useThreadMessages where it's tested.
 * LINKS: src/features/chat/screens/ChatThreadScreen.tsx (owner of state);
 *        docs/DESIGN_SYSTEM.md (targets, radii, calm).
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

/** Roughly four lines of body text before the field scrolls instead of grows. */
const COMPOSER_MAX_HEIGHT = 120;

export interface MessageInputBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  maxLength: number;
}

export function MessageInputBar({ value, onChangeText, onSend, maxLength }: MessageInputBarProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const canSend = value.trim().length > 0;
  return (
    <View style={styles.bar}>
      <View style={styles.pill}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          multiline
          placeholder="Message…"
          placeholderTextColor={palette.textSecondary}
          style={styles.input}
          // The pill IS the label — announce it rather than leaving a bare
          // edit box, since there is no visible label to read.
          accessibilityLabel="Message"
          testID="message-input"
        />
      </View>
      <Pressable
        onPress={onSend}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
        style={({ pressed }) => [
          styles.send,
          pressed && styles.sendPressed,
          !canSend && styles.sendDisabled,
        ]}
        testID="send-button"
      >
        <Feather name="arrow-up" size={sizes.icon} color={palette.textOnPrimary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // ⚠️ A TOP HAIRLINE. The bar is `background` — the same fill as the page —
  // so without an edge the newest bubble and the input box read as touching,
  // and the screen runs as one continuous field from the header to the bottom
  // inset. AppTabBar sets the precedent: a bar, a hairline top edge, no shadow.
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    flexDirection: 'row',
    // Bottom-aligned so a growing pill rises while the send button stays put
    // on the baseline — the button must not drift up the screen as you type.
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: c.background,
  },
  pill: {
    flex: 1,
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingHorizontal: spacing.lg,
  },
  input: {
    ...typography.body,
    color: c.textPrimary,
    maxHeight: COMPOSER_MAX_HEIGHT,
    // Android pads the font box asymmetrically, which tips a single-line
    // value off the pill's optical centre (DESIGN_SYSTEM, Typography).
    includeFontPadding: false,
    paddingVertical: spacing.sm,
    // RN gives multiline inputs a platform top inset on iOS; zeroing it keeps
    // one line centred in the pill on both platforms.
    paddingTop: spacing.sm,
  },
  send: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.full,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: {
    backgroundColor: c.primaryPressed,
  },
  sendDisabled: {
    opacity: opacity.disabled,
  },
});
