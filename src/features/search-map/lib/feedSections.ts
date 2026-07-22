/**
 * WHAT:  Pure feed-section logic — defensive empty-section dropping, the
 *        good-news empty / national-fallback display rules, flattening
 *        sections into the typed FlashList item list, and merging hero
 *        pagination pages.
 * WHY:   The feed renders ONE FlashList, so sections must flatten into a
 *        discriminated item union (type = getItemType recycling pool).
 *        Keeping every rule here as pure functions makes the composition
 *        testable without rendering anything (docs/TESTING.md Tier 2).
 * LINKS: src/features/search-map/types.ts;
 *        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
 *        (server-side composition these rules mirror defensively).
 */

import type { PostSummary } from '@/shared/types';

import type { FeedItem, FeedItemType, FeedSection } from '../types';

export const NEAR_YOU_SECTION_ID = 'near_you';
export const RECENT_UK_SECTION_ID = 'recent_uk';

/** The near_you title restated where no server section exists (good-news
 *  empty / error states) — keep in step with the RPC's section title. */
export const NEAR_YOU_FALLBACK_TITLE = 'Near you';

/** Defensive guard — the RPC omits empty sections, but never trust it. */
export function dropEmptySections(sections: FeedSection[]): FeedSection[] {
  return sections.filter((section) => section.posts.length > 0);
}

/**
 * How the loaded feed should present. `national` mode is a plain feed (the
 * recent_uk section IS the content); in local mode a missing near_you
 * section means "good news, nothing near you" — with the recent_uk fallback
 * section (if the RPC sent one) rendered beneath the empty state.
 */
export type FeedDisplay =
  | { kind: 'feed'; sections: FeedSection[] }
  | { kind: 'good-news-empty'; fallbackSections: FeedSection[] };

export function feedDisplay(sections: FeedSection[], mode: 'local' | 'national'): FeedDisplay {
  const nonEmpty = dropEmptySections(sections);
  if (mode === 'local' && !nonEmpty.some((s) => s.id === NEAR_YOU_SECTION_ID)) {
    // Nothing active nearby. Anything else the RPC sent (recent_uk fallback,
    // possibly a recovered carousel) renders under the good-news message.
    return { kind: 'good-news-empty', fallbackSections: nonEmpty };
  }
  return { kind: 'feed', sections: nonEmpty };
}

/**
 * Flatten sections into FlashList items. EVERY section contributes a header
 * (near_you's chevron opens the area picker — the screen's renderItem
 * special-cases the handler, not the look), then hero sections add one item
 * PER post (full-width cards recycle individually) and carousel sections
 * add ONE row item (the horizontal list).
 */
export function flattenSections(sections: FeedSection[]): FeedItem[] {
  const items: FeedItem[] = [];
  // Section ids SHOULD be unique, but area slugs can collide ("St. Helens" /
  // "St Helens" → the same slug) and duplicate FlashList keys are undefined
  // behaviour — so repeated ids get a per-occurrence suffix in their keys.
  const seenIds = new Map<string, number>();
  for (const section of dropEmptySections(sections)) {
    const occurrence = seenIds.get(section.id) ?? 0;
    seenIds.set(section.id, occurrence + 1);
    const keyId = occurrence === 0 ? section.id : `${section.id}~${occurrence}`;

    items.push({ type: 'sectionHeader', key: `header_${keyId}`, section });
    if (section.layout === 'hero-vertical') {
      for (const post of section.posts) {
        items.push({
          type: 'heroCard',
          key: `${keyId}_${post.id}`,
          sectionId: section.id,
          post,
        });
      }
    } else {
      items.push({ type: 'carouselRow', key: `row_${keyId}`, section });
    }
  }
  return items;
}

/** FlashList getItemType — one recycling pool per row shape. */
export function feedItemType(item: FeedItem): FeedItemType {
  return item.type;
}

/**
 * Render every section as a horizontal rail (the reference feed's layout —
 * stacked carousels, no vertical hero wall). The RPC still describes
 * near_you/recent_uk as hero-vertical; this client-side override is the
 * config-driven layer deciding presentation.
 */
export function asCarousels(sections: FeedSection[]): FeedSection[] {
  return sections.map((section) =>
    section.layout === 'carousel' ? section : { ...section, layout: 'carousel' as const },
  );
}

/**
 * Merge a pagination page into the near_you section, deduplicating by post
 * id (a post can drift between pages when the data changes under offset
 * pagination). Returns sections untouched when there is no near_you.
 */
export function appendHeroPage(sections: FeedSection[], page: PostSummary[]): FeedSection[] {
  return sections.map((section) => {
    if (section.id !== NEAR_YOU_SECTION_ID) {
      return section;
    }
    const seen = new Set(section.posts.map((post) => post.id));
    const fresh = page.filter((post) => !seen.has(post.id));
    return fresh.length === 0 ? section : { ...section, posts: [...section.posts, ...fresh] };
  });
}

/** How many hero posts are loaded (drives the next page's offset). */
export function heroPostCount(sections: FeedSection[]): number {
  return sections.find((s) => s.id === NEAR_YOU_SECTION_ID)?.posts.length ?? 0;
}
