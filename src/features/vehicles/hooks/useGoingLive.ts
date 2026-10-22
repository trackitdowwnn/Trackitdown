/**
 * WHAT:  useGoingLive — watches a just-paid listing until the server makes it
 *        live, for the badge where "Live" will be ('confirming' → a spinner,
 *        'slow' → "Going live soon"). Null when not watching.
 * WHY:   Owner, 2026-10-22: no confirmation page after paying — straight to
 *        the listing, with a loading indicator in the Live badge's place.
 *        This is that page's watch, moved: the listing goes live only when the
 *        SERVER says so (webhook, or sync-post-payment asking Stripe), so the
 *        badge reads the post's status, never assumes.
 *
 *        ⚠️ THE SYNC IS THE SAFETY NET. On 2026-10-22 a wrong webhook secret
 *        left only sync-post-payment to make a real paid listing live. So the
 *        wizard asks once the moment the sheet says paid (PostACarScreen), and
 *        this asks again before saying "slow" and every 30s after.
 *
 *        ⚠️ ONLY WHILE THE LOADED POST IS A DRAFT (code review, 2026-10-22).
 *        Not before it has loaded (nothing to announce over), and never again
 *        once it has been live: a live post never returns to draft, so a
 *        later cancel or recovery (still on the `?paid=1` route) can't bring
 *        "Going live" back over it.
 *
 *        Fast first (eight looks, 1.5s apart, as ChangeRewardScreen), then
 *        quiet: every 10s for ten minutes while the screen is mounted. Live: a
 *        light haptic, one announcement, and `onLive` reloads the listing so
 *        the badge becomes "Live" — also said when the first load is already
 *        live (the webhook beat the page). Unmounting stops it; the listing
 *        still goes live by itself.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (the user);
 *        src/shared/ui/StatusBadge.tsx (GoingLivePhase);
 *        src/features/payments (syncPostPayment); ../post/api/postApi.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { syncPostPayment } from '@/features/payments';
import { lightHaptic } from '@/shared/lib/haptics';
import type { PostStatus } from '@/shared/types';
import type { GoingLivePhase } from '@/shared/ui';

import { fetchMyPostStatus } from '../post/api/postApi';

/** As ChangeRewardScreen: eight looks, 1.5s apart — about twelve seconds. */
export const CONFIRM_ATTEMPTS = 8;
export const CONFIRM_INTERVAL_MS = 1500;
/** The fast looks before which the server asks Stripe itself: once the
 *  webhook has had a fair chance (~4.5s), and once more before "slow". */
export const SYNC_BEFORE_ATTEMPTS: readonly number[] = [3, CONFIRM_ATTEMPTS - 1];
/** The quiet looks after "slow": one every 10s… */
export const SLOW_INTERVAL_MS = 10_000;
/** …for ten minutes… */
export const SLOW_ATTEMPTS = 60;
/** …asking Stripe on every third (every 30s), starting with the first. */
export const SLOW_SYNC_EVERY = 3;

/** Queued, so it never cuts across a screen reader landing on the page
 *  (iOS; Android ignores the option). */
const announce = (message: string) =>
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The watch for a listing the owner has just paid for.
 *
 * @param postId   the listing
 * @param justPaid arrived straight from paying (`?paid=1`); false → never watches
 * @param status   the loaded post's status, or null while it loads
 * @param onLive   called once when the server says it is live (reload the page)
 * @returns 'confirming' or 'slow' while watching a paid draft, else null
 */
export function useGoingLive(
  postId: string,
  {
    justPaid,
    status,
    onLive,
  }: { justPaid: boolean; status: PostStatus | null; onLive: () => void },
): GoingLivePhase | null {
  const [phase, setPhase] = useState<GoingLivePhase>('confirming');
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  });
  // Each said once per visit, however often the watch restarts.
  const paidSaidRef = useRef(false);
  const liveSaidRef = useRef(false);

  const watching = justPaid && status === 'draft';

  // The webhook beat the page: the first load is already live. Still say so.
  useEffect(() => {
    if (justPaid && status === 'active' && !liveSaidRef.current) {
      liveSaidRef.current = true;
      lightHaptic();
      announce('Your car is live.');
    }
  }, [justPaid, status]);

  useEffect(() => {
    if (!watching) return undefined;
    let cancelled = false;
    if (!paidSaidRef.current) {
      paidSaidRef.current = true;
      announce('Payment received. Your car is going live.');
    }
    (async () => {
      setPhase('confirming');
      for (let look = 0; look < CONFIRM_ATTEMPTS + SLOW_ATTEMPTS; look += 1) {
        const fast = look < CONFIRM_ATTEMPTS;
        // Look first: the webhook has often landed by the time the page opens.
        if (look > 0) {
          await wait(fast ? CONFIRM_INTERVAL_MS : SLOW_INTERVAL_MS);
          if (cancelled) return;
        }
        if (look === CONFIRM_ATTEMPTS) {
          setPhase('slow');
          announce('Going live soon.');
        }
        const ask = fast
          ? SYNC_BEFORE_ATTEMPTS.includes(look)
          : (look - CONFIRM_ATTEMPTS) % SLOW_SYNC_EVERY === 0;
        if (ask) {
          await syncPostPayment(postId); // never throws
          if (cancelled) return;
        }
        // A failed read is a blip, not a failed payment: keep looking.
        const fresh = await fetchMyPostStatus(postId);
        if (cancelled) return;
        if (fresh === 'active') {
          liveSaidRef.current = true;
          lightHaptic();
          announce('Your car is live.');
          onLiveRef.current();
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, watching]);

  return watching ? phase : null;
}
