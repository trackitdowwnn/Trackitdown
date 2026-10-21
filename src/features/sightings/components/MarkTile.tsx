/**
 * WHAT:  MarkTile — one of the owner's distinctive marks as a bordered row:
 *        the owner's photo of it, its description, and a tick (seen) or an
 *        empty circle (not). Pressable (a checkbox) when given `onPress`;
 *        read-only otherwise.
 * WHY:   The SAME row on both sides of a sighting (owner, 2026-10-19): the
 *        spotter ticks the marks they could see in the report wizard ("Could
 *        you see any of these?"), and the owner's sighting page lists ALL
 *        their marks with exactly those ticked — so the owner reads the
 *        report the way it was filled in, including the marks NOT seen.
 *        Moved here from sightingSteps.tsx, where it was private.
 * LINKS: src/features/sightings/components/contextSteps.tsx (MarksStep —
 *          the spotter ticks); src/features/sightings/components/
 *          SightingSeenSection.tsx (the owner reads).
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage } from '@/shared/ui';

export interface MarkTileProps {
  description: string;
  photoUrl?: string;
  /** Ticked: chosen in the wizard, SEEN on the owner's page. */
  selected: boolean;
  /** Present: a checkbox the spotter toggles. Absent: a read-only row. */
  onPress?: () => void;
  testID: string;
}

/** One of the owner's marks: their photo, the description, and a check. */
export function MarkTile({ description, photoUrl, selected, onPress, testID }: MarkTileProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  const content = (
    <>
      {photoUrl ? (
        <AppImage uri={photoUrl} style={styles.thumb} testID={`${testID}-photo`} />
      ) : (
        // No photo: an empty thumb keeps every row's text on the same line.
        <View
          style={[styles.thumb, styles.thumbEmpty]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          <Feather name="image" size={sizes.iconSm} color={palette.textSecondary} />
        </View>
      )}
      <Text style={styles.label}>{description}</Text>
      <Feather
        name={selected ? 'check-circle' : 'circle'}
        size={sizes.icon}
        // textSecondary, not borderStrong (~2.6:1): a control's state needs 3:1.
        color={selected ? palette.primary : palette.textSecondary}
      />
    </>
  );

  if (!onPress) {
    // Read-only: one stop that says the state in words, not "checkbox".
    return (
      <View
        accessible
        accessibilityLabel={`${description}, ${selected ? 'seen' : 'not seen'}`}
        testID={testID}
        style={[styles.tile, selected && styles.tileSelected]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={description}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.tile,
        selected && styles.tileSelected,
        pressed && styles.tilePressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // A bordered row each (CardSelect's border and check cue, at the compact
    // `md` radius of the SelectScreen tiles), the owner's photo on the left.
    tile: {
      minHeight: sizes.control,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.sm,
      paddingRight: spacing.lg,
      borderRadius: radii.md,
      borderWidth: sizes.selectBorder,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    tileSelected: {
      borderColor: c.primary,
    },
    tilePressed: {
      backgroundColor: c.surfaceSubtle,
    },
    thumb: {
      width: sizes.markThumb,
      height: sizes.markThumb,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    thumbEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    // flex: 1 takes the row's spare room, so the check always sits trailing.
    label: {
      ...typography.body,
      color: c.textPrimary,
      flex: 1,
    },
  });
