/**
 * WHAT:  ReportSavedCarScreen — "Report this car stolen" from a garage card.
 *        Finds the saved car (from the shared garage cache when it's known,
 *        so usually on the first frame) and hands it to PrefilledReport —
 *        the same prefilled wizard the report host's chooser uses.
 * WHY:   This screen is the garage's whole reason to exist, and it is also what
 *        keeps the two features acyclic: the GARAGE resolves the vehicle and
 *        maps it down to plain answers, so features/vehicles never imports a
 *        SavedVehicle (ARCHITECTURE.md rule 1). A missing or already-posted car
 *        must fail kindly rather than drop someone into a broken wizard at the
 *        worst moment.
 *
 *        While the garage loads it shows ReportPending (the exit ✕, then a
 *        quiet line) — never FullscreenLoader, a native modal that is for
 *        submit-style waits and popped mid-transition here (2026-10-07).
 * LINKS: src/app/report-stolen/[vehicleId].tsx (route);
 *        src/features/garage/components/PrefilledReport.tsx;
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (the submit path
 *          this reuses via PostACarScreen's own flow prop).
 */

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/shared/theme';
import { Button, EmptyState, ErrorState, Screen } from '@/shared/ui';

import { PrefilledReport } from '../components/PrefilledReport';
import { ReportHeader } from '../components/ReportHeader';
import { ReportPending } from '../components/ReportPending';
import { StageCover } from '../components/StageCover';
import { useMyVehicles } from '../hooks/useMyVehicles';
import type { SavedVehicle } from '../types';

/**
 * Both failure exits land on the BLANK wizard, never back on the "which car?"
 * chooser: whatever just went wrong (the car is gone, or the garage won't load)
 * would go wrong again, and a chooser that bounces someone straight back here
 * is a loop at the worst possible moment. One constant so a future edit cannot
 * change one exit and leave the other.
 */
const BLANK_POST_AFTER_PREFILL_FAILURE = '/post-a-car?start=blank' as const;

export interface ReportSavedCarScreenProps {
  vehicleId: string;
}

export function ReportSavedCarScreen({ vehicleId }: ReportSavedCarScreenProps) {
  const router = useRouter();
  const goBack = useCallback(() => router.back(), [router]);
  const { status, vehicles, retry } = useMyVehicles();
  const found = vehicles.find((v) => v.id === vehicleId);

  // ⚠️ ONCE THE REPORT IS SHOWN, IT STAYS (review of #141). The garage cache
  // is dropped the moment the post is created (so the next + won't offer this
  // car again), which sends useMyVehicles back to 'loading' — mid-payment.
  // Without this the form would be swapped for a loader, then for "Already
  // reported", under someone's finger. Held as state, set during render
  // (guarded by its own condition, so it settles).
  const [reporting, setReporting] = useState<SavedVehicle | null>(null);
  if (reporting === null && status === 'ready' && found && !found.isCurrentlyPosted) {
    setReporting(found);
  }
  const vehicle = reporting ?? found;

  const stage = reporting
    ? 'report'
    : status === 'loading'
      ? 'pending'
      : status === 'error'
        ? 'error'
        : !vehicle
          ? 'gone'
          : 'posted';

  return (
    <StageCover stageKey={stage}>
      {reporting ? (
        <PrefilledReport vehicle={reporting} />
      ) : stage === 'pending' ? (
        <ReportPending onBack={goBack} />
      ) : stage === 'error' ? (
        // A FAILED LOAD IS NOT A MISSING CAR. Without this branch a network
        // blip would tell someone whose car has just been stolen that their
        // saved car was deleted — untrue, and the worst possible sentence at
        // the worst possible moment.
        <Screen>
          <ReportHeader onBack={goBack} />
          <View style={styles.state}>
            <ErrorState body="We couldn't load your saved cars." onRetry={retry} />
            <Button
              label="Report a stolen car from scratch"
              variant="ghost"
              onPress={() => router.replace(BLANK_POST_AFTER_PREFILL_FAILURE)}
            />
          </View>
        </Screen>
      ) : stage === 'gone' ? (
        // Genuinely gone — removed on another device, say.
        <Screen>
          <ReportHeader onBack={goBack} />
          <View style={styles.state}>
            <EmptyState
              title="We couldn't find that car"
              body="It may have been removed from My cars. You can still report a car stolen from scratch."
              actionLabel="Report a stolen car"
              onAction={() => router.replace(BLANK_POST_AFTER_PREFILL_FAILURE)}
            />
          </View>
        </Screen>
      ) : (
        <Screen>
          <ReportHeader onBack={goBack} />
          <View style={styles.state}>
            <EmptyState
              title="Already reported"
              body="This car already has a live listing — you can keep updating it there."
              actionLabel="View the listing"
              onAction={() =>
                vehicle?.activePostId
                  ? router.replace(`/post/${vehicle.activePostId}`)
                  : router.replace('/my-cars')
              }
            />
          </View>
        </Screen>
      )}
    </StageCover>
  );
}

const styles = StyleSheet.create({
  state: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
});
