/**
 * WHAT:  buildSharePayload — the native-share text for a post: colour,
 *        make/model, plate, and last-seen area, plus a web link to the post
 *        WHEN ONE EXISTS.
 * WHY:   Pure and separate from the screen so the payload shape is unit-tested
 *        (SECURITY_AND_TRUST: shares carry the plate + area, never a spotter's
 *        details).
 *
 * ⚠️ THE URL IS OPTIONAL, AND TODAY THERE ISN'T ONE. This file used to append
 *        `https://trackitdown.app/post/<id>` to every share. We do not own that
 *        domain and nothing resolves there, so every post anyone had ever
 *        shared carried a link to a browser error. That is the worst possible
 *        place for one: the recipient is a stranger being asked to help look
 *        for a stolen car, and the first thing the app does is hand them
 *        something broken. `publicPostUrl` returns `null` until the domain
 *        exists, and this builder simply omits the link — the car's
 *        description is the part that was doing the work anyway, and it pastes
 *        into a local Facebook group perfectly well on its own.
 *
 * ⚠️ NO `trackitdown://` FALLBACK. A custom scheme is unclickable in most
 *        messaging apps and useless to anyone who does not already have the app
 *        installed — which is everyone a share is trying to reach. It would put
 *        a second broken link where the first one was.
 *
 * ⚠️ `url` IS iOS-ONLY IN React Native's Share API — Android reads `message`
 *        alone. That is why the link is also interpolated into the text rather
 *        than passed only as a field; drop it from the message and Android
 *        shares stop carrying it at all.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (Share.share);
 *        src/shared/lib/publicSite.ts (whether a link exists at all);
 *        src/features/vehicles/lib/postShare.test.ts.
 */

import { publicPostUrl } from '@/shared/lib/publicSite';

import type { PostDetail } from '../types';

export interface SharePayload {
  message: string;
  /** Absent while we have no website — see the header. */
  url?: string;
}

export function buildSharePayload(post: PostDetail, url = publicPostUrl(post.id)): SharePayload {
  const area = post.lastSeenArea ? ` Last seen near ${post.lastSeenArea}.` : '';
  // Plate is optional (a car can be reported without one) — omit the "(...)"
  // rather than share a literal "(null)".
  const plate = post.plate ? ` (${post.plate})` : '';
  // With no link, the share still has to say where it came from — otherwise it
  // is an unattributed claim about someone's car. Attribution is not a link and
  // does not pretend to be one.
  const tail = url ? ` ${url}` : ' Reported on Trackitdown.';
  const message = `Stolen ${post.colour} ${post.make} ${post.model}${plate}.${area}${tail}`;

  return url ? { message, url } : { message };
}
