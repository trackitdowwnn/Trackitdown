/**
 * WHAT:  AlertsScreen — the list of a spotter's alerts: each one's zone as a
 *        thumbnail, its name, what it watches, a pause switch and a "⋯", plus
 *        the route into the creation wizard.
 * WHY:   Replaces the single-zone settings screen. Both Profile rows land here,
 *        because "Notifications" and "Alert areas" are one thing in a user's
 *        head.
 *
 *        The PER-USER concerns live here rather than on an alert: the OS
 *        permission state. An alert can't fix a phone-level block, and asking
 *        about it five times would be absurd — so the list owns it once, in one
 *        compact banner, and stays honest that a saved alert won't fire while
 *        the OS is muting us.
 *
 *        ⚠️ REDESIGNED 2026-08-27 (owner request, Airbnb language). Airbnb has
 *        no saved-search-alerts screen to copy — third-party products exist
 *        precisely because they don't ship one — so the analogue is Wishlists
 *        and what we borrowed is the LANGUAGE: a picture leading each card,
 *        flat surfaces separated by hairlines rather than shadows, restrained
 *        copy around the image, and an empty state that explains the feature
 *        and offers exactly one action. Their register is aspirational ("Build
 *        the perfect trip"); ours serves someone whose car was stolen or a
 *        volunteer looking for one, so the copy stays calm and matter-of-fact.
 *
 *        ⚠️ THE HEADER RENDERS OUTSIDE THE STATE SWITCH, and that is a fix, not
 *        a style. Headers are hidden app-wide and this is a pushed route, so
 *        the old error and signed-out branches — which rendered a bare
 *        SafeAreaView with no title and no chevron — left a user stranded with
 *        only the iOS edge-swipe. Every state now has a way back.
 *
 *        ⚠️ AND IT USES `Screen`, not SafeAreaView from react-native, whose
 *        Android implementation is a plain View that applies no inset at all.
 * LINKS: ../hooks/useMyAlerts.ts; ../api/alertsApi.ts;
 *        ../components/AlertCard.tsx (the row, and summariseAlert with it);
 *        ../components/AlertZoneThumb.tsx (why the map degrades to a glyph);
 *        ../components/AlertActionsSheet.tsx; ../components/AlertPermissionBanner.tsx;
 *        ./AlertWizardScreen.tsx; docs/design-refs/alerts/REFERENCE_SPEC.md.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useRequireAuth } from '@/features/auth';
import { useDevicePermission } from '@/features/permissions';
import { createLogger } from '@/shared/lib/logger';
import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  Button,
  ConfirmDialog,
  type ConfirmDialogRef,
  EmptyState,
  ErrorState,
  Screen,
  StickyActionBar,
  ThemedRefreshControl,
  useToast,
  type BottomSheetRef,
} from '@/shared/ui';

import { deleteAlert, setAlertEnabled } from '../api/alertsApi';
import { AlertActionsSheet } from '../components/AlertActionsSheet';
import { AlertCard } from '../components/AlertCard';
import { AlertPermissionBanner } from '../components/AlertPermissionBanner';
import { AlertZoneGlyph } from '../components/AlertZoneGlyph';
import { invalidateMyAlerts, useMyAlerts } from '../hooks/useMyAlerts';
import { MAX_ALERTS_PER_DAY, MAX_ALERTS_PER_USER, type Alert } from '../types';

const log = createLogger('notifications');

export function AlertsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const state = useMyAlerts();
  const permission = useDevicePermission('notifications');
  const confirmRef = useRef<ConfirmDialogRef>(null);
  const actionsRef = useRef<BottomSheetRef>(null);
  const [pendingDelete, setPendingDelete] = useState<Alert | null>(null);
  const [acting, setActing] = useState<Alert | null>(null);

  const permissionState = permission.status?.state;
  const permissionBlocked = permissionState === 'denied' && permission.status?.canAskAgain === false;
  const permissionGranted = permissionState === 'granted';

  const handleBannerPress = async () => {
    if (permissionBlocked) {
      await Linking.openSettings();
      return;
    }
    const next = await permission.request();
    log.info('push_permission', {
      state: next.state,
      canAskAgain: next.canAskAgain,
      surface: 'alerts_list',
    });
  };

  const toggle = async (alert: Alert, enabled: boolean) => {
    try {
      await setAlertEnabled(alert.id, enabled);
      invalidateMyAlerts();
    } catch {
      toast.show("Couldn't change that — try again.", 'error');
      invalidateMyAlerts(); // re-read the truth; the switch must not lie
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteAlert(pendingDelete.id);
      invalidateMyAlerts();
      toast.show('Alert deleted');
    } catch {
      toast.show("Couldn't delete that — try again.", 'error');
    } finally {
      setPendingDelete(null);
    }
  };

  const alerts = state.status === 'ready' ? state.alerts : [];
  const atCap = alerts.length >= MAX_ALERTS_PER_USER;

  // ⚠️ TAPPABLE AT THE CAP, and it explains itself. It used to be a DISABLED
  // button reading "Limit reached (5)" — the garage screen, whose cap of 5 this
  // deliberately mirrors, records the house rule: "a dead control explains
  // nothing." A live one says the one thing worth saying, at the moment it is
  // relevant.
  const handleCreate = () => {
    if (atCap) {
      toast.show(`You can have up to ${MAX_ALERTS_PER_USER} alerts. Delete one to add another.`);
      return;
    }
    router.push('/alerts/new');
  };

  const openActions = (alert: Alert) => {
    setActing(alert);
    actionsRef.current?.open();
  };

  const header = (
    <View style={styles.headerRow}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.back}
        testID="alerts-back"
      >
        <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        Alerts
      </Text>
    </View>
  );

  return (
    <Screen
      footer={
        state.status === 'ready' && alerts.length > 0 ? (
          <StickyActionBar testID="alerts-action-bar">
            <Button label="Create an alert" onPress={handleCreate} />
          </StickyActionBar>
        ) : undefined
      }
    >
      {header}

      {/* ⚠️ OUTSIDE THE STATE SWITCH, like the header. The permission resolves
          independently of the alerts fetch, so rendering this only in `ready`
          pushed the whole list down the moment the fetch landed — for every
          user with notifications off, and by far more than the 8pt the skeleton
          was retuned to remove. The screen's header comment says the LIST owns
          the permission conversation, not the ready state. */}
      {/* ⚠️ SIGNED-OUT IS THE ONE STATE IT MUST SKIP. The permission resolves
          for anyone holding the phone, so hoisting the banner out of the switch
          also put it on the logged-out screen — asking a visitor to turn on push
          for alerts they cannot own, stacked above "Alerts are tied to your
          account", behind an OS prompt that nothing would then consume. */}
      {state.status !== 'signedOut' && permission.status && !permissionGranted ? (
        <View style={styles.bannerWrap}>
          <AlertPermissionBanner
            blocked={permissionBlocked}
            onPress={() => void handleBannerPress()}
            testID="alerts-permission-banner"
          />
        </View>
      ) : null}

      {state.status === 'loading' ? (
        // ⚠️ SKELETONS, NOT A SPINNER — the house rule for lists. It keeps the
        // label the old FullscreenLoader carried, as an accessibility label, so
        // the state is still announced without a blocking overlay.
        <View
          style={styles.body}
          testID="alerts-skeleton"
          accessible
          accessibilityLabel="Loading your alerts"
          accessibilityState={{ busy: true }}
        >
          {[0, 1].map((key) => (
            <View key={key} style={styles.skeletonRow}>
              <View style={styles.skeletonThumb} />
              <View style={styles.skeletonText}>
                <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
                <View style={styles.skeletonLine} />
              </View>
              {/* ⚠️ THE CONTROLS ARE THE CARD'S TALLEST CHILD, not the
                  thumbnail — 44 + 4 + 44 = 92 against the thumb's 72. Without a
                  placeholder for them the skeleton row is 104pt to the real
                  card's 124, so two rows shifted everything below by 40pt at
                  the moment the alerts arrived, which is the jump a skeleton
                  exists to prevent. */}
              <View style={styles.skeletonControls} />
            </View>
          ))}
        </View>
      ) : null}

      {state.status === 'error' ? (
        <ErrorState title="We couldn't load your alerts" onRetry={state.refresh} />
      ) : null}

      {state.status === 'signedOut' ? (
        <EmptyState
          title="Set the areas you watch"
          body="Alerts are tied to your account, so we know where to send them."
          // Every other signed-out empty state in the app offers the way in;
          // this one silently did not.
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'alert_settings' })}
        />
      ) : null}

      {state.status === 'ready' ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          // Alerts change from OFF this screen — a push arrives, an area is
          // edited elsewhere, a paused alert resumes. The list is otherwise only
          // as fresh as the last invalidation, and there was no way to ask.
          //
          // `pull`, not `refresh`: the latter invalidates globally and its failure
          // path swaps the list for an error page. See the hook.
          refreshControl={
            <ThemedRefreshControl
              refreshing={state.refreshing}
              onRefresh={() => void state.pull()}
            />
          }
        >
          {alerts.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              // Harvested near-verbatim from AlertNudgeSheet, which is where
              // the promise is first made — this screen is where it is kept,
              // and the two should use the same words. It carries the two
              // facts the old copy left out: how often this interrupts you,
              // and that the area saved is not your address.
              body="Pick an area and we'll tell you when a car is reported stolen inside it. A few a day at most — and you can save a rough area rather than your exact address."
              illustration={<AlertZoneGlyph />}
              actionLabel="Create an alert"
              onAction={handleCreate}
              // ⚠️ PRIMARY, NOT THE GHOST DEFAULT. The ghost "invites, not
              // shouts", which is right for an incidental empty screen and
              // wrong here: the feature README opens with "nobody is notified
              // about anything until one exists", so this is the app's core
              // loop having its one conversion moment.
              actionVariant="primary"
              // The scroll already pads 24; without this the two stack to 48
              // a side and the body wraps to a narrow centred column.
              gutter="none"
            />
          ) : (
            // The footnote belongs TO the list, so it lives inside the group at
            // 16 rather than a full section-gap away — it describes the thing
            // directly above it rather than opening a new topic.
            <View style={styles.listGroup}>
              <View style={styles.list}>
                {alerts.map((alert, index) => (
                  <Animated.View
                    key={alert.id}
                    entering={FadeInDown.duration(motion.standard)
                      .delay(Math.min(index, 6) * motion.listStagger)
                      .reduceMotion(ReduceMotion.System)}
                  >
                    <AlertCard
                      alert={alert}
                      onPress={() => router.push(`/alerts/${alert.id}`)}
                      onToggle={(enabled) => void toggle(alert, enabled)}
                      onMore={() => openActions(alert)}
                    />
                  </Animated.View>
                ))}
              </View>

              <Text style={styles.note}>
                {atCap
                  ? `That's all ${MAX_ALERTS_PER_USER} — delete one to add another.`
                  : `You'll get at most ${MAX_ALERTS_PER_DAY} alerts a day in total, however many you set up.`}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      <AlertActionsSheet
        ref={actionsRef}
        alert={acting}
        onEdit={() => {
          actionsRef.current?.close();
          if (acting) router.push(`/alerts/${acting.id}`);
        }}
        onToggle={(enabled) => {
          actionsRef.current?.close();
          if (acting) void toggle(acting, enabled);
        }}
        onDelete={() => {
          actionsRef.current?.close();
          setPendingDelete(acting);
          confirmRef.current?.open();
        }}
        onDismiss={() => setActing(null)}
      />

      <ConfirmDialog
        ref={confirmRef}
        title="Delete this alert?"
        body="You'll stop getting notifications for it. Your other alerts are unaffected."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onDismiss={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The house header idiom: chevron and title inline, the glyph pulled left
    // so its 44pt box sits optically on the 24pt gutter.
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
    title: { ...typography.title, color: c.textPrimary, flexShrink: 1 },
    // 24 gutter (a settings-shaped screen, per DESIGN_SYSTEM), 32 between
    // groups — replacing a single flat 16 that used to space the primer, the
    // notice, every row, the button and the footnote identically, so nothing
    // grouped and nothing led.
    scroll: {
      padding: spacing.xl,
      paddingTop: spacing.lg,
      gap: spacing.xxl,
    },
    // ⚠️ THE SAME PADDING AS `scroll`, INCLUDING THE 16 ON TOP. At the default
    // 24 the content jumped 8pt the moment the alerts arrived — which is
    // exactly what a skeleton exists to prevent, and the comment claiming it
    // mirrored the card's geometry was only true of the rows, not the frame.
    // The banner owns the gutter and the space to whatever follows it; it sits
    // above the state switch so it cannot shift the list when the fetch lands.
    bannerWrap: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
    },
    body: {
      padding: spacing.xl,
      paddingTop: spacing.lg,
      gap: spacing.md,
    },
    // 12 between cards reads as one continuous set; the 32 above and below
    // separates the set from the banner and the footnote.
    listGroup: { gap: spacing.lg },
    list: { gap: spacing.md },

    note: { ...typography.caption, color: c.textSecondary, textAlign: 'center' },
    // Mirrors AlertCard's geometry so load → ready does not jump.
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    skeletonThumb: {
      width: sizes.alertThumb,
      height: sizes.alertThumb,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
    // gap and padding match AlertCard exactly, so the rows do not shift either.
    skeletonText: { flex: 1, gap: spacing.xs },
    skeletonLine: {
      height: sizes.skeletonLine,
      width: '35%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonLineWide: { width: '55%' },
    // Matches AlertCard's `controls` column exactly: two touch targets and the
    // 4pt between them.
    skeletonControls: {
      width: sizes.touchTarget,
      height: sizes.touchTarget * 2 + spacing.xs,
    },
  });
