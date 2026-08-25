/**
 * WHAT:  Tests for the Edge Function send path — the preference filter and the
 *        persist-then-push ordering it must not break.
 * WHY:   `_shared/push.ts` is Deno code and there is no Deno on the machine it
 *        was written on, so until this file existed it was neither run NOR
 *        type-checked — and it is the send path for every notification in the
 *        app. It turns out to be importable from Jest: its ONE import is
 *        `import type`, which the compiler erases, so nothing reaches for a
 *        `npm:` specifier at runtime.
 *
 *        ⚠️ THE FAIL-OPEN DIRECTION IS THE POINT OF MOST OF THESE. Over-
 *        notifying during a fault is an annoyance; under-notifying is a stolen
 *        car reported near someone whose phone stayed silent. The first version
 *        of the filter got this backwards on an unexpected result shape —
 *        review caught it, and these are what would have caught it sooner.
 * LINKS: supabase/functions/_shared/push.ts;
 *        supabase/migrations/20260824170000_notification_preferences.sql;
 *        docs/decisions/ADR-0012-notification-center.md (persist-then-push).
 */

import { notifyUsers, sendToUsers } from '../functions/_shared/push';

type RpcResult = { data: unknown; error: { message: string } | null };

interface FakeClient {
  calls: string[];
  rpcArgs: { name: string; args: Record<string, unknown> }[];
  insertedUserIds: string[];
  tokenQueriedIds: string[];
  rpc: jest.Mock;
  from: jest.Mock;
}

/** A stand-in for the service-role client, recording the ORDER of what it is
 *  asked to do — which is the property ADR-0012 rests on. */
function fakeClient(rpcResult: RpcResult, tokens: string[] = ['tok-1']): FakeClient {
  const client: Partial<FakeClient> = {
    calls: [],
    rpcArgs: [],
    insertedUserIds: [],
    tokenQueriedIds: [],
  };

  client.rpc = jest.fn((name: string, args: Record<string, unknown>) => {
    client.calls!.push(`rpc:${name}`);
    client.rpcArgs!.push({ name, args });
    return Promise.resolve(rpcResult);
  });

  client.from = jest.fn((table: string) => {
    if (table === 'notifications') {
      return {
        insert: (rows: { user_id: string }[]) => {
          client.calls!.push('insert:notifications');
          client.insertedUserIds!.push(...rows.map((r) => r.user_id));
          return Promise.resolve({ error: null });
        },
      };
    }
    return {
      select: () => ({
        in: (_col: string, ids: string[]) => {
          client.calls!.push('select:push_tokens');
          client.tokenQueriedIds!.push(...ids);
          return Promise.resolve({ data: tokens.map((token) => ({ token })), error: null });
        },
      }),
    };
  });

  return client as FakeClient;
}

const CONTENT = { kind: 'alert', title: 'A car', body: 'near you', data: {} };

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // The push send itself is a network call; stub it out so these tests are
  // about the filter and the ordering, not about Expo.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] }),
  }) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

