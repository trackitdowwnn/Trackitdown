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

import { formatClock } from '@/shared/lib/dateTimeLabel';
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

/** Local time for a bubble's meta ("14:32", device locale). Shared with the
 *  inbox row and `formatDateTimeLabel` — see the note on `formatClock`. */
const timeCaption = formatClock;

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
  /** Position within the outgoing run — all mine, all newest, so it is just
   *  the index within `outgoing`. Keeps a burst of sends grouped the same way
   *  it will be once the server confirms it. */
  groupPos?: MessageGroupPos;
  onRetry: (localId: string) => void;
}

export function OutgoingBubble({ message, groupPos = 'single', onRetry }: OutgoingBubbleProps) {
  const styles = useThemedStyles(makeStyles);
  const failed = message.state === 'failed';
  return (
    // ⚠️ GROUPED LIKE ANY OTHER RUN OF MINE. This used to hard-code 12pt and
    // skip groupedCorners entirely, on the reasoning that it is "always the
    // newest thing". True, but a BURST of sends is a run: three pending bubbles
    // sat 12pt apart with full corners, then each confirmation swapped in a
    // MessageBubble at 4pt with tightened corners — the spacing halved and the
    // corners snapped, once per message. Visibly reflowing on confirmation is
    // the same class of lie as animating the swap, which this file already
    // refuses to do.
    <View
      style={[
        styles.messageBlock,
        styles.blockMine,
        { paddingTop: blockPaddingTop(groupPos, false) },
      ]}
    >
      <Pressable
        disabled={!failed}
        onPress={() => onRetry(message.localId)}
        accessibilityRole={failed ? 'button' : undefined}
        accessibilityLabel={
          failed ? `Not sent: ${message.content}. Tap to retry.` : `Sending: ${message.content}`
        }
        style={[
          styles.bubble,
          styles.bubbleMine,
          groupedCorners(true, groupPos),
          !failed && styles.bubblePending,
        ]}
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
 * A floating chip, centred over the conversation.
 *
 * ⚠️ IT WAS A RULED DIVIDER UNTIL 2026-09-04, and the reason it stopped being
 * one is worth keeping. The rules were added because a day label and a time
 * caption were both bare centred grey text — two different jobs that looked
 * identical. The chip solves that same problem better: a filled, rounded object
 * is not the same kind of thing as a bare caption at all, so the two can no
 * longer be confused even at a glance. And the rules had a cost the chip does
 * not — they drew a full-width line across a conversation, which reads as a
 * section break in a surface whose whole point is that it is continuous.
 *
 * ⚠️ THE SAME RECIPE AS AN INCOMING BUBBLE — `surface` with a hairline — and
 * that is deliberate rather than lazy. It is what the reference does: the date
 * chip is the same material as the incoming bubble, one being a small centred
 * instance of the other. Three things keep them apart: it is centred rather
 * than side-aligned, `caption` rather than `body`, and `radii.full` rather than
 * `radii.lg`. Shape does the work, so the fill does not have to.
 *
 * ⚠️ THE HAIRLINE IS NOT DECORATION. On the conversation's `surfaceSubtle`
 * ground a `surface` fill separates by about 1.16:1 — the same reason the
 * incoming bubble carries one. Remove it and the chip is a floating word.
 */
export function DaySeparator({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.dayBlock}>
      <View style={styles.dayChip}>
        <Text style={styles.dayText}>{label}</Text>
      </View>
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
   * The hairline is load-bearing rather than decorative, and it is needed in
   * BOTH schemes — most in LIGHT, in fact: `surface` on `background` separates
   * by fill at only ~1.07:1 light and ~1.10:1 dark, so neither theme gives the
   * bubble a boundary without an edge. (This comment said "dark mode is why"
   * until a review measured it; the attribution was backwards.) Flat + hairline
   * is the house card recipe; a shadow would mean it floats, and it does not.
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
  // The block keeps its `lg` padding, so the chip costs +8pt per separator over
  // the rules it replaced (50 → 58). Trimming the block to hold at 50 would
  // falsify three comments that state this number — blockPaddingTop's,
  // separatorAbove's, and ChatThreadScreen's renderItem note — and day
  // separators are rare. Eight points is cheaper than three drifted comments.
  dayBlock: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  // ⚠️ `alignSelf`-free: the chip centres via the block's alignItems, so it
  // shrink-wraps its label instead of stretching. A stretched chip would be a
  // full-width bar, which is the ruled divider's problem in a new shape.
  dayChip: {
    backgroundColor: c.surface,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dayText: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
