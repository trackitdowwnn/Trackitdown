/**
 * WHAT:  MyCarsScreen — the pushed "My cars" page (reached from Profile): the
 *        saved cars, each with a prominent "Report this car stolen", and one
 *        centred "Add a car" button beneath. Guests get the unchanged auth
 *        invitation; loading/empty/error states keep the page's identity.
 * WHY:   This is the feature's home and its conversion surface — the whole
 *        garage exists so the report action is two taps away at the worst moment
 *        of someone's week, so it is a card-level button, not a menu item.
 *        The page stays deliberately SINGLE-PURPOSE: it is about the cars you
 *        own, and nothing else. It once carried a link through to My posts;
 *        that was removed because a post is not a car, and the link competed
 *        with the one action this screen is for. My posts keeps its own Profile
 *        row.
 *        An EMPTY garage narrows further still: value-led copy and one solid
 *        "Add your car" button, because someone with an empty garage has to be
 *        persuaded to make a bet before anything has gone wrong.
 * LINKS: src/app/my-cars.tsx (route); src/features/garage/hooks/useMyVehicles.ts;
 *        src/features/garage/components/GarageCard.tsx;
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the sibling list,
 *          reached from Profile).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRequireAuth, useSession } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  ThemedRefreshControl,
  useToast,
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { deleteVehicle } from '../api/garageApi';
import { GarageCard } from '../components/GarageCard';
import { useMyVehicles } from '../hooks/useMyVehicles';
import { vehicleDisplayName } from '../lib/vehicleAnswers';
import { MAX_VEHICLES, type SavedVehicle } from '../types';

const log = createLogger('garage');

export function MyCarsScreen() {
  const session = useSession();
  const requireAuth = useRequireAuth();
  const router = useRouter();
  const toast = useToast();
  const { status, vehicles, refreshing, refresh, retry } = useMyVehicles();

  // The car the overflow sheet / remove confirm is acting on.
  const [acting, setActing] = useState<SavedVehicle | null>(null);
  const actionsRef = useRef<BottomSheetRef>(null);
  const removeRef = useRef<ConfirmDialogRef>(null);

  const atCap = vehicles.length >= MAX_VEHICLES;

  const onAdd = useCallback(() => {
    if (atCap) {
      toast.show(`You can save up to ${MAX_VEHICLES} cars. Remove one to add another.`);
      return;
    }
    router.push('/add-vehicle');
  }, [atCap, router, toast]);

  const onReportStolen = useCallback(
    (vehicle: SavedVehicle) => {
      // The conversion this feature exists for — logged distinctly. Id only.
      log.info('garage_prefilled_post_launched', { vehicleId: vehicle.id });
      router.push({
        pathname: '/report-stolen/[vehicleId]',
        params: { vehicleId: vehicle.id },
      });
    },
    [router],
  );

  const onRemoveConfirmed = useCallback(async () => {
    if (!acting) {
      return;
    }
    try {
      await deleteVehicle(acting.id);
      toast.show('Car removed');
      void refresh();
    } catch (err) {
      // deleteVehicle maps the server code (incl. VEHICLE_HAS_ACTIVE_POST) to
      // copy; show it rather than a generic failure.
      toast.show(err instanceof Error ? err.message : 'We couldn’t remove that car.', 'error');
    }
  }, [acting, refresh, toast]);

  const renderCard = useCallback(
    ({ item }: { item: SavedVehicle }) => (
      <GarageCard
        vehicle={item}
        onReportStolen={() => onReportStolen(item)}
        onOpenPost={() => item.activePostId && router.push(`/post/${item.activePostId}`)}
        onOpenActions={() => {
          setActing(item);
          actionsRef.current?.open();
        }}
      />
    ),
    [onReportStolen, router],
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
          testID="my-cars-back"
        >
          <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          My cars
        </Text>
      </View>

      {session.status === 'signedOut' ? (
        <View style={styles.stateBlock}>
          <EmptyState
            title="Your cars live here"
            body="Save your vehicles so reporting one stolen is a couple of taps."
            actionLabel="Log in"
            onAction={() => requireAuth({ context: 'tab_my_cars' })}
          />
        </View>
      ) : status === 'error' ? (
        <View style={styles.stateBlock}>
          <ErrorState body="We couldn't load your cars." onRetry={retry} />
        </View>
      ) : status === 'loading' ? (
        <View style={styles.list}>
          <SkeletonGarageCard />
          <SkeletonGarageCard />
        </View>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListEmptyComponent={
            // An empty garage gets ONE thing to do. EmptyState's own action is a
            // ghost button by design ("invites, not shouts"), which is right for
            // an incidental empty screen but wrong here: this is the feature's
            // only conversion moment, and someone has to make a bet before
            // anything has gone wrong. So the text comes from EmptyState and a
            // solid primary button sits under it.
            <View style={styles.emptyBlock}>
              <EmptyState
                title="No cars saved yet"
                body="Save your car now and reporting it stolen later takes seconds, not minutes — we'll already have the details."
              />
              <View style={styles.emptyAction} testID="garage-add-empty">
                <Button label="Add your car" onPress={onAdd} />
              </View>
            </View>
          }
          ListFooterComponent={
            // Nothing below an empty garage — the CTA above is the only action.
            vehicles.length > 0 ? (
              <View style={styles.footer}>
                {atCap ? (
                  // At the cap the button would be a dead end (the server
                  // refuses), so state the fact instead of offering a tap that
                  // only produces an error.
                  <Text style={styles.capNote}>
                    That&apos;s all {MAX_VEHICLES} — remove one to add another.
                  </Text>
                ) : (
                  <View style={styles.addAction}>
                    <Button
                      label="Add a car"
                      variant="secondary"
                      fullWidth={false}
                      onPress={onAdd}
                    />
                  </View>
                )}
              </View>
            ) : null
          }
        />
      )}

      {/* Overflow for the acted-on car. */}
      <BottomSheet ref={actionsRef} title={acting ? vehicleDisplayName(acting) : undefined}>
        <ListRow
          icon={Pencil}
          title="Edit"
          onPress={() => {
            actionsRef.current?.close();
            if (acting) {
              router.push({
                pathname: '/edit-vehicle/[vehicleId]',
                params: { vehicleId: acting.id },
              });
            }
          }}
          testID="garage-action-edit"
        />
        {/* Disabled rather than hidden while the car has a live listing: the
            server refuses with VEHICLE_HAS_ACTIVE_POST, and walking someone
            through a destructive confirm only to fail is the wrong order. */}
        <ListRow
          icon={Trash2}
          title="Remove"
          subtitle={
            acting?.isCurrentlyPosted
              ? 'Available once this car’s listing is closed'
              : undefined
          }
          destructive
          disabled={acting?.isCurrentlyPosted}
          onPress={() => {
            actionsRef.current?.close();
            removeRef.current?.open();
          }}
          testID="garage-action-remove"
        />
      </BottomSheet>

      {/* Copy states only what actually happens: the ROWS go. The stored photo
          objects are not deleted yet (SECURITY_AND_TRUST §3 open gap), so
          promising "along with its photos" would be a lie. */}
      <ConfirmDialog
        ref={removeRef}
        title="Remove this car?"
        body="It'll be taken out of your garage. Any listing you've already made from it is unaffected."
        confirmLabel="Remove"
        destructive
        onConfirm={onRemoveConfirmed}
      />
    </Screen>
  );
}

