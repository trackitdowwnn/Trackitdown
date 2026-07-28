/**
 * WHAT:  ChooseCarToReportScreen — "Which car?", shown when someone starts a
 *        report and already has cars in their garage. Pick one and the whole
 *        vehicle phase of the wizard is prefilled; or carry on to a blank
 *        report for a car that isn't saved.
 * WHY:   The garage's payoff was reachable from ONE place — the "Report this
 *        car stolen" button inside /my-cars. Anyone who reached for the tab
 *        bar's + (the obvious thing to do when your car has just gone) retyped
 *        details the app already held. This is the missing entry point; the
 *        prefill itself is the existing /report-stolen/[vehicleId] path.
 *
 *        NOT the interstitial the README rejects. That rule ("never prompt on
 *        entry") is about a user with NO saved car being told to go and add
 *        one — strictly SLOWER than just reporting. This screen is never shown
 *        to them: the tab bar routes straight to the blank wizard unless the
 *        cached signal already says there are cars to choose from, so nobody
 *        pays a tap for a garage they haven't filled.
 *
 *        Reuses GarageCard for the photo/plate/nickname presentation, but
 *        WITHOUT its overflow: editing or removing a car is the wrong offer to
 *        someone whose car has just been stolen, and each card should present
 *        exactly one thing to do.
 * LINKS: src/app/report-stolen/index.tsx (the route);
 *        src/app/(tabs)/_layout.tsx (routes here only when cars are known);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx (where a choice
 *          lands); src/features/garage/screens/MyCarsScreen.tsx (the sibling
 *          list this borrows its shape from).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { colors, sizes, spacing, typography } from '@/shared/theme';
import { Button, ErrorState, Screen } from '@/shared/ui';

import { GarageCard } from '../components/GarageCard';
import { useMyVehicles } from '../hooks/useMyVehicles';
import type { SavedVehicle } from '../types';

const log = createLogger('garage');

export function ChooseCarToReportScreen() {
  const router = useRouter();
  const { status, vehicles, retry } = useMyVehicles();

  // A car with a live listing can't be reported again (create_post would refuse
  // it as PLATE_IN_USE). NOTE: isCurrentlyPosted is dormant today — posts.
  // vehicle_id is never written, so it is permanently false (README gap 1).
  // Filtering anyway costs nothing and becomes correct the moment that is fixed.
  const offerable = vehicles.filter((v) => !v.isCurrentlyPosted);

  const startBlank = useCallback(() => {
    // replace, not push: this screen is a fork in the road, not somewhere to
    // come back to. Back from the wizard should reach whatever was before it.
    router.replace('/post-a-car');
  }, [router]);

  // Nothing to choose between — don't strand anyone on an empty chooser. The
  // tab bar normally routes straight past this screen, so reaching here with no
  // cars means the garage emptied (or failed) since that decision was made.
  const nothingToOffer = status === 'ready' && offerable.length === 0;
  useEffect(() => {
    if (nothingToOffer) {
      log.debug('garage_choose_car_skipped', { reason: 'no_offerable_cars' });
      startBlank();
    }
  }, [nothingToOffer, startBlank]);

  useEffect(() => {
    if (status === 'ready' && offerable.length > 0) {
      // Ids and counts only — never a plate or a nickname (docs/LOGGING.md).
      log.info('garage_choose_car_shown', { vehicleCount: offerable.length });
    }
    // Per landing, not per revalidation while sat on the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const choose = useCallback(
    (vehicle: SavedVehicle) => {
      // The same event the /my-cars card fires, so the add → post funnel stays
      // ONE metric across both entry points.
      log.info('garage_prefilled_post_launched', { vehicleId: vehicle.id });
      router.replace({
        pathname: '/report-stolen/[vehicleId]',
        params: { vehicleId: vehicle.id },
      });
    },
    [router],
  );

  const renderCard = useCallback(
    ({ item }: { item: SavedVehicle }) => (
      <GarageCard
        vehicle={item}
        onReportStolen={() => choose(item)}
        // Unreachable while the list is filtered to un-posted cars; kept
        // truthful rather than a no-op in case that filter ever changes.
        onOpenPost={() => item.activePostId && router.push(`/post/${item.activePostId}`)}
      />
    ),
    [choose, router],
  );

  return (
    <Screen>
      {/* Pushed page, headers hidden app-wide → an on-screen back control. */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="choose-car-back"
        >
          <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Which car?
        </Text>
      </View>

      {status === 'error' ? (
        <View style={styles.stateBlock}>
          {/* A failed load must never block the report. Retry is offered, but
              carrying on from scratch is always one tap away. */}
          <ErrorState body="We couldn't load your cars." onRetry={retry} />
          <Button label="Report a car from scratch" variant="ghost" onPress={startBlank} />
        </View>
      ) : (
        <FlatList
          data={offerable}
          renderItem={renderCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            // Always present, never buried: someone whose stolen car simply
            // isn't in the garage must not have to work out how to proceed.
            <Button label="It's a different car" variant="secondary" onPress={startBlank} />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  back: {
    minWidth: sizes.control,
    minHeight: sizes.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    flex: 1,
  },
  stateBlock: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
});
