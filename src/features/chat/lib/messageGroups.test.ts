/**
 * WHAT:  Tests for the chat list builder — reading-order output (oldest →
 *        newest for the bottom-start FlashList), day separators before
 *        their day, the >15-minute timestamp rule, mine/theirs attribution,
 *        optimistic outgoing placement at the newest end, and stable keys.
 * WHY:   Ordering is the classic chat off-by-one; a separator on the wrong
 *        side or a dropped optimistic bubble reads as data loss to a user
 *        mid-conversation.
 * LINKS: src/features/chat/lib/messageGroups.ts, docs/TESTING.md.
 */

import type { ChatMessage, OutgoingMessage } from '../types';
import { buildChatList, chatItemKey, dayLabel } from './messageGroups';

const NOW = new Date('2026-07-15T18:00:00Z');
const ME = 'me';

const message = (id: string, iso: string, sender: string | null = ME): ChatMessage => ({
  id,
  threadId: 't1',
  senderId: sender,
  kind: sender === null ? 'system' : 'user',
  content: `msg-${id}`,
  createdAt: iso,
});

describe('dayLabel', () => {
  it('says Today/Yesterday, then short weekday-day-month', () => {
    // Mid-day fixtures: away from midnight so local-timezone offsets can't
    // flip the day bucket under CI/dev machines.
    expect(dayLabel('2026-07-15T09:00:00Z', NOW)).toBe('Today');
    expect(dayLabel('2026-07-14T12:00:00Z', NOW)).toBe('Yesterday');
    expect(dayLabel('2026-07-06T10:00:00Z', NOW)).toBe('Mon 6 Jul');
  });
});

describe('buildChatList', () => {
  it('returns reading order with the day separator BEFORE its messages', () => {
    const items = buildChatList(
      [message('a', '2026-07-15T10:00:00Z'), message('b', '2026-07-15T10:05:00Z')],
      [],
      ME,
      NOW,
    );
    expect(items.map(chatItemKey)).toEqual(['day-2026-7-15', 'a', 'b']);
    expect(items[0]).toEqual({ type: 'day', id: 'day-2026-7-15', label: 'Today' });
  });

  it('separates days and restarts the timestamp rule on each', () => {
    const items = buildChatList(
      [message('a', '2026-07-14T12:00:00Z'), message('b', '2026-07-15T08:00:00Z')],
      [],
      ME,
      NOW,
    );
    expect(items.map(chatItemKey)).toEqual(['day-2026-7-14', 'a', 'day-2026-7-15', 'b']);
    // Both are their day's first message → both show a time.
    const shows = items.filter((i) => i.type === 'message').map((i) => i.showTime);
    expect(shows).toEqual([true, true]);
  });

  it('shows a time only after gaps over 15 minutes', () => {
    const items = buildChatList(
      [
        message('a', '2026-07-15T10:00:00Z'),
        message('b', '2026-07-15T10:10:00Z'), // 10 min — grouped, no time
        message('c', '2026-07-15T10:26:00Z'), // 16 min — new time
      ],
      [],
      ME,
      NOW,
    );
    const byId = new Map(
      items.filter((i) => i.type === 'message').map((i) => [i.message.id, i.showTime]),
    );
    expect(byId.get('a')).toBe(true); // first of day
    expect(byId.get('b')).toBe(false);
    expect(byId.get('c')).toBe(true);
  });

  it('attributes mine vs theirs and never marks a system message mine', () => {
    const items = buildChatList(
      [message('sys', '2026-07-15T09:00:00Z', null), message('them', '2026-07-15T09:01:00Z', 'other')],
      [],
      ME,
      NOW,
    );
    const mine = new Map(
      items.filter((i) => i.type === 'message').map((i) => [i.message.id, i.mine]),
    );
    expect(mine.get('sys')).toBe(false);
    expect(mine.get('them')).toBe(false);
  });

  it('sorts unordered input (realtime appends) into reading order', () => {
    const items = buildChatList(
      [message('late', '2026-07-15T12:00:00Z'), message('early', '2026-07-15T09:00:00Z')],
      [],
      ME,
      NOW,
    );
    expect(items.map(chatItemKey)).toEqual(['day-2026-7-15', 'early', 'late']);
  });

  it('keeps optimistic outgoing messages at the NEWEST end, pending or failed', () => {
    const outgoing: OutgoingMessage[] = [
      { localId: 'p1', content: 'on its way', createdAt: '2026-07-15T12:01:00Z', state: 'pending' },
      { localId: 'f1', content: 'kept, not dropped', createdAt: '2026-07-15T12:02:00Z', state: 'failed' },
    ];
    const items = buildChatList([message('a', '2026-07-15T12:00:00Z')], outgoing, ME, NOW);
    // Reading order: the pending/failed bubbles sit at the bottom (newest).
    expect(items.map(chatItemKey)).toEqual(['day-2026-7-15', 'a', 'out-p1', 'out-f1']);
    // The failed message's text is retained verbatim.
    const failed = items[3];
    expect(failed.type).toBe('outgoing');
    if (failed.type === 'outgoing') {
      expect(failed.message.content).toBe('kept, not dropped');
      expect(failed.message.state).toBe('failed');
    }
  });
});
