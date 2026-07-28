/**
 * WHAT:  Tests for mruCollection — the target list for the next save: that it
 *        reads synchronously, persists per user, refuses another user's stored
 *        value, survives unreadable/malformed storage, and never lets a slow
 *        hydrate overwrite a pick the user just made.
 * WHY:   Every failure mode here is silent. A leaked target files a new
 *        account's saves at a stranger's list id; a late hydrate drags a save
 *        into the list the user was in LAST session. Neither shows an error —
 *        the car just isn't where they put it, which is exactly the trust this
 *        feature spends.
 * LINKS: src/features/watchlist/lib/mruCollection.ts;
 *        src/features/garage/lib/garageNudgeStorage.test.ts (the template);
 *        src/features/watchlist/lib/watchedStore.ts (same cross-user hazard).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WatchlistEntry } from '../types';

import {
  MRU_COLLECTION_STORAGE_KEY,
  clearMruCollection,
  getMruCollection,
  hydrateMruCollection,
  noteWatchlistLoaded,
  resetMruCollectionForTests,
  setMruCollection,
} from './mruCollection';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const USER = 'user-1';
const OTHER_USER = 'user-2';
const COMMUTE = 'cccccccc-0000-0000-0000-00000000000c';
const NEAR_WORK = 'dddddddd-0000-0000-0000-00000000000d';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  resetMruCollectionForTests();
});

describe('reading the target', () => {
  it('defaults to Saved before anything is set', () => {
    expect(getMruCollection(USER)).toBeNull();
  });

  it('returns the last collection saved into', () => {
    setMruCollection(USER, COMMUTE);

    expect(getMruCollection(USER)).toBe(COMMUTE);
  });

  it('never hands one user another user’s target', () => {
    setMruCollection(USER, COMMUTE);

    expect(getMruCollection(OTHER_USER)).toBeNull();
  });

  it('returns Saved for a guest', () => {
    setMruCollection(USER, COMMUTE);

    expect(getMruCollection(null)).toBeNull();
  });

  it('treats filing back into Saved as a real choice', () => {
    setMruCollection(USER, COMMUTE);
    setMruCollection(USER, null);

    expect(getMruCollection(USER)).toBeNull();
  });
});

describe('persistence', () => {
  it('survives a restart', async () => {
    setMruCollection(USER, COMMUTE);
    // A fresh launch: module state gone, disk intact.
    resetMruCollectionForTests();
    expect(getMruCollection(USER)).toBeNull();

    await hydrateMruCollection(USER);

    expect(getMruCollection(USER)).toBe(COMMUTE);
  });

  it('removes the key rather than storing a null target', async () => {
    setMruCollection(USER, COMMUTE);

    setMruCollection(USER, null);
    await Promise.resolve();

    await expect(AsyncStorage.getItem(MRU_COLLECTION_STORAGE_KEY)).resolves.toBeNull();
  });

  it('discards a value stored by a different user', async () => {
    // Sign out, sign in as someone else on the same device.
    await AsyncStorage.setItem(
      MRU_COLLECTION_STORAGE_KEY,
      JSON.stringify({ userId: OTHER_USER, collectionId: COMMUTE }),
    );

    await hydrateMruCollection(USER);

    expect(getMruCollection(USER)).toBeNull();
  });

  it('falls back to Saved when storage throws', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(hydrateMruCollection(USER)).resolves.toBeUndefined();
    expect(getMruCollection(USER)).toBeNull();
  });

  it('falls back to Saved on malformed JSON', async () => {
    await AsyncStorage.setItem(MRU_COLLECTION_STORAGE_KEY, '{not json');

    await hydrateMruCollection(USER);

    expect(getMruCollection(USER)).toBeNull();
  });

  it('falls back to Saved on a well-formed value of the wrong shape', async () => {
    await AsyncStorage.setItem(
      MRU_COLLECTION_STORAGE_KEY,
      JSON.stringify({ userId: USER, collectionId: 42 }),
    );

    await hydrateMruCollection(USER);

    expect(getMruCollection(USER)).toBeNull();
  });

  it('clears the target for a guest without reading storage', async () => {
    setMruCollection(USER, COMMUTE);
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await hydrateMruCollection(null);

    expect(getMruCollection(USER)).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('never throws when a write fails', () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    expect(() => setMruCollection(USER, COMMUTE)).not.toThrow();
    // The in-memory value is still correct — the write is only for next launch.
    expect(getMruCollection(USER)).toBe(COMMUTE);
  });
});

describe('races', () => {
  it('does not let a slow hydrate overwrite a fresh pick', async () => {
    let release: (value: string | null) => void = () => {};
    jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );

    const hydrating = hydrateMruCollection(USER);
    // The user saves into a list while the read is still in flight.
    setMruCollection(USER, NEAR_WORK);
    release(JSON.stringify({ userId: USER, collectionId: COMMUTE }));
    await hydrating;

    expect(getMruCollection(USER)).toBe(NEAR_WORK);
  });
});

describe('re-deriving from the watchlist', () => {
  const entry = (collectionId: string | null): WatchlistEntry => ({
    kind: 'tombstone',
    watchedAt: '2026-07-21T10:00:00Z',
    collectionId,
    postId: 'p1',
    status: 'expired',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    resolvedAt: '2026-07-22T10:00:00Z',
    thumbnailUrl: null,
  });

  it('takes the newest watch as the target', () => {
    // The RPC orders watched_at desc, so entries[0] is the most recent filing.
    noteWatchlistLoaded(USER, [entry(NEAR_WORK), entry(COMMUTE)]);

    expect(getMruCollection(USER)).toBe(NEAR_WORK);
  });

  it('leaves an existing target alone when the watchlist is empty', () => {
    setMruCollection(USER, COMMUTE);

    noteWatchlistLoaded(USER, []);

    expect(getMruCollection(USER)).toBe(COMMUTE);
  });

  it('ignores a guest load', () => {
    setMruCollection(USER, COMMUTE);

    noteWatchlistLoaded(null, [entry(NEAR_WORK)]);

    expect(getMruCollection(USER)).toBe(COMMUTE);
  });
});

describe('clearing', () => {
  it('forgets a target whose collection has gone', async () => {
    setMruCollection(USER, COMMUTE);

    clearMruCollection();
    await Promise.resolve();

    expect(getMruCollection(USER)).toBeNull();
    await expect(AsyncStorage.getItem(MRU_COLLECTION_STORAGE_KEY)).resolves.toBeNull();
  });
});
