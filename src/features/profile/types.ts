/**
 * WHAT:  Types owned by the profile feature — my full profile, the three
 *        Reputation v1 counters, and the deliberately narrow PublicProfile.
 * WHY:   PublicProfile is a PRIVACY BOUNDARY, not a convenience type: it is
 *        everything an owner may learn about a spotter (docs/DOMAIN.md,
 *        SECURITY_AND_TRUST §1 — first name + reputation only). Keeping it a
 *        separate type (not Pick<MyProfile>) means adding a field is a
 *        deliberate act reviewers can see.
 * LINKS: src/features/profile/components/PublicProfileSheet.tsx;
 *        src/features/profile/api/profileApi.ts (selects match these shapes).
 */

/** Reputation v1 (docs/DOMAIN.md): server-maintained, display-only. */
export interface ReputationCounters {
  sightingsReported: number;
  sightingsHelpful: number;
  recoveriesCredited: number;
}

/** My own profile — everything the profiles row holds for its owner. */
export interface MyProfile {
  id: string;
  firstName: string;
  displayName: string;
  avatarUrl: string | null;
  /** ISO timestamp; rendered as "Member since <month year>". */
  createdAt: string;
  counters: ReputationCounters;
}

// SAFETY: the complete set of fields an owner may see about a spotter.
// No surname (display_name may contain one), no location, no contact.
// Widening this type is a privacy decision — update docs/DOMAIN.md first.
export interface PublicProfile {
  firstName: string;
  avatarUrl: string | null;
  createdAt: string;
  counters: ReputationCounters;
}
