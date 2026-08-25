/**
 * WHAT:  Profile feature configuration — the payouts-row feature flag and the
 *        support address. (Legal link URLs moved to shared/lib/legal.ts now
 *        that the auth flow needs them too.)
 * WHY:   The payouts row shipped dark from 2026-07-10 until 2026-08-03, when
 *        the Stripe Connect UI landed and there was finally something behind
 *        it to reach.
 * LINKS: src/features/profile/screens/ProfileScreen.tsx (consumer);
 *        src/features/payments/screens/PayoutsScreen.tsx (what it opens);
 *        src/shared/lib/legal.ts (LEGAL_URLS); docs/ROADMAP.md (Legal).
 */

/**
 * The payouts row. ON since 2026-08-03.
 *
 * Kept as a flag rather than deleted because it is now a KILL SWITCH: the
 * screen behind it depends on Stripe Connect being correctly configured on the
 * platform account, and if that ever breaks, hiding the row is a one-line
 * change that beats sending spotters into a flow that cannot complete.
 */
export const PAYOUTS_ENABLED = true;

export const SUPPORT_EMAIL = 'support@trackitdown.example'; // TODO(legal)

/**
 * Whether {@link SUPPORT_EMAIL} can actually receive mail.
 *
 * ⚠️ DERIVED, NOT A FLAG, so nobody has to remember to flip it. RFC 2606 and
 * RFC 6761 reserve `.example`, `.test`, `.invalid` and `.localhost` precisely
 * so they can never resolve — an address ending in one is not "a placeholder we
 * should replace", it is one that is guaranteed to bounce. The moment
 * SUPPORT_EMAIL becomes a real address this returns true on its own and the
 * Contact support row comes back.
 *
 * WHY IT EXISTS: the row was offering a mailto: to a reserved domain, and its
 * fallback COPIED THAT ADDRESS TO THE CLIPBOARD — confidently handing someone
 * trying to reach a human an address that cannot work. A dead route presented
 * as a live one is worse than no route, because it spends the one bit of effort
 * they were willing to make. Hiding it leaves "Report a bug", which reaches a
 * real table.
 */
export function supportEmailIsReachable(): boolean {
  const domain = SUPPORT_EMAIL.split('@')[1]?.toLowerCase() ?? '';
  return !['.example', '.test', '.invalid', '.localhost'].some((tld) =>
    domain.endsWith(tld),
  );
}
