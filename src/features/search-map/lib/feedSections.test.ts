/**
 * WHAT:  Tests for the pure feed-section logic — empty sections dropped,
 *        good-news/fallback display rules, flattening + item typing, hero
 *        page merging with dedup.
 * WHY:   These rules decide what the app's primary surface shows; a wrong
 *        branch here renders a dead feed or a sad empty carousel.
 * LINKS: src/features/search-map/lib/feedSections.ts, docs/TESTING.md.
 */

import type { PostSummary } from '@/shared/types';

import type { FeedSection } from '../types';
import {
  appendHeroPage,
  asCarousels,
  dropEmptySections,
  feedDisplay,
  feedItemType,
  flattenSections,
  heroPostCount,
} from './feedSections';

let nextId = 0;
const post = (overrides: Partial<PostSummary> = {}): PostSummary => ({
  id: `post-${nextId++}`,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
  ...overrides,
});

const section = (overrides: Partial<FeedSection> = {}): FeedSection => ({
  id: 'near_you',
  title: 'Near you',
  layout: 'hero-vertical',
  posts: [post(), post()],
  ...overrides,
});

describe('dropEmptySections', () => {
  it('removes sections with no posts and keeps order', () => {
    const sections = [
      section({ id: 'near_you' }),
      section({ id: 'area_salford', layout: 'carousel', posts: [] }),
      section({ id: 'highest_bounties', layout: 'carousel' }),
    ];

    expect(dropEmptySections(sections).map((s) => s.id)).toEqual([
      'near_you',
      'highest_bounties',
    ]);
  });
});

describe('feedDisplay', () => {
  it('is a normal feed when near_you has posts in local mode', () => {
    const display = feedDisplay([section()], 'local');

    expect(display.kind).toBe('feed');
  });

  it('is good-news-empty in local mode without near_you, carrying fallbacks', () => {
    const fallback = section({ id: 'recent_uk', title: 'Recent posts across the UK' });
    const display = feedDisplay([fallback], 'local');

    expect(display).toEqual({ kind: 'good-news-empty', fallbackSections: [fallback] });
  });

  it('treats an all-empty local feed as good-news-empty with no fallbacks', () => {
    const display = feedDisplay([section({ posts: [] })], 'local');

    expect(display).toEqual({ kind: 'good-news-empty', fallbackSections: [] });
  });

  it('renders national mode as a plain feed (recent_uk IS the content)', () => {
    const display = feedDisplay([section({ id: 'recent_uk' })], 'national');

    expect(display.kind).toBe('feed');
  });
});

describe('flattenSections', () => {
  it('flattens hero posts individually and carousels as one row, typed for recycling', () => {
    const hero = section({ id: 'near_you', posts: [post({ id: 'a' }), post({ id: 'b' })] });
    const carousel = section({
      id: 'area_salford',
      title: 'Recently stolen in Salford',
      layout: 'carousel',
      area: 'Salford',
    });

    const items = flattenSections([hero, carousel]);

    expect(items.map((i) => i.type)).toEqual([
      'sectionHeader', // near_you's header renders as the tappable area header
      'heroCard',
      'heroCard',
      'sectionHeader',
      'carouselRow',
    ]);
    expect(items.map(feedItemType)).toEqual(items.map((i) => i.type));
    expect(items.map((i) => i.key)).toEqual([
      'header_near_you',
      'near_you_a',
      'near_you_b',
      'header_area_salford',
      'row_area_salford',
    ]);
  });

  it('gives non-near_you hero sections a header (recent_uk fallback)', () => {
    const items = flattenSections([
      section({ id: 'recent_uk', title: 'Recent posts across the UK', posts: [post({ id: 'a' })] }),
    ]);

    expect(items.map((i) => i.type)).toEqual(['sectionHeader', 'heroCard']);
  });

  it('skips empty sections entirely — no orphan headers', () => {
    const items = flattenSections([
      section({ id: 'area_bury', layout: 'carousel', posts: [] }),
    ]);

    expect(items).toEqual([]);
  });

  it('disambiguates keys when two sections share an id (slug collision)', () => {
    const items = flattenSections([
      section({ id: 'area_st-helens', title: 'Recently stolen in St. Helens', layout: 'carousel' }),
      section({ id: 'area_st-helens', title: 'Recently stolen in St Helens', layout: 'carousel' }),
    ]);

    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length); // all unique
    expect(keys).toEqual([
      'header_area_st-helens',
      'row_area_st-helens',
      'header_area_st-helens~1',
      'row_area_st-helens~1',
    ]);
  });
});

describe('asCarousels', () => {
  it('renders every section as a rail, leaving carousel sections untouched', () => {
    const hero = section({ id: 'near_you' });
    const rail = section({ id: 'area_salford', layout: 'carousel' });

    const result = asCarousels([hero, rail]);

    expect(result.map((s) => s.layout)).toEqual(['carousel', 'carousel']);
    expect(result[1]).toBe(rail); // untouched reference
    // Flattening a converted feed yields header+row pairs only — no heroCards.
    expect(flattenSections(result).map((i) => i.type)).toEqual([
      'sectionHeader',
      'carouselRow',
      'sectionHeader',
      'carouselRow',
    ]);
  });
});

describe('appendHeroPage', () => {
  it('appends new posts to near_you and dedupes by id', () => {
    const sections = [
      section({ id: 'near_you', posts: [post({ id: 'a' }), post({ id: 'b' })] }),
      section({ id: 'highest_bounties', layout: 'carousel' }),
    ];

    const merged = appendHeroPage(sections, [post({ id: 'b' }), post({ id: 'c' })]);

    expect(merged[0].posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1]).toBe(sections[1]); // other sections untouched
    expect(heroPostCount(merged)).toBe(3);
  });

  it('returns sections unchanged when there is no near_you section', () => {
    const sections = [section({ id: 'recent_uk' })];

    expect(appendHeroPage(sections, [post()])).toEqual(sections);
    expect(heroPostCount(sections)).toBe(0);
  });
});
