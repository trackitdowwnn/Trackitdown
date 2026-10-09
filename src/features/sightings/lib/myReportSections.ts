/**
 * WHAT:  How "My sightings" organises a spotter's reports: the sections, in
 *        order — "Waiting on the owner", "Answered", "Taken back" — and the
 *        summary line under the title ("12 reports · 4 confirmed · 1
 *        recovery").
 * WHY:   Redesigned 2026-10-09 — the spotter couldn't see how they were doing
 *        or which reports were still open: the page was one newest-first list
 *        grouped by day. Needs-attention first: what is still with the owner
 *        leads, then what has been decided, then what the spotter withdrew.
 *
 *        The summary counts the list itself, not the profile's reputation
 *        counters (which count once per listing, by design): it describes
 *        what is on this page. Withdrawn reports aren't counted — taking one
 *        back un-files it. "Confirmed" is helpful + credited; a recovery is a
 *        credited one. "Not a match" never becomes a number here, nor
 *        anywhere: no accuracy figure is derived from a rejection (ReportCard).
 * LINKS: src/features/sightings/screens/MySightingsScreen.tsx;
 *        src/features/sightings/components/ReportCard.tsx (the VERDICT copy).
 */

import type { MySightingRecordEntry } from '../api/sightingApi';

export type MyReportSectionKey = 'waiting' | 'answered' | 'withdrawn';

export interface MyReportSection {
  key: MyReportSectionKey;
  title: string;
  entries: MySightingRecordEntry[];
}

const SECTION_OF: Record<MySightingRecordEntry['status'], MyReportSectionKey> = {
  unverified: 'waiting',
  helpful: 'answered',
  credited: 'answered',
  not_mine: 'answered',
  withdrawn: 'withdrawn',
};

const SECTIONS: { key: MyReportSectionKey; title: string }[] = [
  { key: 'waiting', title: 'Waiting on the owner' },
  { key: 'answered', title: 'Answered' },
  { key: 'withdrawn', title: 'Taken back' },
];

/** The reports in their sections, in order; an empty section is left out.
 *  Within each, the RPC's newest-first order is kept. */
export function myReportSections(entries: MySightingRecordEntry[]): MyReportSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    entries: entries.filter((entry) => SECTION_OF[entry.status] === section.key),
  })).filter((section) => section.entries.length > 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 reports · 4 confirmed · 1 recovery" — the parts that are non-zero,
 *  with reports always first; null when there is nothing filed. */
export function myReportSummary(entries: Pick<MySightingRecordEntry, 'status'>[]): string | null {
  const filed = entries.filter((entry) => entry.status !== 'withdrawn');
  if (filed.length === 0) return null;
  const confirmed = filed.filter(
    (entry) => entry.status === 'helpful' || entry.status === 'credited',
  ).length;
  const recoveries = filed.filter((entry) => entry.status === 'credited').length;
  return [
    plural(filed.length, 'report', 'reports'),
    confirmed > 0 ? `${confirmed} confirmed` : null,
    recoveries > 0 ? plural(recoveries, 'recovery', 'recoveries') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
