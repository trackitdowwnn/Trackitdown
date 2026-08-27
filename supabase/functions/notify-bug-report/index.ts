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
 *        the call is never emailed at all. The claim is BY ID now, so nothing
 *        drains it later — that trade was taken deliberately, because the
 *        draining version emailed the wrong report (2026-08-27). The row is
 *        still in bug_reports either way; a pg_net trigger on insert is the
 *        proper fix and would close it for good.
 * LINKS: ./emailContent.ts (everything that builds the message, and its tests);
 *        supabase/migrations/20260827140000_bug_report_email_context.sql (the
 *          claim); src/features/notifications/api/notifyApi.ts (the one door
 *          that calls this); ../_shared/clients.ts; ../_shared/http.ts.
 */

import { createServiceRoleClient, requireEnv } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
// ⚠️ THE CONTENT BUILDERS LIVE NEXT DOOR SO THEY CAN BE TESTED. They are pure
// and Deno-free on purpose: a TypeError in one of them stopped every bug-report
// email on 2026-08-27, and this directory is outside tsconfig and outside lint.
import {
  buildSubject,
  escapeHtml,
  facts,
  factRowsHtml,
  formatWhen,
  plainText,
  type ClaimedReport,
} from './emailContent.ts';

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

  // ⚠️ THE ID IS REQUIRED, and the first version of this deliberately read no
  // body at all — the claim picked the oldest unsent report for the actor and
  // assumed that was the one just filed. On 2026-08-27 it was not: the
  // operator was emailed reports from an hour earlier while the new ones sat
  // unsent, and one missed dispatch would have offset every report after it
  // permanently. Guessing was the bug; the id is now carried end to end.
  //
  // Trusting it is safe because the DATABASE re-checks: the claim serves the
  // row only when its reporter_id is this actor, so a forged id gets the same
  // answer as a missing one.
  let reportId: string;
  try {
    const body = (await request.json()) as { reportId?: string };
    if (!body.reportId) throw new Error('reportId required');
    reportId = body.reportId;
  } catch {
    return errorResponse('BAD_REQUEST', 'reportId is required.', 400);
  }

  const { data, error } = await admin.rpc('claim_bug_report_email', {
    p_actor: actor,
    p_report_id: reportId,
  });
  if (error) {
    console.error('[bug-report] claim failed', error.message);
    return errorResponse('CLAIM_FAILED', 'Could not claim the report.', 500);
  }

  const report = data as ClaimedReport | null;
  if (!report?.claimed) {
    // Already sent, not theirs, does not exist — one answer for all three, so
    // this is not an oracle for which of them is true.
    return jsonResponse({ sent: false });
  }

  // ⚠️ THE ADDRESS IS RESOLVED HERE, NOT IN SQL. The claim returns the
  // reporter's UUID only; turning it into an address goes through the auth
  // admin API rather than a SECURITY DEFINER function reading auth.users,
  // which would put a path to every user's email behind a function whose job
  // is bug reports. A failure is not fatal — the id is still in the email and
  // is enough to look the person up — so this never blocks the send.
  let reporterEmail: string | null = null;
  if (report.reporter_id) {
    try {
      const { data: user } = await admin.auth.admin.getUserById(report.reporter_id);
      reporterEmail = user?.user?.email ?? null;
    } catch {
      console.error('[bug-report] could not resolve the reporter address');
    }
  }

  // Sign each screenshot. A path that fails to sign is reported as such rather
  // than dropped: an operator told "3 screenshots" who can see two links would
  // otherwise wonder which one they are missing.
  const paths = report.screenshot_paths ?? [];
  const links: { label: string; url: string | null }[] = [];
  for (const [index, path] of paths.entries()) {
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, LINK_TTL_SECONDS);
    links.push({ label: `Screenshot ${index + 1}`, url: signed?.signedUrl ?? null });
  }
  const linksHtml = links
    .map((link) =>
      link.url
        ? `<li><a href="${link.url}">${link.label}</a> <span style="color:#888">(expires in 7 days)</span></li>`
        : `<li>${link.label} — could not be linked; open it from the dashboard</li>`,
    )
    .join('');

  const rows = facts(report, reporterEmail);
  const trail = (report.breadcrumbs ?? []).map((line) => escapeHtml(line)).join('<br>');

  const subject = buildSubject(report);

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">Bug report</h2>
    <p style="margin:0 0 16px;color:#888;font-size:13px">
      ${escapeHtml(formatWhen(report.created_at) ?? '')}
    </p>
    <div style="border-left:3px solid #ddd;padding:2px 0 2px 14px;margin-bottom:18px">
      <p style="white-space:pre-wrap;font-size:16px;margin:0">${escapeHtml(report.message ?? '')}</p>
    </div>
    ${
      report.expected
        ? `<p style="margin:0 0 18px"><strong>Expected instead</strong><br>
           <span style="white-space:pre-wrap">${escapeHtml(report.expected)}</span></p>`
        : ''
    }
    <table style="font-size:14px;border-collapse:collapse">${factRowsHtml(rows)}</table>
    ${links.length ? `<h3 style="margin:20px 0 6px">Screenshots</h3><ul style="margin:0;padding-left:20px">${linksHtml}</ul>` : ''}
    ${
      trail
        ? `<h3 style="margin:20px 0 6px">Recent activity</h3>
           <pre style="font-size:12px;color:#444;white-space:pre-wrap">${trail}</pre>`
        : ''
    }
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [TO_ADDRESS],
        subject,
        html,
        // The text alternative — see plainText() for why it is not politeness.
        text: plainText(report, rows, links),
        // ⚠️ REPLY GOES TO THE REPORTER. The app tells them their account
        // travels "so we can reply", and this is what makes that true: hitting
        // reply reaches the person who wrote it rather than the shared sender,
        // which nobody reads. Omitted when the address could not be resolved,
        // because a reply-to pointing at the sending domain is worse than none.
        ...(reporterEmail ? { reply_to: reporterEmail } : {}),
      }),
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
