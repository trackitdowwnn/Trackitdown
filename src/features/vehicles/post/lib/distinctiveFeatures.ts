/**
 * WHAT:  Distinctive features — the owner's photo+description evidence pairs
 *        ("Cracked nearside wing mirror") — plus the pure add/update/remove
 *        model, the length-bounded description schema, and the caps. A pair is
 *        one local photo + a short description of what it shows.
 * WHY:   The description gives the photo meaning: it's what lets a spotter
 *        CONFIRM a car versus a lookalike. Kept as pure functions + a schema so
 *        the ordering/validation is hammered by unit tests without rendering
 *        (precedent: photoGridModel.ts, carColours.ts). GUARDRAILS: a photo is
 *        useless without a description, so a pair is only complete with BOTH;
 *        descriptions are trimmed and length-bounded (3–80); at most 8 pairs.
 *        Gallery upload is fine here — this is the OWNER photographing their own
 *        car (which they may no longer have), NOT spotter evidence, so the
 *        sightings camera-only rule (docs/DOMAIN.md, ADR-0003) does NOT apply.
 * LINKS: src/features/vehicles/post/components/DistinctiveFeaturesField.tsx
 *          (the card list + editor); src/features/vehicles/post/api/postApi.ts
 *          (uploads each photo, maps to create_post); docs/DOMAIN.md.
 */

import { z } from 'zod';

import type { PickedPhoto } from '@/shared/ui';

/** One evidence pair: a local photo + a description of what it shows. */
export interface DistinctiveFeature {
  photo: PickedPhoto;
  description: string;
}

/** Optional step: many cars have none. At most this many pairs. */
export const MAX_DISTINCTIVE_FEATURES = 8;
/** Description bounds — long enough to mean something, short enough to scan. */
export const DESCRIPTION_MIN = 3;
export const DESCRIPTION_MAX = 80;

/** A description: trimmed, 3–80 chars. Required once a photo is added. */
export const descriptionSchema = z
  .string()
  .trim()
  .min(DESCRIPTION_MIN, `Add a few words — at least ${DESCRIPTION_MIN} characters.`)
  .max(DESCRIPTION_MAX, `Keep it under ${DESCRIPTION_MAX} characters.`);

const photoShape = z.object({
  uri: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

/** One complete pair — the shape create_post's client mapping validates. */
export const distinctiveFeatureSchema = z.object({
  photo: photoShape,
  description: descriptionSchema,
});

/** The whole ordered list, capped — the submit-completeness schema for the step. */
export const distinctiveFeaturesSchema = z
  .array(distinctiveFeatureSchema)
  .max(MAX_DISTINCTIVE_FEATURES)
  .default([]);

/** A photo with no description is half-useful — a draft needs BOTH to add. */
export function isCompleteDraft(photo: PickedPhoto | null, description: string): boolean {
  return photo != null && descriptionSchema.safeParse(description).success;
}

/** Whether another pair can be added (cap MAX_DISTINCTIVE_FEATURES). */
export function canAddMore(list: DistinctiveFeature[]): boolean {
  return list.length < MAX_DISTINCTIVE_FEATURES;
}

/** Append a pair (order preserved; description trimmed). */
export function addFeature(
  list: DistinctiveFeature[],
  feature: DistinctiveFeature,
): DistinctiveFeature[] {
  return [...list, { photo: feature.photo, description: feature.description.trim() }];
}

/** Replace the pair at `index` (out-of-range → list unchanged). */
export function updateFeatureAt(
  list: DistinctiveFeature[],
  index: number,
  feature: DistinctiveFeature,
): DistinctiveFeature[] {
  if (index < 0 || index >= list.length) {
    return list;
  }
  const next = [...list];
  next[index] = { photo: feature.photo, description: feature.description.trim() };
  return next;
}

/** Remove the pair at `index`, preserving the order of the rest. */
export function removeFeatureAt(list: DistinctiveFeature[], index: number): DistinctiveFeature[] {
  if (index < 0 || index >= list.length) {
    return list;
  }
  return list.filter((_, i) => i !== index);
}
