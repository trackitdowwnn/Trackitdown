/**
 * WHAT:  Tests for supportEmailIsReachable — whether the support address can
 *        receive mail at all.
 * WHY:   The Contact support row hangs on this. Get it wrong in one direction
 *        and a working address is hidden; get it wrong in the other and the app
 *        hands somebody trying to reach a human an address guaranteed to
 *        bounce, having appeared to help.
 * LINKS: ./config.ts; ./screens/ProfileScreen.tsx.
 */

import { supportEmailIsReachable } from './config';

describe('supportEmailIsReachable', () => {
  it('⚠️ says no to the address currently shipped', async () => {
    // support@trackitdown.example. If this ever starts returning true without
    // the address changing, the row comes back pointing at a dead domain.
    expect(supportEmailIsReachable()).toBe(false);
  });
});

/** The rule, checked directly — the shipped constant only exercises one case. */
describe('the reserved-domain rule', () => {
  const reachable = (email: string) => {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    return !['.example', '.test', '.invalid', '.localhost'].some((tld) => domain.endsWith(tld));
  };

  it('rejects every domain RFC 2606 and 6761 reserve', () => {
    // Reserved SO THAT they never resolve — an address on one is not a
    // placeholder to replace later, it is one that cannot work.
    expect(reachable('support@trackitdown.example')).toBe(false);
    expect(reachable('a@b.test')).toBe(false);
    expect(reachable('a@b.invalid')).toBe(false);
    expect(reachable('a@b.localhost')).toBe(false);
  });

  it('accepts a real address, including one that merely contains the word', () => {
    expect(reachable('support@trackitdown.co.uk')).toBe(true);
    expect(reachable('support@trackitdown.com')).toBe(true);
    // "example" inside the domain is not the reserved TLD.
    expect(reachable('support@example-garage.co.uk')).toBe(true);
  });

  it('⚠️ treats a malformed address as REACHABLE — it is not validation', () => {
    // Named the opposite way round on the first pass, asserting `true` under
    // the title "treats a malformed address as unreachable". The assertion was
    // right and the name was a lie, which is the more dangerous half.
    //
    // The function answers one question — is this domain reserved — and a
    // string with no domain is not. Left as-is deliberately: SUPPORT_EMAIL is a
    // compile-time constant a developer types, so a malformed one is a code
    // review problem, not a runtime state. If this ever reads a value from
    // config or the server, it needs real validation in front of it.
    expect(reachable('not-an-email')).toBe(true);
  });
});
