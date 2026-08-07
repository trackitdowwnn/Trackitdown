/**
 * WHAT:  LocationPrimerCard — the compact row shown atop a national-mode feed
 *        when the user has never picked an area. Opens the area picker.
 * WHY:   The feed must never cold-fire the OS location dialog — location is
 *        personal data, opt-in (SECURITY_AND_TRUST). Routing the row to the
 *        PICKER rather than straight at the device fix keeps that rule intact:
 *        the picker's own "use my current location" button is the explicit
 *        press that may raise the prompt, so nothing fires from a feed tap.
 *
 *        A NudgeRow, not a card, and the only one of the three that stays
 *        PINNED above the feed: this is not a setup offer but a correction —
 *        every car listed beneath it is from the wrong place until it is
 *        answered — so it must not sit below the content it invalidates.
 *        No dismiss for the same reason: a setup step, not a suggestion.
 * LINKS: src/features/search-map/hooks/useFeedLocation.ts;
 *        src/shared/ui/NudgeRow.tsx (the shape, shared with the feed's other
 *        two nudges); src/shared/ui/LocationPicker.tsx
 *        (showCurrentLocationButton — the one-tap device fix, inside);
 *        docs/DESIGN_SYSTEM.md (tone: helpful, never demanding).
 */

import { MapPin } from 'lucide-react-native';
import { memo } from 'react';

import { NudgeRow } from '@/shared/ui';

export interface LocationPrimerCardProps {
  /** Opens the Set-my-area picker. No permission is involved in getting there;
   *  the picker's current-location button owns that prompt. */
  onSetArea: () => void;
}

export const LocationPrimerCard = memo(function LocationPrimerCard({
  onSetArea,
}: LocationPrimerCardProps) {
  return (
    <NudgeRow
      icon={MapPin}
      title="Show cars near you"
      body="Pick an area, or use your location."
      onPress={onSetArea}
      testID="location-primer-card"
    />
  );
});
