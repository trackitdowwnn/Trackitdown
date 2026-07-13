/**
 * WHAT:  theftContextLines — turns the structured theft-context fields
 *        (stolen_from, keys_taken) into the short factual lines the detail
 *        screen shows. Pure, so the phrasing is unit-tested.
 * WHY:   "Keys taken" is genuinely useful to spotters (a car with its keys is
 *        likely being driven, not stripped). stolen_from is a coarse CATEGORY,
 *        never an address — and the RPC coarsens the map point when it's a
 *        driveway, so the home isn't pinpointed (docs/DOMAIN.md theft context).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        src/features/vehicles/lib/theftContext.test.ts.
 */

import type { KeysTaken, StolenFrom } from '../types';

const STOLEN_FROM_LABEL: Record<StolenFrom, string> = {
  driveway: 'a driveway',
  street: 'a street',
  car_park: 'a car park',
  other: 'elsewhere',
};

export function theftContextLines(input: {
  stolenFrom?: StolenFrom;
  keysTaken?: KeysTaken;
}): string[] {
  const lines: string[] = [];
  if (input.stolenFrom) {
    lines.push(`Stolen from ${STOLEN_FROM_LABEL[input.stolenFrom]}`);
  }
  if (input.keysTaken === 'yes') {
    lines.push('Keys were taken with the car');
  } else if (input.keysTaken === 'no') {
    lines.push('Keys were not taken');
  }
  // keysTaken 'unknown' (or absent) → no line.
  return lines;
}
