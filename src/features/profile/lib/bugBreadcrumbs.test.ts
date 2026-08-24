/**
 * WHAT:  Tests for readBreadcrumbs — the log trail a bug report carries.
 * WHY:   ONE property matters here and the rest is detail: the `data` payload
 *        must never travel. That payload is where the bare UUIDs live — a
 *        `postId` in a support queue is a durable pointer at a live victim's
 *        case — and sending the ring buffer as-is was rejected outright when
 *        this feature was designed. This file is what stops that decision being
 *        quietly undone by someone who thinks a little context would help.
 * LINKS: ./bugBreadcrumbs.ts; src/shared/lib/logger.ts; docs/LOGGING.md.
 */

import { MAX_BREADCRUMBS, readBreadcrumbs } from './bugBreadcrumbs';

const mockGetRecentLogs = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  getRecentLogs: () => mockGetRecentLogs(),
}));

const entry = (message: string, data?: Record<string, unknown>) => ({
  timestamp: '2026-08-24T10:15:30.000Z',
  level: 'info',
  feature: 'sightings',
  message,
  data,
});

beforeEach(() => jest.clearAllMocks());

describe('readBreadcrumbs', () => {
  it('reads as a trail of what the app was doing', () => {
    mockGetRecentLogs.mockReturnValue([entry('feed_mounted'), entry('sighting_submit_failed')]);

    expect(readBreadcrumbs()).toEqual([
      '10:15:30 info sightings:feed_mounted',
      '10:15:30 info sightings:sighting_submit_failed',
    ]);
  });

  it('⚠️ never carries the data payload — not a value, not a key', () => {
    // The whole reason this module exists rather than sending getRecentLogs().
    // logger.ts's redaction is key-name matching with NO lat, lng or plate in
    // the pattern, so these three would all have travelled verbatim.
    mockGetRecentLogs.mockReturnValue([
      entry('sighting_created', {
        postId: '11111111-2222-3333-4444-555555555555',
        lat: 51.5072,
        lng: -0.1276,
        plate: 'AB12 CDE',
      }),
    ]);

    const serialised = JSON.stringify(readBreadcrumbs());

    expect(serialised).not.toContain('11111111');
    expect(serialised).not.toContain('51.5');
    expect(serialised).not.toContain('0.12');
    expect(serialised).not.toContain('AB12');
    // And nothing that merely LOOKS like a stripped payload either.
    expect(serialised).not.toContain('postId');
    expect(serialised).not.toContain('lat');
    expect(readBreadcrumbs()).toEqual(['10:15:30 info sightings:sighting_created']);
  });

  it('keeps only the most recent entries, oldest first', () => {
    // Newest are the ones that explain the failure; oldest-first is reading
    // order for a trail.
    mockGetRecentLogs.mockReturnValue(
      Array.from({ length: MAX_BREADCRUMBS + 20 }, (_, i) => entry(`step_${i}`)),
    );

    const trail = readBreadcrumbs();

    expect(trail).toHaveLength(MAX_BREADCRUMBS);
    expect(trail[0]).toContain('step_20');
    expect(trail[trail.length - 1]).toContain(`step_${MAX_BREADCRUMBS + 19}`);
  });

  it('⚠️ stays inside the column bounds even at its longest', () => {
    // The column CHECKs 50 entries AND 4000 characters joined. An over-long
    // entry would raise a check violation the client can only show as its
    // generic fallback, losing a report over a log line nobody typed.
    mockGetRecentLogs.mockReturnValue(
      Array.from({ length: MAX_BREADCRUMBS }, () => entry('x'.repeat(300))),
    );

    const trail = readBreadcrumbs();

    expect(trail).toHaveLength(MAX_BREADCRUMBS);
    expect(trail.join(',').length).toBeLessThanOrEqual(4000);
  });

  it('returns an empty array when nothing has been logged', () => {
    mockGetRecentLogs.mockReturnValue([]);

    expect(readBreadcrumbs()).toEqual([]);
  });
});
