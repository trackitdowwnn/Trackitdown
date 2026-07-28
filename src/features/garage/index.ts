/**
 * WHAT:  Public API of the garage feature (saved vehicles / "My cars").
 * WHY:   Routes and other features import ONLY from here (ARCHITECTURE.md
 *        rule 1); the api layer, wizard flow and cards stay internal. Note the
 *        one-way dependency: garage imports the shared vehicle-identity steps
 *        from features/vehicles, and features/vehicles must never import the
 *        garage back — see types.ts for why.
 * LINKS: src/features/garage/README.md.
 */

export { AddVehicleScreen, type AddVehicleScreenProps } from './screens/AddVehicleScreen';
// The nudge surface. Other features read the saved-car signal through this hook
// and never touch the store directly.
export { useHasSavedCar, type SavedCarState } from './hooks/useHasSavedCar';
export { useGarageNudgeCard, type UseGarageNudgeCardResult } from './hooks/useGarageNudgeCard';
export { SaveYourCarCard, type SaveYourCarCardProps } from './components/SaveYourCarCard';
export { SaveYourCarSheet } from './components/SaveYourCarSheet';
export { requestSaveCarNudge } from './lib/exitNudgeIntent';
// The mirror image of the exit nudge: shown when the user HAS saved cars.
// Reached from the tab bar's + only when there are cars to choose between.
export { ChooseCarToReportScreen } from './screens/ChooseCarToReportScreen';
export { MyCarsScreen } from './screens/MyCarsScreen';
export {
  ReportSavedCarScreen,
  type ReportSavedCarScreenProps,
} from './screens/ReportSavedCarScreen';
export type {
  AddVehicleAnswers,
  SavedVehicle,
  SavedVehicleFeature,
  SavedVehiclePhoto,
  SaveVehicleParams,
  VehicleVerificationState,
} from './types';
export { MAX_VEHICLES } from './types';
