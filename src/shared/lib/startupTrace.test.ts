/**
 * WHAT:  Tests for startupTrace — one trace per launch, first-arrival wins,
 *        missing phases reported rather than dropped.
 * WHY:   This exists to make a slow startup falsifiable, so it has to be
 *        trustworthy itself: a trace that fires twice (a reload, a remount)
 *        or that silently omits a phase that never happened would send someone
 *        optimising the wrong thing. The omission case matters most — a
 *        missing phase IS the finding.
 * LINKS: src/shared/lib/startupTrace.ts; docs/LOGGING.md.
 */

import { __resetStartupTrace, markStartup } from './startupTrace';

// `mock`-prefixed and untyped params: babel's jest.mock scope check rejects
// any other out-of-scope name, and reads a NAMED parameter inside a type
// annotation as a variable access too.
// eslint-disable-next-line no-var
var mockLogSpy = jest.fn();

jest.mock('./logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogSpy(...args),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

/** The emitted payload of the single trace. */
const traced = () => mockLogSpy.mock.calls[0][1] as Record<string, number | null>;

beforeEach(() => {
  mockLogSpy.mockClear();
  __resetStartupTrace();
});

describe('startupTrace', () => {
  it('emits nothing until the feed actually paints', () => {
    markStartup('fonts_ready');
    markStartup('session_ready');
    markStartup('location_ready');
    markStartup('feed_loaded');

    // Four phases in and still silent: the trace measures what the USER waited
    // for, which is cars on screen — not the last network call returning.
    expect(mockLogSpy).not.toHaveBeenCalled();

    markStartup('feed_first_paint');
    expect(mockLogSpy).toHaveBeenCalledTimes(1);
    expect(mockLogSpy).toHaveBeenCalledWith('startup_trace', expect.any(Object));
  });

  it('reports a phase that never happened as null, rather than dropping it', () => {
    // A boot that never resolved a location is exactly the kind of thing this
    // is for. Omitting the key would make it invisible in the log line.
    markStartup('fonts_ready');
    markStartup('feed_first_paint');

    const data = traced();
    expect(data).toHaveProperty('location_ready', null);
    expect(data).toHaveProperty('session_ready', null);
    expect(typeof data.fonts_ready).toBe('number');
  });

  it('traces ONCE per launch — a remount cannot emit a second', () => {
    markStartup('feed_first_paint');
    markStartup('feed_first_paint');
    markStartup('fonts_ready');

    expect(mockLogSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the FIRST arrival of a phase, not the last', async () => {
    markStartup('fonts_ready');
    await new Promise((resolve) => setTimeout(resolve, 25));
    markStartup('fonts_ready'); // a re-render, much later
    markStartup('feed_first_paint');

    const data = traced();
    // RELATIVE, not an absolute threshold. The first version asserted the mark
    // was under 20ms, which is only true when the machine is idle — it passed
    // alone and failed in the full suite. If the LATE call had won, fonts_ready
    // would sit alongside the final phase instead of ~25ms before it.
    expect(
      (data.feed_first_paint as number) - (data.fonts_ready as number),
    ).toBeGreaterThanOrEqual(20);
  });

  it('measures cumulatively from JS start, so phases stay comparable', () => {
    markStartup('fonts_ready');
    markStartup('feed_first_paint');

    const data = traced();
    // total is the final phase's own mark — not a sum of deltas, because the
    // phases overlap and summing them would overstate the wait.
    expect(data.total).toBe(data.feed_first_paint);
    expect(data.feed_first_paint as number).toBeGreaterThanOrEqual(data.fonts_ready as number);
  });
});
