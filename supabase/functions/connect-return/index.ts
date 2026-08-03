/**
 * WHAT:  The doormat Stripe sends a spotter back to after hosted onboarding.
 *        An HTTPS page whose only job is to hand control straight back to the
 *        app at `trackitdown://payouts?onboarding=…`.
 * WHY:   Stripe's Account Links accept **http/https only**. A custom scheme is
 *        rejected outright — `accountLinks.create` answers "Not a valid URL" —
 *        so an app that lives behind `trackitdown://` cannot be a return target
 *        directly. (Found the hard way on 2026-08-03: the account was created
 *        fine and the LINK was what failed.)
 *
 *        Universal links would remove this hop, but they need a verified domain
 *        with an apple-app-site-association file and assetlinks.json, and this
 *        project's domain is still a placeholder. This function needs no domain
 *        and no hosting — it is already deployed next to the function that
 *        mints the link.
 *
 *        NOT A REDIRECT HEADER. A 302 straight to a custom scheme is silently
 *        dropped by some in-app browsers, which leaves the spotter staring at a
 *        blank page with their bank details submitted and no way home. A real
 *        page that navigates itself works in the same cases and, when it does
 *        not, still shows a button they can press.
 *
 * SAFETY: carries no secrets, reads no database, and takes nothing from the
 *        request but one word which is checked against a fixed list. It is
 *        deployed with `--no-verify-jwt` because Stripe's browser arrives with
 *        no session — so it must stay this boring.
 * LINKS: supabase/functions/connect-onboarding/index.ts (mints the link that
 *          points here); src/features/payments/screens/PayoutsScreen.tsx (what
 *          catches the scheme); src/app/payouts.tsx.
 */

import { corsHeaders } from '../_shared/http.ts';

/** The only two answers Stripe ever sends us back with. */
const OUTCOMES = new Set(['complete', 'refresh']);

Deno.serve((request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Anything unexpected becomes `complete`: the screen re-reads the account
  // either way, so the worst case is one wasted read — whereas refusing to
  // redirect would strand someone who has just finished their KYC.
  const requested = new URL(request.url).searchParams.get('onboarding') ?? '';
  const outcome = OUTCOMES.has(requested) ? requested : 'complete';
  const deepLink = `trackitdown://payouts?onboarding=${outcome}`;

  // `replace`, not `href`: the browser's back button should not return to a
  // page whose entire purpose has already happened.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back to Trackitdown</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #F7F7F7; color: #222; margin: 0; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; text-align: center; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #6A6A6A; margin: 0 0 24px; }
  a { display: inline-block; background: #1A1A1A; color: #fff; text-decoration: none;
      padding: 14px 24px; border-radius: 12px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>All done</h1>
  <p>Taking you back to Trackitdown&hellip;</p>
  <a href="${deepLink}">Return to Trackitdown</a>
</main>
<script>window.location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;

  console.log('[payments] connect return bounced', { outcome });
  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
});
