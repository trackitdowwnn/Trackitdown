/**
 * WHAT:  Settings — how the app looks, which notifications reach the phone,
 *        and what the app is allowed to do on this device. Pushed from
 *        Profile → Settings → "App settings".
 * WHY:   The Profile root had been this app's only settings surface, which was
 *        right while there were three rows on it. Appearance needs three of its
 *        own and permissions need four, so the arithmetic that justified
 *        keeping everything flat stopped holding — see the note on the
 *        Appearance group below, and `docs/design-refs/profile/`.
 *
 *        ⚠️ AS LITTLE AS POSSIBLE MOVED HERE. "Alerts & notifications" and
 *        "Payouts" stayed on the Profile root: the first carries a live summary
 *        ("2 alerts" / "Paused") that is information rather than a setting, and
 *        the second only appears when it is relevant, so burying it would make
 *        it undiscoverable exactly when it matters. The original objection to a
 *        hub was that it would bury those two. It does not.
 *
 *        ⚠️ NO AUTH GATE ON THE SCREEN, but the Notifications group needs an
 *        account. Appearance is AsyncStorage and the permissions belong to the
 *        OS, so a guest arriving by deep link gets a screen that works instead
 *        of an invitation to sign in for something that has nothing to do with
 *        an account. Push categories are per-user rows behind an auth-pinned
 *        RPC, so that group is simply absent for a guest — omission rather than
 *        a locked-looking group, which is the same rule the permission rows
 *        follow for an unavailable kind.
 * LINKS: ../components/PermissionRow.tsx (the four permission rows);
 *        src/shared/theme (useThemeControls — the three-state model);
 *        src/app/settings.tsx (the route);
 *        ./SpotterStoryScreen.tsx (the pushed-screen skeleton this follows).
 */

import { useRouter } from 'expo-router';
import { Bell, Camera, ChevronLeft, Images, MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/features/auth';
import { CATEGORY_COPY, useNotificationPreferences } from '@/features/notifications';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemeControls,
  useThemedStyles,
  type Palette,
  type ThemePreference,
} from '@/shared/theme';
import { AppSwitch, ListRow, ListRowGroup, Screen, useToast } from '@/shared/ui';

import { PermissionRow } from '../components/PermissionRow';

/** The three appearance choices, in the order they are offered. */
const APPEARANCE: { value: ThemePreference; title: string; subtitle?: string }[] = [
  // System first because it is the default and the one people return to.
  { value: 'system', title: 'System', subtitle: 'Follows your phone' },
  { value: 'light', title: 'Light' },
  { value: 'dark', title: 'Dark' },
];

