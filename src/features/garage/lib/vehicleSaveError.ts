/**
 * WHAT:  VehicleSaveError — a save failure whose `message` is already
 *        user-facing, carrying the server's raised code for the caller that
 *        wants to branch on it.
 * WHY:   The wizard framework surfaces a thrown error's message verbatim, so the
 *        garage's save path needs an Error whose message is safe to show. This
 *        is the garage's own rather than the posting feature's
 *        PostSubmissionError, because importing that would drag the vehicles
 *        barrel — and through PostDetailScreen, the Stripe native module — into
 *        this feature's data layer.
 * LINKS: src/features/garage/api/garageApi.ts;
 *        src/features/vehicles/post/api/postApi.ts (PostSubmissionError, the
 *          equivalent on the posting side).
 */

export class VehicleSaveError extends Error {
  /** The server's raised code (e.g. VEHICLE_LIMIT_REACHED), or 'RPC_ERROR'. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'VehicleSaveError';
    this.code = code;
  }
}