/** Mirrors GarageCard's geometry so load → ready doesn't jump. */
function SkeletonGarageCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.topRow}>
        <View style={[styles.skeletonBlock, styles.skeletonPhoto]} />
        <View style={styles.identity}>
          <View style={[styles.skeletonBlock, styles.skeletonName]} />
          <View style={[styles.skeletonBlock, styles.skeletonMeta]} />
        </View>
      </View>
      <View style={[styles.skeletonBlock, styles.skeletonButton]} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
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
    color: colors.textPrimary,
    flexShrink: 1,
  },
  stateBlock: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  list: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  emptyBlock: {
    // EmptyState brings its own generous vertical padding, so this only owns
    // the gap to the button.
    gap: spacing.md,
  },
  emptyAction: {
    paddingHorizontal: spacing.xl,
  },
  footer: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  addAction: {
    alignItems: 'center',
  },
  capNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  skeletonCard: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.sm,
  },
  skeletonPhoto: {
    width: 72,
    height: 54,
    borderRadius: radii.md,
  },
  skeletonName: {
    height: typography.heading.lineHeight,
    width: '55%',
  },
  skeletonMeta: {
    height: typography.caption.lineHeight,
    width: '35%',
  },
  skeletonButton: {
    height: sizes.control,
    borderRadius: radii.md,
  },
});
