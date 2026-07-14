/**
 * WHAT:  Legal link targets (Terms, Privacy Policy, Safety Guidelines) —
 *        centralised URLs opened via expo-web-browser.
 * WHY:   Two features now surface these links (auth's sign-in legal line and
 *        the profile screen), so the URLs live in shared/lib rather than inside
 *        one feature (ARCHITECTURE: features never deep-import each other).
 *        Placeholders until launch legal lands (ROADMAP.md) — a one-file change.
 * LINKS: src/features/auth/components/AuthLegalNotice.tsx,
 *        src/features/profile/screens/ProfileScreen.tsx (consumers);
 *        docs/ROADMAP.md (Legal: T&Cs, privacy policy, safety guidelines).
 */

// TODO(legal): replace placeholders before launch (ROADMAP.md legal item).
export const LEGAL_URLS = {
  safetyGuidelines: 'https://trackitdown.example/safety', // TODO(legal)
  terms: 'https://trackitdown.example/terms', // TODO(legal)
  privacyPolicy: 'https://trackitdown.example/privacy', // TODO(legal)
} as const;
