/**
 * WHAT:  devSampleImages — DEV-ONLY sample car photos for posts that have no
 *        uploaded images yet, so the feed cards and detail hero can be viewed
 *        with real pictures during development. Returns [] in production.
 * WHY:   The photo-upload pipeline isn't built, so seeded posts carry empty
 *        photo lists and every surface shows the placeholder. These Unsplash
 *        car images (free licence; Unsplash permits hotlinking their CDN) let
 *        us see the real layouts. Assignment is DETERMINISTIC per post id, so
 *        a given car shows the SAME shots in the feed and on its detail page,
 *        and several distinct ones each ("multiple per post").
 * LINKS: src/features/search-map/api/feedApi.ts (feed cards);
 *        src/features/vehicles/api/vehicleApi.ts (detail hero);
 *        src/shared/types/posts.ts (PostPhoto).
 */

/** Unsplash transform params: auto webp, cropped, ~1000w (feed downsamples). */
const SIZE = '?auto=format&fit=crop&w=1000&q=70';

/** Real Unsplash car photos (search "car"), base URLs only. */
const BASE_URLS = [
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70',
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7',
  'https://images.unsplash.com/photo-1542362567-b07e54358753',
  'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf',
  'https://images.unsplash.com/photo-1511919884226-fd3cad34687c',
  'https://images.unsplash.com/photo-1580273916550-e323be2ae537',
  'https://images.unsplash.com/photo-1494976388531-d1058494cdd8',
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7',
  'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0',
  'https://images.unsplash.com/photo-1459603677915-a62079ffd002',
];

const SAMPLE = BASE_URLS.map((url) => url + SIZE);

/** Stable non-crypto hash of the post id → a start offset into SAMPLE. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Sample photos for one post — DEV only, [] in production. Deterministic per
 * id: the same post always yields the same distinct set (default 4).
 */
export function samplePhotos(id: string, count = 4): { uri: string }[] {
  // DEV app only — never in production, and never under jest (tests assert
  // the real photo mapping, which is empty until the upload pipeline lands).
  if (!__DEV__ || process.env.NODE_ENV === 'test') {
    return [];
  }
  const start = hashId(id) % SAMPLE.length;
  return Array.from({ length: Math.min(count, SAMPLE.length) }, (_, k) => ({
    uri: SAMPLE[(start + k) % SAMPLE.length],
  }));
}
