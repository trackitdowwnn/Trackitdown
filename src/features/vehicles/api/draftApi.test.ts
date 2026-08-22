/**
 * WHAT:  Tests for deleteDraft — the client boundary to the delete-draft Edge
 *        Function, and specifically its error→copy map.
 * WHY:   MONEY-adjacent. Deleting a draft cancels Stripe PaymentIntents, and two
 *        of the failures must NOT read as "please try again": one is permanent
 *        and one is genuinely worth retrying, and telling them apart is the
 *        whole value this thin file adds. A generic retry line on PAYMENT_EXISTS
 *        would loop an owner for ever on something that can never succeed.
 * LINKS: src/features/vehicles/api/draftApi.ts;
 *        supabase/functions/delete-draft/index.ts (the codes);
 *        supabase/migrations/20260816110000_a_draft_delete_must_prove_the_intents_are_dead.sql.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { deleteDraft } from './draftApi';

const mockInvoke = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

/** A non-2xx Edge Function reply, in the { error, code } shape _shared/http.ts
 *  emits and parseFunctionError reads. */
function httpError(code: string, message = 'server copy') {
  const response = { json: async () => ({ error: message, code }) } as unknown as Response;
  return Object.assign(Object.create(FunctionsHttpError.prototype), {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: response,
  }) as FunctionsHttpError;
}

beforeEach(() => jest.clearAllMocks());

describe('deleteDraft', () => {
  it('sends only the post id', async () => {
    mockInvoke.mockResolvedValue({ data: { deleted: true }, error: null });

    await expect(deleteDraft(POST_ID)).resolves.toBeUndefined();

    // The client never says which intents to cancel, or that any exist: the
    // function reads the ledger itself and proves each one dead to the RPC.
    expect(mockInvoke).toHaveBeenCalledWith('delete-draft', { body: { postId: POST_ID } });
  });

  it('does NOT tell someone to retry when money has moved', async () => {
    // PAYMENT_EXISTS is permanent. A draft with a captured charge against it is
    // not a draft in any sense that matters, and no number of retries changes
    // that — so the copy routes to a human instead of looping them.
    mockInvoke.mockResolvedValue({ data: null, error: httpError('PAYMENT_EXISTS') });

    await expect(deleteDraft(POST_ID)).rejects.toMatchObject({
      code: 'PAYMENT_EXISTS',
      message: expect.stringContaining('Contact support'),
    });
    await expect(deleteDraft(POST_ID)).rejects.not.toMatchObject({
      message: expect.stringContaining('try again'),
    });
  });

  it('DOES ask for a retry when an intent could not be proven dead', async () => {
    // The opposite case, and the distinction is the point. INTENT_NOT_CANCELLED
    // usually means a payment was opened on another device mid-flight; the next
    // attempt will see it and cancel it, so retrying really is the fix.
    mockInvoke.mockResolvedValue({ data: null, error: httpError('INTENT_NOT_CANCELLED') });

    await expect(deleteDraft(POST_ID)).rejects.toMatchObject({
      code: 'INTENT_NOT_CANCELLED',
      message: expect.stringContaining('try again'),
    });
  });

  it('says a submitted listing cannot be deleted, rather than failing vaguely', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError('POST_NOT_DRAFT') });

    await expect(deleteDraft(POST_ID)).rejects.toMatchObject({
      code: 'POST_NOT_DRAFT',
      message: expect.stringContaining('already been submitted'),
    });
  });

  it('falls back to generic copy on a code it has never seen', async () => {
    // A new server token must not reach the UI raw, and must not crash the
    // mapper either.
    mockInvoke.mockResolvedValue({ data: null, error: httpError('SOMETHING_NEW') });

    await expect(deleteDraft(POST_ID)).rejects.toMatchObject({
      code: 'SOMETHING_NEW',
    });
  });
});
