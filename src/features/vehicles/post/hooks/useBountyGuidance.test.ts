/**
 * WHAT:  Tests for useBountyGuidance: it starts from guidance already read
 *        ahead (the map step warms it), says when it is still loading, and
 *        settles to the answer once it lands.
 * WHY:   2026-10-08 — the reward step's guidance used to pop in a beat after
 *        the step arrived; starting from the read-ahead is what stops that.
 * LINKS: ./useBountyGuidance.ts; ../api/bountyGuidanceApi.ts.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useBountyGuidance } from './useBountyGuidance';

const KNOWN = { rungs: [{ bountyPence: 10000, reach: 12 }], local: null };
let mockPeek: object | undefined;
const mockFetch = jest.fn();
jest.mock('../api/bountyGuidanceApi', () => ({
  peekBountyGuidance: () => mockPeek,
  fetchBountyGuidance: () => mockFetch(),
}));

beforeEach(() => {
  mockPeek = undefined;
  mockFetch.mockReset().mockResolvedValue(KNOWN);
});

describe('useBountyGuidance', () => {
  it('starts from guidance read ahead — no loading, no pop-in', async () => {
    mockPeek = KNOWN;
    const { result } = await renderHook(() => useBountyGuidance(53.4, -2.2));
    expect(result.current.loading).toBe(false);
    expect(result.current.guidance).toBe(KNOWN);
  });

  it('says it is loading until the answer lands', async () => {
    let land: (value: object) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const { result } = await renderHook(() => useBountyGuidance(53.4, -2.2));
    expect(result.current.loading).toBe(true);

    land(KNOWN);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.guidance).toEqual(KNOWN);
  });

  it('is not loading without a location — there is nothing to ask about', async () => {
    const { result } = await renderHook(() => useBountyGuidance(null, null));
    expect(result.current.loading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
