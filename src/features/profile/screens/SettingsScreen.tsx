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
 *
 *        AIRBNB PASS 2026-08-26 — deliberately small, because the anatomy was
 *        already right: ListRowGroup and ListRow were built FROM the reference
 *        (`docs/design-refs/profile/REFERENCE_SPEC.md` §1c) during the July
 *        profile redesign, so heading-scale ink group titles, hairlines between
 *        rows only, and flat-on-the-page grouping were already in place. Two
 *        gaps closed: the Notifications group gained the icon rail the
 *        reference runs down every settings row (see CATEGORY_ICONS), and the
 *        footnote is bundled with the group it explains rather than sitting
 *        equally far from both neighbours (see styles.bundle). The Permissions
 *        footnote was removed entirely on the owner's call the same day — the
 *        rows state their own answer and offer their own chevron, so it was
 *        narrating the anatomy.
 *
 *        Appearance keeps NO icons — the documented chooser exception below,
 *        not an oversight; a chooser is a different grammar from a list of
 *        destinations. The title also stays inline beside the back chevron
 *        rather than taking the reference's large scroll-away treatment:
 *        sixteen screens share that header idiom, and matching the reference on
 *        one of them would only make this screen the odd one out.
 * LINKS: ../components/PermissionRow.tsx (the four permission rows);
 *        src/shared/theme (useThemeControls — the three-state model);
 *        src/app/settings.tsx (the route);
 *        ./SpotterStoryScreen.tsx (the pushed-screen skeleton this follows).
 */

import { useRouter } from 'expo-router';
import {
  Banknote,
  Bell,
  Binoculars,
  Bookmark,
  Camera,
  ChevronLeft,
  Images,
  MapPin,
  MessageCircle,
  Radar,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth';
import {
  CATEGORY_COPY,
  useNotificationPreferences,
  type NotificationCategory,
} from '@/features/notifications';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemeControls,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppSwitch, ListRow, ListRowGroup, Screen, useToast } from '@/shared/ui';

import { PermissionRow } from '../components/PermissionRow';

/**
 * The icon rail for the Notifications group.
 *
 * ⚠️ EVERY GLYPH REUSES A MEANING THE APP HAS ALREADY ESTABLISHED, because a
 * rail that invents its own vocabulary is worse than no rail: it teaches an
 * association the rest of the app then contradicts. MessageCircle and Bookmark
 * are the Inbox and Watchlist tabs; Binoculars and Banknote are ProfileScreen's
 * own "My sightings" and "Payouts" rows.
 *
 * ⚠️ `alerts` IS THE EXCEPTION, AND NOT BY PREFERENCE. Its natural glyph is
 * `Bell` — what ProfileScreen uses for "Alerts & notifications" — and its
 * second choice is `MapPin`, the alert-area glyph in AlertMatcherPicker. On
 * THIS screen both are already spoken for by the Permissions group below: Bell
 * is the OS notification permission, MapPin the OS location permission. Either
 * would put one glyph against two different things a few rows apart, which is
 * exactly the confusion a rail exists to prevent. Radar is unclaimed here and
 * reads as a watched area.
 *
 * A total Record, so adding a sixth category fails the build here rather than
 * rendering one row with no icon and a title that no longer lines up with its
 * neighbours.
 *
 * ⚠️ EXPORTED FOR ITS TEST, which is the half TypeScript cannot do. The type
 * guarantees every category HAS an icon; it says nothing about which, so
 * `alerts: Bell` would compile happily and quietly reintroduce the collision
 * this map was arranged to avoid. The test pins distinctness and the two
 * reserved glyphs.
 */
export const CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
  alerts: Radar,
  messages: MessageCircle,
  my_sightings: Binoculars,
  money: Banknote,
  watched: Bookmark,
};

