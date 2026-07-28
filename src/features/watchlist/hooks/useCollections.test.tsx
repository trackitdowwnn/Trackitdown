/**
 * WHAT:  Tests for useCollections — loading the caller's lists, keying them by
 *        user, and the local updates that keep create/rename/delete instant.
 * WHY:   The picker opens on a toast action and cannot wait on a round trip,
 *        so these mutations update in place. That optimism is only safe if it
 *        mirrors what the SERVER did — a rename echoing the typed name rather
 *        than the stored (trimmed) one is how a rename comes to look like it
 *        silently failed. The per-user key is the same guard useWatchlist has:
 *        another account's list names must never flash on screen.
 * LINKS: src/features/watchlist/hooks/useCollections.ts;
 *        src/features/watchlist/api/collectionsApi.ts; docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { SessionState } from '@/features/auth';

import type { WatchlistCollection } from '../types';
import { useCollections } from './useCollections';

const COMMUTE: WatchlistCollection = {
  id: 'cccccccc-0000-0000-0000-00000000000c',
  name: 'My commute',
  createdAt: '2026-07-01T10:00:00Z',
};
const NEAR_WORK: WatchlistCollection = {
  id: 'dddddddd-0000-0000-0000-00000000000d',
  name: 'Near work',
  createdAt: '2026-07-02T10:00:00Z',
};

const mockList = jest.fn(async (): Promise<WatchlistCollection[]> => [COMMUTE]);
const mockCreate = jest.fn(async (_name: string): Promise<WatchlistCollection> => NEAR_WORK);
const mockRename = jest.fn(async (_id: string, _name: string): Promise<string> => 'Renamed');
const mockDelete = jest.fn(async (_id: string): Promise<void> => {});
jest.mock('../api/collectionsApi', () => ({
  listMyCollections: () => mockList(),
  createCollection: (name: string) => mockCreate(name),
  renameCollection: (id: string, name: string) => mockRename(id, name),
  deleteCollection: (id: string) => mockDelete(id),
}));

let mockSession: SessionState;
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: 'signedIn', userId: 'user-1' };
  mockList.mockResolvedValue([COMMUTE]);
  mockCreate.mockResolvedValue(NEAR_WORK);
  mockRename.mockResolvedValue('Renamed');
  mockDelete.mockResolvedValue(undefined);
});

describe('loading', () => {
  it('loads the caller’s lists', async () => {
    const { result, unmount } = await renderHook(() => useCollections());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.collections).toEqual([COMMUTE]);
    await unmount();
  });

  it('a guest is instantly ready and empty, with no request', async () => {
    mockSession = { status: 'signedOut', userId: null };
    const { result, unmount } = await renderHook(() => useCollections());

    expect(result.current.status).toBe('ready');
    expect(result.current.collections).toEqual([]);
    expect(mockList).not.toHaveBeenCalled();
    await unmount();
  });

  it('reports an error the caller can retry', async () => {
    mockList.mockRejectedValue(new Error('offline'));
    const { result, unmount } = await renderHook(() => useCollections());

    await waitFor(() => expect(result.current.status).toBe('error'));

    mockList.mockResolvedValue([COMMUTE]);
    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await unmount();
  });
});

describe('create', () => {
  it('appends without a refetch, so the open picker does not stall', async () => {
    const { result, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.create('Near work');
    });

    expect(result.current.collections).toEqual([COMMUTE, NEAR_WORK]);
    // One load on mount, none after the create.
    expect(mockList).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('hands the new list back so the caller can file into it immediately', async () => {
    const { result, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let created: WatchlistCollection | undefined;
    await act(async () => {
      created = await result.current.create('Near work');
    });

    expect(created).toEqual(NEAR_WORK);
    await unmount();
  });

  it('leaves the list untouched when the create is rejected', async () => {
    mockCreate.mockRejectedValue(new Error('You already have a list with that name.'));
    const { result, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.create('My commute')).rejects.toThrow();
    });

    expect(result.current.collections).toEqual([COMMUTE]);
    await unmount();
  });
});

describe('rename', () => {
  it('shows the name the SERVER stored, not the one typed', async () => {
    // The server trims; echoing the input would make a rename look like it
    // silently failed the moment it differed.
    const { result, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.rename(COMMUTE.id, '  Renamed  ');
    });

    expect(result.current.collections[0].name).toBe('Renamed');
    await unmount();
  });
});

describe('remove', () => {
  it('drops the list locally', async () => {
    const { result, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.remove(COMMUTE.id);
    });

    expect(result.current.collections).toEqual([]);
    await unmount();
  });

  it('keeps the list when the delete is rejected', async () => {
    mockDelete.mockRejectedValue(new Error('We couldn’t find that list.'));
    const { result, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.remove(COMMUTE.id)).rejects.toThrow();
    });

    expect(result.current.collections).toEqual([COMMUTE]);
    await unmount();
  });
});

describe('user switching', () => {
  it('never shows the previous account’s list names', async () => {
    const { result, rerender, unmount } = await renderHook(() => useCollections());
    await waitFor(() => expect(result.current.collections).toEqual([COMMUTE]));

    // Sign in as someone else; their load hasn't landed yet.
    mockList.mockImplementation(() => new Promise(() => {}));
    mockSession = { status: 'signedIn', userId: 'user-2' };
    await act(async () => {
      rerender({});
    });

    expect(result.current.collections).toEqual([]);
    expect(result.current.status).toBe('loading');
    await unmount();
  });
});
