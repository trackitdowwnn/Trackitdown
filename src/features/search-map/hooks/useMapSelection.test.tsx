/**
 * WHAT:  Tests for useMapSelection — id↔index sync both ways, clearing,
 *        and implicit deselection when a re-search drops the post.
 * WHY:   Pin and pager must never disagree about what's selected; a stale
 *        selection surviving a re-search would point the camera at a post
 *        that no longer exists.
 * LINKS: src/features/search-map/hooks/useMapSelection.ts, docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { MapPost } from '../types';
import { useMapSelection } from './useMapSelection';

const post = (id: string): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
  latitude: 51.75,
  longitude: -0.34,
});

const POSTS = [post('a'), post('b'), post('c')];

describe('useMapSelection', () => {
  it('selects by id and derives the pager index', async () => {
    const { result } = await renderHook(() => useMapSelection(POSTS));

    await act(async () => result.current.selectPost('b'));

    expect(result.current.selected?.id).toBe('b');
    expect(result.current.selectedIndex).toBe(1);
  });

  it('selects by pager index and derives the id', async () => {
    const { result } = await renderHook(() => useMapSelection(POSTS));

    await act(async () => result.current.selectByIndex(2));

    expect(result.current.selected?.id).toBe('c');
  });

  it('clears on background tap and on out-of-range index', async () => {
    const { result } = await renderHook(() => useMapSelection(POSTS));

    await act(async () => result.current.selectPost('a'));
    await act(async () => result.current.clear());
    expect(result.current.selected).toBeNull();
    expect(result.current.selectedIndex).toBe(-1);

    await act(async () => result.current.selectByIndex(99));
    expect(result.current.selected).toBeNull();
  });

  it('deselects implicitly when the selected post vanishes from the results', async () => {
    const { result, rerender } = await renderHook(
      ({ posts }: { posts: MapPost[] }) => useMapSelection(posts),
      { initialProps: { posts: POSTS } },
    );

    await act(async () => result.current.selectPost('b'));
    expect(result.current.selected?.id).toBe('b');

    await rerender({ posts: [post('a'), post('c')] }); // re-search dropped 'b'

    expect(result.current.selected).toBeNull();
    expect(result.current.selectedIndex).toBe(-1);
  });
});
