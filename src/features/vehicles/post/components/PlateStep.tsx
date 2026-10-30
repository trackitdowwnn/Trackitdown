/**
 * WHAT:  PlateStep — the optional number-plate question shared by both car
 *        flows: the plates read from the photos (tap one to fill the field),
 *        the field, a format warning that never blocks, a close photo when the
 *        photos gave nothing, and a skip.
 * WHY:   The photos step reads the plate in the background (usePlateScan) and
 *        says nothing more; the plates wait here, best first, each beside a
 *        crop so the owner can check it at a glance (owner, 2026-10-30: no
 *        pop-up). A suggestion never fills the field by itself: a listing's
 *        plate cannot be changed later, so a wrong guess must not slip through
 *        on a quick Continue. The field shows what they tapped or typed, and
 *        the suggestion that matches it wears a tick.
 *
 *        THE ROWS WAIT FOR THE LAST PHOTO. Reading 5 photos takes ~12 s, so
 *        people often arrive mid-scan; rows appearing and re-ranking above the
 *        field would move under a finger, and a mis-tap is a permanent plate.
 *        Until it is done, one line holds their place.
 *
 *        Each flow says why it wants the plate through `helper` (the garage
 *        does; the report has no helpers).
 *
 *        THE CLOSE PHOTO (docs/plate-scan-decisions.md). When the photos gave
 *        nothing, one line says so and offers the shot that reads best: the
 *        plate close up. Its readings join the same list; the photo is not
 *        added to the listing.
 * LINKS: ../lib/usePlateScan.tsx; ../lib/readPlate.ts; ../lib/plateScanOutcome.ts;
 *        ../postACarFlow.tsx; src/features/garage/components/garageSteps.tsx
 *        (GaragePlateStep); src/shared/ui/TextField.tsx (the `plate` variant).
 */

import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { formatPlate, isValidPlate, normalisePlate } from '@/shared/lib/plate';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, Button, PlateChip, StepSkipButton, TextField, spellPlate } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { rankScannedPlates, readPlateFromPhoto } from '../lib/readPlate';
import { readingLine, usePlateScan } from '../lib/usePlateScan';

const log = createLogger('vehicles');

export interface PlateStepAnswers {
  plate: string;
  plateScanOffered?: string;
}

export type PlateStepProps = WizardStepProps<PlateStepAnswers> & {
  /** One line on why the plate is wanted, under the field. */
  helper?: string;
};

