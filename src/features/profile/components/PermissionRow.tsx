/**
 * WHAT:  One row reporting what the app is allowed to do on this device, and
 *        taking the user somewhere they can change it.
 * WHY:   `useStartupPermissionRequests` fires all four OS dialogs in sequence
 *        on the first cold start with no explanation attached to any of them
 *        (product call 2026-07-21 — there is deliberately no gate screen). So
 *        someone who tapped "Don't allow" four times has, today, no route back
 *        except finding the app inside the OS settings app themselves. This row
 *        is the audit surface that was missing.
 *
 *        ⚠️ IT IS A STATUS ROW, NOT A SWITCH, AND THAT IS NOT A COMPROMISE.
 *        An app cannot grant itself a permission. A switch here could only
 *        deep-link and then snap back when the user returns without granting,
 *        which reads as a control that failed — the single most reported kind
 *        of settings bug. A row that states the truth and opens the place where
 *        it can be changed is the honest shape.
 *
 *        ⚠️ `denied` DEEP-LINKS EVEN WHEN `canAskAgain` IS TRUE, which diverges
 *        from the house rule (`canAskAgain === false → openSettings, else
 *        request()`) seen at AlertsScreen, CameraCapture and PhotoGridPicker.
 *        Every one of those fires `request()` from behind a PermissionPrimer
 *        that has just explained WHY. A bare settings row has no primer, and on
 *        Android a second refusal is permanent — spending that last chance on
 *        an unexplained dialog would be worse than sending them somewhere they
 *        can see the choice in context. `undetermined` still prompts, because
 *        iOS does not list an app's permission until it has been asked once,
 *        so deep-linking there is a dead end.
 * LINKS: src/features/permissions (useDevicePermission — status, and the
 *          useFocusEffect re-check that makes the round trip work);
 *        ../screens/SettingsScreen.tsx (the only consumer);
 *        src/features/notifications/screens/AlertsScreen.tsx:105 (the house
 *          primer-backed branch this deliberately differs from).
 */

import type { LucideIcon } from 'lucide-react-native';
import { Linking } from 'react-native';

import { useDevicePermission, type PermissionKind } from '@/features/permissions';
import { createLogger } from '@/shared/lib/logger';
import { ListRow, useToast } from '@/shared/ui';

const log = createLogger('permissions');

export interface PermissionRowProps {
  kind: PermissionKind;
  icon: LucideIcon;
  title: string;
  /** Why the app wants it — the primer this row does not otherwise have. */
  subtitle: string;
  testID?: string;
}

export function PermissionRow({ kind, icon, title, subtitle, testID }: PermissionRowProps) {
  const permission = useDevicePermission(kind);
  const toast = useToast();

  const state = permission.status?.state;

  // ⚠️ Not rendered at all when the native module is missing — degrade by
  // omission, the same rule `isUngranted` follows ("unavailable never gates").
  // A row saying "Unavailable" would be an apology for a platform the user is
  // not on.
  if (state === 'unavailable') return null;

  const openSettings = () => {
    // Can reject on stripped Android builds — the EditProfileScreen precedent
    // catches into a toast rather than leaving a bare unhandled rejection.
    Linking.openSettings().catch(() => {
      toast.show('Couldn’t open your phone’s settings.', 'error');
    });
  };

  const press = () => {
    // Guarded: `status` is null until the first silent check resolves, and a
    // press in that window should do nothing rather than guess.
    if (state === undefined) return;
    if (state === 'undetermined') {
      void permission
        .request()
        .then((next) => log.info('permission_requested', { kind, state: next.state }));
      return;
    }
    openSettings();
  };

  return (
    <ListRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      // No value at all while the check is in flight. Showing "Not set" and
      // then correcting it a beat later is worse than showing nothing, and
      // ListRow's `disabled` is not the tool — it dims the row, so four rows
      // would flash grey on every open.
      value={state === undefined ? undefined : VALUES[state]}
      onPress={press}
      testID={testID}
    />
  );
}

/**
 * What each state says.
 *
 * Plain words rather than the OS's own vocabulary ("While Using the App"),
 * because the row's job is to answer "can it?" — the OS screen the row opens
 * is where the shades of yes live.
 */
const VALUES: Record<'granted' | 'denied' | 'undetermined' | 'unavailable', string> = {
  granted: 'Allowed',
  denied: 'Not allowed',
  undetermined: 'Not set',
  unavailable: '',
};
