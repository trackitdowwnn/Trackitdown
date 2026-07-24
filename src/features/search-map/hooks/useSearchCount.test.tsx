/**
 * WHAT:  Tests for useSearchCount — the debounce collapsing rapid changes, the
 *        settled count, the screen-reader announcement, and error handling.
 * WHY:   The live "Show N cars" count fires on every criteria change; without
 *        the debounce + token guard it would flicker stale numbers onto the
 *        apply button.
 * LINKS: src/features/search-map/hooks/useSearchCount.ts.
 */

import { AccessibilityInfo } from 'react-native';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { GeoRegion } from '@/shared/types';

import { useSearchCount } from './useSearchCount';
import { emptyCriteria } from '../lib/searchCriteria';

const mockCount = jest.fn();
jest.mock('../api/mapApi', () => ({
  fetchSearchCount: (...args: unknown[]) => mockCount(...args),
}));

const REGION: GeoRegion = {
  latitude: 51.77,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

beforeEach(() => {
  mockCount.mockReset();
});

describe('useSearchCount', () => {
  it('debounces, then returns the count and announces it', async () => {
    mockCount.mockResolvedValue(4);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    const { result } = await renderHook(() => useSearchCount(REGION, emptyCriteria()));

    await waitFor(() => expect(result.current.count).toBe(4));
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('4 cars match');
  });

  it('announces the singular for a count of one', async () => {
    mockCount.mockResolvedValue(1);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    const { result } = await renderHook(() => useSearchCount(REGION, emptyCriteria()));
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(announce).toHaveBeenCalledWith('1 car match');
  });

  it('nulls the count on error', async () => {
    mockCount.mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(() => useSearchCount(REGION, emptyCriteria()));
    await waitFor(() => expect(result.current.counting).toBe(false));
    expect(result.current.count).toBeNull();
  });

  it('only counts once for rapid criteria changes (debounce collapses them)', async () => {
    mockCount.mockResolvedValue(2);
    const { rerender } = await renderHook(
      ({ text }: { text: string }) => useSearchCount(REGION, { ...emptyCriteria(), text }),
      { initialProps: { text: 'b' } },
    );
    // Three quick changes within the debounce window — each cancels the prior.
    await rerender({ text: 'bm' });
    await rerender({ text: 'bmw' });
    await waitFor(() => expect(mockCount).toHaveBeenCalledTimes(1));
    // The surviving count used the latest term.
    expect(JSON.stringify(mockCount.mock.calls[0][1])).toContain('bmw');
  });
});
