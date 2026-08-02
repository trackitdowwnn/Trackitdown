/**
 * WHAT:  The garage's photos step — the SHARED `PhotosStep`, plus quiet OCR of
 *        the photos the owner adds, offering the registration it reads.
 * WHY:   People photograph their car; the plate is usually in shot. Asking them
 *        to take a SEPARATE picture of the plate — which is what the first
 *        version of this did — is asking twice for something we already have.
 *
 *        WHY A GARAGE COMPONENT AND NOT A FLAG ON `buildVehicleSteps`:
 *        the shared builder lives in `features/vehicles`, which must never
 *        import the garage (ARCHITECTURE rule 1 — the garage imports vehicles,
 *        and a flag would eventually drag the plate concept back the other
 *        way). Instead the garage swaps the step's COMPONENT for this one,
 *        which renders the shared step untouched and adds its own behaviour
 *        around it. `features/vehicles` learns nothing, and the posting
 *        wizard's photo step is unchanged BY CONSTRUCTION rather than by a
 *        flag someone could flip — which matters, because that wizard sends
 *        `p_plate: null` and has nowhere to put a detected plate anyway.
 *
 * QUIET BY DEFAULT. Detection runs in the background and says nothing unless
 *        it has something worth saying:
 *          - nothing read            -> silence
 *          - read, and it MATCHES    -> silence (a "✓ verified" toast would be
 *                                      noise; they typed it correctly)
 *          - read, and the field is EMPTY or DIFFERENT -> the sheet asks
 *        Adding a photo must never block or slow the step, so a failure here
 *        is silent too: the plate is optional and typing always works.
 *
 * SAFETY: OCR runs on-device. Recognised text lives in local state, is dropped
 *        when the sheet closes, and is never persisted or logged — see
 *        shared/lib/ocr/textRecognition.ts. Only a plate the owner confirms
 *        reaches `answers`.
 * LINKS: src/features/vehicles/post/components/postSteps.tsx (PhotosStep);
 *        src/features/garage/lib/addVehicleFlow.tsx (does the swap);
 *        ./PlateScanSheet.tsx; src/shared/lib/plateCandidates.ts.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useRef, useState } from 'react';

import { PhotosStep } from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';
import { formatPlate, normalisePlate } from '@/shared/lib/plate';
import { type PlateCandidate, extractPlateCandidates } from '@/shared/lib/plateCandidates';
import { recogniseText } from '@/shared/lib/ocr/textRecognition';
import type { BottomSheetRef } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import type { AddVehicleAnswers } from '../types';
import { PlateScanSheet } from './PlateScanSheet';

const log = createLogger('garage');

/** OCR wants detail, not megapixels. */
const SCAN_MAX_EDGE = 2000;

/**
 * How many photos to read per batch. A plate appears in the first shot or two
 * of a car; reading eight is slower and no more useful, and this step must
 * never feel like it is thinking.
 */
const MAX_PHOTOS_SCANNED = 3;

export function PhotosWithPlateScanStep(props: WizardStepProps<AddVehicleAnswers>) {
  const { answers, setAnswers } = props;
  const sheetRef = useRef<BottomSheetRef>(null);
  // SAFETY: recognised text never leaves this component. Only a confirmed
  // plate is written to answers.
  const [candidates, setCandidates] = useState<readonly PlateCandidate[]>([]);
  // Which photo URIs have been read already, so re-renders and removals don't
  // re-scan. A ref, not state: this is bookkeeping nothing renders.
  const scanned = useRef(new Set<string>());
  const busy = useRef(false);

  const scan = useCallback(
    async (uris: string[]) => {
      // One batch at a time — a fast tapper adding four photos should not start
      // four concurrent OCR passes on a mid-range phone.
      if (busy.current) {
        return;
      }
      busy.current = true;
      try {
        const found: PlateCandidate[] = [];
        for (const uri of uris.slice(0, MAX_PHOTOS_SCANNED)) {
          // SAFETY: re-encode before the OCR module sees the file — a photo
          // from the camera roll carries EXIF, including the GPS of wherever
          // it was taken, which for a picture of your own car is usually home.
          const context = ImageManipulator.manipulate(uri);
          context.resize({ width: SCAN_MAX_EDGE });
          const rendered = await context.renderAsync();
          const scanFile = await rendered.saveAsync({ format: SaveFormat.JPEG });

          const result = await recogniseText(scanFile.uri);
          if (result.status === 'ok') {
            found.push(...extractPlateCandidates(result.blocks));
          }
          // Stop at the first clean read — no point reading the rest.
          if (found.some((candidate) => candidate.coercions === 0)) {
            break;
          }
        }

        if (found.length === 0) {
          // Silence. They did not ask for this and nothing was found.
          return;
        }

        // Silence on a match, too: if what they typed is already one of the
        // readings, there is nothing to ask and a confirmation would be noise.
        const typed = normalisePlate(answers.plate ?? '');
        if (typed && found.some((candidate) => candidate.canon === typed)) {
          log.info('plate_scan_agreed');
          return;
        }

        log.info('plate_scan_offered', {
          candidates: found.length,
          hadTypedPlate: Boolean(typed),
        });
        setCandidates(found);
        sheetRef.current?.open();
      } catch (error) {
        // Never surface this. Adding photos must not fail because a plate
        // could not be read, and typing the plate always works.
        log.warn('plate_scan_failed', { error: (error as Error).name });
      } finally {
        busy.current = false;
      }
    },
    [answers.plate],
  );

  const onChangePhotos = useCallback(
    (photos: AddVehicleAnswers['photos'] | undefined) => {
      setAnswers({ photos });
      const fresh = (photos ?? [])
        .map((photo) => photo.uri)
        .filter((uri) => !scanned.current.has(uri));
      if (fresh.length === 0) {
        return;
      }
      fresh.forEach((uri) => scanned.current.add(uri));
      // Deliberately not awaited: the step updates immediately and OCR catches
      // up. A photo grid that waits on a recogniser feels broken.
      void scan(fresh);
    },
    [scan, setAnswers],
  );

  const confirm = useCallback(
    (canon: string) => {
      setAnswers({ plate: formatPlate(canon) });
      log.info('plate_scan_confirmed', { fromPhotos: true });
      setCandidates([]);
      sheetRef.current?.close();
    },
    [setAnswers],
  );

  const dismiss = useCallback(() => {
    // Whatever the recogniser saw goes the moment the question is answered.
    setCandidates([]);
    sheetRef.current?.close();
  }, []);

  return (
    <>
      {/* The shared step, untouched — same grid, same limits, same behaviour.
          We only intercept the answer on its way past. */}
      <PhotosStep {...props} setAnswers={({ photos }) => onChangePhotos(photos)} />
      <PlateScanSheet
        ref={sheetRef}
        candidates={candidates}
        // A plate already typed means this is a disagreement, not a discovery.
        existingPlate={answers.plate ?? null}
        onConfirm={confirm}
        onDismiss={dismiss}
      />
    </>
  );
}
