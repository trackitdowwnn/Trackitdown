/**
 * WHAT:  Route /alerts/[alertId] — the SAME wizard, editing an existing alert.
 * WHY:   Thin per ARCHITECTURE.md rule 3: it parses the param and hands it on.
 *        One flow serves create and edit (the garage's AddVehicleScreen makes
 *        the same call); the screen holds a loader until the alert arrives,
 *        because update is a full replace and blank answers would wipe it.
 * LINKS: src/features/notifications/screens/AlertWizardScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { AlertWizardScreen } from '@/features/notifications/screens/AlertWizardScreen';

export default function EditAlertRoute() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  return <AlertWizardScreen alertId={alertId} />;
}
