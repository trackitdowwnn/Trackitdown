/**
 * WHAT:  redirectSystemPath for expo-router's +native-intent — lets Stripe's
 *        payment return through and passes every other link on untouched.
 * WHY:   2026-10-14 (payments plan, PR6). PaymentSheet sends a bank's 3D
 *        Secure step back to `trackitdown://stripe-redirect` (useBountyPayment's
 *        returnURL), and nothing answered to that path — expo-router would
 *        have opened its "unmatched route" screen over the payment, at the very
 *        moment someone has just approved it in their banking app.
 *
 *        So the URL goes to Stripe (handleURLCallback completes the flow on
 *        iOS; it is a no-op on Android, where the SDK resumes on its own) and
 *        the app STAYS where it is — null means "no redirection" (expo-router
 *        v57 docs). On a cold start there is nowhere to stay, so home.
 *
 *        Never throws: an error in +native-intent can crash the app (the docs
 *        say so), so anything unexpected falls back to the link as it came.
 *        Lives here, not in src/app, so it can be tested: a test file in
 *        src/app would be a route.
 * LINKS: src/app/+native-intent.tsx; ../hooks/useBountyPayment.ts (returnURL);
 *        https://docs.expo.dev/router/advanced/native-intent/.
 */

import { handleURLCallback } from '@stripe/stripe-react-native';

/** The path useBountyPayment's returnURL brings a payment back on. */
export const STRIPE_RETURN_PATH = 'stripe-redirect';

export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string | null> {
  if (!path.includes(STRIPE_RETURN_PATH)) {
    return path;
  }
  try {
    await handleURLCallback(path);
  } catch {
    // Stripe couldn't take it: the payment's outcome still arrives through
    // the sheet's own promise and the server. Never a crash, never a redirect.
  }
  return initial ? '/' : null;
}
