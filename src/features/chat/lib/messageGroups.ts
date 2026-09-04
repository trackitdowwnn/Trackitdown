/**
 * WHAT:  Pure list-building for the chat thread — merges persisted messages
 *        with optimistic outgoing ones into render items in READING ORDER
 *        (oldest → newest; the screen's FlashList starts rendered at the
 *        bottom via maintainVisibleContentPosition): day separators before
 *        their day, Airbnb-style timestamp grouping (a time shows on the
 *        first message of a day and after >15-minute gaps), sender-run
 *        positions for the grouped-corner bubble treatment, optimistic
 *        bubbles last (newest, at the bottom). Also the "Seen" maths:
 *        which of MY messages the peer's read marker covers.
 * WHY:   Grouping maths must be hammerable without rendering (house
 *        precedent: photoGridModel, moneySliderMath). FlashList v2 has no
 *        `inverted` — bottom-start rendering keeps the data in natural
 *        order, so this builder stays free of inverted-list off-by-ones.
 *        Seen derives from the thread-level last-read stamp (see chatApi's
 *        fetchThreadPeerState): one quiet "Seen" under the newest covered
 *        message, never per-message ticks — the stamp is "last had the
 *        thread open", and the rendering must not claim more than that.
 * LINKS: src/features/chat/components (renderers);
 *        src/features/chat/api/chatApi.ts (fetchThreadPeerState);
 *        src/shared/lib/dateTimeLabel.ts (day-label sibling styles);
 *        docs/DESIGN_SYSTEM.md (calm, quiet metadata).
 */

// Its own module, not the @/shared/theme barrel — see blockPaddingTop.
import { spacing } from '@/shared/theme/spacing';

import { TIME_GAP_MINUTES, type ChatMessage, type OutgoingMessage } from '../types';

/** Where a user bubble sits in a same-sender run — drives which corners are
 *  tightened (Airbnb's grouped-bubble anatomy). Runs break on sender change,
 *  day change, a time caption, and system messages. */
export type MessageGroupPos = 'single' | 'first' | 'middle' | 'last';

/** One render item for the thread's list (reading order). */
export type ChatListItem =
  | { type: 'day'; id: string; label: string }
  | {
      type: 'message';
      message: ChatMessage;
      mine: boolean;
      /**
       * ⚠️ NOTHING DRAWS THIS ANY MORE (2026-09-04). It used to gate a time
       * caption above the group; every bubble now carries its own time inside
       * itself, so the caption is gone and `MessageBubble` has no `showTime`
       * prop. It is kept because it is ALSO the run-breaker below, and a
       * >15-minute gap is a real conversational boundary whether or not
       * anything prints because of it — the padding ladder is its visible cue
       * now. Deleting it would weld two messages three hours apart into one run.
       */
      showTime: boolean;
      groupPos: MessageGroupPos;
    }
  /** Optimistic outgoing (always mine, always newest; state drives the
   *  pending/failed treatment instead of a timestamp). */
  | { type: 'outgoing'; message: OutgoingMessage };

/**
 * The gap ABOVE a bubble, so that grouping is something you can see.
 *
 * ⚠️ THE GROUPED CORNERS WERE INVISIBLE WITHOUT THIS. Every bubble sat in a
 * symmetric `paddingVertical: spacing.xs`, so any two bubbles were 8pt apart
 * whether or not they belonged to the same run — the corners tightened, and
 * nothing drew closer. A burst of three messages therefore read as three
 * separate events, which is most of why the thread read as a list rather than
 * a conversation.
 *
 * 4 within a run against 12 between runs: a 3:1 ratio, enough that a run reads
 * as one thought. Top-only, because the list's own `paddingVertical` gives the
 * first and last their air.
 *
 * ⚠️ ZERO AFTER A SEPARATOR. A day rule and a system message already pad
 * themselves by 16; adding a bubble's own gap on top would make the thing that
 * divides days look like it belongs to the message beneath it.
 *
 * Lives here rather than in the component because this file's charter is that
 * grouping maths must be hammerable without rendering — same reason
 * `groupPos` is computed here (precedent: photoGridModel, moneySliderMath).
 *
 * ⚠️ `spacing` is imported from its own module, NOT the `@/shared/theme`
 * barrel, which pulls Reanimated in through `motion` — this is a plain logic
 * file and its tests should not need a native mock to run.
 */
export function blockPaddingTop(groupPos: MessageGroupPos, afterSeparator: boolean): number {
  if (afterSeparator) return 0;
  return groupPos === 'middle' || groupPos === 'last' ? spacing.xs : spacing.md;
}

/**
 * Whether the item above index `i` already supplies the gap — a day rule or a
 * system message (both pad themselves by 16), or the top of the list (where the
 * FlashList's own contentContainer padding does the job).
 *
 * Here rather than in the renderer so `blockPaddingTop`'s other argument is as
 * testable as the first.
 */
export function separatorAbove(items: ChatListItem[], i: number): boolean {
  if (i <= 0) return true;
  const previous = items[i - 1];
  if (!previous) return true;
  if (previous.type === 'day') return true;
  return previous.type === 'message' && previous.message.kind === 'system';
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today" / "Yesterday" / "Mon 6 Jul" — chat-scale day labels (the chat
 *  window is days, not archives, so no year; en-GB per house convention). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const dayDelta = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Local-day bucket key, stable across renders. */
