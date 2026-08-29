/**
 * WHAT:  AlertPermissionBanner — one compact row above the alert list saying
 *        notifications are off, and doing something about it.
 * WHY:   ⚠️ IT REPLACES A FULL PERMISSION SCREEN WEDGED INTO A LIST. The old
 *        arrangement inlined `PermissionPrimer` — a whole page, with a large
 *        emoji circle, a `display` headline and bottom-anchored actions —
 *        inside a card at the top of a scroller, and then repeated most of it
 *        as a second prose notice below. Together they pushed the actual alerts
 *        off the first screen. That is the same failure NudgeRow was built for:
 *        "whichever one showed, the tab opened on a wall of setup rather than
 *        on cars".
 *
 *        ⚠️ NO DISMISS, DELIBERATELY. NudgeRow's × is for a suggestion the user
 *        may refuse; this is a correction. Every alert below it is inert until
 *        it is answered, and a saved alert that cannot fire is exactly what the
 *        screen must not hide. This is also what retires the old primer's dead
 *        `secondaryLabel: 'Not now'` — a button that was declared and never
 *        wired, so it never rendered at all — by removing the question rather
 *        than finally answering it.
 *
 *        The two variants are not cosmetic. "Blocked" means the OS will not
 *        show a prompt again, so offering to ask would do nothing; it sends
 *        them to Settings instead, and says the alerts are kept either way.
 * LINKS: ../screens/AlertsScreen.tsx (the only consumer);
 *        src/shared/ui/NudgeRow.tsx; src/features/permissions
 *        (useDevicePermission); src/features/search-map/components/
 *        LocationPrimerCard.tsx (the precedent this copies).
 */

import { Bell, BellOff } from 'lucide-react-native';

import { NudgeRow } from '@/shared/ui';

export interface AlertPermissionBannerProps {
  /** True when the OS will not prompt again — Settings is the only route. */
  blocked: boolean;
  onPress: () => void;
  testID?: string;
}

export function AlertPermissionBanner({ blocked, onPress, testID }: AlertPermissionBannerProps) {
  return (
    <NudgeRow
      icon={blocked ? BellOff : Bell}
      title={blocked ? 'Notifications are off for Trackitdown' : 'Turn on notifications'}
      // ⚠️ Both bodies say the SAVED alerts survive. Someone who has taken the
      // trouble to draw an area needs to know a phone setting has not thrown it
      // away — that sentence was the one worth keeping from the notice this
      // replaces.
      body={
        blocked
          ? 'Saved alerts still can’t reach you. Turn them on in Settings.'
          : 'Your alerts can’t reach you until you do.'
      }
      onPress={onPress}
      // The list already pads at 24; without this the row insets itself by the
      // feed's 16 on top and sits narrower than the cards beneath it.
      gutter="none"
      testID={testID}
    />
  );
}
