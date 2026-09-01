/**
 * WHAT:  The chat data path — RPC wrappers (open_thread / send_message /
 *        mark_thread_read / get_inbox / flag_message / get_thread_peer),
 *        the messages page read (RLS-scoped table select), and the
 *        per-thread realtime subscription factory. Machine-token errors map
 *        to calm copy here.
 * WHY:   The SECURITY DEFINER RPCs are the only write boundary and this
 *        file their only caller (house pattern: sightingApi). PRIVACY:
 *        message CONTENT never appears in logs — events carry ids and
 *        lengths only ([chat] tag, docs/LOGGING.md); the inbox's `other`
 *        block and get_thread_peer's `peer` block are parsed .strict() so a
 *        widened RPC leaking more than first name + reputation fails loudly
 *        client-side (SECURITY_AND_TRUST §1/§6). No peer uid ever reaches
 *        this file's return values — see fetchThreadPeer.
 * LINKS: src/features/chat/types.ts; supabase/migrations/*_chat.sql,
 *        *_chat_thread_peer.sql; src/features/sightings/api/sightingApi.ts
 *        (the pattern); docs/DOMAIN.md (Chat).
 */

import { z } from 'zod';

// Type-only: erased at runtime, so it cannot close the chat→profile require
// cycle (profile → garage → vehicles → chat).
import type { PublicProfile } from '@/features/profile';
import { notifyMessage } from '@/features/notifications';
import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PostStatus } from '@/shared/types';

import type {
  ChatMessage,
  ChatRole,
  InboxThread,
  OpenThreadResult,
} from '../types';
import { MAX_FLAG_REASON_LENGTH, MAX_MESSAGE_LENGTH, MESSAGES_PAGE_SIZE } from '../types';

const log = createLogger('chat');

// --- Error translation -------------------------------------------------------

/** RPC machine tokens → calm, user-facing copy. */
export const CHAT_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in to message.',
  NO_SIGHTING: 'Conversations open once a sighting has been reported on the post.',
  NOT_PARTICIPANT: 'This conversation isn’t available.',
  POST_CLOSED: 'This post has closed, so the conversation is now read-only.',
  INVALID_INPUT: 'That didn’t look right. Please check and try again.',
};

const CHAT_FALLBACK = 'Something went wrong. Please try again.';

/** Error whose `message` is already user-facing; `code` for logging/tests. */
export class ChatActionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ChatActionError';
    this.code = code;
  }
}

/** Map a Supabase RPC error to a ChatActionError. The RPC's message STARTS
 *  with the machine token (validation tokens carry ': detail'). Unknown
 *  Postgres messages can echo input, so only known tokens are logged. */
function toChatError(error: { message: string; code?: string }, action: string): ChatActionError {
  const token = error.message.split(':')[0].trim();
  const known = token in CHAT_ERROR_MESSAGES;
  log.warn(`${action} rejected`, { code: error.code, reason: known ? token : undefined });
  return new ChatActionError(
    known ? CHAT_ERROR_MESSAGES[token] : CHAT_FALLBACK,
    known ? token : 'RPC_ERROR',
  );
}

// --- Row schemas ---------------------------------------------------------------

const messageRowSchema = z.object({
  id: z.guid(),
  thread_id: z.guid(),
  sender_id: z.guid().nullable(),
  kind: z.enum(['system', 'user']),
  content: z.string(),
  created_at: z.string(),
});

function toChatMessage(row: z.infer<typeof messageRowSchema>): ChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at,
  };
}

const inboxRowSchema = z.object({
  thread_id: z.guid(),
  post_id: z.guid(),
  role: z.enum(['owner', 'spotter']),
  last_message_at: z.string(),
  last_message_preview: z.string().nullable(),
  unread_count: z.number().int(),
  post: z.object({
    make: z.string(),
    model: z.string(),
    colour: z.string().nullable(),
    plate: z.string().nullable(),
    // The full PostStatus set, validated at the boundary: an unknown status
    // must fail loudly here, not silently render as "Still missing" after a
    // downstream cast (code review #4).
    status: z.enum([
      'draft',
      'pending_verification',
      'active',
      'recovery_claimed',
      'recovered',
      'recovered_no_spotter',
      'cancelled',
      'expired',
    ]) satisfies z.ZodType<PostStatus>,
    cover_photo_url: z.string().nullable(),
  }),
  // PRIVACY: strict() — any extra field fails loudly. FIRST NAME ONLY: no
  // avatar_path (it embeds the other participant's uid — see types.ts), no
  // surname/email/id.
  other: z
    .object({
      first_name: z.string(),
    })
    .strict(),
});

function toInboxThread(row: z.infer<typeof inboxRowSchema>): InboxThread {
  return {
    threadId: row.thread_id,
    postId: row.post_id,
    role: row.role as ChatRole,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    unreadCount: row.unread_count,
    post: {
      make: row.post.make,
      model: row.post.model,
      colour: row.post.colour,
      plate: row.post.plate,
      status: row.post.status,
      // The RPC's real cover photo, or nothing. Null renders the thread row's
      // placeholder, which is the honest answer for a post without pictures.
      coverPhotoUrl: row.post.cover_photo_url ?? null,
    },
    other: {
      firstName: row.other.first_name,
    },
  };
}

