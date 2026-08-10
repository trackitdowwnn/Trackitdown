/**
 * WHAT:  ChooseCarToReportScreen — "Which car?", shown when someone starts a
 *        report and already has cars in their garage. A utilitarian picker:
 *        one row per car (square thumbnail, name, plate), tap = straight
 *        into the prefilled report; a final "It's a different car" row goes
 *        to the blank wizard.
 * WHY:   Redesigned 2026-07-29 against Airbnb's listing-picker anatomy: when
 *        a host must choose one of their listings for an action, they get
 *        tap-to-advance ROWS, not the management surface's photo cards —
 *        the card treatment is for browsing what you own; a picker is a
 *        question. Ours is asked at the worst moment of someone's week, so
 *        the emotional translation goes further than the reference: zero
 *        decoration, no buttons, no confirm step — the row IS the choice.
 *
 *        This screen is never shown to someone with no saved car: the tab
 *        bar routes straight to the blank wizard unless the cached signal
 *        says there are cars to choose from (see the README's Nudges section
 *        for why this is not the rejected on-entry interstitial).
 * LINKS: src/app/report-stolen/index.tsx (the route);
 *        src/app/(tabs)/_layout.tsx (routes here only when cars are known);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx (where a
 *          choice lands); src/features/garage/components/GarageCard.tsx (the
 *          management-surface card this deliberately does NOT reuse).
 */

import { useRouter } from 'expo-router';
import { Car, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, Button, ErrorState, PlateChip, Screen, spellPlate } from '@/shared/ui';

import { useMyVehicles } from '../hooks/useMyVehicles';
import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';

const log = createLogger('garage');

/** Square picker thumbnail (the reference's ~56–64pt), radius md. */
const THUMB_SIZE = 64;

/** One car, one tap. The row is the choice — no buttons, no confirm. */
function ChooseCarRow({ vehicle, onPress }: { vehicle: SavedVehicle; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const cover = vehicle.photos[0]?.url;
  const name = vehicleDisplayName(vehicle);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        // spellPlate: a reader must never attempt "AB12 CDE" as a word.
        `Report ${name}${vehicle.plate ? `, plate ${spellPlate(vehicle.plate)},` : ''} stolen`
      }
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`choose-car-${vehicle.id}`}
    >
      {cover ? (
        <AppImage uri={cover} recyclingKey={vehicle.id} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Car size={sizes.iconSm} color={palette.textSecondary} />
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        {vehicle.plate ? (
          <View style={styles.plateRow}>
            {/* The row's press, forwarded: the chip is the touch responder
                (long-press copies), so without this the plate would swallow
                the tap that reports this car — on the panic-moment path. */}
            <PlateChip plate={vehicle.plate} onPress={onPress} />
          </View>
        ) : null}
      </View>
      <ChevronRight size={sizes.icon} color={palette.textSecondary} />
    </Pressable>
  );
}

export function ChooseCarToReportScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
      // The same event the /my-cars sheet fires, so the add → post funnel
      // stays ONE metric across both entry points.
      log.info('garage_prefilled_post_launched', { vehicleId: vehicle.id });
      router.replace({
        pathname: '/report-stolen/[vehicleId]',
        params: { vehicleId: vehicle.id },
      });
    },
    [router],
  );

  const renderRow = useCallback(
    ({ item }: { item: SavedVehicle }) => <ChooseCarRow vehicle={item} onPress={() => choose(item)} />,
    [choose],
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
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
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
      ) : status === 'loading' ? (
        // Skeleton rows in the row geometry, and NO footer yet: showing
        // "It's a different car" before the saved cars appear could route
        // someone straight past the feature at its one moment of need
        // (ui review #3).
        <View
          style={styles.listContent}
          testID="choose-car-skeleton"
          accessible
          accessibilityLabel="Loading your cars"
          accessibilityState={{ busy: true }}
        >
          {[0, 1].map((n) => (
            <View key={n} style={styles.row}>
              <View style={[styles.skeletonBlock, styles.thumb]} />
              <View style={styles.rowBody}>
                <View style={[styles.skeletonBlock, styles.skeletonName]} />
                <View style={[styles.skeletonBlock, styles.skeletonPlate]} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={offerable}
          renderItem={renderRow}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            // Always present, never buried: someone whose stolen car simply
            // isn't in the garage must not have to work out how to proceed.
            // The same row anatomy as the cars — it is the same kind of
            // answer, just without a saved car behind it.
            <Pressable
              onPress={startBlank}
              accessibilityRole="button"
              accessibilityLabel="It's a different car — report from scratch"
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              testID="choose-car-different"
            >
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Car size={sizes.iconSm} color={palette.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>It&apos;s a different car</Text>
                <Text style={styles.rowMeta}>Report from scratch</Text>
              </View>
              <ChevronRight size={sizes.icon} color={palette.textSecondary} />
            </Pressable>
          }
        />
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
    flexShrink: 1,
  },
  stateBlock: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    // Rounded press feedback without a border — rows separate by rhythm,
    // not rules (the app has no divider-line convention on lists).
    borderRadius: radii.md,
  },
  rowPressed: {
    backgroundColor: c.surfaceSubtle,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceSubtle,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  rowName: {
    ...typography.cardTitle,
    color: c.textPrimary,
  },
  rowMeta: {
    ...typography.caption,
    color: c.textSecondary,
  },
  plateRow: {
    flexDirection: 'row',
  },
  skeletonBlock: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.sm,
  },
  skeletonName: {
    height: typography.cardTitle.lineHeight,
    width: '45%',
  },
  skeletonPlate: {
    height: typography.plate.lineHeight + spacing.xs * 2,
    width: '35%',
  },
});
