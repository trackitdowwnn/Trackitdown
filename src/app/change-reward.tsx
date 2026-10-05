/**
 * WHAT:  Route /change-reward?postId=…&mode=change|add — the owner changes the
 *        reward on their live listing, or adds one to a £5 fee listing.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3). Wrapped in
 *        BountyPaymentProvider because the screen presents Stripe's
 *        PaymentSheet — scoped here, like /post-a-car, so the native module is
 *        only engaged where money is taken. Flat route, matching
 *        /recover-post and /post-stats. `mode` is only a hint so the title is
 *        right before the reward status loads; the server's answer wins.
 * LINKS: src/features/payments/screens/ChangeRewardScreen.tsx;
 *        src/features/payments/BountyPaymentProvider.tsx;
 *        src/features/vehicles/components/PostOwnerActions.tsx (opens it).
 */

import { useLocalSearchParams } from 'expo-router';

import { BountyPaymentProvider, ChangeRewardScreen } from '@/features/payments';

export default function ChangeRewardRoute() {
  const { postId, mode } = useLocalSearchParams<{ postId: string; mode?: string }>();
  return (
    <BountyPaymentProvider>
      <ChangeRewardScreen
        postId={postId}
        initialMode={mode === 'add' || mode === 'change' ? mode : undefined}
      />
    </BountyPaymentProvider>
  );
}
