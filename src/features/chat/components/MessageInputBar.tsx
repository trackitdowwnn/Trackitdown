/**
 * WHAT:  MessageInputBar — the thread's composer: a multiline TextField and
 *        a round send button that enables only when there is content.
 * WHY:   The input is controlled by the SCREEN (the text survives a failed
 *        send there, not here) and sending is delegated up — this bar is
 *        purely presentational so the optimistic-send contract stays in
 *        useThreadMessages where it's tested.
 * LINKS: src/features/chat/screens/ChatThreadScreen.tsx (owner of state);
 *        src/shared/ui/TextField.tsx; docs/DESIGN_SYSTEM.md (targets, calm).
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, opacity, radii, sizes, spacing } from '@/shared/theme';
import { TextField } from '@/shared/ui';

export interface MessageInputBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  maxLength: number;
}

export function MessageInputBar({ value, onChangeText, onSend, maxLength }: MessageInputBarProps) {
  const canSend = value.trim().length > 0;
  return (
    <View style={styles.bar}>
      <View style={styles.field}>
        <TextField
          label="Message"
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          multiline
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
        <Feather name="arrow-up" size={sizes.icon} color={colors.textOnPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  field: {
    flex: 1,
  },
  send: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // Sit level with the input's box (the TextField reserves helper space).
    marginBottom: spacing.md,
  },
  sendPressed: {
    backgroundColor: colors.primaryPressed,
  },
  sendDisabled: {
    opacity: opacity.disabled,
  },
});
