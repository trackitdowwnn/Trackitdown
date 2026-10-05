/**
 * WHAT:  The one way server code tells the operator something needs a human:
 *        a plain-text email through Resend (the provider bug reports and auth
 *        OTPs already use), plus a console.error that says ALERT either way.
 * WHY:   Stripe caps funds on the platform balance at 90 days (lead support,
 *        2026-10-05). The sweep can see reward money getting old, and the
 *        webhook can see a refund bounce — but until now both could only write
 *        a console line nobody reads (sweep finding #10: "sweep_health() must
 *        be asked, it never speaks"). An unanswered 90-day breach risks the
 *        Stripe account itself, so these must reach a person.
 *
 *        Destination and sender reuse the bug-report secrets so no new setup
 *        is needed: OPS_ALERT_TO_ADDRESS overrides the destination if set,
 *        else BUG_REPORT_TO_ADDRESS, else the interim operator inbox (the
 *        same default notify-bug-report uses).
 *
 * SAFETY: callers pass ids and states only — never a plate, a name, an email
 *        or an amount tied to a person. The email is a pointer into the
 *        dashboard, not a record of anyone. NEVER THROWS: an alert that fails
 *        must not fail the refund or the sweep that raised it; the console line
 *        is written first so the alert survives a Resend outage in the logs.
 * LINKS: supabase/functions/notify-bug-report/index.ts (the sender pattern);
 *        supabase/functions/release-held-refunds/index.ts (deadline alerts);
 *        supabase/functions/stripe-webhook/index.ts (failed refunds);
 *        docs/OPERATIONS.md (what to do when one arrives).
 */

const DEFAULT_TO = 'trackitdowwnn@gmail.com';
const DEFAULT_FROM = 'Trackitdown Alerts <onboarding@resend.dev>';

/**
 * Email the operator. Logs `[ops] ALERT <subject>` FIRST, so the alert exists
 * in the function logs even if nothing below works.
 *
 * Destination: OPS_ALERT_TO_ADDRESS, else BUG_REPORT_TO_ADDRESS, else the
 * interim operator inbox. Sender: BUG_REPORT_FROM_ADDRESS, else Resend's
 * shared sender — which delivers ONLY to the Resend account owner's address,
 * so a custom destination needs a verified sending domain too.
 *
 * Never throws. Resolves `true` only when Resend accepted the email; `false`
 * when RESEND_API_KEY is unset, Resend refused, or the request failed — a
 * caller holding a claim for this alert should hand it back on `false`.
 *
 * @param subject one line; prefixed with "[Trackitdown ops]".
 * @param lines   the plain-text body. IDS AND STATES ONLY — never a plate, a
 *                name, an email, or an amount tied to a person.
 */
export async function sendOpsAlert(subject: string, lines: readonly string[]): Promise<boolean> {
  const text = lines.join('\n');
  console.error(`[ops] ALERT ${subject}`, text);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('[ops] alert not emailed: RESEND_API_KEY is not set');
    return false;
  }
  const to =
    Deno.env.get('OPS_ALERT_TO_ADDRESS') ?? Deno.env.get('BUG_REPORT_TO_ADDRESS') ?? DEFAULT_TO;
  const from = Deno.env.get('BUG_REPORT_FROM_ADDRESS') ?? DEFAULT_FROM;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `[Trackitdown ops] ${subject}`, text }),
    });
    if (!response.ok) {
      // The status only — a provider error body can quote the payload back.
      console.error('[ops] alert email failed', response.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ops] alert email failed', (err as Error).message);
    return false;
  }
}
