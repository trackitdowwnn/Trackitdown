/**
 * WHAT:  The pure content builders for the bug-report email — escaping,
 *        timestamps, the fact rows, the subject and the plain-text part.
 * WHY:   ⚠️ THIS FILE EXISTS BECAUSE A FORMATTING BUG TOOK THE FEATURE DOWN.
 *        On 2026-08-27 `formatWhen` combined `dateStyle`/`timeStyle` with
 *        `timeZoneName`, which is a TypeError by spec rather than a silent
 *        fallback. It was called outside any try/catch, so the whole handler
 *        threw and NOT ONE report was emailed. Nothing saw it coming:
 *        `supabase/functions` is excluded from tsconfig, expo lint does not
 *        reach it, and Edge Functions had no tests at all.
 *
 *        So everything here is deliberately free of Deno APIs, network calls
 *        and imports — it is ordinary TypeScript that Jest can run. index.ts
 *        keeps the parts that genuinely need the runtime (auth, storage,
 *        fetch); this file keeps the parts that can be wrong quietly.
 *
 *        ⚠️ NOTHING HERE MAY THROW. Formatting is presentation and delivery is
 *        the point: a bad date, a null field or an odd locale must degrade the
 *        email, never cost the operator the report.
 * LINKS: ./index.ts (the only consumer); ./emailContent.test.ts.
 */

export interface ClaimedReport {
  claimed: boolean;
  id?: string;
  reporter_id?: string;
  prior_reports?: number;
  previous_report_at?: string | null;
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

export interface ScreenshotLink {
  label: string;
  url: string | null;
}

/** Escape anything that lands inside the HTML body. The message is free text a
 *  user typed, so it is the one thing here that can carry markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A timestamp an operator can read at a glance, in UK time.
 *
 * ⚠️ THE ZONE IS NAMED IN THE OUTPUT. The column is timestamptz and the raw
 * value is UTC, which in British Summer Time is an hour off what the reporter's
 * phone said — enough to make a trail of events look like it happened before
 * the thing it followed. Printing the zone is what stops that being a guess.
 *
 * ⚠️ EXPLICIT COMPONENTS, NEVER dateStyle/timeStyle. Combining either of those
 * with `timeZoneName` throws `TypeError: Invalid option` — it does not fall
 * back — and that is precisely the bug that stopped every bug-report email on
 * 2026-08-27. The test beside this file is the guard.
 */
export function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    // The raw timestamptz is still readable and still true.
    return value;
  }
}

/** "3 days ago", for the previous-report line. Rough on purpose — the exact
 *  timestamp sits beside it and the useful signal is the gap, not the instant.
 *  `now` is injectable so this is testable without freezing the clock. */
export function formatAgo(
  value: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * Everything about the report that is not its free text, as label/value pairs.
 *
 * ⚠️ WHO SENT IT COMES FIRST. The email carried no reporter at all until
 * 2026-08-27, so an operator reading a report had nothing to reply to and no
 * way to look the person up — while the app had been telling that person their
 * account travels "so we can reply". Identity leads because replying is the
 * commonest thing to want to do next.
 *
 * Anything the reporter left unanswered is dropped rather than printed empty:
 * a column of blanks makes the answers that ARE there harder to find.
 */
export function facts(
  report: ClaimedReport,
  reporterEmail: string | null,
  now: number = Date.now(),
): [string, string | null | undefined][] {
  const prior = report.prior_reports ?? 0;
  const previous = formatWhen(report.previous_report_at);
  const ago = formatAgo(report.previous_report_at, now);

  return [
    ['From', reporterEmail],
    ['Reporter', report.reporter_id],
    [
      'History',
      prior === 0
        ? 'First report from this account'
        : `${prior} earlier report${prior === 1 ? '' : 's'}` +
          (previous ? ` — last ${previous}${ago ? ` (${ago})` : ''}` : ''),
    ],
    ['Filed', formatWhen(report.created_at)],
    ['Area', report.area],
    ['Severity', report.severity],
    ['Frequency', report.frequency],
    ['Device', report.device_model],
    ['Platform', report.platform],
    ['OS version', report.os_version],
    ['App version', report.app_version],
    ['Report id', report.id],
  ];
}

export function factRowsHtml(rows: [string, string | null | undefined][]): string {
  return rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#666;white-space:nowrap;vertical-align:top">${label}</td>` +
        `<td style="padding:3px 0">${escapeHtml(String(value))}</td></tr>`,
    )
    .join('');
}

/**
 * The subject line.
 *
 * ⚠️ IT CARRIES THE TRIAGE FIELDS, because a mailbox list view is mostly
 * subjects and "[Bug] the map went blank" says nothing about whether to open it
 * now. Severity and area are exactly the two things that decide that.
 */
export function buildSubject(report: ClaimedReport): string {
  const summary = (report.message ?? '').replace(/\s+/g, ' ').trim();
  return (
    `[Bug${report.severity ? ` · ${report.severity}` : ''}` +
    `${report.area ? ` · ${report.area}` : ''}] ` +
    (summary.length > 60 ? `${summary.slice(0, 60)}…` : summary)
  );
}

/**
 * The plain-text alternative.
 *
 * ⚠️ NOT OPTIONAL POLITENESS. A multipart email with a text part is markedly
 * less likely to be filtered than HTML alone, and this one is sent by a shared
 * sender to a gmail address — the exact shape spam filters are hardest on. It
 * also means the report is readable in a client that refuses to render HTML,
 * which is the client an operator is most likely to be triaging from.
 */
export function plainText(
  report: ClaimedReport,
  rows: [string, string | null | undefined][],
  links: ScreenshotLink[],
): string {
  const lines: string[] = ['BUG REPORT', ''];

  lines.push(report.message ?? '', '');
  if (report.expected) {
    lines.push('EXPECTED INSTEAD', report.expected, '');
  }

  for (const [label, value] of rows) {
    if (value) lines.push(`${label.padEnd(12)} ${value}`);
  }

  if (links.length) {
    lines.push('', 'SCREENSHOTS (links expire in 7 days)');
    for (const link of links) {
      lines.push(link.url ? `${link.label}: ${link.url}` : `${link.label}: not linkable`);
    }
  }

  const trail = report.breadcrumbs ?? [];
  if (trail.length) {
    lines.push('', 'RECENT ACTIVITY (event names only)', ...trail);
  }

  return lines.join('\n');
}
