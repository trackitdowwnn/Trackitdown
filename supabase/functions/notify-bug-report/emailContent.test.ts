/**
 * WHAT:  Tests for the bug-report email's content builders.
 * WHY:   ⚠️ THE FIRST TESTS ANY EDGE FUNCTION IN THIS PROJECT HAS HAD, and they
 *        exist because of a specific outage. On 2026-08-27 `formatWhen`
 *        combined `dateStyle`/`timeStyle` with `timeZoneName` — a TypeError by
 *        spec, not a silent fallback — and because it is called while building
 *        the email rather than inside the send's try/catch, the whole handler
 *        threw and NOT ONE report was emailed.
 *
 *        Nothing could have caught it: `supabase/functions` is excluded from
 *        tsconfig, expo lint does not reach it, and the deploy only checks that
 *        the bundle uploads. A green pipeline said everything was fine while
 *        the feature was completely dead.
 *
 *        So the rule these encode is not "the date looks nice" — it is that
 *        NOTHING in the content builders may throw, whatever it is handed.
 * LINKS: ./emailContent.ts; ./index.ts.
 */

import {
  buildSubject,
  escapeHtml,
  facts,
  factRowsHtml,
  formatAgo,
  formatWhen,
  plainText,
  type ClaimedReport,
} from './emailContent';

/** A report with every field populated — the shape the operator should see. */
const FULL: ClaimedReport = {
  claimed: true,
  id: '188d2e53-ac42-48ea-bd32-1a43d1a0fbda',
  reporter_id: '11111111-1111-1111-1111-111111111111',
  prior_reports: 2,
  previous_report_at: '2026-08-25T13:02:00Z',
  created_at: '2026-08-27T10:23:14Z',
  message: 'The map went blank when I opened it',
  expected: 'It should show pins',
  area: 'explore',
  severity: 'blocked',
  frequency: 'always',
  app_version: '1.0.0',
  platform: 'android',
  os_version: '15',
  device_model: 'Pixel 8',
  breadcrumbs: ['10:00:00 info map:feed_mounted'],
  screenshot_paths: ['user-1/abc-0.jpg'],
};

const NOW = Date.parse('2026-08-27T12:00:00Z');

describe('⚠️ formatWhen — the function that took the feature down', () => {
  it('formats in UK time and NAMES the zone', () => {
    // 10:23 UTC is 11:23 BST. Without the zone printed, an operator comparing
    // this against a breadcrumb trail is guessing which one they are reading.
    const formatted = formatWhen('2026-08-27T10:23:14Z');

    expect(formatted).toContain('11:23');
    expect(formatted).toContain('BST');
    expect(formatted).toContain('Aug');
  });

  it('⚠️ does not throw — combining dateStyle with timeZoneName is a TypeError', () => {
    // THE REGRESSION TEST. `{ dateStyle, timeStyle, timeZoneName }` raises
    // "Invalid option" rather than falling back, and this is called outside the
    // send's try/catch, so a throw here means no email at all.
    expect(() => formatWhen('2026-08-27T10:23:14Z')).not.toThrow();
  });

  it('degrades to the raw value rather than throwing on nonsense', () => {
    // Delivery beats presentation: a date we cannot parse must still leave the
    // operator with the report.
    expect(formatWhen('not a date')).toBe('not a date');
    expect(formatWhen(null)).toBeNull();
    expect(formatWhen(undefined)).toBeNull();
    expect(formatWhen('')).toBeNull();
  });
});

describe('formatAgo', () => {
  it('describes the gap in the largest sensible unit', () => {
    expect(formatAgo('2026-08-27T11:30:00Z', NOW)).toBe('30 min ago');
    expect(formatAgo('2026-08-27T02:00:00Z', NOW)).toBe('10 hr ago');
    expect(formatAgo('2026-08-24T12:00:00Z', NOW)).toBe('3 days ago');
  });

  it('never returns a negative age for a clock skewed into the future', () => {
    expect(formatAgo('2026-08-27T13:00:00Z', NOW)).toBe('0 min ago');
  });

  it('is null rather than throwing for missing or unparseable input', () => {
    expect(formatAgo(null, NOW)).toBeNull();
    expect(formatAgo('not a date', NOW)).toBeNull();
  });
});

