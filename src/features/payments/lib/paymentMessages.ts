/**
 * WHAT:  The lines every payment screen shares about the payment sheet itself.
 * WHY:   Post a car and Change reward said different things — or nothing —
 *        when the sheet was closed (2026-10-16). One home, no imports, so a
 *        screen's tests can mock the payment hook without losing the words.
 * LINKS: ../hooks/useBountyPayment.ts; ../screens/ChangeRewardScreen.tsx;
 *        src/features/vehicles/post/screens/PostACarScreen.tsx.
 */

/** The sheet closed without paying: calm, nothing charged. */
export const PAYMENT_CANCELLED_MESSAGE = 'Payment not completed. Tap to try again when ready.';
