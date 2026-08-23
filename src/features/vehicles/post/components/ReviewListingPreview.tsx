/**
 * WHAT:  The listing preview at the top of the posting wizard's review step:
 *        the cover photo with the car's identity over its lower edge, an Edit
 *        that jumps to the photos step, and a quiet line naming what a spotter
 *        will have to go on.
 * WHY:   Until 2026-08-22 the review described a seven-photo listing as
 *        "Photos — 5 added". A count tells someone how many they picked; it
 *        never tells them whether a stranger could recognise their car from
 *        them, which is the only question this screen is really asking.
 *
 *        ⚠️ THE REGISTER IS VERIFICATION, NOT PRIDE. The reference flow shows
 *        a host their listing to sell the anticipation of guests arriving.
 *        This screen is reached by someone whose car was stolen hours ago, so
 *        the same pattern has to carry a different sentence: not "look what
 *        you've made" but "would someone else know this car if they passed
 *        it?". No celebration copy, and nothing here may imply an outcome —
 *        photos affect whether a car is RECOGNISED, and we measure nothing
 *        about whether one is recovered.
 *
 *        ⚠️ AND IT MUST NOT OVERCLAIM. This is a 4:5 confirmation hero, not
 *        the 4:3 feed card a spotter actually scrolls, so the copy says what
 *        spotters go on — never "this is exactly what spotters see", which
 *        would be a promise about a layout this is not.
 * LINKS: src/shared/ui/MediaIdentityCard.tsx (the layout + its rules);
 *        src/features/vehicles/post/postACarFlow.tsx (wires it into
 *          review.header); src/features/garage/components/VehicleSummaryStep.tsx
 *          (the sibling consumer).
 */

import { Car } from 'lucide-react-native';

import { MediaIdentityCard } from '@/shared/ui';

import { BODY_TYPE_UNKNOWN } from '../lib/bodyTypes';
import { swatchForName } from '../lib/carColours';
import type { PostACarAnswers } from '../types';

/** The step the preview's Edit jumps to — photos are what it is showing. */
export const PREVIEW_EDIT_STEP_ID = 'photos';

/**
 * "Blue BMW 3 Series", degrading cleanly while the flow is half-answered.
 *
 * The two ESCAPE colours ("Other", "Multicolour / wrapped") are not colours,
 * they are the swatch grid admitting it has none — so "Other BMW 3 Series" is
 * worse than "BMW 3 Series". Both open the note field, and the note is the bit
 * that actually says what the car looks like, so it takes their place. Mirrors
 * the colour step's own reviewValue.
 */
function identityLine(answers: Partial<PostACarAnswers>): string {
  const swatch = swatchForName(answers.colour);
  const colour = swatch?.note ? answers.colourNote?.trim() : answers.colour;
  const parts = [colour, answers.make, answers.model].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  return parts.length > 0 ? parts.join(' ') : 'Your car';
}

/**
 * "2018 · Hatchback" — only the parts they actually gave; both are optional.
 *
 * BODY_TYPE_UNKNOWN is the step's escape, stored but NOT a known fact, so it is
 * suppressed here exactly as buildCarDetailRows suppresses it on the listing:
 * "2018 · Not sure" over the photo states a non-fact in the largest supporting
 * line on the screen.
 */
function detailLine(answers: Partial<PostACarAnswers>): string | undefined {
  const bodyType = answers.bodyType?.trim();
  const parts = [
    answers.year ? String(answers.year) : null,
    bodyType && bodyType !== BODY_TYPE_UNKNOWN ? bodyType : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * What a spotter has to work from. Distinctive features are named separately
 * from photos because they are the detail that separates one silver hatchback
 * from every other silver hatchback.
 */
function captionLine(answers: Partial<PostACarAnswers>): string | undefined {
  const photos = answers.photos?.length ?? 0;
  const marks = answers.distinctiveFeatures?.length ?? 0;
  // Nothing to go on yet — and "Spotters will have 0 photos to go on" under an
  // empty frame is a scolding, which is not this screen's job.
  if (photos === 0 && marks === 0) {
    return undefined;
  }
  // Each clause only when its count is non-zero. Guarding just the 0/0 case
  // still printed "Spotters will have 0 photos and 1 distinctive feature to go
  // on" — the same scolding, one clause narrower.
  const parts = [
    photos > 0 ? (photos === 1 ? '1 photo' : `${photos} photos`) : null,
    marks > 0 ? (marks === 1 ? '1 distinctive feature' : `${marks} distinctive features`) : null,
  ].filter((part): part is string => Boolean(part));
  // "Distinctive features", not "marks": every other surface in the app calls
  // them that, including the row a few inches below this one.
  return `Spotters will have ${parts.join(' and ')} to go on.`;
}

export interface ReviewListingPreviewProps {
  answers: Partial<PostACarAnswers>;
  onEditPhotos: () => void;
}

export function ReviewListingPreview({ answers, onEditPhotos }: ReviewListingPreviewProps) {
  return (
    <MediaIdentityCard
      uri={answers.photos?.[0]?.uri}
      name={identityLine(answers)}
      metaText={detailLine(answers)}
      caption={captionLine(answers)}
      onEdit={onEditPhotos}
      editAccessibilityLabel="Edit your photos"
      placeholderIcon={Car}
      testID="review-listing-preview"
      editTestID="review-listing-preview-edit"
    />
  );
}
