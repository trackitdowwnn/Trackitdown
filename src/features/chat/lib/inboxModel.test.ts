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
import { contextLine, isUnread, previewText, totalUnread } from './inboxModel';

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
