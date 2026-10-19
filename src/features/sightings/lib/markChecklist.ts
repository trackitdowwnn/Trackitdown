/**
 * WHAT:  markChecklist — the owner's marks as the sighting page lists them:
 *        the marks this spotter was ASKED about, in the owner's order, each
 *        flagged seen or not by the spotter's ticks — plus whether that list
 *        is complete ("Seen 1 of 3") or only the seen ones.
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

import type { ConfirmableFeature } from '../types';

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
