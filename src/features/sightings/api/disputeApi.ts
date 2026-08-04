/**
 * WHAT:  The spotter's dispute boundary — read what the dispute screen may
 *        know (`my_dispute_context`) and file the one dispute a sighting gets
 *        (`open_dispute`).
 * WHY:   The owner-denial control (DOMAIN.md Disputes): when a post a spotter
 *        sighted closes without crediting anyone, the refund is held 72 hours
 *        and this is the spotter's lever. The server answers every refusal —
 *        not yours, window closed, money moved, already filed — with the ONE
 *        token DISPUTE_NOT_AVAILABLE, so this file deliberately cannot tell
 *        those apart either: the screen shows the same calm "this window has
 *        closed" for all of them, and no probing surface exists.
 * LINKS: supabase/migrations/20260805100000_refund_holds_and_disputes.sql
 *          (both RPCs and the no-oracle rule);
 *        ../screens/SightingDisputeScreen.tsx (the only consumer);
 *        docs/SECURITY_AND_TRUST.md (owner-denial control).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('sightings');

/** What the screen may know. Car as the spotter already saw it — no owner
 *  identity, no location, no plate ever crosses this boundary. */
export interface DisputeContext {
  car: { make: string | null; colour: string | null };
  windowEndsAt: string;
  /** The spotter's 95% share, or null once the money has moved. */
  bountySharePence: number | null;
  dispute: { status: 'open' | 'upheld' | 'rejected'; createdAt: string } | null;
}

export class DisputeError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DisputeError';
    this.code = code;
  }
}

const FALLBACK = 'Something went wrong. Please try again.';

/**
 * The screen's read. Returns null when the server says DISPUTE_NOT_AVAILABLE —
 * for the context read that means "there is nothing here for you" (no hold,
 * not your sighting), which the screen renders as the window-closed state
 * rather than an error.
 */
export async function fetchDisputeContext(sightingId: string): Promise<DisputeContext | null> {
  const { data, error } = await supabase.rpc('my_dispute_context', {
    p_sighting_id: sightingId,
  });
  if (error) {
    if (error.message.includes('DISPUTE_NOT_AVAILABLE')) {
      return null;
    }
    log.warn('dispute context load failed', { code: error.code });
    throw new DisputeError('We couldn’t load this. Please try again.', error.code ?? 'UNKNOWN');
  }
  const doc = data as {
    car?: { make?: string | null; colour?: string | null };
    windowEndsAt?: string;
    bountySharePence?: number | null;
    dispute?: { status?: string; createdAt?: string } | null;
  } | null;
  if (!doc?.windowEndsAt) {
    log.error('dispute context returned an unexpected shape');
    throw new DisputeError(FALLBACK, 'BAD_SHAPE');
  }
  return {
    car: { make: doc.car?.make ?? null, colour: doc.car?.colour ?? null },
    windowEndsAt: doc.windowEndsAt,
    bountySharePence: typeof doc.bountySharePence === 'number' ? doc.bountySharePence : null,
    dispute:
      doc.dispute?.status === 'open' ||
      doc.dispute?.status === 'upheld' ||
      doc.dispute?.status === 'rejected'
        ? { status: doc.dispute.status, createdAt: doc.dispute.createdAt ?? '' }
        : null,
  };
}

/**
 * File the dispute. The statement is optional and capped server-side at 500
 * characters; it is the spotter's own words for the human reviewing the trail.
 */
export async function openDispute(sightingId: string, statement: string): Promise<void> {
  const { error } = await supabase.rpc('open_dispute', {
    p_sighting_id: sightingId,
    p_statement: statement.trim() === '' ? null : statement.trim(),
  });
  if (error) {
    // The single token covers every refusal by design; anything else is a
    // transient failure worth retrying.
    if (error.message.includes('DISPUTE_NOT_AVAILABLE')) {
      log.info('dispute refused', { sightingId });
      throw new DisputeError(
        'This one can’t be contested any more — the window may have closed.',
        'DISPUTE_NOT_AVAILABLE',
      );
    }
    log.warn('open_dispute failed', { code: error.code });
    throw new DisputeError('We couldn’t send this. Please try again.', error.code ?? 'UNKNOWN');
  }
  log.info('dispute filed', { sightingId });
}
