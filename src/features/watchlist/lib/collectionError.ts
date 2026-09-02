/**
 * WHAT:  CollectionError — a collections failure whose `message` is already
 *        user-facing, carrying the server's raised code for the caller that
 *        wants to branch on it.
 * WHY:   Its OWN module rather than a class inside collectionsApi, for the same
 *        reason vehicleSaveError is: CollectionPickerSheet narrows its toasts on
 *        `instanceof CollectionError`, so the class must be importable WITHOUT
 *        the supabase client coming with it. A test that mocks the api module
 *        and then reaches back for the real class would otherwise construct the
 *        client at import time and fail on missing env.
 * LINKS: src/features/watchlist/api/collectionsApi.ts (raises it);
 *        src/features/watchlist/components/CollectionPickerSheet.tsx (narrows
 *          its toasts on it);
 *        src/features/garage/lib/vehicleSaveError.ts (the same shape).
 */

export class CollectionError extends Error {
  /** The server's raised code (e.g. COLLECTION_NAME_TAKEN), or 'RPC_ERROR'. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
  }
}
