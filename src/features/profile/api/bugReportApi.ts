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
    const token = Object.keys(MESSAGES).find((key) => error.message.includes(key));
    // The CODE only — never the message the user wrote, and never the text of
    // the database error, which echoes the input back on some failures.
    log.warn('bug_report_failed', { token: token ?? 'UNKNOWN' });
    throw new BugReportError(
      token ? MESSAGES[token] : FALLBACK,
      token ?? error.code ?? 'UNKNOWN',
    );
  }

  log.info('bug_report_sent');
}
