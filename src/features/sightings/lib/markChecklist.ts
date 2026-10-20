/**
 * WHAT:  markChecklist — the owner's marks as the sighting page lists them:
 *        the marks this spotter was ASKED about, in the owner's order, each
 *        flagged seen or not by the spotter's ticks — plus whether that list
 *        is complete ("Seen 1 of 3") or only the seen ones. And
 *        marksSeenSummary — the same count for the owner's sighting CARD
 *        ("Saw 2 of 3 marks", 2026-10-20), from the sighting alone.
 * WHY:   The owner asked to read the marks the way the spotter answered them
 *        (2026-10-19): the whole "Could you see any of these?" list with the
 *        seen ones ticked — what was NOT seen says something too.
 *
 *        ⚠️ "NOT SEEN" ONLY OF A MARK THAT WAS OFFERED (code review,
 *        2026-10-19). A mark added after the report, a report from before the
 *        wizard asked, or a wizard whose marks never loaded were never put to
 *        the spotter — calling them "not seen" would put words in their
 *        mouth. So the list is the listing's marks ∩ the sighting's
 *        `offeredFeatureIds` (recorded server-side since 2026-10-19, mark ids
 *        kept stable across edits since the same migration). Without both —
 *        the listing not read yet, or an older report — it is the seen marks
 *        alone, and `complete` is false, so the page claims no total. Each is
 *        still the LISTING's copy when the listing has been read: the
 *        sighting's own carries no photo.
 *
 *        A seen mark missing from the listing read (the two reads disagreeing
 *        — e.g. a mark removed between them) still shows, ticked, last: it is
 *        part of what was reported.
 * LINKS: ../hooks/useSightingPost.ts (the listing's marks);
 *        ../components/SightingSeenSection.tsx (renders it with MarkTile);
 *        supabase/migrations (sightings.offered_feature_ids).
 */

import type { ConfirmableFeature, OwnerSighting } from '../types';

/**
 * "Saw 2 of 3 marks" for the owner's sighting CARD (2026-10-20) — the count
 * alone, from the sighting itself (no listing read): of the marks the spotter
 * was ASKED about, how many they could see. Null when that isn't known — an
 * older report (null offered) or one that showed no marks (empty) — so the
 * card never claims a total it doesn't have (the page's "Seen 1 of 3" rule).
 * A seen mark outside the offered set is not counted.
 */
export function marksSeenSummary(
  sighting: Pick<OwnerSighting, 'confirmedFeatures' | 'offeredFeatureIds'>,
): { seen: number; of: number } | null {
  const offered = sighting.offeredFeatureIds;
  if (!offered || offered.length === 0) return null;
  const asked = new Set(offered);
  // Distinct ids on both sides, so a repeated id can never read "3 of 2".
  const seen = new Set(
    sighting.confirmedFeatures.map((mark) => mark.id).filter((id) => asked.has(id)),
  );
  return { seen: seen.size, of: asked.size };
}

export interface MarkCheck {
  mark: ConfirmableFeature;
  seen: boolean;
}

export interface MarkChecklist {
  checks: MarkCheck[];
  /** Every mark the spotter was asked about is here, seen or not — so the
   *  page may say "Seen N of M". False: the seen ones alone. */
  complete: boolean;
}

/**
 * The marks to list for one sighting.
 *
 * @param listingMarks every mark on the listing now, or null if not read.
 * @param seenMarks    the marks the spotter ticked (the sighting's own).
 * @param offeredIds   the marks the spotter was asked about, or null/undefined
 *                     when unknown.
 */
export function markChecklist(
  listingMarks: readonly ConfirmableFeature[] | null,
  seenMarks: readonly ConfirmableFeature[],
  offeredIds: readonly string[] | null | undefined,
): MarkChecklist {
  if (listingMarks === null || offeredIds == null) {
    // The seen marks alone — but each as the LISTING's copy when there is
    // one: the sighting's own carries no photo (get_post_sightings keeps it
    // lean), and an older report showed its marks as bare text (owner,
    // 2026-10-19: "the image is not showing").
    const fromListing = new Map((listingMarks ?? []).map((mark) => [mark.id, mark]));
    return {
      checks: seenMarks.map((mark) => ({ mark: fromListing.get(mark.id) ?? mark, seen: true })),
      complete: false,
    };
  }
  const seenIds = new Set(seenMarks.map((mark) => mark.id));
  const offered = new Set(offeredIds);
  const listed = listingMarks.filter((mark) => offered.has(mark.id));
  const listedIds = new Set(listed.map((mark) => mark.id));
  return {
    checks: [
      ...listed.map((mark) => ({ mark, seen: seenIds.has(mark.id) })),
      ...seenMarks.filter((mark) => !listedIds.has(mark.id)).map((mark) => ({ mark, seen: true })),
    ],
    complete: true,
  };
}
