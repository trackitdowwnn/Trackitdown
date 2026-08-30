/**
 * WHAT:  Tests for the production log sink — what gets captured, what is
 *        stripped from props before it leaves the device, batching, and the
 *        failure behaviour (retry, bounded buffer, no re-entrancy).
 * WHY:   This module reads EVERY log line the app emits and sends some of them
 *        to a table an anonymous caller can write to, so two things must hold
 *        and neither is visible by inspection. First, a coordinate or a plate
 *        must never leave the device — on a stolen-car app that single leak
 *        turns an anonymous counter into a record of where a specific car was.
 *        Second, it must never be able to log: this module is called BY the
 *        logger, so one log line in a failure path is an infinite loop, and
 *        that is the kind of bug that only shows up in production, offline.
 * LINKS: ./telemetry.ts, ./logger.ts,
 *        supabase/migrations/20260830120000_telemetry_sink.sql (the server-side
 *        half of the props contract these mirror), docs/TESTING.md.
 */

import type { LogEntry } from './logger';
import {
  bufferedForTests,
  captureForTests,
  flush,
  installForTests,
  resetTelemetryForTests,
  sanitiseProps,
  shouldCapture,
} from './telemetry';

const mockRpc = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: '2026-08-30T10:00:00.000Z',
  level: 'info',
  feature: 'sightings',
  message: 'feed_load',
  ...over,
});

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: 1, error: null });
  resetTelemetryForTests();
});

afterEach(() => {
  resetTelemetryForTests();
});

describe('shouldCapture', () => {
  it('captures a snake_case info event', () => {
    expect(shouldCapture(entry({ message: 'gate_shown' }))).toBe(true);
  });

  it('ignores a prose info message', () => {
    // The convention IS the discriminator — 123 log.info calls exist, only 86
    // are events. "Sighting submitted" is a sentence and belongs in the console.
    expect(shouldCapture(entry({ message: 'Sighting submitted' }))).toBe(false);
  });

  it('captures every error regardless of message shape', () => {
    expect(shouldCapture(entry({ level: 'error', message: 'Upload failed' }))).toBe(true);
  });

  it('ignores warn and debug', () => {
    expect(shouldCapture(entry({ level: 'warn', message: 'feed_load' }))).toBe(false);
    expect(shouldCapture(entry({ level: 'debug', message: 'feed_load' }))).toBe(false);
  });

  it('never captures its own feature', () => {
    // The re-entrancy guard. Without this a failing flush that logged would
    // queue the log line it just emitted, forever.
    expect(shouldCapture(entry({ feature: 'telemetry', level: 'error' }))).toBe(false);
  });
});

describe('sanitiseProps', () => {
  it('keeps scalars', () => {
    expect(sanitiseProps({ count: 3, ok: true, label: 'hi' })).toEqual({
      count: 3,
      ok: true,
      label: 'hi',
    });
  });

  it.each([
    ['lat', { lat: 51.5 }],
    ['lng', { lng: -0.12 }],
    ['lastSeenLat', { lastSeenLat: 51.5 }],
    ['origin_lng', { origin_lng: -0.12 }],
    ['plate', { plate: 'AB12CDE' }],
    ['plateCanon', { plateCanon: 'AB12CDE' }],
    ['email', { email: 'a@b.com' }],
    ['postcode', { postcode: 'SW1A 1AA' }],
  ])('strips %s — a location or a plate must never leave the device', (_name, data) => {
    expect(sanitiseProps(data)).toEqual({});
  });

  it('drops nested values rather than the whole event', () => {
    // The server's trigger REJECTS a nested bag; dropping the field here means
    // a valid event is never lost to a field nobody cared about.
    expect(sanitiseProps({ ok: true, nested: { a: 1 }, list: [1, 2] })).toEqual({ ok: true });
  });

  it('caps at 8 keys', () => {
    const wide = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitiseProps(wide))).toHaveLength(8);
  });

  it('truncates a long string to 200 characters', () => {
    expect(sanitiseProps({ note: 'x'.repeat(500) }).note).toHaveLength(200);
  });

  it('drops NaN and Infinity, which are not valid JSON', () => {
    expect(sanitiseProps({ a: NaN, b: Infinity, c: 1 })).toEqual({ c: 1 });
  });

  it('drops null and undefined', () => {
    expect(sanitiseProps({ a: null, b: undefined, c: 'keep' })).toEqual({ c: 'keep' });
  });

  it('returns an empty object for no data', () => {
    expect(sanitiseProps(undefined)).toEqual({});
  });
});

