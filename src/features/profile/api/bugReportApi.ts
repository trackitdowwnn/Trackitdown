/**
 * WHAT:  The bug-report write boundary — one call to `submit_bug_report`.
 * WHY:   The only way a user can tell us something is broken. The server owns
 *        every rule (auth, length, the 5-per-hour limit); this file's job is to
 *        turn its tokens into copy a person can act on.
 *
 *        ⚠️ WIDENED 2026-08-24 (owner request) from "message + four device
 *        facts" to a triageable report: area, severity, frequency, what they
 *        expected, an event-name breadcrumb trail, and up to three screenshots.
 *        The three original rejections were NOT reversed wholesale — the route
 *        is still never captured (area is a closed ten-value vocabulary that
 *        cannot hold an id), and logs still travel as event NAMES with every
 *        data payload dropped. Screenshots are the one genuine change of mind,
 *        and they are user-picked, previewed, EXIF-stripped and private-bucket
 *        only. See ./bugScreenshotUpload.ts for why that is defensible and
 *        where its limits are.
 *
 *        ⚠️ THE MESSAGE IS NEVER LOGGED. It is free text the user wrote, and it
 *        is exactly where someone types a plate or an address despite being
 *        asked not to. The same rule governs chat bodies ("log the event
 *        'message sent', never the text") and alert criteria. What is logged is
 *        that a report was sent, and on failure a machine code — nothing else,
 *        not a length, not a preview. The same now goes for `expected`, which
 *        is the user's own text by the same definition.
 * LINKS: supabase/migrations/20260824100000_bug_reports.sql (the RPC and its
 *          tokens); ../screens/ReportBugScreen.tsx (the only consumer);
 *        ../lib/bugDiagnostics.ts (what travels with it);
 *        docs/LOGGING.md (why the text stays out of the logs).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { BugDiagnostics } from '../lib/bugDiagnostics';
import type { BugArea, BugFrequency, BugSeverity } from '../lib/bugReportOptions';

const log = createLogger('profile');

/**
 * A refusal from `submit_bug_report`, already turned into copy.
 *
 * `message` is display-ready and carries nothing from the server's own error
 * text; `code` is the machine token (`NOT_AUTHENTICATED` | `INVALID_INPUT` |
 * `RATE_LIMITED`, or the raw PostgREST code when the failure is unrecognised).
 */
export class BugReportError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'BugReportError';
    this.code = code;
  }
}

/** What the server can refuse with, and what a person should read instead. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Please sign in to send a report.',
  INVALID_INPUT: 'Please write a little about what went wrong.',
  // Deliberately not "try again later": that invites a retry loop against a
  // limit measured in hours. It names the window instead.
  RATE_LIMITED: 'You’ve sent a few reports already. Please try again in an hour.',
};

/**
 * What the reporter is told when nothing more specific is known.
 *
 * ⚠️ EXPORTED BECAUSE THE SCREEN NEEDS THE SAME SENTENCE. `handleComplete`
 * converts anything that is not a BugReportError into one, and it was written
 * with this string copy-pasted — so two different failures (an RPC that
 * returned an error we don't recognise, and an upload or network call that
 * THREW) rendered identical text from two literals that could drift apart. One
 * constant, and the paths are told apart by their log reason instead.
 */
export const BUG_REPORT_FALLBACK_MESSAGE = 'We couldn’t send this. Please try again.';

const FALLBACK = BUG_REPORT_FALLBACK_MESSAGE;

/** The longest message the server will accept. Mirrored here so the screen can
 *  stop typing at the cap rather than let someone write past it and lose it. */
export const BUG_REPORT_MAX_LENGTH = 2000;

/**
 * Everything a report carries beyond the message and the device facts. Every
 * field is optional: the form asks for them, and none of them is worth blocking
 * a report over.
 */
export interface BugReportDetails {
  area: BugArea | null;
  severity: BugSeverity | null;
  frequency: BugFrequency | null;
  /** What they expected instead. Same rules as `message`: never logged. */
  expected: string | null;
  /** Log EVENT NAMES only — see ../lib/bugBreadcrumbs.ts. */
  breadcrumbs: string[];
  /** Object paths in the PRIVATE bucket. Never URLs — there is no read path. */
  screenshotPaths: string[];
}

/**
 * How many reports the caller may still file this hour (0-5).
 *
 * ⚠️ ADVISORY ONLY. `submitBugReport` remains the sole authority on the limit;
 * this exists so a rate-limited reporter can be told BEFORE three screenshots
 * upload rather than after. Treat any failure as "probably fine, carry on" —
 * a broken probe must never be what stops someone reporting a bug.
 *
 * @returns remaining allowance, or `null` if it could not be read.
 */
