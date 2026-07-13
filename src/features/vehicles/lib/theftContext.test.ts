/**
 * WHAT:  Tests for theftContextLines — phrasing for stolen-from + keys-taken,
 *        and the omissions (unknown keys, absent fields).
 * WHY:   "Keys taken" is a load-bearing spotter signal; the wording and the
 *        "unknown → say nothing" rule are pinned so they can't drift.
 * LINKS: src/features/vehicles/lib/theftContext.ts.
 */

import { theftContextLines } from './theftContext';

describe('theftContextLines', () => {
  it('renders stolen-from and keys-taken', () => {
    expect(theftContextLines({ stolenFrom: 'driveway', keysTaken: 'yes' })).toEqual([
      'Stolen from a driveway',
      'Keys were taken with the car',
    ]);
  });

  it('renders keys-not-taken', () => {
    expect(theftContextLines({ stolenFrom: 'car_park', keysTaken: 'no' })).toEqual([
      'Stolen from a car park',
      'Keys were not taken',
    ]);
  });

  it('omits keys when unknown', () => {
    expect(theftContextLines({ stolenFrom: 'street', keysTaken: 'unknown' })).toEqual([
      'Stolen from a street',
    ]);
  });

  it("maps 'other' to elsewhere", () => {
    expect(theftContextLines({ stolenFrom: 'other' })).toEqual(['Stolen from elsewhere']);
  });

  it('renders each field independently (stolen-from only, keys only)', () => {
    expect(theftContextLines({ stolenFrom: 'driveway' })).toEqual(['Stolen from a driveway']);
    expect(theftContextLines({ keysTaken: 'yes' })).toEqual(['Keys were taken with the car']);
  });

  it('returns nothing when no fields are set', () => {
    expect(theftContextLines({})).toEqual([]);
  });
});
