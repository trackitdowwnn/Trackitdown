/**
 * WHAT:  Tests for useEarnings — no read at all while disabled, the list once
 *        it lands, a re-read when the payout account's status (refreshKey)
 *        changes or refresh() is called, and that a failed re-read keeps the
 *        last good list.
 * WHY:   The spotter's rewards are money they are owed. A list that blanks on
 *        a dropped connection reads as money that went away, and a guest
 *        (disabled) must never trigger a signed-in RPC. PayoutsScreen.test.tsx
 *        mocks the API beneath this hook but never exercises the re-read or
 *        failure rules; these pin them directly.
 * LINKS: ./useEarnings.ts; ../api/payoutsApi.ts (fetchMyEarnings);
 *        ../screens/PayoutsScreen.tsx (the host); docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Earnings } from '../api/payoutsApi';
import { useEarnings } from './useEarnings';

const mockFetch = jest.fn();
jest.mock('../api/payoutsApi', () => ({
  fetchMyEarnings: () => mockFetch(),
}));

const earnings = (pendingPence: number): Earnings => ({
  items: [
    {
      sightingId: 'aaaaaaaa-0000-0000-0000-00000000000a',
      car: { make: 'Ford', colour: 'Blue' },
      state: 'add_details',
      rewardPence: pendingPence,
      paidPence: null,
      paidAt: null,
    },
  ],
  totals: { paidPence: 0, pendingPence },
});

type Props = { enabled: boolean; refreshKey?: string };

beforeEach(() => {
  mockFetch.mockReset();
});

describe('useEarnings', () => {
  it('makes no request and returns null while disabled', async () => {
    const { result, unmount } = await renderHook(() => useEarnings(false, 'ready'));

    await act(async () => {});
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.earnings).toBeNull();
    await unmount();
  });

  it('returns the list once the read lands', async () => {
    mockFetch.mockResolvedValue(earnings(30000));
    const { result, unmount } = await renderHook(() => useEarnings(true, 'ready'));

    await waitFor(() => expect(result.current.earnings).toEqual(earnings(30000)));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('re-reads when the account status changes — the moment a reward moves', async () => {
    mockFetch.mockResolvedValue(earnings(30000));
    const { result, rerender, unmount } = await renderHook(
      ({ enabled, refreshKey }: Props) => useEarnings(enabled, refreshKey),
      { initialProps: { enabled: true, refreshKey: 'details_required' } },
    );
    await waitFor(() => expect(result.current.earnings).toEqual(earnings(30000)));

    mockFetch.mockResolvedValue(earnings(50000));
    await act(async () => {
      rerender({ enabled: true, refreshKey: 'ready' });
    });

    await waitFor(() => expect(result.current.earnings).toEqual(earnings(50000)));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('does not re-read when nothing it keys on changed', async () => {
    mockFetch.mockResolvedValue(earnings(30000));
    const { result, rerender, unmount } = await renderHook(
      ({ enabled, refreshKey }: Props) => useEarnings(enabled, refreshKey),
      { initialProps: { enabled: true, refreshKey: 'ready' } },
    );
    await waitFor(() => expect(result.current.earnings).not.toBeNull());

    await act(async () => {
      rerender({ enabled: true, refreshKey: 'ready' });
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('refresh() re-reads — pull-to-refresh', async () => {
    mockFetch.mockResolvedValue(earnings(30000));
    const { result, unmount } = await renderHook(() => useEarnings(true, 'ready'));
    await waitFor(() => expect(result.current.earnings).toEqual(earnings(30000)));

    mockFetch.mockResolvedValue(earnings(50000));
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.earnings).toEqual(earnings(50000)));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('keeps the last good list when a re-read fails', async () => {
    mockFetch.mockResolvedValue(earnings(30000));
    const { result, unmount } = await renderHook(() => useEarnings(true, 'ready'));
    await waitFor(() => expect(result.current.earnings).toEqual(earnings(30000)));

    mockFetch.mockRejectedValue(new Error('offline'));
    await act(async () => {
      result.current.refresh();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.earnings).toEqual(earnings(30000));
    await unmount();
  });

  it('stays null, without throwing, when the very first read fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result, unmount } = await renderHook(() => useEarnings(true, 'ready'));

    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.earnings).toBeNull();
    await unmount();
  });

  it('hides the list the moment it is disabled (signed out), without a new read', async () => {
    mockFetch.mockResolvedValue(earnings(30000));
    const { result, rerender, unmount } = await renderHook(
      ({ enabled, refreshKey }: Props) => useEarnings(enabled, refreshKey),
      { initialProps: { enabled: true, refreshKey: 'ready' } },
    );
    await waitFor(() => expect(result.current.earnings).not.toBeNull());

    await act(async () => {
      rerender({ enabled: false, refreshKey: 'ready' });
    });

    expect(result.current.earnings).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('never lets a superseded read overwrite a newer one', async () => {
    // The first read hangs; the status changes and the second lands; the first
    // arrives late. Serving it would show the older, staler list.
    let releaseFirst: (value: Earnings) => void = () => {};
    mockFetch.mockImplementationOnce(
      () => new Promise<Earnings>((resolve) => (releaseFirst = resolve)),
    );
    const { result, rerender, unmount } = await renderHook(
      ({ enabled, refreshKey }: Props) => useEarnings(enabled, refreshKey),
      { initialProps: { enabled: true, refreshKey: 'details_required' } },
    );

    mockFetch.mockResolvedValue(earnings(50000));
    await act(async () => {
      rerender({ enabled: true, refreshKey: 'ready' });
    });
    await waitFor(() => expect(result.current.earnings).toEqual(earnings(50000)));

    await act(async () => {
      releaseFirst(earnings(30000));
    });

    expect(result.current.earnings).toEqual(earnings(50000));
    await unmount();
  });
});
