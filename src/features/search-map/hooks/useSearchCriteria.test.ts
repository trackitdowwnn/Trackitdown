/**
 * WHAT:  Tests for useSearchCriteria's make → model rule: a different make
 *        clears the model, the same make keeps it, and clearing the make
 *        (the field's ×, or "Any make") clears both.
 * WHY:   A model must never outlive its make (an Audi model on a BMW search
 *        finds nothing), but re-picking the same make shouldn't throw away the
 *        model either: the posting wizard's makeChangePatch rule, which search
 *        didn't follow until 2026-09-30.
 * LINKS: src/features/search-map/hooks/useSearchCriteria.ts;
 *        src/shared/lib/carModels.ts (makeChangePatch).
 */

import { act, renderHook } from '@testing-library/react-native';

import { emptyCriteria } from '../lib/searchCriteria';
import { useSearchCriteria } from './useSearchCriteria';

describe('useSearchCriteria setMake', () => {
  it('clears the model for a different make, keeps it for the same make', async () => {
    const { result } = await renderHook(() => useSearchCriteria());

    await act(async () => {
      result.current.setMake('BMW');
      result.current.patch({ model: '3 Series' });
    });
    await act(async () => result.current.setMake('BMW'));
    expect(result.current.criteria).toMatchObject({ make: 'BMW', model: '3 Series' });

    await act(async () => result.current.setMake('Audi'));
    expect(result.current.criteria).toMatchObject({ make: 'Audi', model: null });
  });

  it('clears a model that came in with no make (a shared link)', async () => {
    const { result } = await renderHook(() =>
      useSearchCriteria({ ...emptyCriteria(), make: null, model: 'Golf' }),
    );
    await act(async () => result.current.setMake(null));
    expect(result.current.criteria).toMatchObject({ make: null, model: null });
  });

  it('clearing the make clears the model too', async () => {
    const { result } = await renderHook(() => useSearchCriteria());
    await act(async () => {
      result.current.setMake('BMW');
      result.current.patch({ model: 'X5' });
    });
    await act(async () => result.current.setMake(null));
    expect(result.current.criteria).toMatchObject({ make: null, model: null });
  });
});
