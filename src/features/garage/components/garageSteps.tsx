/**
 * WHAT:  The two GARAGE-ONLY wizard steps — the number plate and the optional
 *        nickname. Everything else in the add-a-car flow is the shared
 *        vehicle-identity slice from features/vehicles.
 * WHY:   Posting dropped plate capture on 2026-07-24, but a saved car wants one:
 *        it is the natural key for "is this car currently reported stolen?", and
 *        supplying it at posting time re-arms create_post's one-active-post-per-
 *        plate guard, which is dormant today because every post is plate-less.
 *        Both steps are OPTIONAL — a plate the owner doesn't have (or a car with
 *        no pet name) must never block saving.
 * LINKS: src/features/garage/lib/addVehicleFlow.tsx (the flow that uses these);
 *        src/features/vehicles/post/lib/vehicleSteps.tsx (the shared seven);
 *        src/shared/ui/TextField.tsx (the `plate` variant — formatting only;
 *          validation is server-side in add_vehicle).
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { formatPlate } from '@/shared/lib/plate';
import {
  type PlateCandidate,
  extractPlateCandidates,
} from '@/shared/lib/plateCandidates';
import { recogniseText } from '@/shared/lib/ocr/textRecognition';
import { colors, sizes, spacing, typography } from '@/shared/theme';
import { type BottomSheetRef, StepSkipButton, TextField } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import type { AddVehicleAnswers } from '../types';
import { PlateScanSheet } from './PlateScanSheet';

const log = createLogger('garage');

type GarageStepProps = WizardStepProps<AddVehicleAnswers>;

/** OCR wants detail, not megapixels. Also the size PhotoGridPicker settles on. */
const SCAN_MAX_EDGE = 2000;

export function PlateStep({ answers, setAnswers, onSkip }: GarageStepProps) {
  const sheetRef = useRef<BottomSheetRef>(null);
  const [scanning, setScanning] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // SAFETY: recognised text lives HERE and nowhere else — component state that
  // dies with the step. It never enters wizard answers, storage or a log. Only
  // the one plate the user explicitly confirms is written to `answers`.
  const [candidates, setCandidates] = useState<readonly PlateCandidate[]>([]);

  const scan = useCallback(
    async (source: 'camera' | 'library') => {
      // Owner content, so the gallery is fine — this is NOT the sightings
      // evidence camera (CameraCapture), which forbids a gallery path by design
      // because it would let someone fabricate a sighting.
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setBlocked(true);
        setCandidates([]);
        sheetRef.current?.open();
        return;
      }

      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 1 });
      if (picked.canceled || !picked.assets?.[0]) {
        return;
      }

      setBlocked(false);
      setScanning(true);
      log.info('plate_scan_started', { source });

      // SAFETY: re-encode BEFORE handing the file to the OCR module. A photo
      // from the camera roll carries EXIF — including the GPS of wherever it
      // was taken, which for a photo of your own car is usually your home. The
      // manipulated copy has none. `exif: false` on the picker only means WE
      // don't read it; the file on disk still has it.
      // It also bakes in rotation, so the bounding boxes we rank on are in
      // display orientation rather than sensor orientation, and shrinks the
      // image so recognition is fast and memory-safe.
      const context = ImageManipulator.manipulate(picked.assets[0].uri);
      context.resize({ width: SCAN_MAX_EDGE });
      const rendered = await context.renderAsync();
      const scanned = await rendered.saveAsync({ format: SaveFormat.JPEG });

      const result = await recogniseText(scanned.uri);
      // Counts only — never the plate, and never the raw recognised text.
      const found =
        result.status === 'ok' ? extractPlateCandidates(result.blocks) : [];
      log.info('plate_scan_finished', {
        status: result.status,
        candidates: found.length,
      });
      setCandidates(found);
      setScanning(false);
      sheetRef.current?.open();
    },
    [],
  );

  const confirm = useCallback(
    (canon: string) => {
      // Stored in the spaced display form, which is what someone typing would
      // produce and what the field shows back to them.
      setAnswers({ plate: formatPlate(canon) });
      log.info('plate_scan_confirmed');
      setCandidates([]);
      sheetRef.current?.close();
    },
    [setAnswers],
  );

  const dismiss = useCallback(() => {
    // Drop everything the recogniser saw the moment the question is answered.
    setCandidates([]);
    sheetRef.current?.close();
  }, []);

  return (
    <View style={styles.block}>
      <TextField
        label="Number plate"
        variant="plate"
        placeholder="AB12 CDE"
        value={answers.plate ?? ''}
        onChangeText={(plate) => setAnswers({ plate })}
      />

      {/* Secondary by design: typing is the primary path and always works.
          Scanning is the shortcut, not the route. */}
      <Pressable
        onPress={() => void scan('camera')}
        onLongPress={() => void scan('library')}
        disabled={scanning}
        accessibilityRole="button"
        accessibilityLabel="Scan the number plate from a photo"
        accessibilityHint="Opens the camera. Long press to choose an existing photo."
        accessibilityState={{ disabled: scanning }}
        style={styles.scanRow}
        testID="plate-scan"
      >
        <Camera size={sizes.iconSm} color={colors.primary} />
        <Text style={styles.scanLabel}>
          {scanning ? 'Reading the plate…' : 'Scan it from a photo'}
        </Text>
      </Pressable>

      {/* Honest about why we want it, and that it is genuinely optional — some
          owners don't have it to hand, and a thief may have swapped it. */}
      <Text style={styles.helper}>
        We use this to spot if your car is already reported stolen. You can add it later.
      </Text>
      {/* Without this the step is a DEAD END: its schema needs a plate to
          unlock Next, so an owner who doesn't have one to hand could not get
          past the FIRST screen of the flow. */}
      {onSkip ? (
        <StepSkipButton
          label="I don't have it to hand"
          onPress={onSkip}
          testID="plate-skip"
        />
      ) : null}

      <PlateScanSheet
        ref={sheetRef}
        candidates={candidates}
        blocked={blocked}
        onConfirm={confirm}
        onDismiss={dismiss}
      />
    </View>
  );
}

export function NicknameStep({ answers, setAnswers, onSkip }: GarageStepProps) {
  return (
    <View style={styles.block}>
      <TextField
        label="Nickname"
        placeholder="Mum's Golf"
        value={answers.nickname ?? ''}
        onChangeText={(nickname) => setAnswers({ nickname })}
        maxLength={40}
      />
      <Text style={styles.helper}>
        Just for you — it makes a garage with a few cars easier to scan.
      </Text>
      {/* Same dead end as the plate step — and this one is the LAST screen
          before saving, so without it a car with no pet name can't be saved. */}
      {onSkip ? (
        <StepSkipButton label="No name needed" onPress={onSkip} testID="nickname-skip" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // Full-height touch target without a button's visual weight — this is a
    // shortcut offered beside the real input, not a competing call to action.
    minHeight: sizes.touchTarget,
    marginTop: -spacing.xs,
  },
  scanLabel: {
    ...typography.label,
    color: colors.primary,
  },
});
