/**
 * WHAT:  ColourField — the car-colour picker for the post-a-car colour step. A
 *        spacious grid of circular colour swatches, each with its NAME shown
 *        beneath (always visible), a primary ring + check badge on selection,
 *        and a gentle spring pop on tap. Tapping an escape ("Multicolour /
 *        wrapped" or "Other") selects it AND opens a BottomSheet to capture the
 *        free-text specifics (re-tapping reopens it to edit).
 * WHY:   A named-swatch grid — not a spectrum/hex picker — is the right pattern
 *        for a dozen real colours (research). The NAME label is a hard
 *        accessibility requirement, not decoration: ~4.5% of users have colour-
 *        vision deficiency and a colour-blind spotter reads the word — so
 *        colour is NEVER the sole signal (DESIGN_SYSTEM: never encode by colour
 *        alone). Light swatches (white/silver/gold) get a border so they don't
 *        vanish on the light background. The stored value is the canonical NAME
 *        (a clean enum); the note is stored separately (→ owner_note) so it
 *        never pollutes the colour value. The note lives in a focused sheet
 *        opened on selection (no inline input), keeping the grid uncluttered.
 * LINKS: src/features/vehicles/post/lib/carColours.ts (palette + helpers);
 *        src/features/vehicles/post/components/postSteps.tsx (ColourStep);
 *        src/shared/ui/{BottomSheet,TextField,Button}.tsx (the note sheet);
 *        docs/DESIGN_SYSTEM.md (Colour, Motion, Accessibility).
 */

import { Feather } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { lightHaptic } from '@/shared/lib/haptics';
import { colors, motion, radii, sizes, spacing, typography } from '@/shared/theme';
import { BottomSheet, Button, TextField, type BottomSheetRef } from '@/shared/ui';

import { CAR_COLOURS, type CarColour, isNoteColour } from '../lib/carColours';

/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are
   deliberately mutable (scale.value is written from the press handler to drive
   the select pop); the compiler's immutability model doesn't apply to them.
   SwatchCell also opts out of memoization via 'use no memo'. */

export interface ColourFieldProps {
  /** The selected canonical colour name, or null. */
  value: string | null;
  /** The free-text note for an escape colour (wrapped / other specifics). */
  note: string;
  onChange: (colour: string) => void;
  onChangeNote: (note: string) => void;
  error?: string;
}

/** Per-cell stagger (matches SelectScreen): ≤~6 steps so the cascade lands in
 *  the ≤300ms budget (docs/DESIGN_SYSTEM.md Motion — lists). */
const STAGGER_STEP_MS = motion.listStagger;
const STAGGER_MAX_STEPS = 5;

function SwatchCell({
  colour,
  selected,
  index,
  onSelect,
}: {
  colour: CarColour;
  selected: boolean;
  index: number;
  onSelect: (name: string) => void;
}) {
  'use no memo'; // mutates a shared value in the press handler (as AppTabBar/MoneySlider)
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    // A gentle tactile pop: dip then spring back (springStandard — a hair of
    // life; springBouncy is reserved for success moments per the motion tokens).
    scale.value = withSequence(
      withTiming(0.9, { duration: motion.fast / 2, reduceMotion: ReduceMotion.System }),
      withSpring(1, { ...motion.springStandard, reduceMotion: ReduceMotion.System }),
    );
    lightHaptic(); // a light tick to match the pop
    onSelect(colour.name);
  };

  const entering = FadeInDown.duration(motion.fast)
    .delay(Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS)
    .reduceMotion(ReduceMotion.System);

  return (
    <Animated.View entering={entering} style={styles.cell}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={colour.name}
        accessibilityState={{ checked: selected }}
        onPress={handlePress}
        style={styles.cellPressable}
      >
        <Animated.View style={[styles.ring, selected && styles.ringSelected, popStyle]}>
          <View
            testID={`colour-swatch-${colour.name}`}
            style={[
              styles.swatch,
              // Swatch fill is DATA (see carColours.ts), never a token.
              { backgroundColor: colour.hex },
              colour.light && styles.swatchBordered,
            ]}
          >
            {colour.secondaryHex ? (
              <View style={[styles.swatchHalf, { backgroundColor: colour.secondaryHex }]} />
            ) : null}
            {colour.icon ? (
              <Feather name={colour.icon} size={sizes.iconSm} color={colors.textSecondary} />
            ) : null}
          </View>
          {selected ? (
            <View style={styles.checkBadge}>
              <Feather name="check" size={sizes.colourSwatchBadgeIcon} color={colors.textOnPrimary} />
            </View>
          ) : null}
        </Animated.View>
        <Text style={styles.swatchLabel} numberOfLines={2}>
          {colour.name}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function ColourField({ value, note, onChange, onChangeNote, error }: ColourFieldProps) {
  const sheetRef = useRef<BottomSheetRef>(null);

  // Selecting an escape colour ("Multicolour / wrapped" / "Other") opens the
  // note sheet straight away — no separate trigger field. Re-tapping the same
  // escape swatch reopens it to edit the note.
  const handleSelect = (name: string) => {
    onChange(name);
    if (isNoteColour(name)) {
      sheetRef.current?.open();
    }
  };

  return (
    <View style={styles.stack}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Car colour" style={styles.grid}>
        {CAR_COLOURS.map((colour, index) => (
          <SwatchCell
            key={colour.name}
            colour={colour}
            index={index}
            selected={value === colour.name}
            onSelect={handleSelect}
          />
        ))}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <BottomSheet ref={sheetRef} title="Colour details">
        <View style={styles.sheetBody}>
          <TextField
            label="Details"
            variant="multiline"
            placeholder="e.g. matte black wrap over silver"
            value={note}
            onChangeText={onChangeNote}
            maxLength={120}
            helperText="Tell spotters about the wrap or finish."
          />
          <Button label="Done" onPress={() => sheetRef.current?.close()} />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.xl,
  },
  cell: {
    width: '30%',
  },
  cellPressable: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  ring: {
    padding: sizes.colourSwatchRingGap,
    borderRadius: radii.full,
    borderWidth: sizes.colourSwatchRing,
    borderColor: 'transparent',
  },
  ringSelected: {
    borderColor: colors.primary,
  },
  swatch: {
    width: sizes.colourSwatch,
    height: sizes.colourSwatch,
    borderRadius: radii.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Light fills would vanish on the light background — a hairline keeps them legible.
  swatchBordered: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  // Two-tone (wrapped): the secondary colour fills the right half.
  swatchHalf: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '50%',
  },
  checkBadge: {
    position: 'absolute',
    // Sit the badge just outside the ring, offset by the ring stroke.
    right: -sizes.colourSwatchRing,
    bottom: -sizes.colourSwatchRing,
    width: sizes.colourSwatchBadge,
    height: sizes.colourSwatchBadge,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // A ring in the background colour lifts the badge off the swatch edge.
    borderWidth: sizes.colourSwatchRing,
    borderColor: colors.background,
  },
  swatchLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  sheetBody: {
    gap: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
});
