/**
 * WHAT:  PlateStep — the optional number-plate question shared by both car
 *        flows: the field, a format warning that never blocks, a skip, and
 *        (plate scanning v2) a way to try again with a close photo when the
 *        photos could not be read.
 * WHY:   It follows the photos step, which reads the plate from the photos
 *        (PhotosWithPlateScanStep); the flows hide it with `when` once a scanned
 *        plate was confirmed, so it is only asked of people the scan could not
 *        answer. It began as a garage-only step; the owner asked for plates in
 *        the report too (2026-10-30). Each flow says why it wants the plate
 *        through `helper` (the garage does; the report has no helpers).
 *
 *        THE CLOSE PHOTO (v2, docs/plate-scan-decisions.md). When the photos
 *        gave nothing, one line says so and offers the shot that reads best:
 *        the plate close up. It is read like any photo (two reads that must
 *        agree) and offered in the same sheet; nothing is written until the
 *        owner confirms it, and the photo is not added to the listing.
 * LINKS: ./PhotosWithPlateScanStep.tsx (sets plateScanNothing); ../lib/readPlate.ts;
 *        ./PlateScanSheet.tsx; ../postACarFlow.tsx;
 *        src/features/garage/components/garageSteps.tsx (GaragePlateStep);
 *        src/shared/ui/TextField.tsx (the `plate` variant: formatting only).
 */

import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { formatPlate, isValidPlate, normalisePlate } from '@/shared/lib/plate';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, StepSkipButton, TextField, type BottomSheetRef } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { readPlateFromPhoto, type ScannedPlate } from '../lib/readPlate';
import { PlateScanSheet } from './PlateScanSheet';

const log = createLogger('vehicles');

export interface PlateStepAnswers {
  plate: string;
  plateFromScan?: boolean;
  plateScanOffered?: string;
  /** v2: the photos were read and gave no plate. UI state only. */
  plateScanNothing?: boolean;
}

export type PlateStepProps = WizardStepProps<PlateStepAnswers> & {
  /** One line on why the plate is wanted, under the field. */
  helper?: string;
};

export function PlateStep({ answers, setAnswers, onSkip, helper }: PlateStepProps) {
  const styles = useThemedStyles(makeStyles);
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

  // The close photo: reading → found (sheet) or still nothing.
  const sheetRef = useRef<BottomSheetRef>(null);
  const [closeUp, setCloseUp] = useState<'idle' | 'reading' | 'nothing'>('idle');
  const [offer, setOffer] = useState<readonly ScannedPlate[]>([]);
  const offerCloseUp = answers.plateScanNothing && !canon;
  // The sheet is mounted only while there is a reading to offer, and opens
  // once it is (AppleComingSoonSheet's pattern): most visits never need it.
  useEffect(() => {
    if (offer.length > 0) sheetRef.current?.open();
  }, [offer]);

  const takeCloseUp = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: false });
    if (shot.canceled || !shot.assets[0]) return;
    setCloseUp('reading');
    const startedAt = Date.now();
    const reading = await readPlateFromPhoto(shot.assets[0].uri);
    log.info('plate_scan_result', {
      mode: 'v2',
      source: 'closeup',
      kind: reading.kind,
      count: 1,
      durationMs: Date.now() - startedAt,
    });
    if ('plates' in reading) {
      setCloseUp('idle');
      setOffer(reading.plates);
      setAnswers({ plateScanOffered: reading.plates[0].canon });
    } else {
      setCloseUp('nothing');
    }
  };

  return (
    <View style={styles.block}>
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
      {offerCloseUp ? (
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
      {offer.length > 0 ? (
        <PlateScanSheet
          ref={sheetRef}
          candidates={offer}
          onConfirm={(confirmed) => {
            log.info('plate_scan_confirmed', { fromPhotos: false });
            setAnswers({ plate: formatPlate(confirmed), plateFromScan: true });
            sheetRef.current?.close();
          }}
          onDecline={() => {
            log.info('plate_scan_rejected', { candidates: offer.length });
            sheetRef.current?.close();
          }}
          onDismiss={() => setOffer([])}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.md,
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