export async function readBugReportQuota(): Promise<number | null> {
  const { data, error } = await supabase.rpc('bug_report_quota_remaining');
  if (error) {
    log.warn('bug_report_quota_unavailable');
    return null;
  }
  return typeof data === 'number' ? data : null;
}

/**
 * Send a bug report.
 *
 * Requires a SIGNED-IN caller — the server pins `reporter_id` to `auth.uid()`
 * and refuses a guest. `message` is trimmed here and re-validated there.
 * Screenshots must already be uploaded: pass their PATHS, which the server
 * verifies live under the caller's own folder.
 *
 * ⚠️ RETURNS THE NEW REPORT'S ID, which the caller hands to notifyBugReport so
 * the operator is emailed the report that was actually just filed. Before the
 * RPC returned it, the email path had to GUESS — it took the oldest unsent
 * report for that reporter — and on 2026-08-27 that emailed reports from an
 * hour earlier while the new ones sat unsent. The id is the fix, so it is not
 * optional decoration: dropping it on the floor here brings the guessing back.
 *
 * @throws {BugReportError} on any refusal. `.message` is safe to show:
 *   `NOT_AUTHENTICATED` (signed out), `INVALID_INPUT` (empty or over 2000
 *   characters, or a screenshot path that is not the caller's), `RATE_LIMITED`
 *   (more than 5 in a rolling hour), or a generic fallback for anything else.
 */
export async function submitBugReport(
  message: string,
  diagnostics: BugDiagnostics,
  details: BugReportDetails,
): Promise<string | null> {
  const expected = details.expected?.trim();

  const { data, error } = await supabase.rpc('submit_bug_report', {
    p_message: message.trim(),
    p_app_version: diagnostics.appVersion,
    p_platform: diagnostics.platform,
    p_os_version: diagnostics.osVersion,
    p_device_model: diagnostics.deviceModel,
    p_area: details.area,
    p_severity: details.severity,
    p_frequency: details.frequency,
    p_expected: expected ? expected : null,
    // ⚠️ EMPTY ARRAYS TRAVEL AS NULL. An empty array in the operator's queue
    // reads as "we captured a trail and it was empty" / "they attached no
    // screenshots on purpose"; null reads as "there was none". Those are
    // different facts and the queue should not have to guess which it is.
    p_breadcrumbs: details.breadcrumbs.length > 0 ? details.breadcrumbs : null,
    p_screenshot_paths:
      details.screenshotPaths.length > 0 ? details.screenshotPaths : null,
  });

  if (error) {
    // ⚠️ ONLY OUR OWN `raise` MAY CHOOSE THE COPY. P0001 is the SQLSTATE for
    // `raise exception`, which reaches us as the bare token. Everything else
    // is generic — and specifically a check-constraint violation (23514),
    // whose message QUOTES THE OFFENDING INPUT. Scanning that for tokens, as
    // this did, would let text the REPORTER TYPED decide what they are told:
    // write "RATE_LIMITED" in a report long enough to trip a constraint and
    // you are told to come back in an hour.
    const text = error.message.trim();
    const token =
      error.code === 'P0001'
        ? Object.keys(MESSAGES).find((key) => key === text || text.includes(key))
        : undefined;

    // The CODE only — never the message the user wrote, and never the text of
    // the database error, which echoes the input back on some failures.
    //
    // A recognised token is a validation rejection and stays at warn. An
    // UNKNOWN is a genuine failure and must reach the Phase-5 sink at error:
    // a bug reporter whose own submissions fail silently is the worst case
    // this feature has.
    // ⚠️ THE KEY IS `reason`, NOT `token`. logger.ts auto-redacts any data
    // key matching /token|password|secret|.../i, so `{ token: 'RATE_LIMITED' }`
    // reaches the sink as `{ token: '[REDACTED]' }` — fail-safe for privacy,
    // but it would have made the two branches below indistinguishable and the
    // warn/error split pointless. These values are fixed machine tokens from
    // our own `raise`, never user text, so they are safe to carry.
    if (token) {
      log.warn('bug_report_failed', { reason: token });
    } else {
      log.error('bug_report_failed', { reason: 'UNKNOWN' });
    }
    throw new BugReportError(
      token ? MESSAGES[token] : FALLBACK,
      token ?? error.code ?? 'UNKNOWN',
    );
  }

  log.info('bug_report_sent');
  // The id, or null if the server gave us nothing recognisable. Null is not an
  // error — the report IS saved — it only means the email dispatch has nothing
  // to name, and notifyBugReport skips rather than falling back to a guess.
  return typeof data === 'string' ? data : null;
}
