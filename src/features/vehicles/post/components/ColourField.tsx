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
 * LINKS: src/shared/lib/carColours.ts (palette + helpers);
 *        src/features/vehicles/post/components/postSteps.tsx (ColourStep);
 *        src/shared/ui/{BottomSheet,TextField,Button}.tsx (the note sheet);
 *        docs/DESIGN_SYSTEM.md (Colour, Motion, Accessibility).
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';
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
import { BottomSheet, Button, TextField, type BottomSheetRef } from '@/shared/ui';

import {
  CAR_COLOURS,
  canonicalColourName,
  type CarColour,
  isNoteColour,
  swatchForName,
} from '@/shared/lib';

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
  /** The escape note sheet's Done — after the keyboard and sheet have gone. */
  onDone?: () => void;
  error?: string;
}

/** The note sheet's words for a colour with no copy of its own. */
const FALLBACK_NOTE_COPY = {
  title: 'Colour details',
  label: 'Details',
  placeholder: 'e.g. matte black wrap over silver',
  helper: 'Tell spotters about the wrap or finish.',
};

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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
              // EVERY swatch, not just the pale ones (2026-08-10). The border
              // used to be gated on `colour.light`, which was correct while the
              // surface behind it was always white — only white/silver/gold
              // could disappear. Dark mode inverted the problem: Black #1A1A1A
              // on a #1E1E1E card is 1.03:1, so the most commonly picked colour
              // in the grid rendered as an empty hole. A swatch is a sample of
              // paint and needs an edge at BOTH ends of the range; borderStrong
              // clears 3:1 on either surface.
              styles.swatchBordered,
            ]}
          >
            {colour.secondaryHex ? (
              <View style={[styles.swatchHalf, { backgroundColor: colour.secondaryHex }]} />
            ) : null}
            {colour.icon ? (
              <Feather name={colour.icon} size={sizes.iconSm} color={palette.textSecondary} />
            ) : null}
          </View>
          {selected ? (
            <View style={styles.checkBadge}>
              <Feather name="check" size={sizes.colourSwatchBadgeIcon} color={palette.textOnPrimary} />
            </View>
          ) : null}
        </Animated.View>
        {/* The chosen name a weight up: the selection reads in WORDS too,
            never by the ring's colour alone (owner request, 2026-10-12). */}
        <Text style={[styles.swatchLabel, selected && styles.swatchLabelSelected]} numberOfLines={2}>
          {colour.name}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function ColourField({
  value,
  note,
  onChange,
  onChangeNote,
  onDone,
  error,
}: ColourFieldProps) {
  const styles = useThemedStyles(makeStyles);
  const sheetRef = useRef<BottomSheetRef>(null);
  const noteRef = useRef<TextInput>(null);
  const [sheetUp, setSheetUp] = useState(false);
  // A retired name (an old "Brown / Beige") still selects its swatch.
  const chosen = canonicalColourName(value);
  const chosenSwatch = swatchForName(value);
  // Each escape asks its own question (2026-10-12): "What colour is it?" for
  // Other, "Describe the wrap" for Multicolour / wrapped.
  const copy = chosenSwatch?.noteCopy ?? FALLBACK_NOTE_COPY;
  const noteMissing = Boolean(chosenSwatch?.noteRequired) && note.trim() === '';

  // Selecting an escape colour ("Multicolour / wrapped" / "Other") opens the
  // note sheet straight away — no separate trigger field. Re-tapping the same
  // escape swatch reopens it to edit the note.
  const handleSelect = (name: string) => {
    onChange(name);
    if (isNoteColour(name)) {
      setSheetUp(true);
      sheetRef.current?.open();
    }
  };

  // The box takes focus once the sheet has RISEN, not as it mounts — a
  // keyboard raised mid-slide made the sheet jump twice (#158's lesson).
  useEffect(() => {
    if (!sheetUp) return undefined;
    const timer = setTimeout(() => noteRef.current?.focus(), motion.standard);
    return () => clearTimeout(timer);
  }, [sheetUp]);

  // Done takes the keyboard with the sheet, then hands back to the step.
  const finishNote = () => {
    if (noteMissing) return;
    Keyboard.dismiss();
    sheetRef.current?.close();
    onDone?.();
  };

  // A quiet confirmation in WORDS of what is chosen — with the note, if any.
  const summary = chosen
    ? note.trim() && chosenSwatch?.note
      ? `Selected: ${chosen} — ${note.trim()}`
      : `Selected: ${chosen}`
    : null;

  return (
    <View style={styles.stack}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Car colour" style={styles.grid}>
        {CAR_COLOURS.map((colour, index) => (
          <SwatchCell
            key={colour.name}
            colour={colour}
            index={index}
            selected={chosen === colour.name}
            onSelect={handleSelect}
          />
        ))}
      </View>

      {summary ? (
        <Text style={styles.summary} accessibilityLiveRegion="polite" testID="colour-summary">
          {summary}
        </Text>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <BottomSheet
        ref={sheetRef}
        title={copy.title}
        onDismiss={() => {
          Keyboard.dismiss();
          setSheetUp(false);
        }}
      >
        <View style={styles.sheetBody}>
          <TextField
            ref={noteRef}
            label={copy.label}
            variant="multiline"
            placeholder={copy.placeholder}
            value={note}
            onChangeText={onChangeNote}
            maxLength={120}
            helperText={copy.helper}
            accessibilityHint={copy.helper}
            testID="colour-note-input"
          />
          <Button label="Done" onPress={finishNote} disabled={noteMissing} />
        </View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.xl,
  },
  // FOUR columns (2026-10-12): the V5C palette's twenty fill five even rows,
  // where three columns left a ragged last row of two.
  cell: {
    width: '23%',
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
    borderColor: c.primary,
  },
  swatch: {
    width: sizes.colourSwatch,
    height: sizes.colourSwatch,
    borderRadius: radii.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Light fills would vanish on the light page — a hairline keeps them legible.
  // ⚠️ The swatch fills are literal CAR colours, so they never move with the
  // theme; only the ring does. On the dark page it is the DARK swatches that
  // now need this edge, and `colour.light` no longer selects the right ones —
  // a design call, deliberately left alone by this mechanical pass.
  swatchBordered: {
    borderWidth: 1,
    borderColor: c.borderStrong,
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
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // A ring in the background colour lifts the badge off the swatch edge.
    borderWidth: sizes.colourSwatchRing,
    borderColor: c.background,
  },
  swatchLabel: {
    ...typography.caption,
    color: c.textPrimary,
    textAlign: 'center',
  },
  swatchLabelSelected: {
    ...typography.label,
  },
  // "Selected: Blue" under the grid — quiet, secondary ink.
  summary: {
    ...typography.caption,
    color: c.textSecondary,
  },
  sheetBody: {
    gap: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: c.danger,
  },
});
