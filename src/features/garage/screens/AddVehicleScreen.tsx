/**
 * WHAT:  The add-a-car / edit-a-car wizard screen — renders the add-vehicle flow
 *        via the shared WizardScreen and owns the save. Handles BOTH modes: with
 *        a `vehicleId` it seeds the wizard from that saved car and updates it;
 *        without one it creates.
 * WHY:   The route file stays thin (ARCHITECTURE.md rule 3); this is where the
 *        flow meets the data layer. One screen for both modes because the flow
 *        and the mapping are identical — only the RPC and the toast differ, and
 *        a separate EditVehicleScreen would be the same file with two words
 *        changed. On failure it RE-THROWS so the framework keeps the wizard
 *        intact with an inline error and the owner can retry without re-entering
 *        anything (the same rule the posting submit follows: never lose an edit
 *        to a blip).
 * LINKS: src/app/add-vehicle.tsx + src/app/edit-vehicle/[vehicleId].tsx (routes);
 *        src/features/garage/lib/addVehicleFlow.tsx;
 *        src/features/garage/api/garageApi.ts;
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { fetchPostDetail } from '@/features/vehicles';
import { successHaptic } from '@/shared/lib/haptics';
import { createLogger } from '@/shared/lib/logger';
import { spacing } from '@/shared/theme';
import { EmptyState, ErrorState, FullscreenLoader, Screen, useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { addVehicle, updateVehicle } from '../api/garageApi';
import { useMyVehicles } from '../hooks/useMyVehicles';
import { ADD_VEHICLE_INITIAL_ANSWERS, buildAddVehicleFlow } from '../lib/addVehicleFlow';
import { postToAnswers, toAnswers } from '../lib/vehicleAnswers';
import type { AddVehicleAnswers } from '../types';

// Ids and reasons only — never a plate (docs/LOGGING.md).
const log = createLogger('garage');

export interface AddVehicleScreenProps {
  /** Present = edit that saved car; absent = add a new one. */
  vehicleId?: string;
  /** Add a NEW car starting from this (recovered) listing's details — the
   *  "save it to My cars" offer after a recovery (2026-10-27). */
  fromPostId?: string;
}

export function AddVehicleScreen({ vehicleId, fromPostId }: AddVehicleScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const { status, vehicles, retry } = useMyVehicles();

  const flow = useMemo(() => buildAddVehicleFlow(), []);

  const existing = vehicleId ? vehicles.find((v) => v.id === vehicleId) : undefined;

  // undefined = still reading the listing; null = no seed. A failed read falls
  // back to a blank form: adding a car is never destructive, unlike edit mode.
  const [postAnswers, setPostAnswers] = useState<AddVehicleAnswers | null | undefined>(
    fromPostId ? undefined : null,
  );
  useEffect(() => {
    if (!fromPostId) return;
    let live = true;
    // Not silent: the owner was promised their car's details, so say so.
    const fallBack = (reason: string) => {
      if (!live) return;
      log.warn('save_car_seed_failed', { reason });
      toast.show('Couldn’t load your car’s details.', 'error');
      setPostAnswers(null);
    };
    fetchPostDetail(fromPostId)
      .then((result) => {
        if (result.kind !== 'visible') return fallBack(result.kind);
        if (live) setPostAnswers(postToAnswers(result.post));
      })
      .catch(() => fallBack('fetch_failed'));
    return () => {
      live = false;
    };
  }, [fromPostId, toast]);

  // Edit mode waits for the garage to load before seeding, so the wizard is
  // never mounted with empty answers and then re-seeded underneath the user.
  // The same holds for a listing seed.
  const initialAnswers = useMemo(
    () =>
      existing ? toAnswers(existing) : (postAnswers ?? ADD_VEHICLE_INITIAL_ANSWERS),
    [existing, postAnswers],
  );

  if ((vehicleId && status === 'loading') || postAnswers === undefined) {
    return <FullscreenLoader visible />;
  }

  // SAFETY: update_vehicle is a FULL REPLACE. Mounting the wizard in edit mode
  // without the saved car would seed blank answers, and saving would then wipe
  // the plate, nickname, year, body type, photos and distinctive features —
  // silently destroying data the owner never chose to change. So a failed load,
  // or a car that has since been removed, must stop here rather than fall
  // through to an empty form.
  if (vehicleId && (status === 'error' || !existing)) {
    return (
      <Screen>
        <View style={styles.state}>
          {status === 'error' ? (
            <ErrorState body="We couldn't load your car." onRetry={retry} />
          ) : (
            <EmptyState
              title="We couldn't find that car"
              body="It may have been removed from My cars."
              actionLabel="Back to my cars"
              onAction={() => router.replace('/my-cars')}
            />
          )}
        </View>
      </Screen>
    );
  }

  const handleComplete = async (answers: Partial<AddVehicleAnswers>) => {
    // Passed through PARTIAL, deliberately. Four of this flow's steps are
    // optional, so skipping them all is a normal path and the answers really
    // are incomplete; the api layer fills the defaults. Casting to the complete
    // type here (which this used to do) crashed on `photos.entries()` for
    // anyone who saved a car without adding photos.
    if (vehicleId) {
      await updateVehicle(vehicleId, answers);
      successHaptic();
      toast.show('Car updated', 'success');
    } else {
      await addVehicle(answers);
      successHaptic();
      toast.show('Saved to My cars', 'success');
    }
    // back(), not replace(): the owner came FROM /my-cars, so replacing would
    // stack a second copy of it and defeat the refocus revalidation that
    // useMyVehicles is built for.
    router.back();
  };

  return (
    <WizardScreen
      flow={flow}
      initialAnswers={initialAnswers}
      onExit={() => router.back()}
      onComplete={handleComplete}
    />
  );
}

const styles = StyleSheet.create({
  state: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
});
