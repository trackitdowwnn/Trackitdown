/**
 * WHAT:  useSearchCriteria — the search surface's draft-criteria state: the
 *        working SearchCriteria plus small setters (a generic patch, a make
 *        setter that clears the dependent model, a full replace for applying a
 *        recent search, and reset to empty).
 * WHY:   The surface assembles criteria locally before the user applies them to
 *        the map, so the DRAFT lives here — separate from the applied query in
 *        useViewportPosts. The make→model dependency (changing make invalidates
 *        the old model) is enforced in one place so no caller forgets it,
 *        mirroring the posting wizard's makeChangePatch.
 * LINKS: src/features/search-map/lib/searchCriteria.ts;
 *        src/features/search-map/components/SearchSheet.tsx (consumer).
 */

import { useCallback, useState } from 'react';

import { type SearchCriteria, emptyCriteria } from '../lib/searchCriteria';

export interface UseSearchCriteriaResult {
  criteria: SearchCriteria;
  /** Merge a partial change (text, colour, bounty, distance, recency…). */
  patch: (partial: Partial<SearchCriteria>) => void;
  /** Set the make and CLEAR the model (model depends on make). */
  setMake: (make: string | null) => void;
  /** Replace the whole criteria (applying a recent search / seeding). */
  replace: (next: SearchCriteria) => void;
  /** Back to unfiltered. */
  reset: () => void;
}

export function useSearchCriteria(initial?: SearchCriteria): UseSearchCriteriaResult {
  const [criteria, setCriteria] = useState<SearchCriteria>(initial ?? emptyCriteria());

  const patch = useCallback(
    (partial: Partial<SearchCriteria>) => setCriteria((current) => ({ ...current, ...partial })),
    [],
  );
  const setMake = useCallback(
    (make: string | null) => setCriteria((current) => ({ ...current, make, model: null })),
    [],
  );
  const replace = useCallback((next: SearchCriteria) => setCriteria(next), []);
  const reset = useCallback(() => setCriteria(emptyCriteria()), []);

  return { criteria, patch, setMake, replace, reset };
}
