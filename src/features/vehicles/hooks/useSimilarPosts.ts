/**
 * WHAT:  useSimilarPosts — loads the posts for the detail page's "More stolen
 *        cars nearby" rail: the home-feed RPC centred on THIS post's
 *        last-seen point (or the UK-wide recent feed when the post has no
 *        coords), flattened, deduped, minus the post itself, capped at 6.
 * WHY:   The reference's "More stays nearby" is location-driven — ours reuses
 *        the existing public feed pipeline (same visibility rules, same
 *        payload, zero new server surface) rather than a bespoke similarity
 *        RPC. Failure is quiet: the rail simply doesn't render — a broken
 *        suggestions shelf must never error a page the user came to read.
 * LINKS: src/features/search-map (fetchHomeFeed);
 *        src/features/vehicles/components/PostDetailBody.tsx (the rail).
 */

import { useEffect, useState } from 'react';

import { fetchHomeFeed } from '@/features/search-map';
import type { PostSummary } from '@/shared/types';

/** Same neighbourhood scale as the home feed's near-you sections. */
const SIMILAR_RADIUS_MILES = 30;
const SIMILAR_CAP = 6;

export interface UseSimilarPostsResult {
  status: 'loading' | 'ready';
  posts: PostSummary[];
}

export function useSimilarPosts(
  postId: string,
  lat: number | undefined,
  lng: number | undefined,
  /** Fetch only once the post itself is visible — avoids a wasted coordless
   *  round trip that would be replaced when the detail (and coords) land. */
  enabled: boolean,
): UseSimilarPostsResult {
  const [state, setState] = useState<UseSimilarPostsResult>({ status: 'loading', posts: [] });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    fetchHomeFeed({
      latitude: lat ?? null,
      longitude: lng ?? null,
      radiusMiles: SIMILAR_RADIUS_MILES,
    })
      .then((sections) => {
        if (cancelled) {
          return;
        }
        const seen = new Set<string>([postId]);
        const posts: PostSummary[] = [];
        for (const section of sections) {
          for (const post of section.posts) {
            if (!seen.has(post.id) && posts.length < SIMILAR_CAP) {
              seen.add(post.id);
              posts.push(post);
            }
          }
        }
        setState({ status: 'ready', posts });
      })
      .catch(() => {
        // Quiet failure: the rail is a bonus, never an error surface.
        if (!cancelled) {
          setState({ status: 'ready', posts: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [postId, lat, lng, enabled]);

  return state;
}
