/**
 * WHAT:  Route /alerts — thin wrapper mounting AlertsScreen outside the tabs.
 * WHY:   Route files carry no logic (docs/ARCHITECTURE.md rule 3). Reached
 *        from BOTH Profile settings rows and the Explore nudge card.
 *        Direct path, not the feature barrel: this screen pulls the UI barrel
 *        and the permissions feature, and chatApi/sightingApi import that
 *        barrel for notifySighting/notifyMessage — see the barrel's own note.
 * LINKS: src/features/notifications/screens/AlertsScreen.tsx.
 */

import { AlertsScreen } from '@/features/notifications/screens/AlertsScreen';

export default AlertsScreen;