export function PlateStep({ answers, setAnswers, onSkip, helper }: PlateStepProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const scan = usePlateScan();
  const typed = answers.plate ?? '';
  const canon = normalisePlate(typed);

  /**
   * ⚠️ A WARNING, NEVER A GATE. Our FORMATS list cannot know every plate a real
   * car carries: personalised, Northern Irish, pre-2001 and imported plates are
   * all legitimate, and a regex that misses one becomes a wall in front of
   * someone whose car has just been stolen. So it catches a typo and gets out
   * of the way. Only once there is enough to judge: two characters is someone
   * mid-type, not someone who is wrong.
   */
  const looksWrong = canon.length >= 4 && !isValidPlate(canon);

  const suggestions = scan.done ? scan.suggestions : [];
  // For the outcome log: the suggestion they picked if the field matches one,
  // else the best — so picking the second is "accepted", and typing their own
  // is "edited" or "typed" against what we offered. Cleared if none is left.
  const offered = suggestions.some((s) => s.canon === canon) ? canon : suggestions[0]?.canon;
  useEffect(() => {
    if (offered !== answers.plateScanOffered) setAnswers({ plateScanOffered: offered });
  }, [offered, answers.plateScanOffered, setAnswers]);

  // Said once when the rows appear (no visible copy is added for it).
  const count = suggestions.length;
  useEffect(() => {
    if (count > 0) {
      AccessibilityInfo.announceForAccessibility(
        `From your photos, ${count} ${count === 1 ? 'plate' : 'plates'}`,
      );
    }
  }, [count]);

  const [closeUp, setCloseUp] = useState<'idle' | 'reading' | 'nothing'>('idle');
  const nothingFound = scan.total > 0 && scan.done && scan.suggestions.length === 0;

  const takeCloseUp = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return;
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: false });
      if (shot.canceled || !shot.assets[0]) return;
      setCloseUp('reading');
      const startedAt = Date.now();
      const reading = await readPlateFromPhoto(shot.assets[0].uri);
      const plates = reading.kind === 'read' ? rankScannedPlates(reading.sightings) : [];
      log.info('plate_scan_result', {
        mode: 'v3',
        source: 'closeup',
        kind: reading.kind === 'error' ? 'error' : plates.length > 0 ? 'likely' : 'none',
        count: 1,
        durationMs: Date.now() - startedAt,
        ...(reading.kind === 'read' && plates.length === 0
          ? { reason: reading.sawText ? 'no_plate_shape' : 'no_text' }
          : {}),
      });
      if (reading.kind === 'read') scan.addCloseUp(reading.sightings);
      setCloseUp(plates.length > 0 ? 'idle' : 'nothing');
    } catch (error) {
      // The camera can fail to open; typing always works.
      log.warn('plate_scan_failed', { error: (error as Error).name });
      setCloseUp('idle');
    }
  };

  return (
    <View style={styles.block}>
      {!scan.done ? (
        <Text style={styles.helper} testID="plate-scan-reading">
          {readingLine(scan.read, scan.total)}
        </Text>
      ) : null}
      {suggestions.length > 0 ? (
        <View
          style={styles.suggestions}
          accessibilityRole="radiogroup"
          accessibilityLabel="From your photos"
        >
          <Text style={styles.label}>From your photos</Text>
          {suggestions.map((plate, index) => {
            const picked = plate.canon === canon;
            const pick = () => {
              log.info('plate_scan_picked', { index });
              setAnswers({ plate: formatPlate(plate.canon) });
            };
            return (
              <Pressable
                key={plate.canon}
                onPress={pick}
                accessibilityRole="radio"
                // Spelled out — "AB12 CDE" read aloud as a word is useless.
                accessibilityLabel={spellPlate(plate.display)}
                accessibilityState={{ checked: picked }}
                style={({ pressed }) => [
                  styles.option,
                  picked && styles.optionPicked,
                  pressed && styles.optionPressed,
                ]}
                testID={`plate-suggestion-${plate.canon}`}
              >
                {plate.cropUri ? (
                  // contain: the crop is there so every character can be
                  // checked, and a short plate is far from 2.6:1.
                  <AppImage
                    uri={plate.cropUri}
                    style={styles.crop}
                    contentFit="contain"
                    transition={0}
                  />
                ) : (
                  // Keeps the plates in one column when a reading has no crop.
                  <View
                    style={[styles.crop, styles.cropEmpty]}
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                  >
                    <Feather name="image" size={sizes.iconSm} color={palette.textSecondary} />
                  </View>
                )}
                {/* The row's press, forwarded: the chip is a touch responder
                    (long-press copies), and would otherwise swallow the tap. */}
                <PlateChip plate={plate.display} onPress={pick} />
                <View style={styles.tick}>
                  {picked ? <Check size={sizes.icon} color={palette.textPrimary} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <TextField
        label="Number plate"
        variant="plate"
        placeholder="AB12 CDE"
        value={typed}
        onChangeText={(plate) => setAnswers({ plate })}
      />
      {looksWrong ? (
        // Phrased as a question, because it may well be right and we are the
        // ones who might be wrong. Nothing is disabled by this.
        <Text style={styles.warning} testID="plate-format-warning">
          That doesn’t look like a UK plate — is it right?
        </Text>
      ) : null}
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      {nothingFound && !canon ? (
        <>
          <Text style={styles.helper} testID="plate-scan-nothing">
            {closeUp === 'nothing'
              ? 'Still couldn’t read it — you can type it above.'
              : 'We couldn’t read it from your photos.'}
          </Text>
          <Button
            label="Add a close photo of the plate"
            variant="secondary"
            icon="camera"
            loading={closeUp === 'reading'}
            onPress={() => void takeCloseUp()}
          />
        </>
      ) : null}
      {/* Without this the step is a DEAD END: its schema needs a plate to
          unlock Next, so an owner without one to hand could not get past it. */}
      {onSkip ? (
        <StepSkipButton label="I don't have it to hand" onPress={onSkip} testID="plate-skip" />
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.md,
    },
    suggestions: {
      gap: spacing.sm,
    },
    label: {
      ...typography.caption,
      color: c.textSecondary,
    },
    option: {
      minHeight: sizes.touchTarget,
      flexDirection: 'row',
      // Large text: the chip wraps under the crop rather than pushing the
      // tick off the row.
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      // Constant width, colour-only change when picked — the house rule for a
      // bordered selectable (see CardSelect), so nothing shifts.
      borderWidth: sizes.selectBorder,
      borderColor: c.border,
    },
    optionPicked: {
      borderColor: c.primary,
    },
    optionPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    crop: {
      width: sizes.plateCropWidth,
      aspectRatio: sizes.plateCropAspect,
      borderRadius: radii.sm,
    },
    cropEmpty: {
      backgroundColor: c.surfaceSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** Holds the tick's space either way, so picking moves nothing. */
    tick: {
      marginLeft: 'auto',
      width: sizes.icon,
    },
    helper: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // `warning`, not `danger`: nothing is wrong yet and nothing is blocked.
    warning: {
      ...typography.caption,
      color: c.warning,
    },
  });
