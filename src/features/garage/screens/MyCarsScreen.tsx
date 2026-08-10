/**
 * WHAT:  MyCarsScreen — the pushed "My cars" page (reached from Profile):
 *        photography-first saved-car cards (the whole card is one tap → the
 *        actions sheet: Report this car stolen / Edit / Remove), a bare "+"
 *        in the header to add, and the cap note beneath. Guests get the
 *        unchanged auth invitation; loading/empty/error states keep the
 *        page's identity.
 * WHY:   Redesigned 2026-07-29 against Airbnb's host Listings tab: cards are
 *        calm photos with text below, actions live behind the tap in a
 *        bottom sheet, and add is the header's + — no buttons on cards, no
 *        overflow dots. Report moved from a card-level button INTO the sheet
 *        deliberately: this page is the PEACETIME surface, and the distress
 *        path has its own faster route (the tab bar's + goes straight to the
 *        "Which car?" chooser) — here, one extra tap buys a garage that
 *        reads like a garage rather than a form. Inside the sheet the report
 *        action keeps top billing as the one primary button.
 *        The page stays deliberately SINGLE-PURPOSE: the cars you own,
 *        nothing else (the old My-posts link competed with that and is gone;
 *        My posts keeps its own Profile row).
 *        An EMPTY garage narrows further still: value-led copy and one solid
 *        "Add your car" button, because someone with an empty garage has to
 *        be persuaded to make a bet before anything has gone wrong.
 * LINKS: src/app/my-cars.tsx (route); src/features/garage/hooks/useMyVehicles.ts;
 *        src/features/garage/components/GarageCard.tsx (the card anatomy +
 *          reference notes); src/features/vehicles/screens/MyPostsScreen.tsx.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRequireAuth, useSession } from '@/features/auth';
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
import { GARAGE_PHOTO_ASPECT_RATIO, GarageCard } from '../components/GarageCard';
import { useMyVehicles } from '../hooks/useMyVehicles';
import { vehicleDisplayName } from '../lib/vehicleAnswers';
import { MAX_VEHICLES, type SavedVehicle } from '../types';

const log = createLogger('garage');

export function MyCarsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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

  // The whole card is one tap → the actions sheet (Airbnb: cards carry no
  // buttons; menus are bottom sheets). Report/Edit/Remove all live there.
  const renderCard = useCallback(
    ({ item }: { item: SavedVehicle }) => (
      <GarageCard
        vehicle={item}
        onPress={() => {
          setActing(item);
          actionsRef.current?.open();
        }}
      />
    ),
    [],
  );

  return (
    <Screen>
      {/* Pushed page, headers hidden app-wide → an on-screen back control.
          Add lives HERE as a bare + (the reference's header affordance), not
          as a button in the list's footer. At the cap it stays tappable and
          explains itself (onAdd toasts) — a dead control explains nothing. */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="my-cars-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          My cars
        </Text>
        {session.status !== 'signedOut' ? (
          <Pressable
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel="Add a car"
            style={styles.headerAdd}
            testID="my-cars-add"
          >
            <Plus size={sizes.icon} color={palette.textPrimary} />
          </Pressable>
        ) : null}
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
            // Add moved to the header's +; the footer keeps only the cap fact
            // (at the cap the + toasts the same message on tap).
            vehicles.length > 0 && atCap ? (
              <View style={styles.footer}>
                <Text style={styles.capNote}>
                  That&apos;s all {MAX_VEHICLES} — remove one to add another.
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* The card's actions — everything the old on-card button and overflow
          carried, one tap behind the photo. Report keeps top billing as the
          sheet's single primary; a car with a live listing offers its
          listing instead (a second report would be refused as PLATE_IN_USE). */}
      <BottomSheet ref={actionsRef} title={acting ? vehicleDisplayName(acting) : undefined}>
        <View style={styles.sheetBody}>
          {acting?.isCurrentlyPosted ? (
            <ListRow
              icon={ExternalLink}
              title="View listing"
              subtitle="This car is currently reported stolen"
              onPress={() => {
                actionsRef.current?.close();
                if (acting?.activePostId) {
                  router.push(`/post/${acting.activePostId}`);
                }
              }}
              testID="garage-action-view-post"
            />
          ) : (
            <Button
              label="Report this car stolen"
              onPress={() => {
                actionsRef.current?.close();
                if (acting) {
                  onReportStolen(acting);
                }
              }}
            />
          )}
          <ListRow
            icon={Pencil}
            title="Edit details"
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
            title="Remove from garage"
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
        </View>
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

/** Mirrors GarageCard's geometry — photo, name, meta, AND the plate row —
 *  so load → ready doesn't jump (ui review #4). */
function SkeletonGarageCard() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
      <View style={[styles.skeletonBlock, styles.skeletonPhoto]} />
      <View style={[styles.skeletonBlock, styles.skeletonName]} />
      <View style={[styles.skeletonBlock, styles.skeletonMeta]} />
      <View style={[styles.skeletonBlock, styles.skeletonPlate]} />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
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
    color: c.textPrimary,
    // flex, not flexShrink: pushes the header's + to the trailing edge.
    flex: 1,
  },
  headerAdd: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -(sizes.touchTarget - sizes.icon) / 2,
  },
  stateBlock: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  list: {
    padding: spacing.xl,
    // The reference's rhythm: photo-led cards breathe at 24, not 16.
    gap: spacing.xl,
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
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  capNote: {
    ...typography.caption,
    color: c.textSecondary,
  },
  sheetBody: {
    gap: spacing.md,
  },
  skeletonBlock: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.sm,
  },
  skeletonPhoto: {
    width: '100%',
    aspectRatio: GARAGE_PHOTO_ASPECT_RATIO,
    borderRadius: radii.lg,
  },
  skeletonName: {
    height: typography.cardTitle.lineHeight,
    width: '45%',
    marginTop: spacing.md,
  },
  skeletonMeta: {
    height: typography.caption.lineHeight,
    width: '30%',
    marginTop: spacing.xs,
  },
  skeletonPlate: {
    height: typography.plate.lineHeight + spacing.xs * 2,
    width: '28%',
    marginTop: spacing.sm,
  },
});
