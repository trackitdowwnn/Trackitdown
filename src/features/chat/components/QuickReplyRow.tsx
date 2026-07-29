/**
 * WHAT:  QuickReplyRow — a horizontally scrollable row of one-tap reply
 *        chips above the composer. Tapping one hands its text to the caller
 *        (who puts it in the input, editable) — this component never sends.
 * WHY:   Reply speed decides outcomes (Airbnb's messaging data; truer here,
 *        where the first reply to a sighting is time-critical). The row
 *        appears only while the input is EMPTY: once someone is typing they
 *        have found their words, and the row would push the thread up for
 *        nothing. ChoiceChips isn't reused because these are one-tap ACTIONS
 *        in a horizontal scroller, not a persistent selection — role="button"
 *        per chip, no selected state, no wrap.
 * LINKS: src/features/chat/lib/quickReplies.ts (the sets + safety rules);
 *        src/features/chat/screens/ChatThreadScreen.tsx (owns the draft);
 *        docs/DESIGN_SYSTEM.md (chips, motion, accessibility).
 */

import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { colors, motion, radii, sizes, spacing, typography } from '@/shared/theme';

export interface QuickReplyRowProps {
  replies: readonly string[];
  /** Insert this text into the composer — the CALLER sends, never this row. */
  onPick: (reply: string) => void;
}

export function QuickReplyRow({ replies, onPick }: QuickReplyRowProps) {
  if (replies.length === 0) {
    return null;
  }
  return (
    <Animated.View entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // The chips are the accessible elements; the scroller is chrome.
        testID="quick-reply-row"
      >
        {replies.map((reply) => (
          <Pressable
            key={reply}
            onPress={() => onPick(reply)}
            accessibilityRole="button"
            // Says what it DOES (fills the box), not "sends" — it doesn't.
            accessibilityLabel={`${reply} — puts this in the message box to edit or send`}
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            testID={`quick-reply-${reply}`}
          >
            <Text style={styles.chipText} numberOfLines={1}>
              {reply}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  chip: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  chipPressed: {
    backgroundColor: colors.surfaceSubtlePressed,
  },
  chipText: {
    ...typography.label,
    color: colors.textPrimary,
  },
});
