/**
 * WHAT:  Tests for the chat API layer — RPC error-token translation
 *        (NO_SIGHTING gating, POST_CLOSED read-only), send bounds, the
 *        inbox PRIVACY strictness (an extra `other` field — a leaked
 *        surname/id — fails loudly), the no-content-in-logs rule, and the
 *        realtime subscription's cleanup contract.
 * WHY:   The gating and read-only rules are DOMAIN Chat law and the
 *        participant-exposure boundary is SECURITY_AND_TRUST §1; both live
 *        in this file's schemas/mappings and are pinned here.
 * LINKS: src/features/chat/api/chatApi.ts, docs/TESTING.md, docs/LOGGING.md.
 */

import {
  ChatActionError,
  fetchInbox,
  fetchMessages,
  flagMessage,
  markThreadRead,
  openThread,
  sendMessage,
  subscribeToThreadMessages,
} from './chatApi';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockChannelOn = jest.fn();
const mockSubscribe = jest.fn();
const mockRemoveChannel = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    channel: () => ({
      on: (...args: unknown[]) => {
        mockChannelOn(...args);
        return { subscribe: () => mockSubscribe() };
      },
    }),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

const THREAD = 'aaaaaaaa-0000-0000-0000-00000000000a';
const POST = 'aaaaaaaa-0000-0000-0000-00000000000b';
const MESSAGE = 'aaaaaaaa-0000-0000-0000-00000000000c';

const messageRow = {
  id: MESSAGE,
  thread_id: THREAD,
  sender_id: 'aaaaaaaa-0000-0000-0000-00000000000d',
  kind: 'user',
  content: 'hello there',
  created_at: '2026-07-15T12:00:00Z',
};

const inboxRow = {
  thread_id: THREAD,
  post_id: POST,
  role: 'owner',
  last_message_at: '2026-07-15T12:00:00Z',
  last_message_preview: 'hello there',
  unread_count: 2,
  post: {
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    cover_photo_url: null,
  },
  other: { first_name: 'Sam' },
};

beforeEach(() => jest.clearAllMocks());

describe('openThread', () => {
  it('returns the thread id and created flag', async () => {
    mockRpc.mockResolvedValue({ data: { thread_id: THREAD, created: true }, error: null });
    await expect(openThread(POST)).resolves.toEqual({ threadId: THREAD, created: true });
    expect(mockRpc).toHaveBeenCalledWith('open_thread', {
      p_post_id: POST,
      p_spotter_id: null,
    });
  });

  it('maps the sighting-gating rejection to calm copy (DOMAIN: no cold DMs)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'NO_SIGHTING' } });
    await expect(openThread(POST, THREAD)).rejects.toMatchObject({ code: 'NO_SIGHTING' });
  });
});

describe('sendMessage', () => {
  it('sends trimmed content and returns the mapped message', async () => {
    mockRpc.mockResolvedValue({ data: messageRow, error: null });
    const sent = await sendMessage(THREAD, '  hello there  ');
    expect(mockRpc).toHaveBeenCalledWith('send_message', {
      p_thread_id: THREAD,
      p_content: 'hello there',
    });
    expect(sent).toMatchObject({ id: MESSAGE, content: 'hello there', kind: 'user' });
  });

  it('rejects empty and over-long content client-side', async () => {
    await expect(sendMessage(THREAD, '   ')).rejects.toBeInstanceOf(ChatActionError);
    await expect(sendMessage(THREAD, 'x'.repeat(2001))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps POST_CLOSED (read-only after close) to its calm copy', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'POST_CLOSED' } });
    await expect(sendMessage(THREAD, 'anyone there?')).rejects.toMatchObject({
      code: 'POST_CLOSED',
      message: expect.stringContaining('read-only'),
    });
  });

  it('PRIVACY: never logs message content — lengths and ids only', async () => {
    mockRpc.mockResolvedValue({ data: messageRow, error: null });
    await sendMessage(THREAD, 'super secret content');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'POST_CLOSED' } });
    await sendMessage(THREAD, 'super secret content').catch(() => {});
    const allLogged = JSON.stringify([...mockLogInfo.mock.calls, ...mockLogWarn.mock.calls]);
    expect(allLogged).not.toContain('super secret');
    expect(allLogged).toContain('length');
  });
});

describe('fetchInbox', () => {
  it('parses and maps rows', async () => {
    mockRpc.mockResolvedValue({ data: [inboxRow], error: null });
    const inbox = await fetchInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      threadId: THREAD,
      role: 'owner',
      unreadCount: 2,
      other: { firstName: 'Sam' },
    });
  });

  it('PRIVACY: an extra field on `other` (a widened RPC) fails loudly', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...inboxRow, other: { ...inboxRow.other, surname: 'Leaked' } }],
      error: null,
    });
    await expect(fetchInbox()).rejects.toThrow();
  });

  it('PRIVACY: an avatar_path (the uid-bearing field) is rejected too', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...inboxRow, other: { first_name: 'Sam', avatar_path: 'uid/avatar.jpg' } }],
      error: null,
    });
    await expect(fetchInbox()).rejects.toThrow();
  });
});

describe('markThreadRead', () => {
  it('is non-fatal on failure (unread self-heals next stamp)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(markThreadRead(THREAD)).resolves.toBeUndefined();
  });
});

describe('flagMessage', () => {
  it('flags with a bounded reason', async () => {
    mockRpc.mockResolvedValue({ data: { flag_id: MESSAGE }, error: null });
    await flagMessage(MESSAGE, 'threatening');
    expect(mockRpc).toHaveBeenCalledWith('flag_message', {
      p_message_id: MESSAGE,
      p_reason: 'threatening',
    });
    await expect(flagMessage(MESSAGE, 'x'.repeat(501))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('fetchMessages', () => {
  it('reads the latest page newest-first via the RLS-scoped select', async () => {
    const limit = jest.fn().mockResolvedValue({ data: [messageRow], error: null });
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });
    const messages = await fetchMessages(THREAD);
    expect(mockFrom).toHaveBeenCalledWith('messages');
    expect(eq).toHaveBeenCalledWith('thread_id', THREAD);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(messages[0]).toMatchObject({ id: MESSAGE, content: 'hello there' });
  });
});

describe('subscribeToThreadMessages', () => {
  it('filters to the thread and returns a cleanup that removes the channel', () => {
    const onInsert = jest.fn();
    const cleanup = subscribeToThreadMessages(THREAD, onInsert);
    expect(mockChannelOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ event: 'INSERT', table: 'messages', filter: `thread_id=eq.${THREAD}` }),
      expect.any(Function),
    );
    // Simulate an insert arriving over the wire.
    const handler = mockChannelOn.mock.calls[0][2] as (p: { new: unknown }) => void;
    handler({ new: messageRow });
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: MESSAGE }));
    cleanup();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});
