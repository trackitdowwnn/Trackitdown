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

import {
  type AccessibilityActionEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { opacity, radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { blockPaddingTop, type MessageGroupPos } from '../lib/messageGroups';
import type { ChatMessage, OutgoingMessage } from '../types';

/** Bubbles never span the full column — the asymmetry is what reads as a
 *  conversation. A percentage (not a sizes token, which are px) kept named. */
const BUBBLE_MAX_WIDTH = '80%';

/**
 * Grouped-corner anatomy (Airbnb's refreshed threads): within a same-sender
 * run, the corners FACING the run tighten to radii.sm while the outer corners
 * keep radii.lg — three quick messages read as one thought. The tightened
 * side is the side the bubble sits on (right for mine, left for theirs).
 */
function groupedCorners(mine: boolean, groupPos: MessageGroupPos): ViewStyle | null {
  if (groupPos === 'single') {
    return null;
  }
  const towardPrevious = mine ? 'borderTopRightRadius' : 'borderTopLeftRadius';
  const towardNext = mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius';
  if (groupPos === 'first') {
    return { [towardNext]: radii.sm };
  }
  if (groupPos === 'last') {
    return { [towardPrevious]: radii.sm };
  }
  return { [towardPrevious]: radii.sm, [towardNext]: radii.sm };
}

/** Local time for the small caption above a group ("14:32", device locale). */
function timeCaption(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// --- Persisted user message -----------------------------------------------------

export interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  showTime: boolean;
  /** Position in a same-sender run — drives the grouped-corner treatment AND
   *  the gap above (see messageGroups.blockPaddingTop). */
  groupPos?: MessageGroupPos;
  /** True when a day rule or system message sits directly above, which already
   *  pads by 16 — the bubble then adds nothing of its own. */
  afterSeparator?: boolean;
  /** Renders a quiet "Seen" beneath — set on AT MOST one bubble per thread
   *  (messageGroups.latestSeenOutboundId picks it). */
  seen?: boolean;
  /** The other participant's first name, for a warm a11y label ("Sam: …"). */
  otherName?: string;
  /** Report a message. Own messages aren't reportable (queue noise). */
  onReport?: (message: ChatMessage) => void;
}

export function MessageBubble({
  message,
  mine,
  showTime,
  groupPos = 'single',
  afterSeparator = false,
  seen = false,
  otherName,
  onReport,
}: MessageBubbleProps) {
  const styles = useThemedStyles(makeStyles);
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
    <View
      style={[
        styles.messageBlock,
        mine ? styles.blockMine : styles.blockTheirs,
        { paddingTop: blockPaddingTop(groupPos, afterSeparator) },
      ]}
    >
      {showTime ? <Text style={styles.time}>{timeCaption(message.createdAt)}</Text> : null}
      <Pressable
        onLongPress={report}
        // ⚠️ THE TIME IS IN EVERY LABEL, though it is drawn above only one
        // bubble per group. Sighted readers infer a message's time from the
        // caption above its run; a screen-reader user moving bubble by bubble
        // never meets that caption, so before this they could not get the time
        // of any message that did not happen to lead a group.
        accessibilityLabel={
          `${mine ? 'You' : (otherName ?? 'They')}: ${message.content}, ` +
          `${timeCaption(message.createdAt)}`
        }
        accessibilityHint={reportable ? 'Long-press or use the report action' : undefined}
        accessibilityActions={reportable ? [{ name: 'report', label: 'Report this message' }] : undefined}
        onAccessibilityAction={reportable ? handleAccessibilityAction : undefined}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          groupedCorners(mine, groupPos),
        ]}
        testID={`bubble-${message.id}`}
      >
        <Text style={mine ? styles.textMine : styles.textTheirs}>{message.content}</Text>
      </Pressable>
      {seen ? (
        // The thread-level read stamp, worn by the newest covered message —
        // deliberately "Seen", not "Seen at 14:32": the marker means "they
        // had the thread open", and the caption must not claim more.
        <Text style={styles.seen} testID={`seen-${message.id}`}>
          Seen
        </Text>
      ) : null}
    </View>
  );
}

