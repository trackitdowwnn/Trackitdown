/**
 * WHAT:  Tests for the collections API layer — each raised code becoming copy
 *        a user can act on, the deliberate opacity of COLLECTION_NOT_FOUND,
 *        the mapping of list rows, and moveWatch's UPDATE (never a
 *        delete-then-insert).
 * WHY:   The error copy IS the user experience here: hitting the 20-list cap
 *        or a duplicate name must say which, while "deleted" and "never yours"
 *        must stay indistinguishable so the message can't be used to probe for
 *        someone else's list. And a raw Postgres message reaching the UI would
 *        leak schema detail into a toast.
 * LINKS: src/features/watchlist/api/collectionsApi.ts;
 *        supabase/migrations/20260801110000_watchlist_collections.sql;
 *        src/features/garage/api/garageApi.test.ts (the sibling shape).
 */

import {
  CollectionError,
  createCollection,
  deleteCollection,
  listMyCollections,
  moveWatch,
  renameCollection,
} from './collectionsApi';

const mockRpc = jest.fn();
const mockSelect = jest.fn();
const mockOrder = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return { order: (...o: unknown[]) => mockOrder(...o) };
      },
      update: (...args: unknown[]) => {
        mockUpdate(...args);
        return { eq: (...e: unknown[]) => mockEq(...e) };
      },
    }),
  },
}));

const mockWarn = jest.fn();
const mockInfo = jest.fn();
// Forwarding wrappers, not `info: mockInfo`: createLogger() runs at module
// load — while `const mockInfo` is still in its temporal dead zone — so a
// direct reference captures undefined and every call throws.
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

const COLLECTION_ID = 'cccccccc-0000-0000-0000-00000000000c';
const POST_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

const raised = (message: string) => ({ data: null, error: { code: 'P0001', message } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listMyCollections', () => {
  it('maps rows to the domain shape, oldest first', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: COLLECTION_ID, name: 'My commute', created_at: '2026-07-01T10:00:00Z' }],
      error: null,
    });

    await expect(listMyCollections()).resolves.toEqual([
      { id: COLLECTION_ID, name: 'My commute', createdAt: '2026-07-01T10:00:00Z' },
    ]);
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('fails loudly on a shape drift rather than rendering garbage', async () => {
    mockOrder.mockResolvedValue({ data: [{ id: 'not-a-uuid', name: 1 }], error: null });

    await expect(listMyCollections()).rejects.toThrow();
  });
});

describe('createCollection', () => {
  it('returns the list, using the SERVER’s created_at', async () => {
    // Never a client clock: it orders the grid, and a skewed device would drop
    // a just-made list into the middle of it.
    mockRpc.mockResolvedValue({
      data: { collection_id: COLLECTION_ID, name: 'My commute', created_at: '2026-07-27T09:00:00Z' },
      error: null,
    });

    await expect(createCollection('My commute')).resolves.toEqual({
      id: COLLECTION_ID,
      name: 'My commute',
      createdAt: '2026-07-27T09:00:00Z',
    });
    expect(mockRpc).toHaveBeenCalledWith('create_watchlist_collection', { p_name: 'My commute' });
  });

  it.each([
    ['COLLECTION_LIMIT_REACHED', 'You can have up to 20 lists. Delete one to add another.'],
    ['COLLECTION_NAME_TAKEN', 'You already have a list with that name.'],
    ['INVALID_NAME', 'Give your list a name of 1–40 characters.'],
  ])('turns %s into copy that says what to do', async (code, copy) => {
    mockRpc.mockResolvedValue(raised(code));

    await expect(createCollection('x')).rejects.toMatchObject({ message: copy, code });
  });

  it('never shows a raw Postgres message', async () => {
    mockRpc.mockResolvedValue(raised('duplicate key value violates unique constraint "…"'));

    await expect(createCollection('x')).rejects.toMatchObject({
      message: 'Something went wrong. Please try again.',
      code: 'RPC_ERROR',
    });
  });

  it('does not treat inherited Object properties as known codes', async () => {
    // `in` would walk the prototype chain and hand a FUNCTION to the user as
    // their error text; the implementation uses Object.hasOwn.
    mockRpc.mockResolvedValue(raised('toString'));

    const error = await createCollection('x').catch((e: unknown) => e);
    expect((error as CollectionError).message).toBe('Something went wrong. Please try again.');
  });
});

describe('renameCollection', () => {
  it('returns the name the server stored, not the one typed', async () => {
    // The server trims; echoing the raw input would make a rename look like it
    // silently failed.
    mockRpc.mockResolvedValue({
      data: { collection_id: COLLECTION_ID, name: 'My commute' },
      error: null,
    });

    await expect(renameCollection(COLLECTION_ID, '  My commute  ')).resolves.toBe('My commute');
  });
});

describe('deleteCollection', () => {
  it('gives the same opaque copy for "deleted" and "never yours"', async () => {
    // The server raises ONE code for both so the message can't be used to
    // probe for the existence of someone else's list.
    mockRpc.mockResolvedValue(raised('COLLECTION_NOT_FOUND'));

    await expect(deleteCollection(COLLECTION_ID)).rejects.toMatchObject({
      message: 'We couldn’t find that list.',
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  it('never logs the list name, only its id', async () => {
    mockRpc.mockResolvedValue({ data: { collection_id: COLLECTION_ID }, error: null });

    await deleteCollection(COLLECTION_ID);

    expect(mockInfo).toHaveBeenCalledWith('collection_delete', { collectionId: COLLECTION_ID });
  });
});

describe('moveWatch', () => {
  it('updates collection_id in place rather than re-inserting', async () => {
    // Delete-then-insert would be blocked for a post that has since closed —
    // destroying the save on exactly the posts the tombstone section exists to
    // preserve — and would reset created_at, jumping the card to the top.
    mockEq.mockResolvedValue({ error: null });

    await moveWatch(POST_ID, COLLECTION_ID);

    expect(mockUpdate).toHaveBeenCalledWith({ collection_id: COLLECTION_ID });
    expect(mockEq).toHaveBeenCalledWith('post_id', POST_ID);
  });

  it('moving back to Saved is a null, not a delete', async () => {
    mockEq.mockResolvedValue({ error: null });

    await moveWatch(POST_ID, null);

    expect(mockUpdate).toHaveBeenCalledWith({ collection_id: null });
  });

  it('names the likely cause when RLS rejects the move', async () => {
    mockEq.mockResolvedValue({ error: { code: '42501', message: 'denied' } });

    await expect(moveWatch(POST_ID, COLLECTION_ID)).rejects.toMatchObject({
      message: 'We couldn’t find that list.',
      code: 'COLLECTION_NOT_FOUND',
    });
  });
});
