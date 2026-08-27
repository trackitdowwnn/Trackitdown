/**
 * WHAT:  Emails a submitted bug report to the operator, with a time-limited
 *        signed link per screenshot.
 * WHY:   Bug reports landed in a table nobody watches. Invoked by the
 *        reporting client right after submit_bug_report succeeds, exactly like
 *        notify-sighting — and, exactly like notify-sighting, a client-invoked
 *        call cannot be trusted, so the DATABASE authorises:
 *        claim_bug_report_email serves only reports whose reporter_id is the
 *        caller, and stamps `emailed_at` in the same statement so a replay
 *        sends nothing.
 *
 *        ⚠️ SIGNED LINKS, NEVER ATTACHMENTS. bug-screenshots is a PRIVATE
 *        bucket with no client read policy, and the whole screenshot design
 *        rests on the image not being freely fetchable. Attaching the bytes
 *        would put copies of potentially sensitive pictures — an address, a
 *        plate, somebody's driveway — permanently in a mailbox outside that
 *        boundary, where account deletion could never reach them. A link that
 *        expires keeps the bucket the only home the image has.
 *
 *        ⚠️ THE EMAIL IS NOT A REASON TO FAIL A REPORT. The row is committed
 *        before this is ever called, and the client dispatches it
 *        fire-and-forget. Every failure path here returns rather than throws.
 *
 *        HONEST LIMITATION: client-invoked, so a report whose app dies before
 *        the call is emailed only when the NEXT report drains the backlog (the
 *        claim takes the oldest unsent one). That is the same limitation every
 *        notify-* function in this project carries, and a pg_net trigger on
 *        insert is the proper fix.
 * LINKS: supabase/migrations/20260827100000_bug_report_email.sql (the claim);
 *        src/features/notifications/api/notifyApi.ts (the one door that calls
 *          this); ../_shared/clients.ts; ../_shared/http.ts.
 */

import { createServiceRoleClient, requireEnv } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/**
 * Where reports go, and who they come from.
 *
 * ⚠️ ENV-FIRST, because both of these are known to be temporary. The
 * destination is an interim gmail (owner-supplied 2026-08-27) pending "a more
 * official email later", and the sender depends on which domain is verified in
 * Resend — this project already sends auth OTPs through Resend, so a verified
 * domain very likely exists and is a better sender than the shared one. Set
 * either as a Supabase secret and neither needs a code change or a redeploy:
 *
 *     supabase secrets set BUG_REPORT_TO_ADDRESS=bugs@yourdomain.com
 *     supabase secrets set BUG_REPORT_FROM_ADDRESS='Trackitdown <bugs@yourdomain.com>'
 *
 * ⚠️ THE FALLBACK SENDER IS RESTRICTED. onboarding@resend.dev needs no domain
 * verification but delivers ONLY to the address that owns the Resend account.
 * If the destination is ever changed to something else while the sender is
 * still the fallback, Resend refuses and the report is silently not delivered —
 * which is why the send failure is logged rather than swallowed.
 */
const TO_ADDRESS = Deno.env.get('BUG_REPORT_TO_ADDRESS') ?? 'trackitdowwnn@gmail.com';
const FROM_ADDRESS =
  Deno.env.get('BUG_REPORT_FROM_ADDRESS') ?? 'Trackitdown Bugs <onboarding@resend.dev>';

/** How long a screenshot link works. Long enough to read a report on Monday
 *  that arrived on Friday; short enough that an old mailbox is not an archive
 *  of other people's pictures. */
const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

const BUCKET = 'bug-screenshots';

interface ClaimedReport {
  claimed: boolean;
  id?: string;
  created_at?: string;
  message?: string;
  expected?: string | null;
  area?: string | null;
  severity?: string | null;
  frequency?: string | null;
  app_version?: string | null;
  platform?: string | null;
  os_version?: string | null;
  device_model?: string | null;
  breadcrumbs?: string[] | null;
  screenshot_paths?: string[] | null;
}

/** Escape anything that lands inside the HTML body. The message is free text a
 *  user typed, so it is the one thing here that can carry markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `label: value` rows, skipping anything the reporter left unanswered — an
 *  empty row says nothing and makes the real answers harder to find. */
