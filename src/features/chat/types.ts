/**
 * WHAT:  Types owned by the chat feature — the message/thread shapes, the
 *        optimistic-send states, the RPC param/result contracts
 *        (open_thread / send_message / mark_thread_read / get_inbox /
 *        flag_message), and the feature's bounds constants.
 * WHY:   One place ties the screens, hooks, and API layer to the RPC
 *        contract; the bounds mirror the migration's CHECKs so client and
 *        server agree by construction (house pattern: sightings/types.ts).
 * LINKS: src/features/chat/api/chatApi.ts; supabase/migrations/*_chat.sql;
 *        docs/DOMAIN.md (Chat).
 */

/** Bounds — mirrored by the chat migration's CHECK constraints. */
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_FLAG_REASON_LENGTH = 500;
/** Timestamp shown between bubbles when the gap exceeds this (minutes). */
export const TIME_GAP_MINUTES = 15;
/** Messages fetched per page (latest first; older pages on demand). */
export const MESSAGES_PAGE_SIZE = 100;

/** The caller's side of a thread. */
export type ChatRole = 'owner' | 'spotter';

/** 'system' = the automatic safety first message (sender_id null). */
export type MessageKind = 'system' | 'user';

/** One persisted message as read from the server. */
export interface ChatMessage {
  id: string;
  threadId: string;
  /** null on system messages. */
  senderId: string | null;
  kind: MessageKind;
  content: string;
  createdAt: string;
}

/** Client-side delivery state layered over a message being sent.
 *  'failed' NEVER drops the text — the bubble keeps it with a retry. */
export type SendState = 'pending' | 'failed';

/** An optimistic outgoing message: rendered immediately, reconciled with
 *  the server row (matched by localId → replaced) on RPC success. */
export interface OutgoingMessage {
  /** Client-generated identity until the server row replaces it. */
  localId: string;
  content: string;
  createdAt: string;
  state: SendState;
}

/** One inbox row from get_inbox (newest activity first). PRIVACY: the
 *  other party is FIRST NAME ONLY. No avatar: the avatar storage path is
 *  pinned to `<uid>/avatar.jpg`, so returning it (or any URL built from it)
 *  would ship the other participant's uid to the client — reversing the
 *  boundary open_thread_for_sighting exists to protect, and chaining to a
 *  surname via the permissive profiles policy. Same call the post-detail
 *  owner block already made (20260713170000_post_detail_owner_no_avatar_path).
 *  Chat avatars can return once the profiles read-path is hardened. */
export interface InboxThread {
  threadId: string;
  postId: string;
  role: ChatRole;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
  post: {
    make: string;
    model: string;
    colour: string | null;
    plate: string | null;
    status: string;
    coverPhotoUrl: string | null;
  };
  other: {
    firstName: string;
  };
}

/** open_thread result: created=false means the thread already existed. */
export interface OpenThreadResult {
  threadId: string;
  created: boolean;
}
