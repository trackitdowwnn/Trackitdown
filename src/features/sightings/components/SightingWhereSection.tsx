/**
 * WHAT:  "Where" on the owner's sighting page: the street address in a chip
 *        (as the listing page shows its place), the exact captured point on a
 *        non-interactive map card, the safety notice, and — below it — two
 *        buttons side by side, [Google Maps] [Waze], each with the app's own
 *        mark. Or one line saying the location couldn't be captured (the
 *        notice still shows, and there is nothing to open).
 * WHY:   The owner asked for all three on 2026-10-20: the address under the
 *        title, no "Approximate — within about N m" line under the map (added
 *        2026-10-08; the owner found it noise), and the two apps by name
 *        instead of one quiet "Open in Maps" link.
 *
 *        ⚠️ THE NOTICE SITS WITH THE POINT, AND THE BUTTONS BELOW THE NOTICE
 *        (SECURITY_AND_TRUST §1; review of #145). The exact spot is where an
 *        owner is most tempted to act; a notice several sections further down
 *        did not stand beside it. Each button goes through the screen's
 *        confirm (which repeats the notice) and opens a PIN in that app —
 *        never directions, never Waze's navigate=yes (mapsLink.ts): §1 bans
 *        pursuit features.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx (the
 *          confirm, the URLs); ./MapsAppLogos.tsx; src/shared/ui/AppMap.tsx;
 *        src/shared/ui/SafetyNotice.tsx; src/shared/lib/mapsLink.ts;
 *        docs/SECURITY_AND_TRUST.md.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  listRowStackFontScale,
  motion,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { SafetyNotice } from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';

import { GoogleMapsLogo, WazeLogo } from './MapsAppLogos';

/** Same ~1.4-mile preview span as the post page's last-seen map. */
const PREVIEW_DELTA = 0.02;

/** The maps apps the owner can open the point in. */
export type MapsApp = 'google' | 'waze';

export interface SightingWhereSectionProps {
  /** The first photo that carried a location, or null. */
  point: { lat: number; lng: number } | null;
  /** The street address (or the stored area) — under the title, in a chip. */
  address: string | null;
  /** The area, for the map's spoken label. */
  areaLabel: string | null;
  /** Asks first — the screen's safety confirm — then opens the pin. */
  onOpenMaps: (app: MapsApp) => void;
}

/** The address, the map, the notice and the two apps — see the header. */
export function SightingWhereSection({
  point,
  address,
  areaLabel,
  onOpenMaps,
}: SightingWhereSectionProps) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  // At large text the pair stacks, as the decision bar's does, rather than
  // squeezing two names and two logos into half a screen each.
  const stacked = (fontScale ?? 1) > listRowStackFontScale;

  // The listing page's place chip, the same look (PostDetailBody).
  const addressChip = address ? (
    <View
      style={styles.addressChip}
      accessible
      accessibilityLabel={`Address: ${address}`}
      testID="sighting-address"
    >
      <Text style={styles.addressText}>{address}</Text>
    </View>
  ) : null;

  if (!point) {
    return (
      <View style={styles.root}>
        {addressChip}
        <Text style={styles.missing}>Location couldn’t be captured for this sighting.</Text>
        <SafetyNotice />
      </View>
    );
  }

  const google = (
    <MapsAppButton
      label="Google Maps"
      logo={<GoogleMapsLogo />}
      onPress={() => onOpenMaps('google')}
      testID="sighting-open-google-maps"
    />
  );
  const waze = (
    <MapsAppButton
      label="Waze"
      logo={<WazeLogo />}
      onPress={() => onOpenMaps('waze')}
      testID="sighting-open-waze"
    />
  );

  return (
    <View style={styles.root}>
      {addressChip}
      <View
        style={styles.mapCard}
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          areaLabel
            ? `Map of where the car was seen, near ${areaLabel}`
            : 'Map of where the car was seen'
        }
        testID="sighting-map"
      >
        <AppMap
          interactive={false}
          region={{
            latitude: point.lat,
            longitude: point.lng,
            latitudeDelta: PREVIEW_DELTA,
            longitudeDelta: PREVIEW_DELTA,
          }}
          animateDurationMs={motion.mapPan}
          onRegionChangeStart={() => {}}
          onRegionChangeComplete={() => {}}
        >
          <AppMapMarker
            coordinate={{ latitude: point.lat, longitude: point.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.pin} />
          </AppMapMarker>
        </AppMap>
      </View>
      <SafetyNotice />
      {stacked ? (
        <View style={styles.stack}>
          {google}
          {waze}
        </View>
      ) : (
        <View style={styles.pair}>
          <View style={styles.half}>{google}</View>
          <View style={styles.half}>{waze}</View>
        </View>
      )}
    </View>
  );
}

/** One maps app: its mark and its name, in the secondary button's look. A
 *  Pressable of its own because Button's icon slot takes a Feather glyph, not
 *  a brand mark. */
function MapsAppButton({
  label,
  logo,
  onPress,
  testID,
}: {
  label: string;
  logo: ReactNode;
  onPress: () => void;
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The visible words first (Button's rule), so voice control matches.
      accessibilityLabel={label}
      accessibilityHint={`Opens the place in ${label}, after a safety reminder`}
      style={({ pressed }) => [styles.appButton, pressed && styles.pressed]}
      testID={testID}
    >
      {logo}
      {/* Wraps at large text, never truncates — Button's own label rule. */}
      <Text style={styles.appLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.md,
    },
    // PostDetailBody's place chip, token for token.
    addressChip: {
      alignSelf: 'flex-start',
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    addressText: {
      ...typography.label,
      color: c.textPrimary,
      includeFontPadding: false,
    },
    mapCard: {
      height: sizes.mapPreview,
      borderRadius: radii.xl,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    // No shadow: markers carry none (Android never draws it, and on iOS it
    // adds tappable margin) — the surface ring gives the pin its edge.
    pin: {
      width: sizes.mapPinConfirm,
      height: sizes.mapPinConfirm,
      borderRadius: radii.full,
      backgroundColor: c.primary,
      borderWidth: sizes.mapPinRing,
      borderColor: c.surface,
    },
    missing: {
      ...typography.body,
      color: c.textSecondary,
    },
    // SightingDecisionBar's pair / stack.
    pair: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    half: {
      flex: 1,
    },
    stack: {
      gap: spacing.md,
    },
    // Button's `secondary` variant, token for token (an ink outline, ink
    // label, grey when pressed), with the app's mark before its name.
    // Horizontal padding `lg`, not Button's `xl`: each sits in half a row.
    appButton: {
      minHeight: sizes.control,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.primary,
    },
    pressed: {
      backgroundColor: c.surfaceSubtle,
    },
    appLabel: {
      ...typography.label,
      color: c.primary,
      flexShrink: 1,
      textAlign: 'center',
    },
  });