describe('capture and flush', () => {
  it('buffers an event and sends it with the session id', async () => {
    installForTests('11111111-1111-4111-8111-111111111111');
    captureForTests(entry({ message: 'feed_load', data: { count: 4 } }));

    expect(bufferedForTests()).toHaveLength(1);

    await flush();

    expect(mockRpc).toHaveBeenCalledWith('record_telemetry_events', {
      p_session_id: '11111111-1111-4111-8111-111111111111',
      p_events: [
        expect.objectContaining({
          event: 'feed_load',
          feature: 'sightings',
          level: 'info',
          props: { count: 4 },
          app_version: '1.0.0',
        }),
      ],
    });
    expect(bufferedForTests()).toHaveLength(0);
  });

  it('turns an error message into a valid event name', async () => {
    installForTests('22222222-2222-4222-8222-222222222222');
    captureForTests(entry({ level: 'error', message: 'Sighting submit failed' }));
    await flush();

    const sent = mockRpc.mock.calls[0][1].p_events[0];
    // The column is CHECK-constrained to ^[a-z][a-z0-9_]*$ — a prose message
    // would be rejected server-side and the event silently lost.
    expect(sent.event).toBe('error_sighting_submit_failed');
    expect(sent.event).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(sent.level).toBe('error');
  });

  it('does nothing when nothing is buffered', async () => {
    installForTests('33333333-3333-4333-8333-333333333333');
    await flush();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('restores the batch when the RPC returns an error, so it retries', async () => {
    installForTests('44444444-4444-4444-8444-444444444444');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });

    captureForTests(entry({ message: 'feed_load' }));
    await flush();

    expect(bufferedForTests()).toHaveLength(1);

    mockRpc.mockResolvedValue({ data: 1, error: null });
    await flush();
    expect(bufferedForTests()).toHaveLength(0);
  });

  it('restores the batch when the RPC throws', async () => {
    installForTests('55555555-5555-4555-8555-555555555555');
    mockRpc.mockRejectedValue(new Error('network'));

    captureForTests(entry({ message: 'feed_load' }));
    await expect(flush()).resolves.toBeUndefined(); // never throws
    expect(bufferedForTests()).toHaveLength(1);
  });

  it('drops the OLDEST events past the ceiling when flushes are failing', () => {
    installForTests('66666666-6666-4666-8666-666666666666');
    mockRpc.mockRejectedValue(new Error('offline'));

    // The offline case the ceiling exists for: events keep arriving while
    // nothing can be sent. The newest are the ones nearest whatever went
    // wrong, so those are the ones kept.
    for (let i = 0; i < 250; i++) {
      captureForTests(entry({ message: `event_${i}`, data: { i } }));
    }
    const buffered = bufferedForTests();
    expect(buffered.length).toBeLessThanOrEqual(200);
    expect(buffered[buffered.length - 1].props).toEqual({ i: 249 });
  });

  it('keeps capturing while a flush is in flight', async () => {
    // Regression: an earlier draft skipped capture whenever `flushing` was
    // true, which silently discarded every event from every other feature for
    // the length of a network round trip.
    installForTests('77777777-7777-4777-8777-777777777777');
    let release: (v: unknown) => void = () => {};
    mockRpc.mockReturnValue(new Promise((r) => { release = r; }));

    for (let i = 0; i < 50; i++) captureForTests(entry({ message: `event_${i}` }));
    expect(bufferedForTests()).toHaveLength(0); // the batch is in flight

    captureForTests(entry({ message: 'arrived_mid_flight' }));
    expect(bufferedForTests()).toHaveLength(1);

    release({ data: 50, error: null });
    await Promise.resolve();
  });

  it('does nothing before the sink is installed', () => {
    // No session id yet, so there is nothing to attribute events to.
    captureForTests(entry({ message: 'feed_load' }));
    expect(bufferedForTests()).toHaveLength(1); // buffered…
    return flush().then(() => {
      expect(mockRpc).not.toHaveBeenCalled(); // …but never sent.
    });
  });
});
