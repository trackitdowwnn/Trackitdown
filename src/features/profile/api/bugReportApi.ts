/**
 * WHAT:  The bug-report write boundary — one call to `submit_bug_report`.
 * WHY:   The only way a user can tell us something is broken. The server owns
 *        every rule (auth, length, the 5-per-hour limit); this file's job is to
 *        turn its tokens into copy a person can act on.
 *
 *        ⚠️ THE MESSAGE IS NEVER LOGGED. It is free text the user wrote, and it
 *        is exactly where someone types a plate or an address despite being
 *        asked not to. The same rule governs chat bodies ("log the event
 *        'message sent', never the text") and alert criteria. What is logged is
 *        that a report was sent, and on failure a machine code — nothing else,
 *        not a length, not a preview.
 * LINKS: supabase/migrations/20260824100000_bug_reports.sql (the RPC and its
 *          tokens); ../screens/ReportBugScreen.tsx (the only consumer);
 *        ../lib/bugDiagnostics.ts (what travels with it);
 *        docs/LOGGING.md (why the text stays out of the logs).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { BugDiagnostics } from '../lib/bugDiagnostics';

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

const FALLBACK = 'We couldn’t send this. Please try again.';

/** The longest message the server will accept. Mirrored here so the screen can
 *  stop typing at the cap rather than let someone write past it and lose it. */
export const BUG_REPORT_MAX_LENGTH = 2000;

/**
 * Send a bug report.
 *
 * Requires a SIGNED-IN caller — the server pins `reporter_id` to `auth.uid()`
 * and refuses a guest. `message` is trimmed here and re-validated there.
 *
 * @throws {BugReportError} on any refusal. `.message` is safe to show:
 *   `NOT_AUTHENTICATED` (signed out), `INVALID_INPUT` (empty or over 2000
 *   characters), `RATE_LIMITED` (more than 5 in a rolling hour), or a generic
 *   fallback for anything else.
 */
export async function submitBugReport(
  message: string,
  diagnostics: BugDiagnostics,
): Promise<void> {
  const { error } = await supabase.rpc('submit_bug_report', {
    p_message: message.trim(),
    p_app_version: diagnostics.appVersion,
    p_platform: diagnostics.platform,
    p_os_version: diagnostics.osVersion,
    p_device_model: diagnostics.deviceModel,
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
}
