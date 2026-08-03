/**
 * WHAT:  Public surface of the payments feature — both halves of the money
 *        loop: the owner's bounty escrow (charge, deactivate/refund) and the
 *        spotter's payee account (Connect onboarding).
 * WHY:   Other features import from '@/features/payments' and never reach into
 *        its api/hooks folders (feature-boundary rule, docs/ARCHITECTURE.md).
 * LINKS: src/features/payments/api/paymentsApi.ts,
 *        src/features/payments/api/payoutsApi.ts,
 *        src/features/payments/hooks/useBountyPayment.ts,
 *        src/features/payments/hooks/useDeactivatePost.ts,
 *        src/features/payments/screens/PayoutsScreen.tsx,
 *        src/features/payments/BountyPaymentProvider.tsx.
 */

export { BountyPaymentProvider } from './BountyPaymentProvider';
export {
  CREATE_PAYMENT_ERROR_MESSAGES,
  DEACTIVATE_ERROR_MESSAGES,
  PaymentError,
  createBountyPaymentIntent,
  deactivatePost,
  type DeactivateResult,
} from './api/paymentsApi';
export {
  useBountyPayment,
  type BountyPaymentOutcome,
  type BountyPaymentResult,
} from './hooks/useBountyPayment';
export { useDeactivatePost, type DeactivateOutcome } from './hooks/useDeactivatePost';
export {
  PAYOUT_ONBOARDING_ERROR_MESSAGES,
  fetchMyPayoutAccount,
  startConnectOnboarding,
  type ConnectOnboardingResult,
  type PayoutAccount,
} from './api/payoutsApi';
export {
  usePayoutAccount,
  type PayoutAccountState,
  type PayoutAccountStatus,
} from './hooks/usePayoutAccount';
export { PayoutsScreen } from './screens/PayoutsScreen';
