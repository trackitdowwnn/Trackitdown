/**
 * WHAT:  ReportSavedCarScreen — "Report this car stolen" from a garage card.
 *        Loads the saved car, builds the post-a-car wizard with its vehicle
 *        phase collapsed to a confirm step, and hands off to the ordinary
 *        posting screen behaviour (create draft → escrow → live).
 * WHY:   This screen is the garage's whole reason to exist, and it is also what
 *        keeps the two features acyclic: the GARAGE resolves the vehicle and
 *        maps it down to plain answers, so features/vehicles never imports a
 *        SavedVehicle (ARCHITECTURE.md rule 1). A missing or already-posted car
 *        must fail kindly rather than drop someone into a broken wizard at the
 *        worst moment.
 * LINKS: src/app/report-stolen/[vehicleId].tsx (route);
 *        src/features/garage/lib/prefilledPostFlow.tsx;
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (the submit path
 *          this reuses via PostACarScreen's own flow prop).
 */

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  POST_A_CAR_INITIAL_ANSWERS,
  PostACarScreen,
  postACarFlow,
} from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';
import { spacing } from '@/shared/theme';
import { Button, EmptyState, ErrorState, FullscreenLoader, Screen } from '@/shared/ui';

import { useMyVehicles } from '../hooks/useMyVehicles';
import { buildPrefilledPostFlow } from '../lib/prefilledPostFlow';

const log = createLogger('garage');

export interface ReportSavedCarScreenProps {
  vehicleId: string;
}

export function ReportSavedCarScreen({ vehicleId }: ReportSavedCarScreenProps) {
  const router = useRouter();
  const { status, vehicles, retry } = useMyVehicles();
  // Set when the owner taps Edit on the confirm step — restores the full seven
  // steps, seeded with the same answers.
  const [expanded, setExpanded] = useState(false);

  const vehicle = vehicles.find((v) => v.id === vehicleId);

  const onEdit = useCallback(() => {
    log.info('garage_prefill_expanded', { vehicleId });
    setExpanded(true);
  }, [vehicleId]);

  const prefilled = useMemo(
    () =>
      vehicle
        ? buildPrefilledPostFlow({
            baseFlow: postACarFlow,
            baseInitialAnswers: POST_A_CAR_INITIAL_ANSWERS,
            vehicle,
            expanded,
            onEdit,
          })
        : null,
    [vehicle, expanded, onEdit],
  );

  if (status === 'loading') {
    return <FullscreenLoader visible />;
  }

  // A FAILED LOAD IS NOT A MISSING CAR. useMyVehicles returns ready-and-empty on
  // error, so without this branch a network blip would tell someone whose car
  // has just been stolen that their saved car was deleted — untrue, and the
  // worst possible sentence at the worst possible moment.
  if (status === 'error') {
    return (
      <Screen>
        <View style={styles.state}>
          <ErrorState body="We couldn't load your cars." onRetry={retry} />
          <Button
            label="Report a stolen car from scratch"
            variant="ghost"
            onPress={() => router.replace('/post-a-car')}
          />
        </View>
      </Screen>
    );
  }

  // Genuinely gone — removed on another device, say.
  if (!vehicle) {
    return (
      <Screen>
        <View style={styles.state}>
          <EmptyState
            title="We couldn't find that car"
            body="It may have been removed from your garage. You can still report a car stolen from scratch."
            actionLabel="Report a stolen car"
            onAction={() => router.replace('/post-a-car')}
          />
        </View>
      </Screen>
    );
  }

  if (vehicle.isCurrentlyPosted) {
    return (
      <Screen>
        <View style={styles.state}>
          <EmptyState
            title="Already reported"
            body="This car already has a live listing — you can keep updating it there."
            actionLabel="View the listing"
            onAction={() =>
              vehicle.activePostId
                ? router.replace(`/post/${vehicle.activePostId}`)
                : router.replace('/my-cars')
            }
          />
        </View>
      </Screen>
    );
  }

  return (
    <PostACarScreen flow={prefilled?.flow} initialAnswers={prefilled?.initialAnswers} />
  );
}

const styles = StyleSheet.create({
  state: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
});
