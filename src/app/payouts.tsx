/**
 * WHAT:  Route file for the pushed "Payouts" page, and the landing point for
 *        Stripe's hosted-onboarding redirect.
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — everything lives in the
 *        payments feature's PayoutsScreen.
 *
 *        THIS ROUTE MUST EXIST EVEN THOUGH iOS NEVER NAVIGATES TO IT.
 *        `connect-onboarding` hardcodes `trackitdown://payouts?onboarding=…` as
 *        its return and refresh URLs. On iOS the auth session intercepts that
 *        redirect and the app never navigates, but on Android the deep link is
 *        delivered for real — and on either platform, if the OS killed the app
 *        behind the browser, this route is the ONLY thing that sees the return.
 * LINKS: src/features/payments/screens/PayoutsScreen.tsx;
 *        supabase/functions/connect-onboarding/index.ts (the redirect targets).
 */

import { PayoutsScreen } from '@/features/payments';

export default PayoutsScreen;
