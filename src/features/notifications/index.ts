/**
 * WHAT:  Public API of the notifications feature.
 * WHY:   Other code (route files, the root layout, the Explore feed, Profile)
 *        imports ONLY from here (docs/ARCHITECTURE.md rule 1). The payload
 *        schema, the send plumbing, and the api layer stay internal — a
 *        push payload must have exactly one construction site.
 * LINKS: src/features/notifications/README.md.
 */

// The Profile summary row reads the alert shape; the bounds are shared copy.
export type { Alert, AlertCriteria } from './types';
export {
  MIN_RADIUS_MILES,
  MAX_RADIUS_MILES,
  MAX_ALERTS_PER_DAY,
  MAX_ALERTS_PER_USER,
} from './types';

// Sign-out must release this device before the session drops (features/profile
// calls it from signOut). Exported as the ONE token-lifecycle action other
// features may take — registration is owned by NotificationsHost.
export { unregisterCurrentPushToken } from './api/pushTokenApi';

// The ONE way another feature causes a push. All fire-and-forget and never
// throw — a notification must not be able to fail the action that caused it.
// Authorisation is enforced server-side by the claim RPCs.
export { notifyCredited, notifyMessage, notifySighting } from './api/notifyApi';

// Alert state, read by Profile's summary row and the Explore nudge card. Its
// deps are React, the api layer and useSession — imported by MODULE path, not
// the auth barrel, precisely to keep this file within the budget below.
export { useMyAlerts, invalidateMyAlerts, type MyAlertsState } from './hooks/useMyAlerts';

// ---------------------------------------------------------------------------
// THIS BARREL IS DELIBERATELY LIGHT. chatApi and sightingApi import it just to
// call notifySighting/notifyMessage, so anything reaching expo-notifications,
// react-native-maps, AsyncStorage, the auth gate or the shared/ui barrel would
// land in those plain api modules' module graph — and their tests would have
// to mock the native map and AsyncStorage merely to load the file. (That is
// not hypothetical: it broke them twice while this feature was built.)
//
// Same call as AppMap's absence from the shared/ui barrel. The heavy exports
// are imported by their single consumer, by path:
//   src/app/_layout.tsx        -> components/NotificationsHost
//   src/app/alerts/index.tsx   -> screens/AlertsScreen
//   src/app/alerts/new|[id]    -> screens/AlertWizardScreen
//   search-map/HomeFeedScreen  -> components/AlertNudgeCard
//                              -> hooks/useAlertNudgeCard
// Before adding an export here, check what it drags in.
//
// pushRoute / pushPayload are also deliberately absent: nothing outside this
// feature should be able to construct or interpret a push payload.
// ---------------------------------------------------------------------------
