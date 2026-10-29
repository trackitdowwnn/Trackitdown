/**
 * WHAT:  ColourField — the car-colour picker for the post-a-car colour step. A
 *        spacious grid of circular colour swatches, each with its NAME shown
 *        beneath (always visible), a primary ring + check badge on selection,
 *        and a gentle spring pop on tap. Tapping an escape ("Multicolour /
 *        wrapped" or "Other") selects it AND opens a BottomSheet to capture the
 *        free-text specifics (re-tapping reopens it to edit). The paint finish
 *        is NOT asked here: ColourStep asks it on the way out, in
 *        PaintFinishSheet (2026-10-12). No "Selected: …" line under the grid
 *        (owner request, the same day): the ring, tick and bolder name say it.
 * WHY:   A named-swatch grid — not a spectrum/hex picker — is the right pattern
 *        for the ~twenty real colours a V5C records (research). The NAME label is a hard
 *        accessibility requirement, not decoration: ~4.5% of users have colour-
 *        vision deficiency and a colour-blind spotter reads the word — so
 *        colour is NEVER the sole signal (DESIGN_SYSTEM: never encode by colour
 *        alone). Every swatch gets a border so none vanishes, pale or dark,
 *        on either theme. The stored value is the canonical NAME
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
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from 'react-native';
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
  listRowStackFontScale,
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { fontFamilies } from '@/shared/theme/typography';
import { BottomSheet, Button, TextField, type BottomSheetRef } from '@/shared/ui';

import {
  CAR_COLOURS,
  canonicalColourName,
  type CarColour,
  colourIsComplete,
  glyphInkFor,
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
  error?: string;
}

/** The note sheet's words for a colour with no copy of its own. */
const FALLBACK_NOTE_COPY = {
  title: 'Colour details',
  label: 'Details',
  placeholder: 'e.g. matte black wrap over silver',
  helper: 'Tell spotters about the wrap or finish.',
};

