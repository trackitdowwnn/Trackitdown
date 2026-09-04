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
import {
  blockPaddingTop,
  buildChatList,
  chatItemKey,
  dayLabel,
  latestSeenOutboundId,
  separatorAbove,
} from './messageGroups';

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

describe('groupPos — the grouped-corner runs', () => {
  const positionsOf = (items: ReturnType<typeof buildChatList>) =>
    items.flatMap((item) => (item.type === 'message' ? [item.groupPos] : []));

  it('a lone message is single', () => {
    const items = buildChatList([message('a', '2026-07-15T10:00:00Z')], [], ME, NOW);
    expect(positionsOf(items)).toEqual(['single']);
  });

  it('a rapid same-sender burst reads first / middle / last', () => {
    const items = buildChatList(
      [
        message('a', '2026-07-15T10:00:00Z'),
        message('b', '2026-07-15T10:01:00Z'),
        message('c', '2026-07-15T10:02:00Z'),
      ],
      [],
      ME,
      NOW,
    );
    expect(positionsOf(items)).toEqual(['first', 'middle', 'last']);
  });

  it('a sender change breaks the run', () => {
    const items = buildChatList(
      [
        message('a', '2026-07-15T10:00:00Z', ME),
        message('b', '2026-07-15T10:01:00Z', 'them'),
        message('c', '2026-07-15T10:02:00Z', 'them'),
      ],
      [],
      ME,
      NOW,
    );
    expect(positionsOf(items)).toEqual(['single', 'first', 'last']);
  });

  it('a long gap breaks the run', () => {
    // ⚠️ RENAMED 2026-09-04, same assertion. It used to be justified by a
    // drawn caption — ">15 min earns a time caption, so the bubble under it
    // must open a fresh run and the caption never sits over a tightened
    // corner". The caption is gone (every bubble now carries its own time),
    // and the rule survives it: a half-hour gap IS a conversational boundary,
    // and the padding ladder is what shows it now.
    const items = buildChatList(
      [
        message('a', '2026-07-15T10:00:00Z'),
        message('b', '2026-07-15T10:01:00Z'),
        message('c', '2026-07-15T10:30:00Z'),
      ],
      [],
      ME,
      NOW,
    );
    expect(positionsOf(items)).toEqual(['first', 'last', 'single']);
  });

  it('a system message breaks the run and never joins one', () => {
    const items = buildChatList(
      [
        message('a', '2026-07-15T10:00:00Z'),
        message('sys', '2026-07-15T10:00:30Z', null),
        message('b', '2026-07-15T10:01:00Z'),
      ],
      [],
      ME,
      NOW,
    );
    // The system item keeps the default and is rendered by SystemMessage,
    // which ignores groupPos entirely.
    const userPositions = items.flatMap((item) =>
      item.type === 'message' && item.message.kind === 'user' ? [item.groupPos] : [],
    );
    expect(userPositions).toEqual(['single', 'single']);
  });
});

describe('latestSeenOutboundId', () => {
  const mine = [
    message('m1', '2026-07-15T10:00:00Z'),
    message('m2', '2026-07-15T11:00:00Z'),
    message('m3', '2026-07-15T12:00:00Z'),
  ];

  it('picks the NEWEST of my messages the marker covers — one Seen, ever', () => {
    expect(latestSeenOutboundId(mine, ME, '2026-07-15T11:30:00Z')).toBe('m2');
  });

  it('covers a message created at the exact marker instant', () => {
    // The marker is stamped AFTER the reader's client loaded the thread.
    expect(latestSeenOutboundId(mine, ME, '2026-07-15T11:00:00Z')).toBe('m2');
  });

  it('null when they have not read since my oldest message', () => {
    expect(latestSeenOutboundId(mine, ME, '2026-07-15T09:00:00Z')).toBeNull();
  });

  it('null without a marker — no data must never render as "not seen"', () => {
    expect(latestSeenOutboundId(mine, ME, null)).toBeNull();
  });

  it('never picks their messages or the system message', () => {
    const mixed = [
      message('theirs', '2026-07-15T13:00:00Z', 'them'),
      message('sys', '2026-07-15T13:30:00Z', null),
      ...mine,
    ];
    expect(latestSeenOutboundId(mixed, ME, '2026-07-15T14:00:00Z')).toBe('m3');
  });
});

describe('⚠️ blockPaddingTop — grouping you can SEE', () => {
  // The grouped corners were invisible before this: every bubble sat in a
  // symmetric 8pt, so the corners tightened and nothing drew closer. A burst of
  // three messages read as three separate events.
  it('draws a run together and pushes runs apart', () => {
    expect(blockPaddingTop('middle', false)).toBe(4);
    expect(blockPaddingTop('last', false)).toBe(4);
    expect(blockPaddingTop('first', false)).toBe(12);
    expect(blockPaddingTop('single', false)).toBe(12);
  });

  it('is a 3:1 ratio — the thing that makes a run read as one thought', () => {
    expect(blockPaddingTop('first', false) / blockPaddingTop('middle', false)).toBe(3);
  });

  it('⚠️ adds nothing under a separator, which already pads itself', () => {
    // A day rule pads 16 below itself. A bubble adding its own 12 on top would
    // make the thing that divides days look like it belongs to the message
    // beneath it.
    for (const pos of ['single', 'first', 'middle', 'last'] as const) {
      expect(blockPaddingTop(pos, true)).toBe(0);
    }
  });
});

describe('separatorAbove', () => {
  const items = buildChatList(
    [message('a', '2026-07-15T09:00:00Z'), message('sys', '2026-07-15T09:01:00Z', null)],
    [],
    ME,
  );

  it('treats the top of the list as already spaced', () => {
    expect(separatorAbove(items, 0)).toBe(true);
  });

  it('sees a day rule above the first message', () => {
    // buildChatList always opens with a day item.
    expect(items[0]?.type).toBe('day');
    expect(separatorAbove(items, 1)).toBe(true);
  });

  it('sees a system message as a separator too', () => {
    const afterSystem = items.length;
    expect(separatorAbove([...items, message('b', '2026-07-15T09:02:00Z')] as never, afterSystem))
      .toBe(true);
  });

  it('is false between two ordinary bubbles', () => {
    const pair = buildChatList(
      [message('a', '2026-07-15T09:00:00Z'), message('b', '2026-07-15T09:01:00Z')],
      [],
      ME,
    );
    expect(separatorAbove(pair, 2)).toBe(false);
  });
});