// --- Optimistic outgoing -----------------------------------------------------------

export interface OutgoingBubbleProps {
  message: OutgoingMessage;
  onRetry: (localId: string) => void;
}

export function OutgoingBubble({ message, onRetry }: OutgoingBubbleProps) {
  const styles = useThemedStyles(makeStyles);
  const failed = message.state === 'failed';
  return (
    // Always the newest thing in the thread, so it always starts a run.
    <View style={[styles.messageBlock, styles.blockMine, { paddingTop: spacing.md }]}>
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
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.systemBlock} testID={`system-${message.id}`}>
      <Text style={styles.systemText}>{message.content}</Text>
    </View>
  );
}

/**
 * A ruled divider, not a floating caption. Day labels and the time captions
 * above a message group were both bare centred grey text, so two different
 * jobs — "a new day starts here" and "this group is N hours later" — looked
 * identical. The rules give the day its own weight; time stays plain.
 */
export function DaySeparator({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.dayBlock}>
      <View style={styles.dayRule} />
      <Text style={styles.dayText}>{label}</Text>
      <View style={styles.dayRule} />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // ⚠️ TOP-ONLY PADDING, supplied per bubble by blockPaddingTop — a symmetric
  // paddingVertical here is what made every bubble 8pt from its neighbour
  // whatever the grouping said, so the tightened corners had nothing to tighten
  // toward. Bottom stays 0; the list's own contentContainer gives the first and
  // last their air.
  messageBlock: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 0,
    gap: spacing.xs,
  },
  blockMine: {
    alignItems: 'flex-end',
  },
  blockTheirs: {
    alignItems: 'flex-start',
  },
  /**
   * ⚠️ SIDE-ALIGNED, NOT CENTRED. A centred grey caption is visually the same
   * object as a DaySeparator's label — and DaySeparator was given its rules
   * precisely so the two jobs would stop looking alike. Letting the time
   * inherit the block's flex-end/flex-start finishes that thought: a day
   * belongs to the thread, a time belongs to whoever spoke.
   */
  time: {
    ...typography.caption,
    color: c.textSecondary,
    paddingBottom: spacing.xs,
  },
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bubbleMine: {
    backgroundColor: c.primary,
  },
  /**
   * ⚠️ A SURFACE WITH AN EDGE, NOT A GREY SMEAR. `surfaceSubtle` on the page's
   * `background` is #EEEEEE on #F7F7F7 — about 1.06:1 — so an incoming bubble
   * had almost no boundary at all, while mine is a hard near-black. That
   * asymmetry is most of why the thread read as plain: one side was a shape and
   * the other was a stain. It is the same defect the inbox pass caught on the
   * notification tile.
   *
   * The hairline is load-bearing rather than decorative, and dark mode is why:
   * `surface` #1E1E1E on `background` #141414 is 1.1:1, so without an edge the
   * bubble has no boundary there either. Flat + hairline is the house card
   * recipe; a shadow would mean it floats, and it does not.
   */
  bubbleTheirs: {
    backgroundColor: c.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  bubblePending: {
    opacity: opacity.inactive,
  },
  textMine: {
    ...typography.body,
    color: c.textOnPrimary,
  },
  textTheirs: {
    ...typography.body,
    color: c.textPrimary,
  },
  deliveryState: {
    ...typography.caption,
    color: c.textSecondary,
  },
  seen: {
    ...typography.caption,
    color: c.textSecondary,
  },
  deliveryFailed: {
    color: c.danger,
  },
  systemBlock: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  systemText: {
    ...typography.caption,
    color: c.textSecondary,
    textAlign: 'center',
  },
  dayBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  dayRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.border,
  },
  dayText: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