/** A swatch's full box: the swatch, its ring gap and its ring, both sides. */
const SWATCH_BOX = sizes.colourSwatch + 2 * (sizes.colourSwatchRingGap + sizes.colourSwatchRing);

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
        accessibilityHint={colour.note ? 'Opens a box to describe it' : undefined}
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
              // The swatch's own ink, not a theme one: the fill never flips, so a
              // themed grey went to ~2:1 on it in dark mode (UI review).
              <Feather name={colour.icon} size={sizes.iconSm} color={glyphInkFor(colour)} />
            ) : null}
          </View>
          {selected ? (
            <View style={styles.checkBadge}>
              <Feather name="check" size={sizes.colourSwatchBadgeIcon} color={palette.textOnPrimary} />
            </View>
          ) : null}
        </Animated.View>
        {/* The chosen name a weight up — the same SIZE, so nothing rewraps
            and no row moves under the finger: the selection reads in WORDS
            too, never by the ring's colour alone (owner request, 2026-10-12). */}
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
  error,
}: ColourFieldProps) {
  const styles = useThemedStyles(makeStyles);
  const sheetRef = useRef<BottomSheetRef>(null);
  const noteRef = useRef<TextInputInstance>(null);
  const [sheetUp, setSheetUp] = useState(false);
  // Done pressed on a blank required note: the box says why (UI review —
  // a disabled Done said nothing to anyone).
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const { width, fontScale } = useWindowDimensions();
  // A retired name (an old "Brown / Beige") still selects its swatch.
  const chosen = canonicalColourName(value);
  const chosenSwatch = swatchForName(value);
  // Each escape asks its own question (2026-10-12).
  const copy = chosenSwatch?.noteCopy ?? FALLBACK_NOTE_COPY;
  const noteMissing = !colourIsComplete(value, note);

  // FOUR columns where four swatches and their gaps fit; three at large text
  // or on a narrow phone, where four would overflow their cells and split
  // names mid-word (UI review). Rows of flex:1 cells — never measured widths.
  const fitsFour =
    width - 2 * spacing.xl >= 4 * SWATCH_BOX + 3 * spacing.sm &&
    (fontScale ?? 1) <= listRowStackFontScale;
  const columns = fitsFour ? 4 : 3;
  const rows = chunk(CAR_COLOURS, columns);

  const openSheet = () => {
    setNoteError(undefined);
    setSheetUp(true);
    sheetRef.current?.open();
  };

  // Selecting an escape colour ("Multicolour / wrapped" / "Other") opens the
  // note sheet straight away — no separate trigger field. Re-tapping the same
  // escape swatch reopens it to edit the note.
  const handleSelect = (name: string) => {
    onChange(name);
    if (isNoteColour(name)) openSheet();
  };

  // The box takes focus once the sheet has RISEN, not as it mounts — a
  // keyboard raised mid-slide made the sheet jump twice (#158's lesson). A
  // small margin past the slide, so it never lands on the last frame.
  useEffect(() => {
    if (!sheetUp) return undefined;
    const timer = setTimeout(() => noteRef.current?.focus(), motion.standard + motion.fast);
    return () => clearTimeout(timer);
  }, [sheetUp]);

  // Done takes the keyboard with the sheet — or, for a blank required note,
  // says what's missing and keeps the box.
  const finishNote = () => {
    if (noteMissing) {
      setNoteError('Say what colour it is');
      noteRef.current?.focus();
      return;
    }
    Keyboard.dismiss();
    sheetRef.current?.close();
  };

  return (
    <View style={styles.stack}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Car colour" style={styles.grid}>
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.row}>
            {row.map((colour, cellIndex) => (
              <SwatchCell
                key={colour.name}
                colour={colour}
                index={rowIndex * columns + cellIndex}
                selected={chosen === colour.name}
                onSelect={handleSelect}
              />
            ))}
            {/* Spacers keep a short last row's cells the same width. */}
            {Array.from({ length: columns - row.length }, (_, i) => (
              <View key={`spacer-${i}`} style={styles.cell} />
            ))}
          </View>
        ))}
      </View>

      {/* No "Selected: …" line under the grid (owner request, 2026-10-12):
          the ring, the tick and the bolder name already say it. Only an
          "Other" with nothing said gets a line — what's missing, and the way
          back to its box (re-tapping the swatch is not discoverable). */}
      {chosen && noteMissing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add the colour"
          onPress={openSheet}
          hitSlop={spacing.md}
          style={styles.addLink}
        >
          <Text style={styles.addLinkText}>Add the colour</Text>
        </Pressable>
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
          setNoteError(undefined);
        }}
      >
        <View style={styles.sheetBody}>
          <TextField
            ref={noteRef}
            label={copy.label}
            variant="multiline"
            placeholder={copy.placeholder}
            value={note}
            onChangeText={(text) => {
              setNoteError(undefined);
              onChangeNote(text);
            }}
            maxLength={120}
            helperText={copy.helper}
            accessibilityHint={copy.helper}
            error={noteError}
            testID="colour-note-input"
          />
          <Button label="Done" onPress={finishNote} />
        </View>
      </BottomSheet>
    </View>
  );
}

/** `items` in rows of `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  grid: {
    rowGap: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    columnGap: spacing.sm,
  },
  // Equal flex cells in each row (DESIGN_SYSTEM: never measured widths).
  cell: {
    flex: 1,
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
  // Every swatch's edge (see the SwatchCell comment): pale fills vanish on the
  // light page and dark ones on the dark page, so none goes without it.
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
    minHeight: 2 * typography.caption.lineHeight,
  },
  // Two lines reserved for every name, so a row is the same height whatever
  // is picked; selection changes the WEIGHT only, never the size.
  swatchLabelSelected: {
    fontFamily: fontFamilies.medium,
  },
  // For an undescribed Other: the underlined way back to its box.
  addLink: {
    alignSelf: 'flex-start',
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  addLinkText: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  sheetBody: {
    gap: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: c.danger,
  },
});
