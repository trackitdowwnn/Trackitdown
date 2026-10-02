/**
 * WHAT:  Jest's global setup: pins the test clock's zone to Europe/London
 *        before any test worker starts.
 * WHY:   The app's users are in the UK, and some tests pin UK clock rules
 *        (calendarDates.test.ts: the spring-forward hour that doesn't exist).
 *        Setting process.env.TZ INSIDE a test file does nothing: Jest gives
 *        each test file its own copy of process.env, so Node's clock never
 *        sees the change. Those tests passed on a laptop set to UK time and
 *        failed on CI (UTC) from 2026-09-29 until this fix (2026-10-02).
 *        This runs in the parent process, so every worker inherits the zone.
 * LINKS: package.json (jest.globalSetup); src/shared/lib/calendarDates.test.ts.
 */

module.exports = async () => {
  process.env.TZ = 'Europe/London';
};
