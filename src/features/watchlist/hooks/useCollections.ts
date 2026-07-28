/**
 * WHAT:  useCollections — the caller's named lists, plus create/rename/delete
 *        that keep the local copy in step without a refetch round trip.
 * WHY:   The picker has to open INSTANTLY on a toast action, so it can't wait
 *        on a load; and the grid needs lists that contain nothing yet, which
 *        the watchlist payload can't describe. Keyed by user for the same
 *        reason useWatchlist is: another account's list names must never
 *        flash on screen.
 * LINKS: src/features/watchlist/api/collectionsApi.ts;
 *        src/features/watchlist/hooks/useWatchlist.ts (the sibling shape);
 *        src/features/watchlist/components/CollectionPickerSheet.tsx.
 */

import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/features/auth';

import {
  createCollection,
  deleteCollection,
  listMyCollections,
  renameCollection,
} from '../api/collectionsApi';
import type { WatchlistCollection } from '../types';

export type CollectionsStatus = 'loading' | 'ready' | 'error';

export interface UseCollectionsResult {
  status: CollectionsStatus;
  collections: WatchlistCollection[];
  reload: () => void;
  /** Resolves with the new list so the caller can file into it immediately. */
  create: (name: string) => Promise<WatchlistCollection>;
  rename: (collectionId: string, name: string) => Promise<void>;
  remove: (collectionId: string) => Promise<void>;
}

export function useCollections(): UseCollectionsResult {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  const [loaded, setLoaded] = useState<{
    userId: string;
    collections: WatchlistCollection[];
  } | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);

  // Promise chains, not async/await: load runs from an effect and every
  // setState must sit in a .then (the no-sync-setState-in-effect rule).
  const load = useCallback((): Promise<void> => {
    if (!userId) {
      return Promise.resolve();
    }
    const uid = userId;
    return Promise.resolve()
      .then(() => listMyCollections())
      .then((collections) => {
        setLoaded({ userId: uid, collections });
        setErrorFor(null);
      })
      .catch(() => {
        // listMyCollections already logged it.
        setErrorFor(uid);
      });
  }, [userId]);

  useEffect(() => {
    if (session.status === 'loading' || !userId) {
      return;
    }
    void load();
  }, [session.status, userId, load]);

  const create = useCallback(
    async (name: string): Promise<WatchlistCollection> => {
      const collection = await createCollection(name);
      // Append rather than refetch: the picker is open and the user is
      // mid-gesture, so a round trip here would be a visible stall on the one
      // interaction this feature is built around.
      setLoaded((prev) =>
        prev && prev.userId === userId
          ? { ...prev, collections: [...prev.collections, collection] }
          : prev,
      );
      return collection;
    },
    [userId],
  );

  const rename = useCallback(
    async (collectionId: string, name: string): Promise<void> => {
      const saved = await renameCollection(collectionId, name);
      setLoaded((prev) =>
        prev && prev.userId === userId
          ? {
              ...prev,
              // The SERVER's name, not the typed one — it trims, and showing
              // something different from what was stored is how a rename comes
              // to look like it silently failed.
              collections: prev.collections.map((c) =>
                c.id === collectionId ? { ...c, name: saved } : c,
              ),
            }
          : prev,
      );
    },
    [userId],
  );

  const remove = useCallback(
    async (collectionId: string): Promise<void> => {
      await deleteCollection(collectionId);
      setLoaded((prev) =>
        prev && prev.userId === userId
          ? { ...prev, collections: prev.collections.filter((c) => c.id !== collectionId) }
          : prev,
      );
    },
    [userId],
  );

  const current = userId && loaded?.userId === userId ? loaded.collections : null;
  const status: CollectionsStatus =
    session.status === 'loading'
      ? 'loading'
      : !userId
        ? 'ready'
        : errorFor === userId
          ? 'error'
          : current
            ? 'ready'
            : 'loading';

  return {
    status,
    collections: current ?? [],
    reload: () => void load(),
    create,
    rename,
    remove,
  };
}
