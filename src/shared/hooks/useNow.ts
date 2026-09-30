/**
 * WHAT:  useNow — "now" as a Date held in state, refreshed every `intervalMs`
 *        while the component is mounted.
 * WHY:   ⚠️ A render-time `new Date()` FREEZES on a device. The React Compiler
 *        memoises it against the props, so a tick re-renders cached output
 *        and the clock never moves. Jest doesn't run the compiler, so tests
 *        pass anyway (2026-09-29 code review). A state value is a real
 *        dependency, so anything derived from it recomputes.
 * LINKS: src/features/vehicles/post/components/LastSeenTimeField.tsx (presets);
 *        src/shared/ui/DateRangeField.tsx (whether a range needs its year).
 */

import { useEffect, useState } from 'react';

/** The current moment, refreshed every `intervalMs`. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
