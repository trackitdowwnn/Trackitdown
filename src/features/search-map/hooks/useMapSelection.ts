/**
 * WHAT:  useMapSelection — the pin↔card sync brain: which post is
 *        selected, as BOTH an id (for pin styling) and an index (for the
 *        floating card pager), with changes flowing either way.
 * WHY:   Tapping a pin must scroll the pager; swiping the pager must move
 *        the pin — one source of truth (the id) with the index DERIVED
 *        keeps the two surfaces from fighting. A re-search that drops the
 *        selected post deselects implicitly: the derived lookup returns
 *        null, no cleanup effect needed (and none of the setState-in-
 *        effect hazards that come with one).
 * LINKS: src/features/search-map/screens/MapSearchScreen.tsx (consumer);
 *        src/features/search-map/components/MapCardPager.tsx.
 */

import { useCallback, useMemo, useState } from 'react';

import type { MapPost } from '../types';

export interface UseMapSelectionResult {
  /** The selected post, or null (vanished ids resolve to null). */
  selected: MapPost | null;
  /** Pager index of the selection; -1 when nothing is selected. */
  selectedIndex: number;
  /** Pin tap. */
  selectPost: (id: string) => void;
  /** Pager swipe settled on an index (clamped; out-of-range clears). */
  selectByIndex: (index: number) => void;
  /** Map-background tap. */
  clear: () => void;
}

export function useMapSelection(posts: MapPost[]): UseMapSelectionResult {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedIndex = useMemo(
    () => (selectedId === null ? -1 : posts.findIndex((post) => post.id === selectedId)),
    [posts, selectedId],
  );
  const selected = selectedIndex >= 0 ? posts[selectedIndex] : null;

  const selectPost = useCallback((id: string) => setSelectedId(id), []);

  const selectByIndex = useCallback(
    (index: number) => {
      setSelectedId(index >= 0 && index < posts.length ? posts[index].id : null);
    },
    [posts],
  );

  const clear = useCallback(() => setSelectedId(null), []);

  return { selected, selectedIndex, selectPost, selectByIndex, clear };
}
