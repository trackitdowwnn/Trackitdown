/**
 * WHAT:  Route /alerts/new — the create-an-alert wizard.
 * WHY:   Thin per ARCHITECTURE.md rule 3. Presented with modal grammar
 *        (slide_from_bottom, registered in _layout.tsx) because it is a
 *        self-contained TASK over the app, like post-a-car and report-sighting.
 * LINKS: src/features/notifications/screens/AlertWizardScreen.tsx.
 */

import { AlertWizardScreen } from '@/features/notifications/screens/AlertWizardScreen';

export default function NewAlertRoute() {
  return <AlertWizardScreen />;
}