describe('⚠️ who sent it', () => {
  it('leads with the address and the reporter id', () => {
    // The email carried no reporter at all until 2026-08-27, so there was
    // nothing to reply to — while the app told the reporter their account
    // travels "so we can reply".
    const rows = facts(FULL, 'someone@example.com', NOW);

    expect(rows[0]).toEqual(['From', 'someone@example.com']);
    expect(rows[1]).toEqual(['Reporter', '11111111-1111-1111-1111-111111111111']);
  });

  it('still names the reporter id when the address could not be resolved', () => {
    // Resolution failure must not lose the only way to look someone up.
    const rendered = factRowsHtml(facts(FULL, null, NOW));

    expect(rendered).not.toContain('From');
    expect(rendered).toContain('11111111-1111-1111-1111-111111111111');
  });

  it('says plainly when this is a first report', () => {
    const rows = facts({ ...FULL, prior_reports: 0, previous_report_at: null }, null, NOW);
    const history = rows.find(([label]) => label === 'History');

    expect(history?.[1]).toBe('First report from this account');
  });

  it('counts earlier reports and says how long ago the last one was', () => {
    const history = facts(FULL, null, NOW).find(([label]) => label === 'History');

    expect(history?.[1]).toContain('2 earlier reports');
    // 47 hours, not "2 days": the fixture is just inside the 48-hour threshold
    // where formatAgo still prefers hours. Precision is the point at this range
    // — "yesterday evening" and "two mornings ago" are different facts when you
    // are deciding whether someone is hitting the same wall repeatedly.
    expect(history?.[1]).toContain('47 hr ago');
    expect(history?.[1]).toContain('BST');
  });

  it('singularises a single earlier report', () => {
    const rows = facts({ ...FULL, prior_reports: 1 }, null, NOW);
    const history = rows.find(([label]) => label === 'History');

    expect(history?.[1]).toContain('1 earlier report —');
    expect(history?.[1]).not.toContain('1 earlier reports');
  });
});

describe('the rendered rows', () => {
  it('drops anything the reporter left unanswered', () => {
    // A column of blanks makes the answers that ARE there harder to find.
    const sparse: ClaimedReport = { claimed: true, id: 'r1', message: 'it broke' };
    const rendered = factRowsHtml(facts(sparse, null, NOW));

    expect(rendered).not.toContain('Severity');
    expect(rendered).not.toContain('Device');
    expect(rendered).toContain('Report id');
  });

  it('⚠️ escapes user text, which is the one field that can carry markup', () => {
    const rendered = factRowsHtml([['Area', '<script>alert(1)</script>']]);

    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });
});

describe('the subject', () => {
  it('carries severity and area, so a mailbox list is triageable', () => {
    expect(buildSubject(FULL)).toBe('[Bug · blocked · explore] The map went blank when I opened it');
  });

  it('omits what was not answered rather than printing gaps', () => {
    expect(buildSubject({ claimed: true, message: 'it broke' })).toBe('[Bug] it broke');
  });

  it('truncates a long message and collapses newlines', () => {
    const subject = buildSubject({ claimed: true, message: `a\n\nb${'x'.repeat(100)}` });

    // One line, and short enough that a client will not cut it mid-word.
    expect(subject).not.toContain('\n');
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(subject).toContain('…');
  });
});

describe('the plain-text part', () => {
  it('carries the message, the facts, the links and the trail', () => {
    const rows = facts(FULL, 'someone@example.com', NOW);
    const text = plainText(FULL, rows, [
      { label: 'Screenshot 1', url: 'https://example.com/signed' },
    ]);

    expect(text).toContain('The map went blank when I opened it');
    expect(text).toContain('EXPECTED INSTEAD');
    expect(text).toContain('someone@example.com');
    expect(text).toContain('https://example.com/signed');
    expect(text).toContain('map:feed_mounted');
  });

  it('says so when a screenshot could not be linked, rather than dropping it', () => {
    // An operator told "3 screenshots" who can see two links would otherwise
    // wonder which one they are missing.
    const text = plainText(FULL, [], [{ label: 'Screenshot 1', url: null }]);

    expect(text).toContain('Screenshot 1: not linkable');
  });

  it('omits empty sections instead of printing bare headings', () => {
    const bare: ClaimedReport = { claimed: true, message: 'it broke' };
    const text = plainText(bare, [], []);

    expect(text).not.toContain('SCREENSHOTS');
    expect(text).not.toContain('RECENT ACTIVITY');
    expect(text).not.toContain('EXPECTED INSTEAD');
  });
});

describe('⚠️ nothing in the content builders may throw', () => {
  it('survives a completely empty report', () => {
    // The rule the outage taught: formatting is presentation, delivery is the
    // point. Whatever arrives, the operator gets an email.
    const empty: ClaimedReport = { claimed: true };

    expect(() => {
      const rows = facts(empty, null, NOW);
      factRowsHtml(rows);
      buildSubject(empty);
      plainText(empty, rows, []);
    }).not.toThrow();
  });

  it('survives nulls in every optional field', () => {
    const nulled: ClaimedReport = {
      claimed: true,
      expected: null,
      area: null,
      severity: null,
      frequency: null,
      app_version: null,
      platform: null,
      os_version: null,
      device_model: null,
      breadcrumbs: null,
      screenshot_paths: null,
      previous_report_at: null,
    };

    expect(() => {
      const rows = facts(nulled, null, NOW);
      factRowsHtml(rows);
      buildSubject(nulled);
      plainText(nulled, rows, []);
    }).not.toThrow();
  });
});
