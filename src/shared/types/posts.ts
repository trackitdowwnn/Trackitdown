/**
 * WHAT:  Cross-feature domain types for stolen-car posts — the PostStatus
 *        lifecycle union (mirroring the SQL enum) and the PostSummary shape
 *        that list/card surfaces render.
 * WHY:   Post status and summaries cross feature lines (search-map feed,
 *        vehicles/my-posts, profile, notifications), so they live in
 *        shared/types per docs/ARCHITECTURE.md. The database enum is the
 *        source of truth — if `public.post_status` changes in a migration,
 *        this union must change in the same commit.
 * LINKS: supabase/migrations/20260707110712_payments_foundation.sql
 *        (post_status enum); docs/DOMAIN.md (lifecycle);
 *        src/shared/ui/VehicleCard.tsx (renderer of PostSummary).
 */

/** Lifecycle of a post. Mirrors `public.post_status` — keep in sync. */
export type PostStatus =
  | 'draft'
  | 'pending_verification'
  | 'active'
  | 'recovery_claimed'
  | 'recovered'
  | 'recovered_no_spotter'
  | 'cancelled'
  | 'expired'
  | 'rejected';

/** One photo on a post, as list surfaces need it. */
export interface PostPhoto {
  /** Public (or signed) URL of the image. */
  uri: string;
  /** Thumbhash placeholder string, when the upload pipeline produced one. */
  thumbhash?: string;
}

/** The slice of a post that cards and list rows render. */
export interface PostSummary {
  id: string;
  photos: PostPhoto[];
  make: string;
  model: string;
  colour: string;
  /** UK registration, formatted for display ("AB12 CDE"); null if the car has
   *  no plate (make/model are the identity then). */
  plate: string | null;
  status: PostStatus;
  /** ISO timestamp of the last-seen report. */
  lastSeenAt: string;
  /** Human area name ("Camden"); optional — location precision varies. */
  lastSeenArea?: string;
  /** Distance from the viewer, when location is available. */
  distanceMiles?: number;
  /**
   * Bounty in integer pence (docs/DOMAIN.md: money is never floats), or NULL
   * for a no-reward listing paid for with the fixed platform fee (ADR-0014).
   *
   * NULL, never 0 — a 0 would render as "£0 bounty" on every card and pin. Do
   * NOT coalesce this to 0 at a call site to satisfy the compiler; render
   * NO_BOUNTY_LABEL (or pass the null straight to BountyTag, which owns that
   * decision). The nullability is deliberately load-bearing.
   */
  bountyPence: number | null;
}
