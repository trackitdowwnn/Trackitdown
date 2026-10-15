/**
 * WHAT:  expo-router's system-link hook. A web sign-in's return (Apple on
 *        Android) and Stripe's 3D Secure return both STAY where the app is;
 *        every other link passes through untouched.
 * WHY:   Without this, either return would open expo-router's "unmatched
 *        route" screen at the very moment someone has just signed in or paid.
 *        Never throws: an error in +native-intent can crash the app (expo-router
 *        docs), so a failing half falls through to the next.
 * LINKS: src/features/auth/lib/oauthReturn.ts (handleAuthReturnPath);
 *        src/features/payments/lib/stripeReturn.ts (the Stripe half, and why).
 */

import { handleAuthReturnPath } from '@/features/auth/lib/oauthReturn';
import { redirectSystemPath as redirectStripePath } from '@/features/payments/lib/stripeReturn';

export async function redirectSystemPath(args: {
  path: string;
  initial: boolean;
}): Promise<string | null> {
  try {
    const auth = handleAuthReturnPath(args);
    if (auth !== undefined) return auth;
  } catch {
    // Not ours to fail on — Stripe's half (and pass-through) still runs.
  }
  return redirectStripePath(args);
}
