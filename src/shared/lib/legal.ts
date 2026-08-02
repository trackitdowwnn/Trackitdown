/**
 * WHAT:  Where the legal links go — in-app routes for Safety, Terms and
 *        Privacy, plus the public URLs those documents will ALSO be published
 *        at once a domain exists.
 * WHY:   Two features surface these links (auth's sign-in consent line and the
 *        profile screen), so the targets live in shared/lib rather than inside
 *        one feature (ARCHITECTURE: features never deep-import each other).
 *
 *        The links used to open `https://trackitdown.example/...` — `.example`
 *        is an IANA-reserved TLD that resolves to nothing, so every tap opened
 *        a browser error, including the "you agree to our Terms" line shown at
 *        sign-up. They now open the documents in-app, which needs no domain and
 *        can never drift from the version of the terms a user actually agreed
 *        to.
 *
 *        LEGAL_PUBLIC_URLS is still needed and still unset: the App Store and
 *        Play Console both require a publicly reachable privacy-policy URL,
 *        which an in-app screen cannot satisfy. Fill it in when the domain is
 *        registered and the same content is published there.
 * LINKS: src/features/legal/ (the documents + the screen);
 *        src/features/auth/components/AuthLegalNotice.tsx,
 *        src/features/profile/screens/ProfileScreen.tsx (consumers);
 *        docs/ROADMAP.md (Legal item).
 */

/** The three documents, by the slug the route reads. */
export type LegalDoc = 'safety' | 'terms' | 'privacy';

/**
 * Build the in-app href. The OBJECT form, not a path string: `/legal/[doc]` is
 * a dynamic route, and expo-router's typed routes reject a pre-interpolated
 * literal like '/legal/terms' — the generated union contains the pattern, not
 * the instances. `router.push(legalHref('terms'))`.
 */
export function legalHref(doc: LegalDoc) {
  return { pathname: '/legal/[doc]' as const, params: { doc } };
}

/**
 * The hosted copies, required for STORE LISTINGS only (not used in the app).
 * TODO(legal): set these once the domain is registered and the documents from
 * src/features/legal/lib/legalContent.ts are published there. Until then the
 * store submission cannot be completed — this is a launch blocker, not a nicety.
 */
export const LEGAL_PUBLIC_URLS: {
  readonly terms: string | null;
  readonly privacyPolicy: string | null;
} = {
  terms: null,
  privacyPolicy: null,
};
