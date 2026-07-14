/**
 * WHAT:  Profile feature configuration — the payouts-row feature flag and the
 *        support address. (Legal link URLs moved to shared/lib/legal.ts now
 *        that the auth flow needs them too.)
 * WHY:   The payouts row ships dark until Phase 3's payments feature exists
 *        (flip PAYOUTS_ENABLED then).
 * LINKS: src/features/profile/screens/ProfileScreen.tsx (consumer);
 *        src/shared/lib/legal.ts (LEGAL_URLS); docs/ROADMAP.md (Legal).
 */

/** Flip when the Phase 3 payments feature (Stripe Connect UI) lands. */
export const PAYOUTS_ENABLED = false;

export const SUPPORT_EMAIL = 'support@trackitdown.example'; // TODO(legal)
