/**
 * WHAT:  Tests for useThreadMessages — the optimistic-send contract (a
 *        failed send RETAINS its text as a failed bubble; retry re-delivers
 *        the same content), realtime dedupe (our own echo never doubles),
 *        the focus-scoped subscription cleanup, and read-marking.
 * WHY:   Failure retention is the feature's trust moment (never silently
 *        drop a user's words) and a leaked channel or doubled bubble reads
 *        as broken chat — all pinned here without rendering screens.
 * LINKS: src/features/chat/hooks/useThreadMessages.ts, docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ChatMessage } from '../types';
import { useThreadMessages } from './useThreadMessages';

const mockFetchMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockMarkRead = jest.fn();
const mockSubscribe = jest.fn();
const mockCleanup = jest.fn();

jest.mock('../api/chatApi', () => ({
  fetchMessages: (...args: unknown[]) => mockFetchMessages(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  markThreadRead: (...args: unknown[]) => mockMarkRead(...args),
  subscribeToThreadMessages: (...args: unknown[]) => {
    mockSubscribe(...args);
    return mockCleanup;
  },
}));

// useFocusEffect: run the effect like a mounted, focused screen would —
// including its cleanup on unmount (the channel-leak contract under test).
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

const THREAD = 'thread-1';

const serverMessage = (id: string, content = `content-${id}`): ChatMessage => ({
  id,
  threadId: THREAD,
  senderId: 'me',
  kind: 'user',
  content,
  createdAt: '2026-07-15T12:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchMessages.mockResolvedValue([serverMessage('m1')]);
  mockMarkRead.mockResolvedValue(undefined);
});

describe('useThreadMessages', () => {
  it('loads the first page, marks the thread read, and subscribes on focus', async () => {
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.messages).toHaveLength(1);
    expect(mockMarkRead).toHaveBeenCalledWith(THREAD);
    expect(mockSubscribe).toHaveBeenCalledWith(THREAD, expect.any(Function));
  });

  it('cleans up the realtime channel on unmount (no leaked subscriptions)', async () => {
    const { unmount } = await renderHook(() => useThreadMessages(THREAD));
    await act(async () => {});
    // House pattern (useTimeAgo.test): unmount inside async act, or effect
    // cleanups don't flush under this renderer.
    await act(async () => unmount());
    expect(mockCleanup).toHaveBeenCalled();
  });

  it('dedupes a realtime echo of a message already present', async () => {
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const onInsert = mockSubscribe.mock.calls[0][1] as (m: ChatMessage) => void;
    await act(async () => {
      onInsert(serverMessage('m2'));
      onInsert(serverMessage('m2')); // the echo
    });
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('confirms an optimistic send: pending bubble → server row, no duplicate', async () => {
    mockSendMessage.mockResolvedValue(serverMessage('m9', 'hello'));
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      result.current.send('hello');
    });
    await waitFor(() => expect(result.current.outgoing).toHaveLength(0));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm9']);
  });

  it('two rapid sends BOTH queue — the second is never dropped (review C1)', async () => {
    // Never resolve, so both stay pending and we can see both bubbles exist.
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      expect(result.current.send('first')).toBe(true);
      expect(result.current.send('second')).toBe(true);
    });
    expect(result.current.outgoing.map((o) => o.content)).toEqual(['first', 'second']);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it('send returns false for empty input (caller keeps its draft)', async () => {
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      expect(result.current.send('   ')).toBe(false);
    });
    expect(result.current.outgoing).toHaveLength(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('NEVER drops a failed send: text retained, state failed, error surfaced', async () => {
    mockSendMessage.mockRejectedValue(new Error('This post has closed, so…'));
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      result.current.send('my exact words');
    });
    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));
    expect(result.current.outgoing[0].content).toBe('my exact words');
    expect(result.current.sendError).toContain('closed');
    expect(result.current.messages).toHaveLength(1); // nothing fake persisted
  });

  it('retry re-delivers the SAME content and clears the bubble on success', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('network'));
    mockSendMessage.mockResolvedValueOnce(serverMessage('m9', 'my exact words'));
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      result.current.send('my exact words');
    });
    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));
    await act(async () => {
      result.current.retrySend(result.current.outgoing[0].localId);
    });
    await waitFor(() => expect(result.current.outgoing).toHaveLength(0));
    expect(mockSendMessage).toHaveBeenLastCalledWith(THREAD, 'my exact words');
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm9']);
  });

  it('marks read again when a message arrives while the thread is open', async () => {
    const { result } = await renderHook(() => useThreadMessages(THREAD));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    mockMarkRead.mockClear();
    const onInsert = mockSubscribe.mock.calls[0][1] as (m: ChatMessage) => void;
    await act(async () => {
      onInsert(serverMessage('m3'));
    });
    expect(mockMarkRead).toHaveBeenCalledWith(THREAD);
  });
});