// --- RPCs -----------------------------------------------------------------------

const openThreadResultSchema = z.object({ thread_id: z.guid(), created: z.boolean() });

/** Open (or return) the thread for a (post, spotter) pair. Owners pass the
 *  spotter id; spotters pass nothing. Server validates the sighting gating. */
export async function openThread(
  postId: string,
  spotterId?: string,
): Promise<OpenThreadResult> {
  const { data, error } = await supabase.rpc('open_thread', {
    p_post_id: postId,
    p_spotter_id: spotterId ?? null,
  });
  if (error) throw toChatError(error, 'open_thread');
  const parsed = openThreadResultSchema.parse(data);
  log.info('thread_opened', { threadId: parsed.thread_id, created: parsed.created });
  return { threadId: parsed.thread_id, created: parsed.created };
}

/** The OWNER's entry: open the thread for one of their post's sightings.
 *  PRIVACY: the owner's client never holds a spotter_id (get_post_sightings
 *  strips it, SECURITY_AND_TRUST §1) — the server resolves the spotter from
 *  the sighting id the owner legitimately has. */
export async function openThreadForSighting(sightingId: string): Promise<OpenThreadResult> {
  const { data, error } = await supabase.rpc('open_thread_for_sighting', {
    p_sighting_id: sightingId,
  });
  if (error) throw toChatError(error, 'open_thread_for_sighting');
  const parsed = openThreadResultSchema.parse(data);
  log.info('thread_opened', { threadId: parsed.thread_id, created: parsed.created });
  return { threadId: parsed.thread_id, created: parsed.created };
}

/** Send one message. PRIVACY: only the LENGTH is ever logged. */
export async function sendMessage(threadId: string, content: string): Promise<ChatMessage> {
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ChatActionError(CHAT_ERROR_MESSAGES.INVALID_INPUT, 'INVALID_INPUT');
  }
  const { data, error } = await supabase.rpc('send_message', {
    p_thread_id: threadId,
    p_content: trimmed,
  });
  if (error) {
    log.warn('message_send_failed', { threadId, length: trimmed.length });
    throw toChatError(error, 'send_message');
  }
  const row = messageRowSchema.parse(data);
  log.info('message_sent', { threadId, length: trimmed.length });
  // Notify the other participant. SAFETY: only the message ID crosses here —
  // the push body is built server-side as sender first name + post context,
  // and the message CONTENT never transits push (SECURITY_AND_TRUST §3).
  notifyMessage(row.id);
  return toChatMessage(row);
}

/** Stamp the caller's last_read_at on a thread (drives unread + badge). */
export async function markThreadRead(threadId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_thread_read', { p_thread_id: threadId });
  if (error) {
    // Non-fatal: unread state self-heals on the next successful stamp.
    log.warn('thread_read stamp failed', { threadId });
    return;
  }
  log.debug('thread_read', { threadId });
}

/** The caller's inbox, newest activity first. */
export async function fetchInbox(): Promise<InboxThread[]> {
  const { data, error } = await supabase.rpc('get_inbox');
  if (error) {
    log.warn('get_inbox failed', { code: error.code });
    throw new ChatActionError('We couldn’t load your inbox. Please try again.', 'INBOX_LOAD');
  }
  return z.array(inboxRowSchema).parse(data ?? []).map(toInboxThread);
}

/** Flag a message for moderation. Re-flagging returns the existing flag. */
export async function flagMessage(messageId: string, reason?: string): Promise<void> {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length > MAX_FLAG_REASON_LENGTH) {
    throw new ChatActionError(CHAT_ERROR_MESSAGES.INVALID_INPUT, 'INVALID_INPUT');
  }
  const { error } = await supabase.rpc('flag_message', {
    p_message_id: messageId,
    p_reason: trimmed.length > 0 ? trimmed : null,
  });
  if (error) throw toChatError(error, 'flag_message');
  log.info('message_flagged', { messageId });
}

// --- Thread peer (RPC) --------------------------------------------------------------

/** A participant's view of the OTHER side of one thread. */
export interface ThreadPeer {
  /** When they last had the thread open — the "Seen" caption derives here.
   *  A thread-level stamp (mark_thread_read), NOT a per-message receipt. */
  theirLastReadAt: string;
  /** The spotter's narrow passport — present ONLY when the caller is the
   *  post's OWNER. A spotter always gets null: owner identity is never
   *  exposed (DOMAIN.md; security review M2). */
  peer: PublicProfile | null;
  /**
   * Whether contact is blocked, in EITHER direction — the thread is frozen
   * read-only (ADR-0017 Q1).
   *
   * ⚠️ DELIBERATELY UNATTRIBUTED. The server does not say who blocked whom, and
   * this must not start asking: a blocked person seeing "they blocked you"
   * learns something about who that person is, and on a stolen-car app that is
   * exactly what the silence is protecting. Both sides see the same frozen
   * thread, which is indistinguishable from the other person having stopped
   * replying.
   */
  blocked: boolean;
}

