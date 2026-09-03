/**
 * WHAT:  SightingWithdrawError — a withdrawal failure whose `message` is
 *        already user-facing, carrying the server's raised code.
 * WHY:   Its OWN module, for the reason vehicleSaveError, collectionError and
 *        stillMissingError are: MySightingsScreen narrows its toast on
 *        `instanceof SightingWithdrawError`, so the class has to be importable
 *        WITHOUT the supabase client coming with it. Importing it from the api
 *        module constructs the client at import time and fails on missing env
 *        in any test that mocks the data layer — the FOURTH time this repo has
 *        learnt it, which is why it is now a pattern rather than a fix.
 *
 *        It also keeps the narrowing honest: a test that mocks the api module
 *        can still use the REAL class, so a stub cannot make the guard pass
 *        while the shipped one rejects the errors it exists to show.
 * LINKS: src/features/sightings/api/sightingApi.ts (raises it, re-exports it);
 *        src/features/sightings/screens/MySightingsScreen.tsx (narrows on it);
 *        src/features/watchlist/lib/collectionError.ts (the same shape).
 */

export class SightingWithdrawError extends Error {
  /** SIGHTING_NOT_WITHDRAWABLE, or 'UNKNOWN'. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SightingWithdrawError';
    this.code = code;
  }
}
