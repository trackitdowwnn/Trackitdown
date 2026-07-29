/**
 * WHAT:  Tests for useThreadMeta — header context picked out of the inbox
 *        payload by thread id: found, missing, error + retry, and the
 *        stale-response guard on a thread switch.
 * WHY:   'missing' vs 'error' is a user-facing distinction ("this
 *        conversation isn't available" vs "check your connection") — mixing
 *        them tells someone with a network blip that their conversation is
 *        gone. The last untested chat hook before this file.
 * LINKS: src/features/chat/hooks/useThreadMeta.ts; docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { InboxThread } from '../types';
import { useThreadMeta } from './useThreadMeta';

const mockFetchInbox = jest.fn();
jest.mock('../api/chatApi', () => ({
  get fetchInbox() {
    return mockFetchInbox;
  },
}));

const thread = (threadId: string): InboxThread => ({
  threadId,
  postId: 'p1',
  role: 'owner',
  lastMessageAt: '2026-07-15T10:00:00Z',
  lastMessagePreview: 'hello',
  unreadCount: 0,
  post: {
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    coverPhotoUrl: null,
  },
  other: { firstName: 'Sam' },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchInbox.mockResolvedValue([thread('t1'), thread('t2')]);
});

describe('useThreadMeta', () => {
  it('finds its thread in the inbox payload', async () => {
    const { result, unmount } = await renderHook(() => useThreadMeta('t2'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.thread?.threadId).toBe('t2');
    await unmount();
  });

  it("reports 'missing' for a thread the payload doesn't hold", async () => {
    const { result, unmount } = await renderHook(() => useThreadMeta('nope'));

    await waitFor(() => expect(result.current.status).toBe('missing'));
    expect(result.current.thread).toBeNull();
    await unmount();
  });

  it("a network failure is 'error', never 'missing' — the copy differs", async () => {
    mockFetchInbox.mockRejectedValue(new Error('offline'));
    const { result, unmount } = await renderHook(() => useThreadMeta('t1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    await unmount();
  });

  it('retry refetches after an error', async () => {
    mockFetchInbox.mockRejectedValueOnce(new Error('offline'));
    const { result, unmount } = await renderHook(() => useThreadMeta('t1'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.thread?.threadId).toBe('t1');
    await unmount();
  });

  it('a stale response never lands after the thread id changes', async () => {
    // First load hangs; the id changes; the late first response must not
    // overwrite the second thread's context with the first's.
    let releaseFirst: (rows: InboxThread[]) => void = () => {};
    mockFetchInbox.mockImplementationOnce(
      () => new Promise<InboxThread[]>((resolve) => (releaseFirst = resolve)),
    );

    const { result, rerender, unmount } = await renderHook(
      ({ id }: { id: string }) => useThreadMeta(id),
      { initialProps: { id: 't1' } },
    );

    await act(async () => {
      rerender({ id: 't2' });
    });
    await waitFor(() => expect(result.current.thread?.threadId).toBe('t2'));

    await act(async () => {
      releaseFirst([thread('t1')]);
    });

    expect(result.current.thread?.threadId).toBe('t2');
    await unmount();
  });
});
