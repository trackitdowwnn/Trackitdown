/**
 * WHAT:  Tests for useBountyGuidance: it starts from guidance already read
 *        ahead (the map step warms it), settles to the answer once it lands,
 *        and never shows one point's guidance for another.
 * WHY:   2026-10-08 — the reward step's guidance used to pop in a beat after
 *        the step arrived; starting from the read-ahead is what stops that.
 * LINKS: ./useBountyGuidance.ts; ../api/bountyGuidanceApi.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useBountyGuidance } from './useBountyGuidance';

const KNOWN = { rungs: [{ bountyPence: 10000, reach: 12 }], local: null };
const ELSEWHERE = { rungs: [{ bountyPence: 5000, reach: 3 }], local: null };
const EMPTY = { rungs: [], local: null };
let mockPeek: Record<string, object> = {};
const mockFetch = jest.fn();
jest.mock('../api/bountyGuidanceApi', () => ({
  peekBountyGuidance: (lat: number, lng: number) => mockPeek[`${lat},${lng}`],
  fetchBountyGuidance: (lat: number, lng: number) => mockFetch(lat, lng),
}));

beforeEach(() => {
  mockPeek = {};
  mockFetch.mockReset().mockResolvedValue(KNOWN);
});

describe('useBountyGuidance', () => {
  it('starts from guidance read ahead — there on the first render', async () => {
    mockPeek = { '53.4,-2.2': KNOWN };
    let first: unknown;
    await renderHook(() => {
      const result = useBountyGuidance(53.4, -2.2);
      first ??= result.guidance;
      return result;
    });
    expect(first).toBe(KNOWN);
  });

  it('settles to the answer once it lands', async () => {
    const { result } = await renderHook(() => useBountyGuidance(53.4, -2.2));
    await waitFor(() => expect(result.current.guidance).toEqual(KNOWN));
  });

  it('never shows one point’s guidance for another', async () => {
    mockPeek = { '53.4,-2.2': KNOWN };
    let never: (value: object) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (never = resolve)));
    const { result, rerender } = await renderHook(
      ({ lat }: { lat: number }) => useBountyGuidance(lat, -2.2),
      { initialProps: { lat: 53.4 } },
    );
    expect(result.current.guidance).toBe(KNOWN);

    await act(async () => rerender({ lat: 51.5 })); // a different point, nothing known
    expect(result.current.guidance).toEqual(EMPTY);
    never(ELSEWHERE);
  });

  it('asks nothing without a location', async () => {
    const { result } = await renderHook(() => useBountyGuidance(null, null));
    expect(result.current.guidance).toEqual(EMPTY);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
