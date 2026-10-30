/**
 * WHAT:  Tests for plateScanOutcome — how a plate was settled, without the
 *        plate itself leaving the function.
 * LINKS: ./plateScanOutcome.ts.
 */

import { logPlateScanOutcome, plateScanOutcome } from './plateScanOutcome';

const mockInfo = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: (...args: unknown[]) => mockInfo(...args) }),
}));

it('accepted: the suggestion, untouched (spacing and case do not count)', () => {
  expect(plateScanOutcome({ plate: 'ab12 cde', plateScanOffered: 'AB12CDE' })).toEqual({
    kind: 'accepted',
  });
});

it('edited: a suggestion, then changed, with the edit distance capped at 3', () => {
  expect(plateScanOutcome({ plate: 'AB12CDF', plateScanOffered: 'AB12CDE' })).toEqual({
    kind: 'edited',
    count: 1,
  });
  expect(plateScanOutcome({ plate: 'XY34ZZZ', plateScanOffered: 'AB12CDE' })).toEqual({
    kind: 'edited',
    count: 3,
  });
});

it('typed: a plate, with no suggestion', () => {
  expect(plateScanOutcome({ plate: 'AB12CDE' })).toEqual({ kind: 'typed' });
});

it('skipped: no plate, whatever was suggested', () => {
  expect(plateScanOutcome({ plate: ' ', plateScanOffered: 'AB12CDE' })).toEqual({ kind: 'skipped' });
  expect(plateScanOutcome({})).toEqual({ kind: 'skipped' });
});

it('⚠️ logs the kind and count only, never a plate', () => {
  logPlateScanOutcome({ plate: 'AB12CDF', plateScanOffered: 'AB12CDE' });
  expect(mockInfo).toHaveBeenCalledWith('plate_scan_outcome', { kind: 'edited', count: 1 });
  expect(JSON.stringify(mockInfo.mock.calls)).not.toMatch(/AB12/);
});
