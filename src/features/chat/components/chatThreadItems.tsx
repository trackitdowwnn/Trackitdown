/**
 * WHAT:  The thread's render pieces — MessageBubble (mine right on primary,
 *        theirs left on surface, its own time inside it bottom-right,
 *        long-press → report), OutgoingBubble (pending "Sending…" / failed
 *        "Not sent — tap to retry", text always retained), SystemMessage
 *        (centred, quiet — never a fake user bubble), and DaySeparator (a
 *        centred chip).
 * WHY:   Calm bubbles per the design system: radius `lg`, and NO TAILS — the
 *        grouped corners carry run position instead, which is the job a tail
 *        does elsewhere. The failed state is deliberately louder than anything
 *        else here: losing a user's words silently is the one unforgivable
 *        chat sin.
 *
 *        ⚠️ A WHATSAPP STRUCTURE PASS LANDED 2026-09-04 (owner request), and
 *        two of its decisions reversed things recorded here. Times MOVED from
 *        a sparse caption above the group to inside every bubble; the day
 *        separator stopped being a ruled divider. Both are argued at their own
 *        definitions below. What was NOT taken, and why, is in
 *        docs/design-refs/chat/GAP_ANALYSIS.md — tails, near-pill radii and
 *        per-message ticks each have a reason on file, and the tick one is a
 *        data claim rather than a taste.
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
  /* ⚠️ NO `showTime` (2026-09-04). Every bubble now draws its own time inside
     itself, so there is nothing left for a caller to gate. `messageGroups`
     still COMPUTES showTime — it is the run-breaker, and a >15-minute gap is
     still a real conversational boundary — it just no longer draws anything. */
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
      <Pressable
        onLongPress={report}
        // ⚠️ EXPLICITLY ONE NODE. The meta `Text` is now a descendant of this
        // Pressable, so without `accessible` a screen reader can announce the
        // time twice — once from this label, once from the child. Do NOT reach
        // for accessibilityElementsHidden on the meta instead: RNTL excludes
        // hidden nodes by default, which would make it untestable.
        accessible
        // The time is in every label, as it has been since the caption only
        // ever appeared above one bubble per run. It is now also DRAWN on every
        // bubble, so the two finally agree.
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
        {/* ⚠️ "Seen" RIDES THE META, it is not a caption below the bubble any
            more. Same claim as before and no larger: the marker is
            THREAD-level, so this says "they had the thread open", never
            "this message was read". That is also why there is no tick — a
            tick on one bubble and not its neighbours asserts a per-message
            fact the data does not carry, at every glance. The word is the
            only rendering that is true. */}
        <Text
          style={[styles.meta, mine ? styles.metaMine : styles.metaTheirs]}
          testID={seen ? `seen-${message.id}` : undefined}
        >
          {timeCaption(message.createdAt)}
          {seen ? ' · Seen' : ''}
        </Text>
      </Pressable>
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
        {/* ⚠️ "Sending…" LIVES IN THE META SLOT, where the confirmed bubble
            will put its time. That is the point: the optimistic→persisted swap
            becomes a text substitution inside a box that already exists, with
            no reflow. This file already refuses to ANIMATE that swap because a
            double pop reads as a double send; a silent relayout is the same
            lie told more slowly. A FAILED send keeps its own loud caption
            below — see below. */}
        {/* ⚠️ FULL-STRENGTH INK, NOT `metaMine`. A pending bubble already wears
            `opacity.inactive` on the WHOLE container, so a muted token inside
            it is dimmed twice: `textOnPrimaryMuted` composited through 0.5
            measures 2.08:1 light / 2.97:1 dark against the bubble's own
            composited fill — far under the 4.5 text floor, on the label that
            says whether a message has sent.

            This is the exact hazard `textOnPrimaryMuted`'s own comment warns
            about ("a token can be measured; a composite cannot") — and
            `colors.test.ts` re-derives token PAIRINGS, so it cannot see a
            runtime alpha and did not catch it. Let the container do the
            dimming once: 3.49:1 / 5.03:1, the same as the message text beside
            it. */}
        {!failed ? (
          <Text style={[styles.meta, styles.metaPending]}>Sending…</Text>
        ) : null}
      </Pressable>
      {/* ⚠️ FAILURE STAYS FULL-WIDTH AND LOUD, outside the bubble. It is thirty
          characters of instruction, it is the one state a person must act on,
          and losing someone's words silently is the one unforgivable chat sin.
          It does not go in a corner in `caption` to match the others. */}
      {failed ? (
        <Text style={[styles.deliveryState, styles.deliveryFailed]}>
          Not sent — tap the message to retry
        </Text>
      ) : null}
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
  /**
   * ⚠️ A WRAPPING ROW, NOT A COLUMN (2026-09-04) — this is what puts the time
   * inside the bubble, and the geometry is the whole trick.
   *
   * React Native has no `float`, so the reference's behaviour (meta rides the
   * last text line if it fits, drops to its own line if not) has to come out of
   * Yoga. It does: `flexWrap` lets the two children share a line or split, and
   * the meta's `marginStart: 'auto'` pins it to the bubble's inner trailing
   * edge in whichever case happens. `alignItems: 'flex-end'` bottom-aligns the
   * 18pt meta box against the 24pt text line so it reads as sitting ON the
   * baseline rather than floating.
   *
   * Three alternatives were rejected. Absolute-positioning the meta over
   * invisible trailing spacer characters puts fake characters into user content
   * and breaks at large type and in RTL. Giving the meta its own row
   * unconditionally adds ~18pt to EVERY bubble, and turns a one-word "Yes" into
   * a two-row box with an empty second line. Nesting the meta in the same
   * `<Text>` as the content gets the nicest flow but inherits `body`'s 24pt
   * line-height and cannot right-align to the bubble edge.
   *
   * ⚠️ `marginStart`, NOT `marginLeft` — RTL.
   *
   * ⚠️ paddingHorizontal is `md` (12), down from `lg` (16), because the bubble
   * now carries a trailing element and 16 either side of that reads loose.
   * VERTICAL padding stays 12: it is what keeps the long-press target ≥48pt
   * tall, and long-press is the only moderation route a person has.
   */
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    columnGap: spacing.sm,
  },
  /**
   * The bubble's own timestamp, and its send/seen state when it has one.
   *
   * ⚠️ `textOnPrimaryMuted` INSIDE MINE, `textSecondary` inside theirs. On a
   * `primary` fill the only other sanctioned ink is `textOnPrimary` at ~17:1,
   * which makes a timestamp shout as loudly as the message. See the token's own
   * note for why this is not an opacity.
   */
  meta: {
    ...typography.caption,
    marginStart: 'auto',
  },
  metaMine: {
    color: c.textOnPrimaryMuted,
  },
  metaTheirs: {
    color: c.textSecondary,
  },
  // Inside a bubble that is already dimmed as a whole — see the note at the
  // render site. Never `textOnPrimaryMuted`: two dimmings compound.
  metaPending: {
    color: c.textOnPrimary,
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
