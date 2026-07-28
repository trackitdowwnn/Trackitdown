/**
 * WHAT:  Route for editing a saved car — the same wizard as add-vehicle, seeded
 *        from the garage row named by the path param.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): read the param,
 *        hand it to the screen. One screen serves both modes because the flow
 *        and the mapping are identical — only the RPC differs.
 * LINKS: src/features/garage/screens/AddVehicleScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { AddVehicleScreen } from '@/features/garage';

export default function EditVehicleRoute() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  return <AddVehicleScreen vehicleId={vehicleId} />;
}