describe('the preference filter', () => {
  it('sends only to the users the RPC returns', async () => {
    const client = fakeClient({ data: ['user-a'], error: null });

    await sendToUsers(client as never, ['user-a', 'user-b'], CONTENT);

    expect(client.tokenQueriedIds).toEqual(['user-a']);
  });

  it('⚠️ sends to EVERYONE when the lookup errors', async () => {
    const client = fakeClient({ data: null, error: { message: 'boom' } });

    await sendToUsers(client as never, ['user-a', 'user-b'], CONTENT);

    expect(client.tokenQueriedIds).toEqual(['user-a', 'user-b']);
  });

  it('⚠️ sends to EVERYONE when the result shape is not what we expect', async () => {
    // The defect review caught. `returns setof uuid` yields bare strings, but
    // this file could not be run when it was written, so the object branch was
    // a guess — and it guessed the key was `id`. PostgREST names the column
    // after the FUNCTION, so `.id` was undefined for every row: the audience
    // looked full, matched no tokens, and every push in the app went silent
    // — including the two kinds that may never be muted.
    const client = fakeClient({ data: [{ something_unexpected: 42 }], error: null });

    await sendToUsers(client as never, ['user-a', 'user-b'], CONTENT);

    expect(client.tokenQueriedIds).toEqual(['user-a', 'user-b']);
  });

  it('reads a row whose column is named after the function, without guessing the name', async () => {
    const client = fakeClient({ data: [{ push_recipients: 'user-a' }], error: null });

    await sendToUsers(client as never, ['user-a', 'user-b'], CONTENT);

    expect(client.tokenQueriedIds).toEqual(['user-a']);
  });

  it('⚠️ sends to EVERYONE when the RPC returns no data at all', async () => {
    // `data: null` with no error would read as "nobody qualifies" and silence
    // the whole batch.
    const client = fakeClient({ data: null, error: null });

    await sendToUsers(client as never, ['user-a'], CONTENT);

    expect(client.tokenQueriedIds).toEqual(['user-a']);
  });

  it('an empty audience is respected — that is a real answer, not a fault', async () => {
    const client = fakeClient({ data: [], error: null });

    await sendToUsers(client as never, ['user-a'], CONTENT);

    expect(client.tokenQueriedIds).toEqual([]);
  });

  it('⚠️ chunks the audience, and UNIONS what every chunk returned', async () => {
    // PostgREST caps set-returning RPCs at db-max-rows (1000 by default) and
    // truncates with NO error, so a big fan-out would silently lose its tail
    // and the fail-open branch would never fire.
    //
    // ⚠️ THE UNION HALF IS THE POINT. Asserting only "three calls, each ≤200"
    // passes just as happily if the function ASSIGNS each batch's result
    // instead of accumulating it — two thirds of the audience would go silent,
    // with no error, which is the same class of bug the chunking was added to
    // fix. So each call returns a DISTINCT id and all three must arrive.
    const many = Array.from({ length: 450 }, (_, i) => `user-${i}`);
    const client = fakeClient({ data: [], error: null });
    let call = 0;
    client.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      client.rpcArgs.push({ name, args });
      call += 1;
      return Promise.resolve({ data: [`from-batch-${call}`], error: null });
    });

    await sendToUsers(client as never, many, CONTENT);

    const rpcCalls = client.rpcArgs.filter((c) => c.name === 'push_recipients');
    expect(rpcCalls).toHaveLength(3);
    for (const c of rpcCalls) {
      expect((c.args.p_user_ids as string[]).length).toBeLessThanOrEqual(200);
    }
    expect(client.tokenQueriedIds).toEqual(['from-batch-1', 'from-batch-2', 'from-batch-3']);
  });

  it('passes the kind through, because that is what the filter keys on', async () => {
    const client = fakeClient({ data: ['user-a'], error: null });

    await sendToUsers(client as never, ['user-a'], { ...CONTENT, kind: 'sighting' });

    expect(client.rpcArgs[0].args.p_kind).toBe('sighting');
  });
});

describe('⚠️ persist-then-push', () => {
  it('writes the notifications row BEFORE consulting preferences', async () => {
    // ADR-0012. Muting must cost the interruption and never the information,
    // and the only thing enforcing that is the order of two statements. This
    // is the guard on it.
    const client = fakeClient({ data: [], error: null });

    await notifyUsers(client as never, ['user-a'], CONTENT);

    expect(client.calls.indexOf('insert:notifications')).toBeGreaterThanOrEqual(0);
    expect(client.calls.indexOf('insert:notifications')).toBeLessThan(
      client.calls.indexOf('rpc:push_recipients'),
    );
  });

  it('⚠️ a fully muted audience still gets its rows', async () => {
    // The whole promise: the Inbox stays complete, only the buzz is dropped.
    const client = fakeClient({ data: [], error: null });

    await notifyUsers(client as never, ['user-a', 'user-b'], CONTENT);

    expect(client.insertedUserIds).toEqual(['user-a', 'user-b']);
    expect(client.tokenQueriedIds).toEqual([]);
  });

  it('⚠️ sendToUsers writes NO notifications row — chat is excluded by design', async () => {
    // ADR-0012's one exclusion: the Messages segment is chat's persistent
    // surface, so duplicating threads into the centre would be noise. Nothing
    // else asserted it, and the fake would record the insert if it ever began.
    const client = fakeClient({ data: ['user-a'], error: null });

    await sendToUsers(client as never, ['user-a'], { ...CONTENT, kind: 'message' });

    expect(client.calls).not.toContain('insert:notifications');
  });

  it('the row audience is never narrowed by the filter', async () => {
    const client = fakeClient({ data: ['user-a'], error: null });

    await notifyUsers(client as never, ['user-a', 'user-b'], CONTENT);

    expect(client.insertedUserIds).toEqual(['user-a', 'user-b']);
    expect(client.tokenQueriedIds).toEqual(['user-a']);
  });
});
