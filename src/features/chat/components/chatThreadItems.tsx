/**
 * WHAT:  The thread's render pieces — MessageBubble (mine right on primary,
 *        theirs left on surfaceSubtle, optional time caption, long-press →
 *        report), OutgoingBubble (pending "Sending…" / failed "Not sent —
 *        tap to retry", text always retained), SystemMessage (centred,
 *        quiet — never a fake user bubble), and DaySeparator.
 * WHY:   Calm bubbles per the design system: no tails, radius `lg`, times
 *        appear only where messageGroups says a gap earns one. The failed
 *        state is deliberately louder than anything else here — losing a
 *        user's words silently is the one unforgivable chat sin.
 * LINKS: src/features/chat/lib/messageGroups.ts (what renders when);
 *        docs/DESIGN_SYSTEM.md (colours, radii, tone);
 *        docs/DOMAIN.md (Chat: the system safety message).
 */

import { type AccessibilityActionEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, spacing, typography } from '@/shared/theme';

import type { ChatMessage, OutgoingMessage } from '../types';

/** Bubbles never span the full column — the asymmetry is what reads as a
 *  conversation. A percentage (not a sizes token, which are px) kept named. */
const BUBBLE_MAX_WIDTH = '80%';

/** Local time for the small caption above a group ("14:32", device locale). */
function timeCaption(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// --- Persisted user message -----------------------------------------------------

export interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  showTime: boolean;
  /** The other participant's first name, for a warm a11y label ("Sam: …"). */
  otherName?: string;
  /** Report a message. Own messages aren't reportable (queue noise). */
  onReport?: (message: ChatMessage) => void;
}

export function MessageBubble({ message, mine, showTime, otherName, onReport }: MessageBubbleProps) {
  const reportable = Boolean(onReport) && !mine;
  const report = () => {
    if (reportable) onReport?.(message);
  };
  // Screen readers can't synthesise a long-press, so the report path is ALSO
  // an accessibility action (VoiceOver/TalkBack rotor) — not gesture-only.
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'report') report();
  };

  return (
    <View style={[styles.messageBlock, mine ? styles.blockMine : styles.blockTheirs]}>
      {showTime ? <Text style={styles.time}>{timeCaption(message.createdAt)}</Text> : null}
      <Pressable
        onLongPress={report}
        accessibilityLabel={`${mine ? 'You' : (otherName ?? 'They')}: ${message.content}`}
        accessibilityHint={reportable ? 'Long-press or use the report action' : undefined}
        accessibilityActions={reportable ? [{ name: 'report', label: 'Report this message' }] : undefined}
        onAccessibilityAction={reportable ? handleAccessibilityAction : undefined}
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
        testID={`bubble-${message.id}`}
      >
        <Text style={mine ? styles.textMine : styles.textTheirs}>{message.content}</Text>
      </Pressable>
    </View>
  );
}

// --- Optimistic outgoing -----------------------------------------------------------

export interface OutgoingBubbleProps {
  message: OutgoingMessage;
  onRetry: (localId: string) => void;
}

export function OutgoingBubble({ message, onRetry }: OutgoingBubbleProps) {
  const failed = message.state === 'failed';
  return (
    <View style={[styles.messageBlock, styles.blockMine]}>
      <Pressable
        disabled={!failed}
        onPress={() => onRetry(message.localId)}
        accessibilityRole={failed ? 'button' : undefined}
        accessibilityLabel={
          failed ? `Not sent: ${message.content}. Tap to retry.` : `Sending: ${message.content}`
        }
        style={[styles.bubble, styles.bubbleMine, !failed && styles.bubblePending]}
        testID={`outgoing-${message.localId}`}
      >
        <Text style={styles.textMine}>{message.content}</Text>
      </Pressable>
      <Text style={[styles.deliveryState, failed && styles.deliveryFailed]}>
        {failed ? 'Not sent — tap the message to retry' : 'Sending…'}
      </Text>
    </View>
  );
}

// --- System + day chrome --------------------------------------------------------------

/** DOMAIN: the automatic safety first message — centred and quiet, visually
 *  distinct from every human bubble. */
export function SystemMessage({ message }: { message: ChatMessage }) {
  return (
    <View style={styles.systemBlock} testID={`system-${message.id}`}>
      <Text style={styles.systemText}>{message.content}</Text>
    </View>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <View style={styles.dayBlock}>
      <Text style={styles.dayText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  messageBlock: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  blockMine: {
    alignItems: 'flex-end',
  },
  blockTheirs: {
    alignItems: 'flex-start',
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceSubtle,
  },
  bubblePending: {
    opacity: opacity.inactive,
  },
  textMine: {
    ...typography.body,
    color: colors.textOnPrimary,
  },
  textTheirs: {
    ...typography.body,
    color: colors.textPrimary,
  },
  deliveryState: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  deliveryFailed: {
    color: colors.danger,
  },
  systemBlock: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  systemText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  dayBlock: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  dayText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
