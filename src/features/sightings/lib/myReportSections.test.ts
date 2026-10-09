/**
 * WHAT:  Tests for myReportSections / myReportSummary — the sections in
 *        order (waiting, answered, taken back) with empty ones left out, and
 *        the summary's counting rules.
 * WHY:   "Waiting on the owner" first is the point of the 2026-10-09
 *        redesign, and the summary must never turn a "Not a match" into a
 *        number, nor count a report the spotter took back.
 * LINKS: src/features/sightings/lib/myReportSections.ts.
 */

import type { MySightingRecordEntry } from '../api/sightingApi';
import { myReportSections, myReportSummary } from './myReportSections';

const entry = (id: string, status: MySightingRecordEntry['status']): MySightingRecordEntry => ({
  id,
  createdAt: '2026-10-08T10:00:00Z',
  status,
  reviewedAt: null,
  areaLabel: null,
  car: { make: 'Ford', colour: 'Blue' },
});

describe('myReportSections', () => {
  it('puts what is still with the owner first, then the answered, then the taken back', () => {
    const sections = myReportSections([
      entry('a', 'helpful'),
      entry('b', 'withdrawn'),
      entry('c', 'unverified'),
      entry('d', 'not_mine'),
      entry('e', 'credited'),
    ]);
    expect(sections.map((s) => [s.title, s.entries.map((e) => e.id)])).toEqual([
      ['Still open', ['c']],
      ['Answered', ['a', 'd', 'e']],
      ['Taken back', ['b']],
    ]);
  });

  it('leaves out an empty section', () => {
    expect(myReportSections([entry('a', 'unverified')]).map((s) => s.key)).toEqual(['waiting']);
    expect(myReportSections([])).toEqual([]);
  });
});

describe('myReportSummary', () => {
  const of = (...statuses: MySightingRecordEntry['status'][]) =>
    statuses.map((status) => ({ status }));

  it.each([
    [of('unverified'), '1 report'],
    [of('unverified', 'not_mine'), '2 reports'],
    [of('helpful', 'unverified'), '2 reports · 1 helpful'],
    [of('credited'), '1 report · 1 helpful · 1 recovery'],
    [of('credited', 'credited', 'helpful', 'not_mine'), '4 reports · 3 helpful · 2 recoveries'],
    // Taking a report back un-files it.
    [of('withdrawn', 'helpful'), '1 report · 1 helpful'],
  ])('%j → "%s"', (entries, line) => {
    expect(myReportSummary(entries)).toBe(line);
  });

  it('is null only with no reports at all — the empty state speaks then', () => {
    expect(myReportSummary([])).toBeNull();
  });

  it('says so when everything was taken back, rather than vanishing', () => {
    expect(myReportSummary(of('withdrawn', 'withdrawn'))).toBe('No open reports');
  });
});
