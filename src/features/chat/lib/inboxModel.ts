/**
 * WHAT:  Pure inbox maths — the context line for a thread row ("About your
 *        Blue BMW" + plate for owners / "Your sighting · Blue BMW" for
 *        spotters), the unread total that feeds the Inbox tab badge, and
 *        the row's unread treatment.
 * WHY:   The context line is what anchors a conversation to a CAR (Airbnb
 *        anchors to a listing); its wording and the privacy split — the
 *        plate renders ONLY on the owner's own rows (their own plate),
 *        never on a spotter's — are product decisions worth pinning in
 *        tests without rendering.
 * LINKS: src/features/chat/components/ThreadRow.tsx (consumer);
 *        src/shared/ui/appTabBarModel.ts (badge thresholds live there);
 *        docs/DESIGN_SYSTEM.md (PlateChip norms).
 */

import type { InboxThread } from '../types';

/** The thread row's anchoring line. `plate` non-null means "render a
 *  PlateChip after the prefix" — only ever the OWNER'S OWN plate. */
export interface ContextLine {
  prefix: string;
  plate: string | null;
}

/** "Blue BMW 3 Series" — colour + make + model, skipping blanks. */
function carLabel(post: InboxThread['post']): string {
  return [post.colour, post.make, post.model].filter(Boolean).join(' ');
}

export function contextLine(thread: InboxThread): ContextLine {
  if (thread.role === 'owner') {
    // The owner sees their own car's plate — their own data, PlateChip-styled.
    return { prefix: `About your ${carLabel(thread.post)}`, plate: thread.post.plate };
  }
  // PRIVACY: a spotter's row never carries the plate — the car is anchored
  // by description only (the post's public face).
  return { prefix: `Your sighting · ${carLabel(thread.post)}`, plate: null };
}

/** Row preview: the denormalised last message, or a calm fallback (the
 *  system first message always sets one, so this is belt-and-braces). */
export function previewText(thread: InboxThread): string {
  return thread.lastMessagePreview ?? 'No messages yet';
}

export function isUnread(thread: InboxThread): boolean {
  return thread.unreadCount > 0;
}

/** The Inbox tab badge value (AppTabBar's model handles 9+ capping). */
export function totalUnread(threads: InboxThread[]): number {
  return threads.reduce((sum, thread) => sum + Math.max(0, thread.unreadCount), 0);
}
