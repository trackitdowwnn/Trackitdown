/**
 * WHAT:  StillMissingError — an ADR-0019 liveness failure whose `message` is
 *        already user-facing, carrying the server's raised code.
 * WHY:   Its OWN module, for the reason vehicleSaveError and collectionError
 *        are: PostDetailScreen narrows its toast on `instanceof
 *        StillMissingError`, so the class has to be importable WITHOUT the
 *        supabase client coming with it. Importing it from the api module
 *        constructs the client at import time, which fails on missing env in
 *        any test that mocks the data layer — the third time this repo has
 *        learnt it, and the reason the pattern is now a pattern.
 * LINKS: src/features/vehicles/api/stillMissingApi.ts (raises it);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (narrows on it);
 *        src/features/garage/lib/vehicleSaveError.ts;
 *        src/features/watchlist/lib/collectionError.ts.
 */

export class StillMissingError extends Error {
  /** The server's raised code (NOT_AUTHENTICATED / POST_NOT_FOUND), or 'RPC_ERROR'. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'StillMissingError';
    this.code = code;
  }
}
