/**
 * WHAT:  The Inbox tab badge aggregator — one tiny ledger summing chat unread
 *        and notification-center unread into the single number the tab shows.
 * WHY:   The Inbox tab has two faces (Messages | Notifications) but ONE badge,
 *        and two features feeding `setBadge('inbox', …)` independently would
 *        each overwrite the other's half. Each reports its own count here and
 *        receives the honest total back to set. Module-level state on purpose:
 *        both callers are hooks that already re-report on every load/focus, so
 *        no subscription machinery is needed — the freshest report wins, and a
 *        stale half is at worst one focus-refetch old.
 *
 *        Chat may import this (chat already imports the notifications barrel
 *        for its send path); notifications must never import chat — that
 *        direction is what keeps the require cycle out.
 * LINKS: src/features/chat/hooks/useInbox.ts (the chat reporter);
 *        ../hooks/useNotificationCenter.ts (the center reporter);
 *        src/shared/ui/AppTabBar.tsx (useTabBadges — where the total lands).
 */

export type InboxBadgeSource = 'chat' | 'center';

const counts: Record<InboxBadgeSource, number> = { chat: 0, center: 0 };

/**
 * Record one side's unread count and get the total the tab badge should show.
 * The caller sets `setBadge('inbox', total)` itself — this module stays free
 * of React so it is trivially unit-testable.
 */
export function reportInboxBadge(source: InboxBadgeSource, unread: number): number {
  counts[source] = Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
  return counts.chat + counts.center;
}

/** Test seam: reset between cases. Harmless in production (never called). */
export function resetInboxBadge(): void {
  counts.chat = 0;
  counts.center = 0;
}
