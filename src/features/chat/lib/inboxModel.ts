/**
 * WHAT:  Pure inbox maths — the context line for a thread row ("About your
 *        Blue BMW" + plate for owners / "Your sighting · Blue BMW" for
 *        spotters), the unread total that feeds the Inbox tab badge, the
 *        row's unread treatment, and the filter-chip model (All · Unread ·
 *        My cars · My sightings) with its per-filter empty-state copy.
 * WHY:   The context line is what anchors a conversation to a CAR (Airbnb
 *        anchors to a listing); its wording and the privacy split — the
 *        plate renders ONLY on the owner's own rows (their own plate),
 *        never on a spotter's — are product decisions worth pinning in
 *        tests without rendering. The filters are Airbnb's inbox chips
 *        translated: their categories become our owner-side/spotter-side
 *        split, with Unread as the workhorse. Filtering is CLIENT-side
 *        over the already-loaded list — the inbox is one RPC payload, and
 *        a filter must never cost a round trip.
 * LINKS: src/features/chat/components/ThreadRow.tsx,
 *        src/features/chat/screens/InboxScreen.tsx (consumers);
 *        src/shared/ui/appTabBarModel.ts (badge thresholds live there);
 *        docs/DESIGN_SYSTEM.md (PlateChip norms).
 */


import type { InboxThread } from '../types';

/* The Messages list is a FLAT array of threads as of 2026-09-04.
 *
 * What stood here was `groupThreadsByDay` and its `InboxDayRow` adapter, which
 * turned the list into day headers interleaved with rows so the two inbox faces
 * grouped time the same way and used the same words for it. Both faces dropped
 * grouping together — each row now carries its own `formatListStamp` — so the
 * adapter had no consumer left and went with it.
 *
 * Two rules died with it and are recorded because they were load-bearing while
 * they lived: group AFTER filtering (or a chip strands a header over a day it
 * emptied), and newest-first input (`groupByDay` opens a header only when the
 * label CHANGES, so out-of-order input printed a day twice).
 *
 * `groupByDay` in shared/lib is untouched — MySightingsScreen still uses it.
 */

/** The inbox filter chips, in display order. */
export type InboxFilter = 'all' | 'unread' | 'my_cars' | 'my_sightings';

export const INBOX_FILTERS: InboxFilter[] = ['all', 'unread', 'my_cars', 'my_sightings'];

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

/**
 * Row preview: the denormalised last message, or a calm fallback.
 *
 * ⚠️ THE FALLBACK IS THE LIVE PATH NOW, not belt-and-braces as this said until
 * 2026-08-29. Threads used to open with a system message that seeded a preview,
 * so NULL was theoretical; `open_thread` no longer writes one, and a thread
 * nobody has spoken in genuinely has no preview. The migration that made that
 * change cites this fallback as the reason it was safe to do.
 */
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

/** Apply one filter chip. Order is preserved — the RPC already sorts by
 *  newest activity, and a filter must never reshuffle. */
export function filterThreads(threads: InboxThread[], filter: InboxFilter): InboxThread[] {
  switch (filter) {
    case 'unread':
      return threads.filter(isUnread);
    // "My cars" = threads where I am the OWNER (spotters wrote to me about my
    // car); "My sightings" = threads where I am the SPOTTER. The same role
    // field that drives the plate privacy split drives this — one source.
    case 'my_cars':
      return threads.filter((thread) => thread.role === 'owner');
    case 'my_sightings':
      return threads.filter((thread) => thread.role === 'spotter');
    default:
      return threads;
  }
}

/** Chip label, with the live unread count on the Unread chip ("Unread (3)").
 *  Zero drops the count — "Unread (0)" reads as a bug, not a state. */
export function filterLabel(filter: InboxFilter, threads: InboxThread[]): string {
  switch (filter) {
    case 'unread': {
      const count = threads.filter(isUnread).length;
      return count > 0 ? `Unread (${count})` : 'Unread';
    }
    case 'my_cars':
      return 'My cars';
    case 'my_sightings':
      return 'My sightings';
    default:
      return 'All';
  }
}

/** Per-filter empty copy. An empty Unread is GOOD NEWS and must read like
 *  it; an empty role filter explains how that side of the split begins.
 *  Only shown when the unfiltered list is non-empty — a truly empty inbox
 *  keeps the original invitation EmptyState. */
export function emptyFilterCopy(filter: InboxFilter): { title: string; body: string } {
  switch (filter) {
    case 'unread':
      return {
        title: 'All caught up',
        body: 'No unread messages — nice. New replies will appear here.',
      };
    case 'my_cars':
      return {
        title: 'No messages about your cars',
        body: 'When a spotter reports a sighting on one of your posts, their conversation shows here.',
      };
    case 'my_sightings':
      return {
        title: 'No messages about your sightings',
        body: 'Report a sighting on a post and the owner can message you here.',
      };
    default:
      // Unreachable from the UI (the screen shows filter-empties only when
      // the unfiltered list is non-empty, and 'all' is the identity) — kept
      // for exhaustiveness, deliberately duplicating the invitation copy.
      return {
        title: 'No conversations yet',
        body: 'Conversations open when a spotter reports a sighting on your car — or when you report one.',
      };
  }
}
