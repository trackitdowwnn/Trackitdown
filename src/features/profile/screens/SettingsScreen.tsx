/**
 * WHAT:  Settings — how the app looks, and what it is allowed to do on this
 *        device. Pushed from Profile → Settings → "App settings".
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
 *        ⚠️ NO AUTH GATE, deliberately. Everything here is local to the device
 *        — the theme preference is AsyncStorage, the permissions belong to the
 *        OS — so a guest arriving by deep link gets a screen that works rather
 *        than an invitation to sign in for something that has nothing to do
 *        with an account. That also makes it trivially testable.
 * LINKS: ../components/PermissionRow.tsx (the four permission rows);
 *        src/shared/theme (useThemeControls — the three-state model);
 *        src/app/settings.tsx (the route);
 *        ./SpotterStoryScreen.tsx (the pushed-screen skeleton this follows).
 */

import { useRouter } from 'expo-router';
import { Bell, Camera, ChevronLeft, Images, MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemeControls,
  useThemedStyles,
  type Palette,
  type ThemePreference,
} from '@/shared/theme';
import { ListRow, ListRowGroup, Screen } from '@/shared/ui';

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
  const { preference, setPreference } = useThemeControls();

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
    // Says once what four rows would otherwise each have to imply: these are
    // not switches, and the app is not the thing that decides.
    footnote: {
      ...typography.caption,
      color: c.textSecondary,
      paddingHorizontal: spacing.md,
    },
  });
