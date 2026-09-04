/**
 * WHAT:  PUBLIC_WEB_ORIGIN — the one place that knows whether Trackitdown has a
 *        reachable website yet, and `publicPostUrl`, the only sanctioned way to
 *        build a link to a post on it.
 * WHY:   ⚠️ IT IS `null` BECAUSE WE DO NOT OWN A DOMAIN, and that is a fact
 *        about the world rather than a stub someone forgot. `postShare.ts`
 *        hard-coded `https://trackitdown.app/post/<id>` into every shared post
 *        for months. Nothing resolves there. Somebody who wants to help — the
 *        one person a stolen-car share exists to reach — taps it, gets a
 *        browser error, and concludes the app is fake. A dead link is strictly
 *        worse than no link: it spends the trust the share was asking for.
 *
 *        So the origin is nullable and every consumer must handle `null`. There
 *        is no default, no placeholder, and no "example.com" — those are how a
 *        broken link ships in the first place.
 *
 * ⚠️ SETTING THIS IS NOT ENOUGH TO FIX THE LEGAL URLS, and they are deliberately
 *        NOT derived from it. `LEGAL_PUBLIC_URLS` needs two things to be true —
 *        the domain exists AND the policy documents are actually published on
 *        it — and coupling them would let the first silently assert the second.
 *        A store reviewer following a privacy-policy link to a 404 is a worse
 *        outcome than an empty field. Fill those in separately, when the pages
 *        are up.
 *
 * ⚠️ AND IT IS NOT ENOUGH TO MAKE THE LINK WORK. A URL under this origin has to
 *        be SERVED by something — a web route that renders the post, plus the
 *        Universal Link / App Link association files if it should open the app.
 *        None of that exists. Setting this constant makes the app print the
 *        link; it does not make the link resolve. Ship the page first.
 * LINKS: src/features/vehicles/lib/postShare.ts (the only consumer today);
 *        src/shared/lib/legal.ts (the same "no domain yet" problem, kept
 *          separate on purpose — see above);
 *        src/features/profile/config.ts (SUPPORT_EMAIL, third of the three).
 */

/**
 * Scheme + host, no trailing slash.
 *
 * TODO(domain): `https://trackitdown.co.uk` is the intended one — named as
 * imminent by `20260901140000_purge_sighting_location_history.sql` and already
 * baked into `scripts/export-legal.mjs`. Set this when the site is up AND it
 * serves `/post/<id>`; the legal pages going live is NOT the same milestone,
 * because those are static exports and this is not.
 *
 * Three things are blocked on that one purchase and they clear at different
 * moments: LEGAL_PUBLIC_URLS when `npm run legal:export` output is published,
 * SUPPORT_EMAIL when a mailbox exists, and this when a post page exists.
 */
export const PUBLIC_WEB_ORIGIN: string | null = null;

/**
 * A shareable web link to a post, or `null` while there is nowhere to link to.
 *
 * `origin` is injectable so the has-a-domain branch can be tested before we
 * have one. Production callers pass nothing and get the real constant —
 * TESTING.md's rule about constants applies here: a test that supplies its own
 * origin is testing the FORMATTING, and must never be mistaken for proof that
 * links work today.
 */
export function publicPostUrl(postId: string, origin = PUBLIC_WEB_ORIGIN): string | null {
  if (!origin) return null;
  return `${origin.replace(/\/+$/, '')}/post/${postId}`;
}
