/**
 * WHAT:  The chat feature's PUBLIC API — the only file other features and
 *        route files may import from (ARCHITECTURE.md rule 1).
 * WHY:   Keeps the feature swappable and its internals private; screens and
 *        entry-point helpers are added here as they land.
 * LINKS: src/features/chat/README.md (the spec); docs/ARCHITECTURE.md.
 */

export { ChatActionError, openThread, openThreadForSighting } from './api/chatApi';
// fetchInbox + totalUnread power the Inbox route's hidden-half badge sync:
// with the tab split into segments, only the visible screen's hook reports its
// unread half, so the route re-reads the HIDDEN half on focus (ADR-0012).
export { fetchInbox } from './api/chatApi';
export { totalUnread } from './lib/inboxModel';
export { ChatInboxScreen } from './screens/InboxScreen';
export { ChatThreadScreen } from './screens/ChatThreadScreen';
export type {
  ChatMessage,
  ChatRole,
  InboxThread,
  MessageKind,
  OpenThreadResult,
  OutgoingMessage,
  SendState,
} from './types';