function factRows(report: ClaimedReport): string {
  const facts: [string, string | null | undefined][] = [
    ['Area', report.area],
    ['Severity', report.severity],
    ['Frequency', report.frequency],
    ['App version', report.app_version],
    ['Platform', report.platform],
    ['OS', report.os_version],
    ['Device', report.device_model],
    ['Filed', report.created_at],
  ];
  return facts
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${label}</td>` +
        `<td style="padding:2px 0">${escapeHtml(String(value))}</td></tr>`,
    )
    .join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST.', 405);
  }

  const admin = createServiceRoleClient();

  const jwt = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: auth } = await admin.auth.getUser(jwt);
  const actor = auth?.user?.id;
  if (!actor) {
    return errorResponse('NOT_AUTHENTICATED', 'Sign in required.', 401);
  }

  // ⚠️ NO BODY IS READ. The caller does not get to say which report to send —
  // the claim serves the oldest unsent report belonging to THIS actor, so a
  // forged id from a patched client has nothing to forge.
  const { data, error } = await admin.rpc('claim_bug_report_email', { p_actor: actor });
  if (error) {
    console.error('[bug-report] claim failed', error.message);
    return errorResponse('CLAIM_FAILED', 'Could not claim the report.', 500);
  }

  const report = data as ClaimedReport | null;
  if (!report?.claimed) {
    // Nothing to send, not theirs, does not exist — one answer for all three.
    return jsonResponse({ sent: false });
  }

  // Sign each screenshot. A path that fails to sign is reported as such rather
  // than dropped: an operator told "3 screenshots" who can see two links would
  // otherwise wonder which one they are missing.
  const paths = report.screenshot_paths ?? [];
  const links: string[] = [];
  for (const [index, path] of paths.entries()) {
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, LINK_TTL_SECONDS);
    links.push(
      signed?.signedUrl
        ? `<li><a href="${signed.signedUrl}">Screenshot ${index + 1}</a> (link expires in 7 days)</li>`
        : `<li>Screenshot ${index + 1} — could not be linked; open it from the dashboard</li>`,
    );
  }

  const trail = (report.breadcrumbs ?? []).map((line) => escapeHtml(line)).join('<br>');
  const subject =
    `[Bug] ${report.severity ?? 'report'} — ${(report.message ?? '').slice(0, 60)}` +
    ((report.message ?? '').length > 60 ? '…' : '');

  const html = `
    <h2 style="margin:0 0 12px">Bug report</h2>
    <p style="white-space:pre-wrap;font-size:16px">${escapeHtml(report.message ?? '')}</p>
    ${
      report.expected
        ? `<p style="margin-top:16px"><strong>Expected instead</strong><br>
           <span style="white-space:pre-wrap">${escapeHtml(report.expected)}</span></p>`
        : ''
    }
    <table style="margin-top:16px;font-size:14px;border-collapse:collapse">${factRows(report)}</table>
    ${links.length ? `<h3 style="margin:20px 0 6px">Screenshots</h3><ul>${links.join('')}</ul>` : ''}
    ${
      trail
        ? `<h3 style="margin:20px 0 6px">Recent activity</h3>
           <pre style="font-size:12px;color:#444;white-space:pre-wrap">${trail}</pre>`
        : ''
    }
    <p style="margin-top:20px;font-size:12px;color:#888">Report ${report.id}</p>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [TO_ADDRESS], subject, html }),
    });

    if (!response.ok) {
      // ⚠️ THE STATUS ONLY. A provider's error body can quote the payload back,
      // and the payload here is the text somebody wrote about their bug — the
      // same rule bugReportApi follows for database errors.
      console.error('[bug-report] send failed', response.status);
      return errorResponse('SEND_FAILED', 'Could not send the email.', 502);
    }
  } catch {
    console.error('[bug-report] send threw');
    return errorResponse('SEND_FAILED', 'Could not send the email.', 502);
  }

  // The id only — never the message, never a link, never the address.
  console.log('[bug-report] emailed', report.id);
  return jsonResponse({ sent: true });
});
