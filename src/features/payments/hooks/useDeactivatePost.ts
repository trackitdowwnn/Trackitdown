/**
 * WHAT:  A hook that drives deactivating a paid post + refunding its bounty.
 *        Exposes `deactivate(postId)` and an in-flight `pending` flag; resolves
 *        with a coarse outcome — 'done' (with the server's refund figures) or
 *        'failed' (with a user-facing message). Never throws.
 * WHY:   The screen shouldn't know the Edge Function's shape or juggle the
 *        try/catch + loading flag. This wraps paymentsApi.deactivatePost into one
 *        call the detail screen maps cleanly: 'done' toasts the exact refund and
 *        refetches; 'failed' toasts the message. Mirrors useBountyPayment's
 *        coarse-result shape.
 * LINKS: src/features/payments/api/paymentsApi.ts (deactivatePost, PaymentError);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (consumer).
 */

import { useCallback, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';

import { PaymentError, deactivatePost, type DeactivateResult } from '../api/paymentsApi';

const log = createLogger('payments');

const DEACTIVATE_FAILED_MESSAGE = 'We couldn’t deactivate your listing. Please try again.';

export type DeactivateOutcome =
  | { outcome: 'done'; result: Extract<DeactivateResult, { held: false }>; message: null }
  /** The listing is down; the refund waits out the dispute window. */
  | { outcome: 'held'; refundAfter: string; message: null }
  | { outcome: 'failed'; result: null; message: string; code: string };

export function useDeactivatePost() {
  const [pending, setPending] = useState(false);

  const deactivate = useCallback(
    async (postId: string, attestedSightingIds?: string[]): Promise<DeactivateOutcome> => {
      setPending(true);
      try {
        const result = await deactivatePost(postId, attestedSightingIds);
        if (result.held) {
          return { outcome: 'held', refundAfter: result.refundAfter, message: null };
        }
        return { outcome: 'done', result, message: null };
      } catch (err) {
        const message = err instanceof PaymentError ? err.message : DEACTIVATE_FAILED_MESSAGE;
        const code = err instanceof PaymentError ? err.code : 'UNKNOWN';
        log.warn('deactivate failed', { code });
        // The code rides along so the screen can react to ATTESTATION_STALE
        // (re-run the pre-flight) without string-matching the copy.
        return { outcome: 'failed', result: null, message, code };
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { deactivate, pending };
}
