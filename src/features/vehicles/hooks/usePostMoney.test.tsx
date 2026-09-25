/**
 * WHAT:  Tests for usePostMoney — no read at all for a non-owner (disabled),
 *        the owner's money once it lands, a re-read on refreshKey change, on
 *        refresh(), and on every RETURN to the screen (but not the first
 *        focus, which is the mount), and that a failed re-read keeps the last
 *        good answer.
 * WHY:   Money moves while the owner is elsewhere (the refund sweep, the payout
 *        webhook), so the focus re-read is the whole reason this card is
 *        truthful. The first-focus skip is the other half: without it every
 *        screen open reads twice. And a card that blanks on a dropped
 *        connection reads as money that went away. The screen tests stub
 *        useFocusEffect to a no-op, so none of this is asserted there.
 * LINKS: ./usePostMoney.ts; ../api/postMoneyApi.ts (fetchPostMoney);
 *        ../components/PostMoneyCard.tsx (the consumer); docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { PostMoney } from '../lib/postMoney';
import { usePostMoney } from './usePostMoney';

const mockFetch = jest.fn();
jest.mock('../api/postMoneyApi', () => ({
  fetchPostMoney: (postId: string) => mockFetch(postId),
}));

// Capture the focus callback rather than run it: the test decides when the
// screen gains focus. The real useFocusEffect fires once on mount (already
// focused) and again on every return.
const mockFocusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    mockFocusCallbacks.push(cb);
  },
}));
const focus = () => mockFocusCallbacks[mockFocusCallbacks.length - 1]();

const money = (over: Partial<PostMoney> = {}): PostMoney => ({
  kind: 'bounty_escrow',
  pricing: 'fee_on_top',
  state: 'held',
  headlinePence: 50000,
  rewardPence: 50000,
  serviceFeePence: 2500,
  chargedPence: 52500,
  hasCreditedSighting: false,
  paid: null,
  refund: null,
  refundHold: null,
  ...over,
});

type Props = { postId: string; enabled: boolean; refreshKey?: string };

beforeEach(() => {
  mockFetch.mockReset();
  mockFocusCallbacks.length = 0;
});

describe('usePostMoney', () => {
  it('makes no request and returns null for anyone but the owner', async () => {
    const { result, unmount } = await renderHook(() => usePostMoney('p1', false, 'active'));

    await act(async () => {
      focus(); // the mount's focus
    });
    await act(async () => {
      focus(); // a return
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.money).toBeNull();
    await unmount();
  });

  it('returns the owner’s money once the read lands', async () => {
    mockFetch.mockResolvedValue(money());
    const { result, unmount } = await renderHook(() => usePostMoney('p1', true, 'active'));

    await waitFor(() => expect(result.current.money).toEqual(money()));
    expect(mockFetch).toHaveBeenCalledWith('p1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('does not re-read on the first focus — that is the mount, already read', async () => {
    mockFetch.mockResolvedValue(money());
    const { result, unmount } = await renderHook(() => usePostMoney('p1', true, 'active'));
    await waitFor(() => expect(result.current.money).not.toBeNull());

    await act(async () => {
      focus();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('re-reads on every return to the screen — money moved while the owner was away', async () => {
    mockFetch.mockResolvedValue(money());
    const { result, unmount } = await renderHook(() => usePostMoney('p1', true, 'refund_held'));
    await waitFor(() => expect(result.current.money).toEqual(money()));
    await act(async () => {
      focus(); // mount
    });

    const released = money({
      state: 'refunded',
      refund: { pence: 52500, cardFeePence: 0, at: '2026-09-28T18:00:00Z' },
    });
    mockFetch.mockResolvedValue(released);
    await act(async () => {
      focus(); // back from somewhere else
    });

    await waitFor(() => expect(result.current.money).toEqual(released));
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      focus(); // and again
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    await unmount();
  });

  it('re-reads when the post status (refreshKey) changes', async () => {
    mockFetch.mockResolvedValue(money());
    const { result, rerender, unmount } = await renderHook(
      ({ postId, enabled, refreshKey }: Props) => usePostMoney(postId, enabled, refreshKey),
      { initialProps: { postId: 'p1', enabled: true, refreshKey: 'active' } },
    );
    await waitFor(() => expect(result.current.money).toEqual(money()));

    const awaiting = money({ state: 'awaiting_payee', hasCreditedSighting: true });
    mockFetch.mockResolvedValue(awaiting);
    await act(async () => {
      rerender({ postId: 'p1', enabled: true, refreshKey: 'recovery_claimed' });
    });

    await waitFor(() => expect(result.current.money).toEqual(awaiting));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('refresh() re-reads — after the owner’s own action moved money', async () => {
    mockFetch.mockResolvedValue(money());
    const { result, unmount } = await renderHook(() => usePostMoney('p1', true, 'active'));
    await waitFor(() => expect(result.current.money).toEqual(money()));

    const sending = money({ state: 'sending', hasCreditedSighting: true });
    mockFetch.mockResolvedValue(sending);
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.money).toEqual(sending));
    await unmount();
  });

  it('keeps the last good answer when a re-read fails', async () => {
    mockFetch.mockResolvedValue(money());
    const { result, unmount } = await renderHook(() => usePostMoney('p1', true, 'active'));
    await waitFor(() => expect(result.current.money).toEqual(money()));
    await act(async () => {
      focus(); // mount
    });

    mockFetch.mockRejectedValue(new Error('offline'));
    await act(async () => {
      focus(); // a return, on a dead connection
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.money).toEqual(money());
    await unmount();
  });

  it('stays null, without throwing, when the very first read fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result, unmount } = await renderHook(() => usePostMoney('p1', true, 'active'));

    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.money).toBeNull();
    await unmount();
  });

  it('never lets a superseded read overwrite a newer one', async () => {
    let releaseFirst: (value: PostMoney) => void = () => {};
    mockFetch.mockImplementationOnce(
      () => new Promise<PostMoney>((resolve) => (releaseFirst = resolve)),
    );
    const { result, rerender, unmount } = await renderHook(
      ({ postId, enabled, refreshKey }: Props) => usePostMoney(postId, enabled, refreshKey),
      { initialProps: { postId: 'p1', enabled: true, refreshKey: 'active' } },
    );

    const paid = money({
      state: 'paid',
      hasCreditedSighting: true,
      paid: { pence: 50000, at: '2026-09-25T10:00:00Z' },
    });
    mockFetch.mockResolvedValue(paid);
    await act(async () => {
      rerender({ postId: 'p1', enabled: true, refreshKey: 'recovered' });
    });
    await waitFor(() => expect(result.current.money).toEqual(paid));

    await act(async () => {
      releaseFirst(money()); // the stale "held" arrives late
    });

    expect(result.current.money).toEqual(paid);
    await unmount();
  });
});
