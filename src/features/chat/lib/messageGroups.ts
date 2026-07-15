/**
 * WHAT:  Pure list-building for the chat thread — merges persisted messages
 *        with optimistic outgoing ones into render items in READING ORDER
 *        (oldest → newest; the screen's FlashList starts rendered at the
 *        bottom via maintainVisibleContentPosition): day separators before
 *        their day, Airbnb-style timestamp grouping (a time shows on the
 *        first message of a day and after >15-minute gaps), optimistic
 *        bubbles last (newest, at the bottom).
 * WHY:   Grouping maths must be hammerable without rendering (house
 *        precedent: photoGridModel, moneySliderMath). FlashList v2 has no
 *        `inverted` — bottom-start rendering keeps the data in natural
 *        order, so this builder stays free of inverted-list off-by-ones.
 * LINKS: src/features/chat/components (renderers);
 *        src/shared/lib/dateTimeLabel.ts (day-label sibling styles);
 *        docs/DESIGN_SYSTEM.md (calm, quiet metadata).
 */

import { TIME_GAP_MINUTES, type ChatMessage, type OutgoingMessage } from '../types';

/** One render item for the thread's list (reading order). */
export type ChatListItem =
  | { type: 'day'; id: string; label: string }
  | { type: 'message'; message: ChatMessage; mine: boolean; showTime: boolean }
  /** Optimistic outgoing (always mine, always newest; state drives the
   *  pending/failed treatment instead of a timestamp). */
  | { type: 'outgoing'; message: OutgoingMessage };

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
    });
    previousAt = at;
  }

  for (const message of outgoing) {
    items.push({ type: 'outgoing', message });
  }

  return items;
}

/** Stable FlashList key for any item. */
export function chatItemKey(item: ChatListItem): string {
  if (item.type === 'day') return item.id;
  if (item.type === 'outgoing') return `out-${item.message.localId}`;
  return item.message.id;
}
