/**
 * WHAT:  Tests for the inbox maths — the owner/spotter context lines (and
 *        the privacy rule that a plate renders ONLY on the owner's own
 *        rows), preview fallback, unread flags, and the badge total.
 * WHY:   The context line is the row's anchor and the plate split is a
 *        privacy decision (a spotter never gets a plate the post's public
 *        face doesn't show); the badge total drives the tab treatment.
 * LINKS: src/features/chat/lib/inboxModel.ts, docs/TESTING.md.
 */

import type { InboxThread } from '../types';
import {
  INBOX_FILTERS,
  contextLine,
  emptyFilterCopy,
  filterLabel,
  filterThreads,
  groupThreadsByDay,
  isUnread,
  previewText,
  totalUnread,
} from './inboxModel';

const thread = (overrides: Partial<InboxThread> = {}): InboxThread => ({
  threadId: 't1',
  postId: 'p1',
  role: 'owner',
  lastMessageAt: '2026-07-15T10:00:00Z',
  lastMessagePreview: 'See you found it',
  unreadCount: 0,
  post: {
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    coverPhotoUrl: null,
  },
  other: { firstName: 'Sam' },
  ...overrides,
});

describe('contextLine', () => {
  it("owner: 'About your <car>' WITH their own plate", () => {
    expect(contextLine(thread())).toEqual({
      prefix: 'About your Blue BMW 3 Series',
      plate: 'AB12 CDE',
    });
  });

  it("spotter: 'Your sighting · <car>' and NEVER a plate", () => {
    expect(contextLine(thread({ role: 'spotter' }))).toEqual({
      prefix: 'Your sighting · Blue BMW 3 Series',
      plate: null,
    });
  });

  it('skips missing colour without double spaces', () => {
    const t = thread();
    t.post.colour = null;
    expect(contextLine(t).prefix).toBe('About your BMW 3 Series');
  });
});

describe('preview + unread', () => {
  it('falls back calmly when no preview exists', () => {
    expect(previewText(thread({ lastMessagePreview: null }))).toBe('No messages yet');
    expect(previewText(thread())).toBe('See you found it');
  });

  it('flags unread rows and sums the badge total', () => {
    expect(isUnread(thread())).toBe(false);
    expect(isUnread(thread({ unreadCount: 2 }))).toBe(true);
    expect(
      totalUnread([thread({ unreadCount: 2 }), thread({ unreadCount: 0 }), thread({ unreadCount: 5 })]),
    ).toBe(7);
  });
});

describe('filterThreads', () => {
  const rows = [
    thread({ threadId: 'o-unread', role: 'owner', unreadCount: 2 }),
    thread({ threadId: 's-read', role: 'spotter', unreadCount: 0 }),
    thread({ threadId: 'o-read', role: 'owner', unreadCount: 0 }),
    thread({ threadId: 's-unread', role: 'spotter', unreadCount: 1 }),
  ];

  it("'all' is the identity — same rows, same order", () => {
    expect(filterThreads(rows, 'all')).toEqual(rows);
  });

  it("'unread' keeps only rows with something new", () => {
    expect(filterThreads(rows, 'unread').map((t) => t.threadId)).toEqual([
      'o-unread',
      's-unread',
    ]);
  });

  it("'my_cars' is the OWNER side — spotters wrote to me about my car", () => {
    expect(filterThreads(rows, 'my_cars').map((t) => t.threadId)).toEqual([
      'o-unread',
      'o-read',
    ]);
  });

  it("'my_sightings' is the SPOTTER side", () => {
    expect(filterThreads(rows, 'my_sightings').map((t) => t.threadId)).toEqual([
      's-read',
      's-unread',
    ]);
  });

  it('never reorders — the RPC already sorted by newest activity', () => {
    // Order-preservation is the property; each filter is a subsequence.
    const ids = rows.map((t) => t.threadId);
    for (const filter of INBOX_FILTERS) {
      const filtered = filterThreads(rows, filter).map((t) => t.threadId);
      expect(filtered).toEqual(ids.filter((id) => filtered.includes(id)));
    }
  });
});

describe('filterLabel', () => {
  it('puts the live count on Unread', () => {
    const rows = [thread({ unreadCount: 2 }), thread({ threadId: 't2', unreadCount: 1 })];
    expect(filterLabel('unread', rows)).toBe('Unread (2)');
  });

  it("drops the count at zero — 'Unread (0)' reads as a bug", () => {
    expect(filterLabel('unread', [thread({ unreadCount: 0 })])).toBe('Unread');
  });

  it('names the role filters in the user’s words, not the schema’s', () => {
    expect(filterLabel('my_cars', [])).toBe('My cars');
    expect(filterLabel('my_sightings', [])).toBe('My sightings');
    expect(filterLabel('all', [])).toBe('All');
  });
});

describe('emptyFilterCopy', () => {
  it('an empty Unread is good news and reads like it', () => {
    expect(emptyFilterCopy('unread').title).toBe('All caught up');
  });

  it('each filter explains ITS OWN emptiness — no shared generic copy', () => {
    const titles = INBOX_FILTERS.map((filter) => emptyFilterCopy(filter).title);
    expect(new Set(titles).size).toBe(INBOX_FILTERS.length);
  });
});

describe('⚠️ groupThreadsByDay', () => {
  // The Messages face groups by the same calendar words the Notifications face
  // uses, so one tab does not speak two vocabularies for "when".
  const NOW = new Date('2026-07-15T18:00:00Z');

  it('heads a day ONCE, however many conversations it holds', () => {
    const items = groupThreadsByDay(
      [
        thread({ threadId: 'a', lastMessageAt: '2026-07-15T17:00:00Z' }),
        thread({ threadId: 'b', lastMessageAt: '2026-07-15T09:00:00Z' }),
      ],
      NOW,
    );

    expect(items.filter((item) => item.type === 'header')).toHaveLength(1);
    expect(items.map((item) => item.type)).toEqual(['header', 'row', 'row']);
  });

  it('opens a new header when the day changes', () => {
    const items = groupThreadsByDay(
      [
        thread({ threadId: 'a', lastMessageAt: '2026-07-15T17:00:00Z' }),
        thread({ threadId: 'b', lastMessageAt: '2026-07-14T17:00:00Z' }),
      ],
      NOW,
    );

    expect(items.filter((item) => item.type === 'header').map((item) => item.label)).toEqual([
      'Today',
      'Yesterday',
    ]);
  });

  it('carries the whole thread through, not just its id', () => {
    // The row renders from `item.row.thread`; an adapter that dropped the
    // thread would typecheck and then render an empty row.
    const items = groupThreadsByDay([thread({ threadId: 'a' })], NOW);
    const row = items.find((item) => item.type === 'row');

    expect(row?.type === 'row' && row.row.thread.other.firstName).toBe('Sam');
    expect(row?.type === 'row' && row.row.thread.post.make).toBe('BMW');
  });

  it('keys rows by threadId, so a header can never collide with a row', () => {
    const items = groupThreadsByDay([thread({ threadId: 'abc' })], NOW);

    expect(items.map((item) => item.key)).toEqual(['header-Today', 'abc']);
  });

  it('an empty inbox groups to nothing at all — no orphan header', () => {
    expect(groupThreadsByDay([], NOW)).toEqual([]);
  });
});
