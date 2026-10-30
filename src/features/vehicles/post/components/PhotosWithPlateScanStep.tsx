/**
 * WHAT:  The photos step of both car flows (My cars → Add a car, and the
 *        stolen-car report) — the SHARED `PhotosStep`, plus the plate scan of
 *        the photos the owner adds (usePlateScan). It hands the grid to the
 *        scan, dims the photo being read, and says under the grid how far the
 *        reading has got. The plates it finds are offered on the plate step.
 * WHY:   People photograph their car; the plate is usually in shot, so we read
 *        it rather than ask for a separate picture of it.
 *
 *        NO POP-UP (owner, 2026-10-30). This step used to open a sheet as soon
 *        as a plate was read — sometimes while the owner was still adding
 *        photos — and an accidental swipe counted as "no". Now nothing
 *        interrupts: the reading carries on while they continue, and the plates
 *        are waiting, with their crops, on the plate step.
 *
 *        THE LINE IS UNDER THE GRID. A status line once sat above it and pushed
 *        every tile down when a scan started and back up when it ended. Below,
 *        nothing moves. The tile being read is still dimmed (the grid's own
 *        busy overlay), so it is clear WHICH photo is being read.
 * SAFETY: OCR runs on-device (readPlate.ts); recognised text never reaches a
 *        draft or a log, and `answers` only as the plate the owner picks or
 *        types, plus the plate offered for the outcome log (PlateStep).
 * LINKS: ../lib/usePlateScan.tsx; ./PlateStep.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx (PhotosStep);
 *        src/features/garage/lib/addVehicleFlow.tsx and ../postACarFlow.tsx
 *          (swap this in for the plain photos step).
 */

import { Feather } from '@expo/vector-icons';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import type { WizardStepProps } from '@/shared/wizard';

import { readingLine, usePlateScan } from '../lib/usePlateScan';
import type { VehicleAnswers } from '../lib/vehicleSteps';
import { PhotosStep } from './postSteps';

/** What this step reads and writes: the vehicle slice, plus the plate. */
export type PlateScanAnswers = VehicleAnswers & {
  plate: string;
  /** The plate step's top suggestion when it was left, canonical — for the
   *  outcome log only. UI state: never sent to the server, never drafted. */
  plateScanOffered?: string;
};

/**
 * The words on the tile being read, and spoken for it. Lives here rather than
 * in the grid because "number plate" is this step's sentence — `shared/ui`
 * only knows that a tile is busy.
 */
export const PLATE_SCAN_LABEL = 'Looking for a number plate';

export function PhotosWithPlateScanStep(props: WizardStepProps<PlateScanAnswers>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const scan = usePlateScan();
  const { track } = scan;

  // The grid as it stands, on every change and on coming back to this step.
  const photos = props.answers.photos;
  useEffect(() => {
    track(photos);
  }, [photos, track]);

  const found = scan.done && scan.suggestions.length > 0;
  // Spoken once when reading starts and once when a plate is found — not on
  // every photo, which would talk over someone still adding them. (A live
  // region would not reach iOS.)
  const reading = scan.reading !== null;
  useEffect(() => {
    if (reading) AccessibilityInfo.announceForAccessibility(PLATE_SCAN_LABEL);
  }, [reading]);
  useEffect(() => {
    if (found) AccessibilityInfo.announceForAccessibility('Plate found');
  }, [found]);

  return (
    <>
      {/* The shared step, untouched — same grid, same limits, same behaviour.
          Only the ONE tile being read is dimmed; keyed by the grid's uri. */}
      <PhotosStep
        {...props}
        status={
          scan.reading ? { [scan.reading]: { kind: 'busy', label: PLATE_SCAN_LABEL } } : undefined
        }
      />
      {/* No spinner: the tile being read already shows one. */}
      {reading || found ? (
        <View style={styles.status} testID="plate-scan-status">
          {found ? (
            <Feather name="check" size={sizes.iconSm} color={palette.textSecondary} />
          ) : null}
          <Text style={styles.statusText}>
            {reading ? readingLine(scan.read, scan.total) : 'Plate found'}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    statusText: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
