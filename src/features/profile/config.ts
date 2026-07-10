/**
 * WHAT:  Profile feature configuration — the payouts-row feature flag,
 *        support/legal link targets, and the support address.
 * WHY:   The payouts row ships dark until Phase 3's payments feature exists
 *        (flip PAYOUTS_ENABLED then); legal URLs are centralised with TODO
 *        placeholders so launch legal (ROADMAP.md) is a one-file change.
 * LINKS: src/features/profile/screens/ProfileScreen.tsx (consumer);
 *        docs/ROADMAP.md (Legal: T&Cs, privacy policy, safety guidelines).
 */

/** Flip when the Phase 3 payments feature (Stripe Connect UI) lands. */
export const PAYOUTS_ENABLED = false;

// TODO(legal): replace placeholders before launch (ROADMAP.md legal item).
export const LEGAL_URLS = {
  safetyGuidelines: 'https://trackitdown.example/safety', // TODO(legal)
  terms: 'https://trackitdown.example/terms', // TODO(legal)
  privacyPolicy: 'https://trackitdown.example/privacy', // TODO(legal)
} as const;

export const SUPPORT_EMAIL = 'support@trackitdown.example'; // TODO(legal)