// .strict(): a widened RPC leaking a uid, display_name, or avatar_path must
// fail loudly client-side, exactly like get_inbox's `other` block.
//
// ⚠️ The OUTER object is deliberately NOT strict (only `peer` is), which is why
// `blocked` could be added server-side without breaking older bundles. It is
// still `.optional()` here so this bundle also works against a server that
// predates 20260901150000 — an OTA can reach a phone before a migration lands.
const threadPeerResultSchema = z.object({
  their_last_read_at: z.string(),
  blocked: z.boolean().optional(),
  peer: z
    .object({
      first_name: z.string(),
      created_at: z.string(),
      sightings_reported: z.number().int(),
      sightings_helpful: z.number().int(),
      recoveries_credited: z.number().int(),
    })
    .strict()
    .nullable(),
});

/**
 * PRIVACY: this deliberately replaced a direct read of the thread row. The
 * row is participant-readable and carries both uids, but a uid in app code
 * pivots (via the permissive profiles select) to display_name — which may
 * hold a surname — and avatar_path. The RPC keeps the uid server-side and
 * returns only what may be rendered; avatarUrl stays null because the
 * storage path embeds the uid this exists to withhold.
 */
export async function fetchThreadPeer(threadId: string): Promise<ThreadPeer> {
  const { data, error } = await supabase.rpc('get_thread_peer', { p_thread_id: threadId });
  if (error) throw toChatError(error, 'get_thread_peer');
  const parsed = threadPeerResultSchema.parse(data);
  return {
    theirLastReadAt: parsed.their_last_read_at,
    // Absent means an older server, which had no blocking at all — so "not
    // blocked" is the honest reading, and it degrades to today's behaviour.
    blocked: parsed.blocked ?? false,
    peer: parsed.peer
      ? {
          firstName: parsed.peer.first_name,
          avatarUrl: null,
          createdAt: parsed.peer.created_at,
          counters: {
            sightingsReported: parsed.peer.sightings_reported,
            sightingsHelpful: parsed.peer.sightings_helpful,
            recoveriesCredited: parsed.peer.recoveries_credited,
          },
        }
      : null,
  };
}

// --- Blocking (RPC) -----------------------------------------------------------------

/**
 * Blocks the other participant of this thread. After it returns, neither side
 * can send and no new thread can open between them; the history stays.
 *
 * ⚠️ TAKES A THREAD ID BECAUSE THIS CLIENT HAS NO PEER UID, and that is the
 * point rather than an inconvenience — see fetchThreadPeer's PRIVACY note. The
 * server resolves the other party from the thread it already owns, so adding
 * blocking did not require handing a uid to the client.
 *
 * ⚠️ NOT REPORTED TO THE OTHER PERSON, and the caller must not tell them
 * either: no message is inserted, no push is sent. ADR-0017 keeps a block
 * indistinguishable from silence.
 */
export async function blockThreadPeer(threadId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_thread_id: threadId });
  if (error) throw toChatError(error, 'block_user');
  // The thread id is safe to log — it is already in every other chat event —
  // and there is no peer identity here to leak.
  log.info('thread_peer_blocked', { threadId });
}

// --- Messages read (RLS-scoped) ---------------------------------------------------

/** Latest page of a thread's messages (RLS scopes to participants). Pass
 *  `before` (the oldest loaded createdAt) to page further back. */
export async function fetchMessages(
  threadId: string,
  before?: string,
): Promise<ChatMessage[]> {
  let query = supabase
    .from('messages')
    .select('id, thread_id, sender_id, kind, content, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (before) {
    query = query.lt('created_at', before);
  }
  const { data, error } = await query;
  if (error) {
    log.warn('messages fetch failed', { threadId, code: error.code });
    throw new ChatActionError('We couldn’t load this conversation. Please try again.', 'LOAD');
  }
  return z.array(messageRowSchema).parse(data ?? []).map(toChatMessage);
}

// --- Realtime -----------------------------------------------------------------------

/** Subscribe to INSERTs on one thread's messages. Returns the cleanup the
 *  caller MUST run on blur/unmount — channels never outlive the screen
 *  (no leaked subscriptions). RLS authorises the stream server-side. */
export function subscribeToThreadMessages(
  threadId: string,
  onInsert: (message: ChatMessage) => void,
): () => void {
  const channel = supabase
    .channel(`thread-${threadId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
      (payload: { new: unknown }) => {
        const row = messageRowSchema.safeParse(payload.new);
        if (row.success) {
          onInsert(toChatMessage(row.data));
        }
      },
    )
    .subscribe();
  log.debug('thread_subscribed', { threadId });
  return () => {
    void supabase.removeChannel(channel);
    log.debug('thread_unsubscribed', { threadId });
  };
}
