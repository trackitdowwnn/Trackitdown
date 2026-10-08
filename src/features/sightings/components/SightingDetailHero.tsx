/**
 * WHAT:  The sighting page's hero — the spotter's evidence photos, full-bleed
 *        and swipeable (the shared PhotoPager), with a library photo marked
 *        ON the photo "From photo library", the counter lifted clear of the
 *        content sheet that rides over the hero's foot.
 * WHY:   The redesign (2026-10-08, "hard to read and understand") lays the
 *        page out like the post page the owner already knows: the photos own
 *        the top, the back button floats over them. They used to be a stack
 *        of full-width images the owner had to scroll past to reach anything.
 *
 *        ADR-0003: a gallery photo is context, not capture-moment evidence,
 *        and must be labelled UNMISSABLY — on the photo itself, and in its
 *        spoken label, not in a caption a swipe away.
 * LINKS: src/shared/ui/PhotoPager.tsx;
 *        src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/features/vehicles/components/PostHero.tsx (the same shape).
 */

import { Camera } from 'lucide-react-native';

import { radii } from '@/shared/theme';
import { PhotoPager } from '@/shared/ui';

import type { OwnerSighting } from '../types';

export interface SightingDetailHeroProps {
  photos: OwnerSighting['photos'];
  /** Signed URLs by storage path; a photo without one yet is an empty page. */
  photoUrls: Record<string, string>;
  width: number;
  height: number;
}

/** The evidence photos, full-bleed — see the header. */
export function SightingDetailHero({ photos, photoUrls, width, height }: SightingDetailHeroProps) {
  return (
    <PhotoPager
      photos={photos.map((photo) => ({
        uri: photoUrls[photo.path],
        badge: photo.source === 'gallery' ? 'From photo library' : undefined,
      }))}
      height={height}
      estimatedWidth={width}
      // PhotoPager adds "photo 2 of 3" itself.
      alt="Sighting"
      placeholderIcon={Camera}
      placeholderLabel="No photos with this sighting"
      // Clear of the content sheet's rounded top, which overlaps the hero's
      // last radii.xl points (as on the post page).
      counterBottomInset={radii.xl}
      testID="sighting-photos"
    />
  );
}
