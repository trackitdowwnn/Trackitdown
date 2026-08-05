/**
 * WHAT:  Tests for the feed's day grouping — Today/Yesterday/date labels and
 *        one header per day change, against an injected clock.
 * WHY:   The boundaries (midnight, year-end) are exactly where a device test
 *        never happens to run. Clock-injected, so they are assertions here.
 * LINKS: ./dayGroups.ts; ../screens/NotificationCenterScreen.tsx.
 */

import { groupByDay } from './dayGroups';

const NOW = new Date('2026-08-06T10:00:00');

const row = (id: string, createdAt: string) => ({ id, createdAt });

describe('groupByDay', () => {
  it('labels today, yesterday, and calendar days — one header per change', () => {
    const items = groupByDay(
      [
        row('a', '2026-08-06T09:00:00'),
        row('b', '2026-08-06T01:00:00'),
        row('c', '2026-08-05T23:59:00'),
        row('d', '2026-08-01T12:00:00'),
      ],
      NOW,
    );
    expect(items.map((item) => (item.type === 'header' ? `H:${item.label}` : item.key))).toEqual([
      'H:Today',
      'a',
      'b',
      'H:Yesterday',
      'c',
      'H:1 August',
      'd',
    ]);
  });

  it('adds the year only when it is not this year', () => {
    const items = groupByDay([row('old', '2025-12-31T12:00:00')], NOW);
    expect(items[0]).toMatchObject({ type: 'header', label: '31 December 2025' });
  });

  it('returns an empty list for an empty feed — no orphan header', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
