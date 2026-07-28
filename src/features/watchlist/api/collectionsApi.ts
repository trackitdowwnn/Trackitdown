/**
 * WHAT:  Supabase access for watchlist collections — the caller's named lists
 *        (a plain RLS-scoped select) plus the three write RPCs, with each
 *        raised code translated into copy that can be shown verbatim.
 * WHY:   Names are the ONLY thing the item payload can't tell us: a list the
 *        user made but hasn't filed anything into yet has no items, so it
 *        would vanish from a grid derived purely from watches. That is the
 *        whole reason this file exists alongside get_my_watchlist.
 *
 *        PRIVACY: a collection name is free text the user wrote for themselves.
 *        It is never logged (ids only), never shared, and never leaves their
 *        own session — the same rule as vehicles.nickname.
 * LINKS: supabase/migrations/20260801110000_watchlist_collections.sql;
 *        src/features/garage/api/garageApi.ts (the RPC error-mapping shape);
 *        src/features/watchlist/types.ts; docs/LOGGING.md.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import { MAX_COLLECTIONS } from '../types';
import type { CollectionId, WatchlistCollection } from '../types';

const log = createLogger('watchlist');

const FALLBACK = 'Something went wrong. Please try again.';

const COLLECTION_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Please sign in and try again.',
  INVALID_NAME: 'Give your list a name of 1–40 characters.',
  COLLECTION_LIMIT_REACHED: `You can have up to ${MAX_COLLECTIONS} lists. Delete one to add another.`,
  COLLECTION_NAME_TAKEN: 'You already have a list with that name.',
  // Deliberately the same copy for "deleted" and "never yours" — the server
  // raises one opaque code for both so it can't be used to probe for the
  // existence of someone else's list.
  COLLECTION_NOT_FOUND: 'We couldn’t find that list.',
};

/** A collections failure whose `message` is already safe to show. */
export class CollectionError extends Error {
  /** The server's raised code (e.g. COLLECTION_NAME_TAKEN), or 'RPC_ERROR'. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
  }
}

const collectionRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  created_at: z.string(),
});

/** Call a collections RPC and translate its raised code into user-facing copy. */
async function callCollectionRpc(fn: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    // hasOwn, not `in`: `in` walks the prototype chain, so a Postgres message
    // of "toString" would look known and hand a FUNCTION to the user as copy.
    const known = Object.hasOwn(COLLECTION_ERROR_MESSAGES, error.message);
    const message = known ? COLLECTION_ERROR_MESSAGES[error.message] : FALLBACK;
    // The name is never logged, only the outcome.
    log.warn(`${fn} rejected`, { code: error.code, reason: known ? error.message : undefined });
    throw new CollectionError(message, known ? error.message : 'RPC_ERROR');
  }
  return data;
}

/**
 * The caller's named lists, oldest first. RLS scopes this to own rows — there
 * is no RPC because there is nothing to hide behind one: a plain select of your
 * own list names needs no server-side rules.
 */
export async function listMyCollections(): Promise<WatchlistCollection[]> {
  const { data, error } = await supabase
    .from('watchlist_collections')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });
  if (error) {
    log.error('collections_load failed', { code: error.code });
    throw error;
  }
  const rows = z.array(collectionRowSchema).parse(data ?? []);
  log.info('collections_load', { count: rows.length });
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

const createResultSchema = z.object({
  collection_id: z.guid(),
  name: z.string(),
  created_at: z.string(),
});
const renameResultSchema = z.object({ collection_id: z.guid(), name: z.string() });

/** Create a named list. Returns it so the caller can file into it immediately. */
export async function createCollection(name: string): Promise<WatchlistCollection> {
  const data = await callCollectionRpc('create_watchlist_collection', { p_name: name });
  const result = createResultSchema.parse(data);
  log.info('collection_create', { collectionId: result.collection_id });
  // created_at is the server's, never invented here: it orders the grid, and a
  // device clock minutes out would drop a just-made list into the middle.
  return { id: result.collection_id, name: result.name, createdAt: result.created_at };
}

/** Rename a list the caller owns. */
export async function renameCollection(collectionId: string, name: string): Promise<string> {
  const data = await callCollectionRpc('rename_watchlist_collection', {
    p_collection_id: collectionId,
    p_name: name,
  });
  const result = renameResultSchema.parse(data);
  log.info('collection_rename', { collectionId });
  return result.name;
}

/**
 * Delete a list the caller owns. The saved cars in it are NOT deleted — the
 * foreign key returns them to the implicit "Saved" bucket. Any UI wording here
 * must say so.
 */
export async function deleteCollection(collectionId: string): Promise<void> {
  await callCollectionRpc('delete_watchlist_collection', { p_collection_id: collectionId });
  log.info('collection_delete', { collectionId });
}

/**
 * Re-file an existing watch. An UPDATE, deliberately not delete-then-insert:
 * re-inserting is blocked once a post has closed, so the naive version would
 * silently destroy the save on exactly the closed posts the tombstone section
 * exists to preserve — and would reset created_at, jumping the card to the top
 * of the list on a mere reorganise.
 *
 * The UPDATE grant is column-limited to collection_id, so this cannot be
 * repointed at another post.
 */
export async function moveWatch(postId: string, collectionId: CollectionId): Promise<void> {
  const { error } = await supabase
    .from('watchlist_items')
    .update({ collection_id: collectionId })
    .eq('post_id', postId);
  if (error) {
    log.warn('watch_move failed', { postId, code: error.code });
    throw new CollectionError(
      // The likeliest cause by far is that the destination list was deleted on
      // another device, so name that rather than a generic failure.
      error.code === '42501' ? COLLECTION_ERROR_MESSAGES.COLLECTION_NOT_FOUND : FALLBACK,
      error.code === '42501' ? 'COLLECTION_NOT_FOUND' : 'RPC_ERROR',
    );
  }
  log.info('watch_move', { postId, toId: collectionId });
}
