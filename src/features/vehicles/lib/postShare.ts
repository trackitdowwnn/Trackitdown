/**
 * WHAT:  buildSharePayload — the native-share text + URL for a post: colour,
 *        make/model, plate, and last-seen area, plus a placeholder web URL.
 * WHY:   Pure and separate from the screen so the payload shape is unit-tested
 *        (SECURITY_AND_TRUST: shares carry the plate + area, never a spotter's
 *        details). The URL is a placeholder until Phase-4 deep links exist.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (Share.share);
 *        src/features/vehicles/lib/postShare.test.ts.
 */

import type { PostDetail } from '../types';

// TODO(phase-4 deep links): replace with a real universal link to the post.
const SHARE_BASE_URL = 'https://trackitdown.app/post/';

export interface SharePayload {
  message: string;
  url: string;
}

export function buildSharePayload(post: PostDetail): SharePayload {
  const url = `${SHARE_BASE_URL}${post.id}`;
  const area = post.lastSeenArea ? ` Last seen near ${post.lastSeenArea}.` : '';
  const message = `Stolen ${post.colour} ${post.make} ${post.model} (${post.plate}).${area} ${url}`;
  return { message, url };
}
