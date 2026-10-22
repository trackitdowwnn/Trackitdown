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
 *        Fast first (eight looks, 1.5s apart, as ChangeRewardScreen), then
 *        quiet: every 10s for ten minutes while the page is open. Live: a
 *        light haptic, one announcement, and `onLive` reloads the listing so
 *        the badge becomes "Live". Unmounting stops it; the listing still goes
 *        live by itself.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (the user);
 *        src/shared/ui/StatusBadge.tsx (GoingLivePhase);
 *        src/features/payments (syncPostPayment); ../post/api/postApi.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { syncPostPayment } from '@/features/payments';
import { lightHaptic } from '@/shared/lib/haptics';
import type { GoingLivePhase } from '@/shared/ui';

import { fetchMyPostStatus } from '../post/api/postApi';

/** As ChangeRewardScreen: eight looks, 1.5s apart — about twelve seconds. */
export const CONFIRM_ATTEMPTS = 8;
export const CONFIRM_INTERVAL_MS = 1500;
/** The fast looks before which the server asks Stripe itself: once the
 *  webhook has had a fair chance (~4.5s), and once more before "slow". */
export const SYNC_BEFORE_ATTEMPTS: readonly number[] = [3, CONFIRM_ATTEMPTS - 1];
/** Then quietly: every 10s for ten minutes, asking Stripe every third look. */
export const SLOW_INTERVAL_MS = 10_000;
export const SLOW_ATTEMPTS = 60;
export const SLOW_SYNC_EVERY = 3;

/** Queued, so it never cuts across a screen reader landing on the page. */
const announce = (message: string) =>
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useGoingLive(
  postId: string,
  { watching, onLive }: { watching: boolean; onLive: () => void },
): GoingLivePhase | null {
  const [phase, setPhase] = useState<GoingLivePhase>('confirming');
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  });

  useEffect(() => {
    if (!watching) return undefined;
    let cancelled = false;
    announce('Payment received. Your car is going live.');
    (async () => {
      for (let look = 0; look < CONFIRM_ATTEMPTS + SLOW_ATTEMPTS; look += 1) {
        const fast = look < CONFIRM_ATTEMPTS;
        // Look first: the webhook has often landed by the time the page opens.
        if (look > 0) {
          await wait(fast ? CONFIRM_INTERVAL_MS : SLOW_INTERVAL_MS);
          if (cancelled) return;
        }
        if (look === CONFIRM_ATTEMPTS) {
          setPhase('slow');
          announce('Going live soon. It goes live by itself.');
        }
        const ask = fast
          ? SYNC_BEFORE_ATTEMPTS.includes(look)
          : (look - CONFIRM_ATTEMPTS) % SLOW_SYNC_EVERY === 0;
        if (ask) {
          await syncPostPayment(postId); // never throws
          if (cancelled) return;
        }
        // A failed read is a blip, not a failed payment: keep looking.
        const status = await fetchMyPostStatus(postId);
        if (cancelled) return;
        if (status === 'active') {
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
