/**
 * WHAT:  Tests for `_shared/cancelIntents.ts` — the list of intents proven
 *        `canceled` at Stripe that delete_draft_post and
 *        forget_cancelled_draft_intents accept as evidence.
 * WHY:   Tier 1 money (docs/TESTING.md): an id on that list lets its ledger row
 *        go, so only what Stripe CONFIRMS is dead may be on it — never a
 *        succeeded or processing intent, never one Stripe could not be asked.
 * LINKS: supabase/functions/_shared/cancelIntents.ts.
 */

import { cancelAndProve } from '../functions/_shared/cancelIntents';

type Status = string | Error;

function fakeIntents(onCancel: Record<string, Status>, onRetrieve: Record<string, Status> = {}) {
  const answer = (status: Status | undefined) =>
    status instanceof Error || status === undefined
      ? Promise.reject(status ?? new Error('no answer'))
      : Promise.resolve({ status });
  return {
    cancel: jest.fn((id: string) => answer(onCancel[id])),
    retrieve: jest.fn((id: string) => answer(onRetrieve[id])),
  } as never;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('cancelAndProve', () => {
  it('proves an intent Stripe cancels', async () => {
    expect(await cancelAndProve(fakeIntents({ pi_a: 'canceled' }), ['pi_a'], 't')).toEqual(['pi_a']);
  });

  it('proves an intent that was already cancelled', async () => {
    const intents = fakeIntents({ pi_a: new Error('terminal') }, { pi_a: 'canceled' });
    expect(await cancelAndProve(intents, ['pi_a'], 't')).toEqual(['pi_a']);
  });

  it('never proves a paid or processing intent', async () => {
    const intents = fakeIntents(
      { pi_paid: new Error('terminal'), pi_busy: new Error('processing') },
      { pi_paid: 'succeeded', pi_busy: 'processing' },
    );
    expect(await cancelAndProve(intents, ['pi_paid', 'pi_busy'], 't')).toEqual([]);
  });

  it('never proves an intent Stripe could not be asked about', async () => {
    const intents = fakeIntents({ pi_a: new Error('down') }, { pi_a: new Error('down') });
    expect(await cancelAndProve(intents, ['pi_a'], 't')).toEqual([]);
  });

  it('proves each intent on its own', async () => {
    const intents = fakeIntents(
      { pi_a: 'canceled', pi_b: new Error('terminal') },
      { pi_b: 'succeeded' },
    );
    expect(await cancelAndProve(intents, ['pi_a', 'pi_b'], 't')).toEqual(['pi_a']);
  });
});
