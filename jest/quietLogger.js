/**
 * WHAT:  Hides the app logger's own lines (src/shared/lib/logger.ts —
 *        "🔴 ERROR [feature] message …") from Jest output.
 * WHY:   Hundreds of tests deliberately drive failure paths, and the logger
 *        reports each one exactly as it would on a device. That made a green
 *        run print ~700 "ERROR"/"WARN" lines that were not test errors at all —
 *        and buried the console output that IS a problem (React act() warnings,
 *        deprecations), which this filter leaves untouched.
 *        Only lines in the logger's exact `<icon> <LEVEL> [feature] ` shape are
 *        dropped. A test that spies on console (jest.spyOn) still sees every
 *        call: the spy wraps this filter. DEBUG_LOGS=1 shows them again.
 * LINKS: src/shared/lib/logger.ts (LEVEL_PREFIX); package.json jest.setupFiles.
 */

const LOGGER_LINE = /^\S+\s(DEBUG|INFO|WARN|ERROR)\s+\[[^\]]+\]\s/;

if (!process.env.DEBUG_LOGS) {
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method];
    console[method] = (...args) => {
      if (typeof args[0] === 'string' && LOGGER_LINE.test(args[0])) return;
      original(...args);
    };
  }
}
