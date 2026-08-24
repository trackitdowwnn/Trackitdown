/**
 * WHAT:  Tests for bugReportApi — the payload it sends, the copy it maps each
 *        server refusal to, and what it is allowed to log.
 * WHY:   Two things here are load-bearing. The client must never supply a
 *        reporter id (the server pins it to auth.uid(), and a client-supplied
 *        one would be an attribution hole). And the report text must never
 *        reach the logs: it is free text the user wrote, and it is exactly
 *        where someone types a plate or an address despite being asked not to —
 *        the same rule that governs chat bodies.
 * LINKS: src/features/profile/api/bugReportApi.ts;
 *        supabase/migrations/20260824100000_bug_reports.sql; docs/LOGGING.md.
 */

import { BugReportError, submitBugReport } from './bugReportApi';
import type { BugDiagnostics } from '../lib/bugDiagnostics';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: (...args: unknown[]) => mockError(...args),
    debug: jest.fn(),
  }),
}));

const DIAGNOSTICS: BugDiagnostics = {
  appVersion: '1.0.0',
  platform: 'ios',
  osVersion: '18.2',
  deviceModel: 'iPhone 14',
};

beforeEach(() => jest.clearAllMocks());

describe('the payload', () => {
  it('sends the message and the four named diagnostics, and nothing else', async () => {
    mockRpc.mockResolvedValue({ error: null });

    await submitBugReport('  the map went blank  ', DIAGNOSTICS);

    expect(mockRpc).toHaveBeenCalledWith('submit_bug_report', {
      p_message: 'the map went blank',
      p_app_version: '1.0.0',
      p_platform: 'ios',
      p_os_version: '18.2',
      p_device_model: 'iPhone 14',
    });
    // ⚠️ Exactly these keys. A reporter id from the client would be an
    // attribution hole, and anything identifying a post, sighting or place has
    // no business in a support queue.
    const [, params] = mockRpc.mock.calls[0];
    // Sorted both sides: "exactly these five keys" is the property worth
    // pinning, and object-literal order is implementation.
    expect(Object.keys(params).sort()).toEqual([
      'p_app_version',
      'p_device_model',
      'p_message',
      'p_os_version',
      'p_platform',
    ]);
  });

  it('passes a missing diagnostic through as null rather than inventing one', async () => {
    mockRpc.mockResolvedValue({ error: null });

    await submitBugReport('x', { ...DIAGNOSTICS, deviceModel: null, osVersion: null });

    const [, params] = mockRpc.mock.calls[0];
    expect(params.p_device_model).toBeNull();
    expect(params.p_os_version).toBeNull();
  });
});

describe('what the user is told', () => {
  const refusals: [string, string][] = [
    ['NOT_AUTHENTICATED', 'Please sign in to send a report.'],
    ['INVALID_INPUT', 'Please write a little about what went wrong.'],
    ['RATE_LIMITED', 'You’ve sent a few reports already. Please try again in an hour.'],
  ];

  it.each(refusals)('maps %s to copy a person can act on', async (token, copy) => {
    mockRpc.mockResolvedValue({ error: { message: `error: ${token}`, code: 'P0001' } });

    await expect(submitBugReport('x', DIAGNOSTICS)).rejects.toMatchObject({
      code: token,
      message: copy,
    });
  });

  it('falls back rather than showing a database error', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'duplicate key value violates…', code: '23505' } });

    await expect(submitBugReport('x', DIAGNOSTICS)).rejects.toMatchObject({
      message: 'We couldn’t send this. Please try again.',
    });
  });
});

describe('⚠️ what reaches the logs', () => {
  it('logs the event and NOT the report text', async () => {
    mockRpc.mockResolvedValue({ error: null });

    await submitBugReport('my plate is AB12 CDE and I live at 4 Elm Road', DIAGNOSTICS);

    expect(mockInfo).toHaveBeenCalledWith('bug_report_sent');
    // No second argument at all — not the text, not its length, not a preview.
    expect(mockInfo.mock.calls[0]).toHaveLength(1);
  });

  it('logs only a token on failure, never the message or the server error', async () => {
    // The database echoes the input back on some failures, so the error's own
    // message is as unsafe to log as the user's text.
    mockRpc.mockResolvedValue({
      error: { message: 'value too long: my plate is AB12 CDE', code: 'P0001' },
    });

    await expect(submitBugReport('my plate is AB12 CDE', DIAGNOSTICS)).rejects.toThrow(
      BugReportError,
    );

    // ⚠️ error, NOT warn. An unrecognised failure is a real one, and only
    // error reaches the crash sink — a bug reporter whose own submissions fail
    // silently is this feature's worst case.
    expect(mockError).toHaveBeenCalledWith('bug_report_failed', { reason: 'UNKNOWN' });
    const logged = JSON.stringify([...mockError.mock.calls, ...mockWarn.mock.calls]);
    expect(logged).not.toContain('AB12');
    expect(logged).not.toContain('value too long');
  });

  it('keeps a validation rejection at warn', async () => {
    // These three are the user being told something, not a fault to page on.
    mockRpc.mockResolvedValue({ error: { message: 'RATE_LIMITED', code: 'P0001' } });

    await expect(submitBugReport('again', DIAGNOSTICS)).rejects.toThrow(BugReportError);

    expect(mockWarn).toHaveBeenCalledWith('bug_report_failed', { reason: 'RATE_LIMITED' });
    expect(mockError).not.toHaveBeenCalled();
  });

  it('⚠️ does not let the reporter pick the error copy by typing a token', async () => {
    // A check-constraint violation (23514) quotes the offending input back, so
    // its message can contain whatever the reporter typed. The scan this
    // replaced searched every failure's text and would have matched here —
    // handing someone who wrote "NOT_AUTHENTICATED" a "please sign in" they
    // cannot act on, from a submission that was signed in the whole time.
    mockRpc.mockResolvedValue({
      error: { message: 'new row violates check constraint: NOT_AUTHENTICATED', code: '23514' },
    });

    await expect(submitBugReport('NOT_AUTHENTICATED', DIAGNOSTICS)).rejects.toThrow(
      'We couldn’t send this. Please try again.',
    );
    expect(mockError).toHaveBeenCalledWith('bug_report_failed', { reason: 'UNKNOWN' });
  });
});
