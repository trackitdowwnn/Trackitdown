/**
 * WHAT:  Tests for ./log.ts — the line's fields, level filtering, the
 *        dev/prod formats, redaction on the way out, and that logging can
 *        never throw.
 * WHY:   docs/logging-decisions.md fixes the schema every function's lines
 *        share; a field silently missing breaks every saved search at once.
 * LINKS: ./log.ts; ./handler.test.ts (request context); docs/logging-decisions.md.
 */

import { createLog, runInContext, type Level } from './log';

function capture(vars: Record<string, string> = {}) {
  const lines: { level: Level; line: string }[] = [];
  const log = createLog('test-fn', {
    env: (name) => vars[name],
    write: (level, line) => lines.push({ level, line }),
  });
  const parsed = () => lines.map(({ line }) => JSON.parse(line));
  return { log, lines, parsed };
}

describe('createLog', () => {
  it('writes one JSON line with every required field', () => {
    const { log, parsed } = capture({ RELEASE: 'abc123', APP_ENV: 'staging' });
    log.info('report_emailed', { report_id: 'r1' });
    const [entry] = parsed();
    expect(entry).toEqual({
      ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      level: 'info',
      msg: 'report_emailed',
      service: 'edge',
      fn: 'test-fn',
      env: 'staging',
      version: 'abc123',
      report_id: 'r1',
    });
  });

  it('defaults to production, an unknown version and level info', () => {
    const { log, parsed } = capture();
    log.debug('hidden');
    log.info('shown');
    expect(parsed()).toEqual([
      expect.objectContaining({ msg: 'shown', env: 'production', version: 'unknown' }),
    ]);
  });

  it.each([
    ['debug', ['debug', 'info', 'warn', 'error']],
    ['warn', ['warn', 'error']],
    ['ERROR', ['error']],
    ['nonsense', ['info', 'warn', 'error']],
  ])('LOG_LEVEL=%s writes %j', (setting, expected) => {
    const { log, lines } = capture({ LOG_LEVEL: setting });
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(lines.map((l) => l.level)).toEqual(expected);
  });

  it('redacts the data on the way out', () => {
    const { log, lines } = capture();
    log.error('send_failed', { authorization: 'Bearer x', detail: 'to a@b.co' });
    expect(lines[0].line).not.toMatch(/Bearer x|a@b\.co/);
  });

  it('never lets data overwrite a base field', () => {
    const { log, parsed } = capture();
    log.info('real', { msg: 'fake', level: 'error', fn: 'other' });
    expect(parsed()[0]).toMatchObject({ msg: 'real', level: 'info', fn: 'test-fn' });
  });

  it('carries the request context when there is one', () => {
    const { log, parsed } = capture();
    runInContext({ trace_id: 't'.repeat(32), span_id: 's'.repeat(16), request_id: 'req-1' }, () =>
      log.info('inside'),
    );
    log.info('outside');
    const [inside, outside] = parsed();
    expect(inside).toMatchObject({
      trace_id: 't'.repeat(32),
      span_id: 's'.repeat(16),
      request_id: 'req-1',
    });
    expect(outside.request_id).toBeUndefined();
  });

  it('is readable text in development', () => {
    const { log, lines } = capture({ APP_ENV: 'development' });
    log.warn('slow', { duration_ms: 5 });
    expect(lines[0].line).toMatch(/^\S+Z WARN \[test-fn\] slow \{"duration_ms":5\}$/);
  });

  it('never throws — an unloggable entry becomes log_failed', () => {
    const { log, parsed } = capture();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const throwing = {
      get boom() {
        throw new Error('getter');
      },
    };
    expect(() => log.info('a', { loop })).not.toThrow();
    expect(() => log.info('b', throwing)).not.toThrow();
    expect(parsed().map((e) => e.msg)).toEqual(['a', 'log_failed']);
  });
});