function dayKey(iso: string): string {
  const date = new Date(iso);
  return `day-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Build the list's items in READING ORDER (oldest first, day separators
 * before their day, optimistic outgoing last). `messages` may arrive in any
 * order (realtime inserts append) — sorted here.
 */
export function buildChatList(
  messages: ChatMessage[],
  outgoing: OutgoingMessage[],
  myId: string,
  now: Date = new Date(),
): ChatListItem[] {
  const ascending = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const items: ChatListItem[] = [];
  let previousAt: number | null = null;
  let previousDay: string | null = null;

  for (const message of ascending) {
    const at = new Date(message.createdAt).getTime();
    const day = dayKey(message.createdAt);
    const newDay = day !== previousDay;
    if (newDay) {
      items.push({ type: 'day', id: day, label: dayLabel(message.createdAt, now) });
      previousDay = day;
    }
    const gapMinutes = previousAt === null ? Infinity : (at - previousAt) / 60_000;
    items.push({
      type: 'message',
      message,
      mine: message.senderId === myId,
      showTime: newDay || gapMinutes > TIME_GAP_MINUTES,
      groupPos: 'single', // resolved by the pass below, once neighbours are known
    });
    previousAt = at;
  }

  assignGroupPositions(items);

  for (const message of outgoing) {
    items.push({ type: 'outgoing', message });
  }

  return items;
}

/**
 * Second pass: mark each USER bubble's place in its same-sender run, so the
 * renderer can tighten the corners inside a run (Airbnb's grouped anatomy —
 * three quick messages read as one thought, not three announcements).
 *
 * A run breaks on anything that already breaks the eye: a different sender, a
 * day separator, a long gap (showTime), or a system message. Meaning the
 * time caption ALWAYS sits above a fully-rounded top corner — the two cues
 * never fight.
 */
function assignGroupPositions(items: ChatListItem[]): void {
  let run: Extract<ChatListItem, { type: 'message' }>[] = [];

  const closeRun = () => {
    if (run.length === 1) {
      run[0].groupPos = 'single';
    } else if (run.length > 1) {
      run.forEach((item, index) => {
        item.groupPos = index === 0 ? 'first' : index === run.length - 1 ? 'last' : 'middle';
      });
    }
    run = [];
  };

  for (const item of items) {
    const isUserMessage = item.type === 'message' && item.message.kind === 'user';
    if (!isUserMessage) {
      closeRun(); // day separators and system messages break runs
      continue;
    }
    const startsNewRun =
      item.showTime || run.length === 0 || run[run.length - 1].message.senderId !== item.message.senderId;
    if (startsNewRun) {
      closeRun();
    }
    run.push(item);
  }
  closeRun();
}

/**
 * The newest of MY user messages the peer's read marker covers — where the
 * single quiet "Seen" renders. `null` when nothing qualifies (no marker yet,
 * or they haven't opened the thread since my newest message… strictly: since
 * this one).
 *
 * Uses `<=`: the marker is stamped AFTER the reader's client has loaded the
 * thread, so a message created in the same instant has been displayed.
 * CAVEAT (review #6): the columns also carry a DEFAULT of now() from thread
 * creation — before anyone has read anything. Harmless today because the
 * only opening-transaction message is the system one, which this function
 * excludes; if open_thread ever inserts a USER message in that transaction,
 * revisit this boundary before trusting it.
 */
export function latestSeenOutboundId(
  messages: ChatMessage[],
  myId: string,
  theirLastReadAt: string | null,
): string | null {
  if (!theirLastReadAt) {
    return null;
  }
  const readUpTo = new Date(theirLastReadAt).getTime();
  let latest: ChatMessage | null = null;
  for (const message of messages) {
    if (message.kind !== 'user' || message.senderId !== myId) {
      continue;
    }
    if (new Date(message.createdAt).getTime() > readUpTo) {
      continue;
    }
    if (!latest || new Date(message.createdAt).getTime() > new Date(latest.createdAt).getTime()) {
      latest = message;
    }
  }
  return latest?.id ?? null;
}

/** Stable FlashList key for any item. */
export function chatItemKey(item: ChatListItem): string {
  if (item.type === 'day') return item.id;
  if (item.type === 'outgoing') return `out-${item.message.localId}`;
  return item.message.id;
}

/**
 * Where one pending message sits in the run of unsent ones.
 *
 * They are all mine and all newest, so position is just index within
 * `outgoing` — but they still need it: a burst of three sends used to render
 * 12pt apart with full corners, then snap to 4pt with tightened corners one at
 * a time as the server confirmed each. Reflowing on confirmation is the same
 * lie as animating the swap, which this feature already refuses to tell.
 */
export function outgoingGroupPos(
  outgoing: readonly OutgoingMessage[],
  localId: string,
): MessageGroupPos {
  const i = outgoing.findIndex((m) => m.localId === localId);
  if (i < 0 || outgoing.length <= 1) return 'single';
  if (i === 0) return 'first';
  if (i === outgoing.length - 1) return 'last';
  return 'middle';
}
