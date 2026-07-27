/**
 * WHAT:  Public surface of the payments feature — the bounty escrow charge and
 *        the deactivate/refund path.
 * WHY:   Other features import from '@/features/payments' and never reach into
 *        its api/hooks folders (feature-boundary rule, docs/ARCHITECTURE.md).
 * LINKS: src/features/payments/api/paymentsApi.ts,
 *        src/features/payments/hooks/useBountyPayment.ts,
 *        src/features/payments/hooks/useDeactivatePost.ts,
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
