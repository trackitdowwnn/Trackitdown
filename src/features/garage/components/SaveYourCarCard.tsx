/**
 * WHAT:  SaveYourCarCard — the peacetime nudge in the Explore feed. Offers
 *        "add your car" in one tap, and can be dismissed for good.
 * WHY:   The garage only pays off if it is filled in BEFORE anything goes wrong,
 *        and nothing else tells people it exists unless they happen to open
 *        Profile. This is the one reaching surface — inline and ignorable, never
 *        an interruption, because the user came to the feed to look at cars.
 *
 *        A NudgeRow, not a card: the old ~265dp card sat above every real car on
 *        the feed's first screen. The "60 seconds now vs seconds on the worst
 *        day" pitch survives as the row's one supporting line — no urgency, no
 *        scare tactics.
 *
 *        DISMISSIBLE, unlike the location primer, because it is a suggestion
 *        rather than a setup step.
 * LINKS: src/features/garage/hooks/useGarageNudgeCard.ts (decides when it shows);
 *        src/shared/ui/NudgeRow.tsx (the shape, shared with the other two feed
 *        nudges); src/features/search-map/screens/HomeFeedScreen.tsx (the slot).
 */

import { Car } from 'lucide-react-native';
import { memo } from 'react';

import { NudgeRow } from '@/shared/ui';

export interface SaveYourCarCardProps {
  /** Open the add-a-car flow. */
  onAdd: () => void;
  /** Dismiss for good — the offer is not made again. */
  onDismiss: () => void;
}

export const SaveYourCarCard = memo(function SaveYourCarCard({
  onAdd,
  onDismiss,
}: SaveYourCarCardProps) {
  return (
    <NudgeRow
      icon={Car}
      title="Is your car in here?"
      body="So reporting it later takes seconds."
      onPress={onAdd}
      onDismiss={onDismiss}
      testID="garage-nudge-card"
      dismissTestID="garage-nudge-dismiss"
    />
  );
});
