/**
 * WHAT:  Tests for the bug-report message minimum and the counter line beneath
 *        the box.
 * WHY:   This module exists so the gate and the caption cannot disagree, so the
 *        boundary is what gets pinned: at exactly the minimum the counter must
 *        stop asking for more, and one short it must say how many more.
 *
 *        ⚠️ THE COUNT IS TRIMMED. A field padded with spaces that satisfies a
 *        minimum is the same defect as a whitespace-only report, one step up.
 * LINKS: ./bugMessageRules.ts; ./bugReportFlow.tsx (the schema that gates).
 */

import {
  BUG_REPORT_MIN_LENGTH,
  bugMessageLength,
  bugMessageWordCount,
  describeMessageProgress,
} from './bugMessageRules';

describe('measuring the message', () => {
  it('ignores padding at both ends', () => {
    expect(bugMessageLength('  hello  ')).toBe(5);
    expect(bugMessageWordCount('  hello  ')).toBe(1);
  });

  it('counts a run of whitespace as one separator', () => {
    // Two spaces, a newline and a tab between words — a paste from a chat log
    // should not read as nine words.
    expect(bugMessageWordCount('the  map\nwent\tblank')).toBe(4);
  });

  it('is zero for an empty or whitespace-only message', () => {
    expect(bugMessageWordCount('')).toBe(0);
    expect(bugMessageWordCount('   \n  ')).toBe(0);
    expect(bugMessageLength('   \n  ')).toBe(0);
  });
});

describe('the line under the box', () => {
  it('states the ask before anything is typed, rather than scoring zero', () => {
    // "0 words" on a field nobody has touched reads as a failure state.
    expect(describeMessageProgress('')).toBe(`At least ${BUG_REPORT_MIN_LENGTH} characters`);
    expect(describeMessageProgress('   ')).toBe(`At least ${BUG_REPORT_MIN_LENGTH} characters`);
  });

  it('⚠️ says how much further to go, not just how far in', () => {
    // A bare count next to a disabled Next is a scoreboard: the user cannot
    // tell whether the button is broken or they are.
    const short = 'x'.repeat(BUG_REPORT_MIN_LENGTH - 4);
    expect(describeMessageProgress(short)).toBe('1 word · 4 more characters');
  });

  it('singularises the last character', () => {
    expect(describeMessageProgress('x'.repeat(BUG_REPORT_MIN_LENGTH - 1))).toBe(
      '1 word · 1 more character',
    );
  });

  it('drops the shortfall the moment the minimum is met, without congratulating', () => {
    // No tick, no "great" — a report that is long enough is simply normal.
    expect(describeMessageProgress('x'.repeat(BUG_REPORT_MIN_LENGTH))).toBe('1 word');
    expect(describeMessageProgress('The map went blank when I opened it')).toBe('8 words');
  });

  it('singularises one word', () => {
    expect(describeMessageProgress('x'.repeat(BUG_REPORT_MIN_LENGTH))).toContain('1 word');
    expect(describeMessageProgress('a'.repeat(10) + ' ' + 'b'.repeat(10))).toBe('2 words');
  });

  it('⚠️ counts padding toward neither the minimum nor the words', () => {
    // Twenty spaces around a two-letter answer must not clear a minimum that
    // exists to make a report triageable.
    const padded = `${' '.repeat(20)}hi${' '.repeat(20)}`;
    expect(describeMessageProgress(padded)).toBe(
      `1 word · ${BUG_REPORT_MIN_LENGTH - 2} more characters`,
    );
  });
});