export function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const { preference, setPreference } = useThemeControls();
  // The categories are per-account, so a guest has nothing to read or write.
  // Appearance and the permission rows are device-local and still work.
  const signedIn = session.status === 'signedIn';
  const { preferences, loading: loadingPreferences, setEnabled } = useNotificationPreferences(
    session.status === 'signedIn' ? session.userId : null,
  );

  const toggleCategory = async (category: Parameters<typeof setEnabled>[0], next: boolean) => {
    const ok = await setEnabled(category, next);
    if (!ok) {
      // The hook has already put the switch back. Saying so matters: a switch
      // that silently returns to where it was reads as a broken control, and
      // the user would otherwise believe a mute took effect that did not.
      toast.show('Couldn’t save that. Please try again.', 'error');
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="settings-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Settings
        </Text>
      </View>

      {/* ⚠️ THREE ROWS, REVERSING AN OWNER CALL OF 2026-08-10. That call was
          "a switch, not a three-way chooser", and it was reasoned honestly:
          a two-state control that mirrors the EFFECTIVE scheme keeps "follow
          the phone" as the default without spending a row on saying so. Its
          stated cost was that the first flip pins the app to that scheme for
          good — "there is no way back to following the phone".

          That cost was worth paying when there was nowhere to put a third
          option. This screen is that place. Nothing about the model changes:
          `preference` has been a three-state union with working persistence
          since the theme shipped, and `setPreference('system')` already worked
          — it simply had no caller.

          Bound to `preference` (what they CHOSE), never `scheme` (what is in
          effect). Binding to scheme is what forced the two-state control in the
          first place: 'system' has no scheme of its own to mirror. */}
      <ListRowGroup title="Appearance">
        {APPEARANCE.map((option) => (
          <ListRow
            key={option.value}
            title={option.title}
            subtitle={option.subtitle}
            // No icons: three icons in a chooser read as three destinations.
            selected={preference === option.value}
            onPress={() => setPreference(option.value)}
            testID={`row-appearance-${option.value}`}
          />
        ))}
      </ListRowGroup>

      {signedIn ? (
        <ListRowGroup title="Notifications">
          {CATEGORY_COPY.map((entry) => (
            <ListRow
              key={entry.category}
              title={entry.title}
              subtitle={entry.subtitle}
              // ⚠️ NO `toggled` UNTIL THE READ LANDS. The switches render from
              // the defaults so the group is never an empty hole, but before
              // the read those values are a placeholder — and `toggled` drives
              // the row's ROLE and STATE, so a user who muted Messages last
              // week was told "switch, on" by their screen reader while the
              // server had it off. A stale pixel is a flicker; a stale
              // announcement is a false statement.
              toggled={loadingPreferences ? undefined : preferences[entry.category]}
              onPress={
                loadingPreferences
                  ? undefined
                  : () => void toggleCategory(entry.category, !preferences[entry.category])
              }
              trailing={
                loadingPreferences ? (
                  <View style={styles.switchPlaceholder} />
                ) : (
                  <AppSwitch
                    value={preferences[entry.category]}
                    onValueChange={(next) => void toggleCategory(entry.category, next)}
                  />
                )
              }
              testID={`row-notify-${entry.category}`}
            />
          ))}

        </ListRowGroup>
      ) : null}

      {/* ⚠️ A FOOTNOTE, NOT A ROW — and it was a row first, which was wrong
          three ways at once. ListRow hands React Native `disabled={!pressable}`,
          and Pressable folds that into accessibilityState, so a row with no
          onPress is ANNOUNCED AS DIMMED however it looks — the exact "stuck
          control reads as a bug" reading this text exists to avoid. It also got
          ListRow's numberOfLines={2}, which cut the sentence off before the
          half that explains anything, and an icon indent none of the switches
          above it had, so it read as their child.

          The content is unchanged and so is the reasoning: two kinds have no
          preference column to store a mute in. A sighting push is the moment
          the whole product exists for, and the 72-hour contest window has no
          in-app door at all — docs/ROADMAP.md records that /sighting-dispute is
          reachable ONLY from its push — so silencing that one removes a money
          right rather than a notification. */}
      {signedIn ? (
        <Text style={styles.footnote} testID="notify-always-on">
          Two things stay on whatever you choose here: a sighting of your car, and the 72 hours you
          have to contest a decision about a bounty. Neither can be got back if you miss it.
        </Text>
      ) : null}

      {/* The subtitles are the primer these rows would otherwise lack — the
          startup chain asks for all four in a row with no explanation attached
          to any of them, so this may be the first time the user is told why. */}
      <ListRowGroup title="Permissions">
        <PermissionRow
          kind="notifications"
          icon={Bell}
          title="Notifications"
          subtitle="So we can tell you the moment your car is seen."
          testID="row-permission-notifications"
        />
        <PermissionRow
          kind="location"
          icon={MapPin}
          title="Location"
          subtitle="So we can show cars reported near you."
          testID="row-permission-location"
        />
        <PermissionRow
          kind="camera"
          icon={Camera}
          title="Camera"
          subtitle="For photographing a car you have spotted."
          testID="row-permission-camera"
        />
        <PermissionRow
          kind="photos"
          icon={Images}
          title="Photos"
          subtitle="For adding pictures of your own car to a listing."
          testID="row-permission-photos"
        />
      </ListRowGroup>

      <Text style={styles.footnote}>
        Notifications, location, camera and photos are controlled by your phone. Tapping one takes
        you to where you can change it.
      </Text>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scroll: {
      padding: spacing.xl,
      gap: spacing.xl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
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
    // Stands in for the Switch until the read lands, at the switch's own
    // width, so nothing shifts when the real control arrives.
    switchPlaceholder: {
      width: sizes.control,
      height: sizes.skeletonLine * 2,
      borderRadius: radii.md,
      backgroundColor: c.surfaceSubtle,
    },
    // Says once what four rows would otherwise each have to imply: these are
    // not switches, and the app is not the thing that decides.
    footnote: {
      ...typography.caption,
      color: c.textSecondary,
      paddingHorizontal: spacing.md,
    },
  });
