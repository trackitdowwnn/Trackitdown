/**
 * WHAT:  expo-router's system-link hook. Stripe's 3D Secure return stays on
 *        the payment; every other link passes through untouched.
 * LINKS: src/features/payments/lib/stripeReturn.ts (the logic, and why).
 */

export { redirectSystemPath } from '@/features/payments/lib/stripeReturn';
