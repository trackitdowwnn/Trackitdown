/**
 * WHAT:  How a car's plate was settled, logged once when a flow finishes:
 *        accepted (the suggestion, untouched), edited (a suggestion, then
 *        changed: `count` is the edit distance, 1–3, 3 = "3 or more"), typed
 *        (no suggestion), or skipped (no plate).
 * WHY:   Real-world accuracy, over time (docs/plate-scan-decisions.md): the
 *        scan's own events say what it offered; only this says whether the
 *        owner kept it. Kinds and counts only — never a plate.
 * LINKS: ../components/PlateStep.tsx (records plateScanOffered);
 *        ../screens/PostACarScreen.tsx and
 *        src/features/garage/screens/AddVehicleScreen.tsx (call it).
 */

import { createLogger } from '@/shared/lib/logger';
import { normalisePlate } from '@/shared/lib/plate';

const log = createLogger('vehicles');

export type PlateScanOutcome =
  | { kind: 'accepted' | 'typed' | 'skipped' }
  | { kind: 'edited'; count: 1 | 2 | 3 };

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function plateScanOutcome(answers: {
  plate?: string;
  plateScanOffered?: string;
}): PlateScanOutcome {
  const plate = normalisePlate(answers.plate ?? '');
  if (!plate) return { kind: 'skipped' };
  if (!answers.plateScanOffered) return { kind: 'typed' };
  const distance = editDistance(answers.plateScanOffered, plate);
  if (distance === 0) return { kind: 'accepted' };
  return { kind: 'edited', count: Math.min(distance, 3) as 1 | 2 | 3 };
}

export function logPlateScanOutcome(answers: { plate?: string; plateScanOffered?: string }) {
  log.info('plate_scan_outcome', plateScanOutcome(answers));
}
