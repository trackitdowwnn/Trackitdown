/**
 * WHAT:  Tests for the notification center's day groups — bucket edges by
 *        LOCAL calendar day, header order, out-of-order input, and which rows
 *        start a group (no divider above them).
 * WHY:   A row filed under the wrong day, or a header printed twice, is the
 *        kind of slip the owner's "hard to read" complaint was about.
 * LINKS: ./dayGroups.ts.
 */

import type { NotificationRow } from '../api/notificationsApi';
import { dayGroupOf, notificationDayGroups } from './dayGroups';

// Midday local time, so ±hours never cross a day edge by accident.
const NOW = new Date(2026, 9, 19, 12, 0, 0);

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m, d, h, min).toISOString();

const row = (id: string, createdAt: string): NotificationRow => ({
  id,
  kind: 'alert',
  title: id,
  body: 'body',
  payload: null,
  readAt: null,
  createdAt,
  imageUrl: null,
});

describe('dayGroupOf', () => {
  it('splits on LOCAL midnight, not 24 hours back', () => {
    expect(dayGroupOf(at(2026, 9, 19, 0, 1), NOW)).toBe('Today');
    expect(dayGroupOf(at(2026, 9, 18, 23, 59), NOW)).toBe('Yesterday');
    expect(dayGroupOf(at(2026, 9, 18, 0, 0), NOW)).toBe('Yesterday');
    expect(dayGroupOf(at(2026, 9, 17, 23, 59), NOW)).toBe('Earlier');
  });

  it('counts a row from the future (clock skew) as Today', () => {
    expect(dayGroupOf(at(2026, 9, 20, 9), NOW)).toBe('Today');
  });
});

describe('notificationDayGroups', () => {
  it('heads each non-empty group once, in Today → Yesterday → Earlier order', () => {
    const items = notificationDayGroups(
      [
        row('t1', at(2026, 9, 19, 11)),
        row('t2', at(2026, 9, 19, 8)),
        row('e1', at(2026, 9, 2)),
      ],
      NOW,
    );

    expect(items.map((i) => (i.type === 'header' ? i.label : i.row.id))).toEqual([
      'Today',
      't1',
      't2',
      'Earlier',
      'e1',
    ]);
  });

  it('marks the first row of each group, and only that row', () => {
    const items = notificationDayGroups(
      [
        row('t1', at(2026, 9, 19, 11)),
        row('t2', at(2026, 9, 19, 8)),
        row('y1', at(2026, 9, 18)),
      ],
      NOW,
    );
    const firsts = items.flatMap((i) => (i.type === 'row' && i.firstInGroup ? [i.row.id] : []));

    expect(firsts).toEqual(['t1', 'y1']);
  });

  it('⚠️ never prints a header twice for out-of-order input', () => {
    const items = notificationDayGroups(
      [row('t1', at(2026, 9, 19)), row('e1', at(2026, 9, 1)), row('t2', at(2026, 9, 19, 9))],
      NOW,
    );

    expect(items.filter((i) => i.type === 'header')).toHaveLength(2);
    expect(items.map((i) => (i.type === 'header' ? i.label : i.row.id))).toEqual([
      'Today',
      't1',
      't2',
      'Earlier',
      'e1',
    ]);
  });

  it('is empty for an empty feed — no orphan headers', () => {
    expect(notificationDayGroups([], NOW)).toEqual([]);
  });
});
