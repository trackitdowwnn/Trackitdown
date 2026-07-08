/**
 * WHAT:  Tests for timeAgo — each unit band, boundary crossings, future
 *        clamping, and the unparseable-input guard.
 * WHY:   Last-seen recency drives spotter urgency; an off-by-a-unit bug
 *        ("2h" shown as "2d") would misinform every card in the feed.
 * LINKS: src/shared/lib/timeAgo.ts, docs/TESTING.md (Tier 2).
 */

import { timeAgo } from './timeAgo';

const NOW = new Date('2026-07-08T12:00:00Z');
const secondsBefore = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('timeAgo', () => {
  it.each([
    [0, 'just now'],
    [59, 'just now'],
    [60, '1m ago'],
    [59 * 60, '59m ago'],
    [60 * 60, '1h ago'],
    [23 * 3600, '23h ago'],
    [24 * 3600, '1d ago'],
    [6 * 86400, '6d ago'],
    [7 * 86400, '1w ago'],
    [30 * 86400, '4w ago'],
  ])('%i seconds back → %s', (seconds, expected) => {
    expect(timeAgo(secondsBefore(seconds), NOW)).toBe(expected);
  });

  it('accepts ISO strings and epoch millis', () => {
    expect(timeAgo('2026-07-08T10:00:00Z', NOW)).toBe('2h ago');
    expect(timeAgo(NOW.getTime() - 120_000, NOW)).toBe('2m ago');
  });

  it('clamps future timestamps to "just now"', () => {
    expect(timeAgo(new Date(NOW.getTime() + 60_000), NOW)).toBe('just now');
  });

  it('throws on unparseable input', () => {
    expect(() => timeAgo('not a date', NOW)).toThrow(/unparseable/);
  });
});
