/**
 * WHAT:  One guard, against the REAL logger: the failure log's data key
 *        survives redaction.
 * WHY:   bugReportApi.test.ts mocks `@/shared/lib/logger` wholesale, so it can
 *        assert whatever key it likes and never learn what the logger does with
 *        it. That blind spot hid a real defect.
 *
 *        ⚠️ THE KEY WAS `token`, AND logger.ts AUTO-REDACTS ANY KEY MATCHING
 *        /token|password|secret|authorization|apikey|api_key/i. So every
 *        failure — validation rejection and genuine fault alike — reached the
 *        sink as `{ token: '[REDACTED]' }`, indistinguishable from each other.
 *        Fail-safe for privacy, and useless for the one thing the log exists
 *        for: a bug reporter whose own submissions fail silently is this
 *        feature's worst case.
 * LINKS: ./bugReportApi.ts; src/shared/lib/logger.ts; docs/LOGGING.md.
 */

import { addLogSink, createLogger, type LogEntry } from '@/shared/lib/logger';

describe('⚠️ the bug-report failure log survives redaction', () => {
  it('carries a readable reason rather than [REDACTED]', () => {
    const entries: LogEntry[] = [];
    addLogSink((entry) => entries.push(entry));

    // The exact call bugReportApi makes on an unrecognised failure.
    createLogger('profile').error('bug_report_failed', { reason: 'UNKNOWN' });

    const entry = entries.find((e) => e.message === 'bug_report_failed');
    expect(entry?.data).toEqual({ reason: 'UNKNOWN' });
    // The assertion that actually bites: name the key `token` and this fails.
    expect(JSON.stringify(entry?.data)).not.toContain('REDACTED');
  });
});