export function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // ⚠️ THE BOTTOM INSET IS PAID HERE, NOT BY `Screen`. Screen's `edges` default
  // to ['top'] deliberately — tab screens let content run under the tab bar —
  // but this is a PUSHED screen with no tab bar and no footer, so under SDK
  // 57's edge-to-edge Android the last permission row sat under the navigation
  // buttons and could not be reached. Padding the scroll CONTENT rather than
  // adding a 'bottom' edge keeps the page running edge-to-edge behind the bar
  // while guaranteeing the final row clears it. Same shape as
  // ReportSightingScreen and PostBottomBar.
  //
  // ⚠️ NOT FIXED IN `Screen` ITSELF, though every pushed `Screen scroll` has
  // this (SpotterStoryScreen is the next one). Screen is shared with tab
  // screens that must NOT gain the inset, and several callers already add
  // their own — so a blanket change there would double-pad some and alter
  // others. That is its own change with its own audit.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  // ⚠️ `scheme` (what is on screen), NOT `preference` (what was chosen). While
  // preference is 'system' it has no light/dark value for a switch to mirror,
  // so binding to it would show OFF on a dark phone. See the Appearance note.
  const { scheme, setPreference } = useThemeControls();
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
    <Screen
      scroll
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
    >
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

      {/* ⚠️ ONE SWITCH, AND IT COSTS 'system'. Owner's call, 2026-08-26, and
          the fourth position this control has held: 2026-08-10 a single switch;
          2026-08-24 three radio rows, to buy back "follow the phone";
          2026-08-26 morning two switches, to have switches AND keep it;
          2026-08-26 afternoon this — just the toggle.

          ⚠️ THE PRICE IS THE ONE THE ORIGINAL DECISION NAMED, and it is real:
          a two-state control has no value meaning "follow the phone", so the
          FIRST FLIP PINS THE APP FOR GOOD. `preference` is still a three-state
          union and 'system' is still the default a fresh install starts on —
          but once this switch is touched there is no route back to it short of
          clearing app data. Nobody should be surprised by that later; it is
          accepted, not overlooked.

          ⚠️ BOUND TO `scheme`, NOT `preference`, and that is forced rather than
          chosen. `scheme` is what is ON SCREEN; `preference` is what was
          chosen, and while it is 'system' it has no light/dark value to mirror.
          Bind to preference and a user on a dark phone opens a dark app with
          the switch reading OFF — the control contradicting the screen. So it
          mirrors the effect and writes a choice, which is exactly the shape
          2026-08-10 described. */}
      <ListRowGroup title="Appearance">
        <ListRow
          title="Dark mode"
          toggled={scheme === 'dark'}
          onPress={() => setPreference(scheme === 'dark' ? 'light' : 'dark')}
          trailing={
            <AppSwitch
              value={scheme === 'dark'}
              onValueChange={(next) => setPreference(next ? 'dark' : 'light')}
            />
          }
          testID="row-appearance-dark"
        />
      </ListRowGroup>

      {signedIn ? (
        <View style={styles.bundle}>
          <ListRowGroup title="Notifications">
            {CATEGORY_COPY.map((entry) => (
              <ListRow
                key={entry.category}
                icon={CATEGORY_ICONS[entry.category]}
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

          {/* ⚠️ A FOOTNOTE, NOT A ROW — and it was a row first, which was wrong
              three ways at once. ListRow hands React Native `disabled={!pressable}`,
              and Pressable folds that into accessibilityState, so a row with no
              onPress is ANNOUNCED AS DIMMED however it looks — the exact "stuck
              control reads as a bug" reading this text exists to avoid. It also got
              ListRow's numberOfLines={2}, which cut the sentence off before the
              half that explains anything.

              ⚠️ THE THIRD REASON EXPIRED ON 2026-08-26 and is kept because it
              now argues the other way round. It read "an icon indent none of the
              switches above it had, so it read as their child" — true while the
              switches had no icons. They have a rail now, so a footnote at the
              ROW indent would read as a sixth category. It stays at the GROUP
              title's inset, which is what it actually annotates.

              The content is unchanged and so is the reasoning: two kinds have no
              preference column to store a mute in. A sighting push is the moment
              the whole product exists for, and the 72-hour contest window has no
              in-app door at all — docs/ROADMAP.md records that /sighting-dispute is
              reachable ONLY from its push — so silencing that one removes a money
              right rather than a notification. */}
          <Text style={styles.footnote} testID="notify-always-on">
            Two things stay on whatever you choose here: a sighting of your car, and the 72 hours you
            have to contest a decision about a bounty. Neither can be got back if you miss it.
          </Text>
        </View>
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
    // A group and the footnote explaining it, held closer to each other than
    // to the next group (the scroll's spacing.xl). Proximity is the ONLY thing
    // saying which group a caption belongs to — at an equal gap on both sides
    // it belongs to neither, which is what it looked like before.
    bundle: {
      gap: spacing.sm,
    },
    // Stands in for the Switch until the read lands, at the switch's own
    // width, so nothing shifts when the real control arrives.
    switchPlaceholder: {
      width: sizes.control,
      height: sizes.skeletonLine * 2,
      borderRadius: radii.md,
      backgroundColor: c.surfaceSubtle,
    },
    // ⚠️ ONE CONSUMER SINCE 2026-08-26, and the wording of this note used to
    // describe the other one. There was a second footnote under Permissions
    // ("Notifications, location, camera and photos are controlled by your
    // phone…") saying once what four rows would otherwise each have to imply:
    // these are not switches, and the app is not the thing that decides. Owner
    // removed it — the rows already carry a `value` stating the current answer
    // and a chevron promising somewhere to go, so the sentence was narrating
    // what the anatomy shows. What remains is the Notifications note, which is
    // NOT the same kind of thing: it states a fact the UI cannot show, because
    // the two unmutable kinds have no row to appear on.
    footnote: {
      ...typography.caption,
      color: c.textSecondary,
      paddingHorizontal: spacing.md,
    },
  });
