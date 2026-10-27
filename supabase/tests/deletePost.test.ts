/**
 * WHAT:  Tests for the delete-post Edge Function's ORDER: ask the RPC first,
 *        and touch Stripe only when the one thing in the way is an unproven
 *        intent.
 * WHY:   Audit run 2, lead 6. The RPC's money / hold / dispute / review
 *        refusals do not depend on Stripe, yet every retry during a 72-hour
 *        hold re-cancelled every abandoned intent on the post — two Stripe
 *        calls per row, on a count the owner can grow.
 * HOW:   Mocks the clients module (its npm: imports never load) and captures
 *        the handler from a stubbed Deno.serve.
 * LINKS: supabase/functions/delete-post/index.ts.
 */

const mockRpc = jest.fn();
const mockCancel = jest.fn();
const mockRetrieve = jest.fn();

jest.mock('../functions/_shared/clients.ts', () => ({
  createServiceRoleClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: MOCK_OWNER } }, error: null }) },
    rpc: mockRpc,
    from: (table: string) => {
      const rows =
        table === 'posts'
          ? { owner_id: MOCK_OWNER, status: 'cancelled' }
          : [{ stripe_payment_intent_id: 'pi_a' }, { stripe_payment_intent_id: 'pi_b' }];
      const query = {
        select: () => query,
        eq: () => query,
        in: async () => ({ data: rows, error: null }),
        maybeSingle: async () => ({ data: rows, error: null }),
      };
      return query;
    },
  }),
  createStripeClient: () => ({ paymentIntents: { cancel: mockCancel, retrieve: mockRetrieve } }),
}));

const MOCK_OWNER = '11111111-1111-1111-1111-111111111111';
const POST = '22222222-2222-2222-2222-222222222222';

let handler: (request: unknown) => Promise<{ status: number; json: () => Promise<unknown> }>;

beforeAll(() => {
  (globalThis as { Deno?: unknown }).Deno = {
    serve: (h: typeof handler) => {
      handler = h;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must load AFTER the Deno stub
  require('../functions/delete-post/index.ts');
});

beforeEach(() => {
  mockRpc.mockReset();
  mockCancel.mockReset().mockResolvedValue({ status: 'canceled' });
  mockRetrieve.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const call = () =>
  handler({
    method: 'POST',
    headers: { get: () => 'Bearer jwt' },
    json: async () => ({ postId: POST }),
  });

it('⚠️ a refused delete makes NO Stripe calls', async () => {
  mockRpc.mockResolvedValue({ error: { message: 'MONEY_IN_FLIGHT' } });

  const response = await call();

  expect(response.status).toBe(409);
  expect(mockCancel).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('cancels the strays only when they are all that is in the way, then deletes with the proof', async () => {
  mockRpc
    .mockResolvedValueOnce({ error: { message: 'INTENT_NOT_CANCELLED' } })
    .mockResolvedValueOnce({ error: null });

  const response = await call();

  expect(response.status).toBe(200);
  expect(mockCancel).toHaveBeenCalledTimes(2);
  expect(mockRpc.mock.calls[0][1].p_cancelled_intent_ids).toEqual([]);
  expect(mockRpc.mock.calls[1][1].p_cancelled_intent_ids).toEqual(['pi_a', 'pi_b']);
});

it('a post with no strays is deleted on the first ask', async () => {
  mockRpc.mockResolvedValue({ error: null });

  const response = await call();

  expect(response.status).toBe(200);
  expect(mockCancel).not.toHaveBeenCalled();
});
