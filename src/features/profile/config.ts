/**
 * WHAT:  Profile feature configuration — the payouts-row feature flag and the
 *        support address. (Legal link URLs moved to shared/lib/legal.ts now
 *        that the auth flow needs them too.)
 * WHY:   The payouts row shipped dark from 2026-07-10 until 2026-08-03, when
 *        the Stripe Connect UI landed and there was finally something behind
 *        it to reach.
 * LINKS: src/features/profile/screens/ProfileScreen.tsx (consumer);
 *        src/features/payments/screens/PayoutsScreen.tsx (what it opens);
 *        src/shared/lib/legal.ts (LEGAL_URLS); docs/ROADMAP.md (Legal).
 */

/**
 * The payouts row. ON since 2026-08-03.
 *
 * Kept as a flag rather than deleted because it is now a KILL SWITCH: the
 * screen behind it depends on Stripe Connect being correctly configured on the
 * platform account, and if that ever breaks, hiding the row is a one-line
 * change that beats sending spotters into a flow that cannot complete.
 */
export const PAYOUTS_ENABLED = true;

export const SUPPORT_EMAIL = 'support@trackitdown.example'; // TODO(legal)
