/**
 * WHAT:  mruCollection — which list the NEXT save should go into: the
 *        collection the user most recently filed something in. A module-level
 *        value (read synchronously at tap time), hydrated from AsyncStorage on
 *        launch and re-derived for free from the newest watch on every
 *        watchlist load.
 * WHY:   Airbnb's heart never asks first — it saves, then offers "Change".
 *        For that to be more than a coin flip, the default target has to be the
 *        list the user is actually working in: someone adding five cars to
 *        "My commute" should tap five times, not tap-and-correct five times.
 *        Read must be SYNCHRONOUS (an await between the tap and the insert
 *        would be a race with the optimistic flip), hence the module value
 *        rather than a hook or a storage read per save.
 *
 *        FAIL-SOFT to null. Unreadable storage, a foreign user's value, a
 *        deleted collection — all resolve to Saved, which always exists and
 *        can never reject an insert. The cost of being wrong is one tap of
 *        "Change"; the cost of failing hard would be a save that doesn't
 *        happen, which this feature may never do.
 * LINKS: src/features/watchlist/hooks/useWatchToggle.ts (the reader);
 *        src/features/watchlist/api/watchlistApi.ts (addWatch's stale-target
 *        fallback calls clearMruCollection); src/features/garage/lib/
 *        garageNudgeStorage.ts (the versioned-key + fail-soft template).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CollectionId, WatchlistEntry } from '../types';

/** Bump to reset everyone's target back to Saved. The version lives IN the key,
 *  so a bump invalidates old values with no migration. */
export const MRU_COLLECTION_VERSION = 1;

export const MRU_COLLECTION_STORAGE_KEY = `trackitdown.watchlist_mru_v${MRU_COLLECTION_VERSION}`;

/**
 * The target, carrying its NAME as well as its id so the save toast can say
 * "Saved to My commute" the instant it appears — the toast fires optimistically,
 * before the insert resolves, so there is no chance to look a name up.
 *
 * The name is nullable because one path knows only the id: re-deriving the
 * target from the watchlist payload, whose items carry collection_id and no
 * name. Callers show the generic copy in that case rather than a placeholder.
 */
export interface MruTarget {
  id: string;
  name: string | null;
}

let mruTarget: MruTarget | null = null;
// Which user the value belongs to. Stored alongside it and re-checked on read
// because a target is a hint about ONE person's filing habits — the same
// cross-user hazard watchedStore.hydrationGeneration guards, and a leak here
// would silently file a new account's saves into a stranger's list id (which
// RLS then rejects, so it's a correctness bug rather than a privacy one).
let mruForUser: string | null = null;
// Generation counter: a hydrate only lands if no newer hydrate/set has
// happened since, so a slow storage read can't overwrite a fresh user pick.
let generation = 0;

interface StoredMru {
  userId: string;
  collectionId: string;
  name?: string | null;
}

function isStoredMru(value: unknown): value is StoredMru {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.userId === 'string' && typeof record.collectionId === 'string';
}

/**
 * The collection the next save should target, with its name when known.
 * Synchronous by design — called between the tap and the optimistic flip.
 */
export function getMruTarget(userId: string | null): MruTarget | null {
  if (userId === null || mruForUser !== userId) {
    return null;
  }
  return mruTarget;
}

/** Just the id — what addWatch needs. `null` means the implicit Saved bucket. */
export function getMruCollection(userId: string | null): CollectionId {
  return getMruTarget(userId)?.id ?? null;
}

/**
 * Record where a save just landed. `null` (Saved) is a real choice and is
 * persisted like any other — someone who deliberately files back into Saved
 * should not keep getting pulled into their last named list.
 *
 * Pass the name whenever the caller has it (the picker always does). Omitting
 * it while keeping the SAME id preserves the name already held, so re-deriving
 * the target across devices can't quietly downgrade the toast copy.
 */
export function setMruCollection(
  userId: string,
  collectionId: CollectionId,
  name?: string | null,
): void {
  generation += 1;
  mruForUser = userId;
  if (collectionId === null) {
    mruTarget = null;
  } else {
    const keptName = name === undefined && mruTarget?.id === collectionId ? mruTarget.name : null;
    mruTarget = { id: collectionId, name: name ?? keptName };
  }
  // Fire-and-forget: the in-memory value is already correct, and a failed
  // write costs at most the right default on the next cold start.
  void persist(userId, mruTarget);
}

/** Forget the target — the collection it named is gone (addWatch's fallback). */
export function clearMruCollection(): void {
  generation += 1;
  mruTarget = null;
  void persist(mruForUser, null);
}

async function persist(userId: string | null, target: MruTarget | null): Promise<void> {
  try {
    if (userId === null || target === null) {
      await AsyncStorage.removeItem(MRU_COLLECTION_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(
      MRU_COLLECTION_STORAGE_KEY,
      JSON.stringify({
        userId,
        collectionId: target.id,
        name: target.name,
      } satisfies StoredMru),
    );
  } catch {
    // Silent by design — see the fail-soft note in the header.
  }
}

/**
 * Restore the target on launch. Anything unexpected — unreadable storage,
 * malformed JSON, another user's value — resolves to Saved rather than
 * throwing. Call once per session; a later set() always wins.
 */
export async function hydrateMruCollection(userId: string | null): Promise<void> {
  const mine = ++generation;
  if (userId === null) {
    mruForUser = null;
    mruTarget = null;
    return;
  }
  let restored: MruTarget | null = null;
  try {
    const raw = await AsyncStorage.getItem(MRU_COLLECTION_STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      // The user check is the point of storing userId at all: a signed-out
      // then signed-in-as-someone-else device must not inherit the target.
      if (isStoredMru(parsed) && parsed.userId === userId) {
        // The name may be absent (a value written before names were stored,
        // or one re-derived from the watchlist) — that only costs the
        // generic toast copy.
        restored = { id: parsed.collectionId, name: parsed.name ?? null };
      }
    }
  } catch {
    // Fail-soft to Saved.
  }
  if (mine !== generation) {
    // A save (or another hydrate) happened while we were reading — that value
    // is newer than the disk's, so leave it alone.
    return;
  }
  mruForUser = userId;
  mruTarget = restored;
}

/**
 * Re-derive the target from the watchlist itself. The RPC orders by
 * `watched_at desc`, so `entries[0]` IS the most recent filing — which makes
 * this free, and authoritative across devices in a way local storage can't be.
 *
 * An empty watchlist leaves the current value ALONE rather than clearing it:
 * someone who just removed their last save still has a list in mind, and this
 * runs on every load, so clearing would quietly undo a pick made seconds ago.
 *
 * Items carry no collection NAME, so this passes none — which keeps the name
 * already held when the id is unchanged (the overwhelmingly common case) and
 * drops to the generic toast copy only when the newest save really was made
 * into a list this device has never seen named.
 */
export function noteWatchlistLoaded(userId: string | null, entries: WatchlistEntry[]): void {
  const newest = entries[0];
  if (userId === null || newest === undefined) {
    return;
  }
  setMruCollection(userId, newest.collectionId);
}

/** Test seam — module state outlives a single test file otherwise. */
export function resetMruCollectionForTests(): void {
  generation += 1;
  mruForUser = null;
  mruTarget = null;
}
