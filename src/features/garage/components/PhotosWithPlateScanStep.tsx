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
 *        QUIET IS ABOUT THE OUTCOME, NOT THE WORK. While it is reading, the
 *        photo it is reading is DIMMED — the grid's own per-tile status
 *        overlay, with a spinner and "Looking for a number plate". OCR starts
 *        after the grid's resize shimmer has stopped, so without it the step
 *        looks idle for seconds and then a sheet appears from nowhere.
 *        Progress is shown; the result still is not.
 *
 *        WHY ON THE TILE rather than a line above the grid, which is what this
 *        did first: the scan walks up to three photos and a single line cannot
 *        say WHICH, so it read as a stall rather than progress. The line also
 *        mounted outside the grid and inserted ~30pt of layout, shunting every
 *        tile down when a scan started and back up when it ended — on every
 *        photo added. The overlay uses space the grid already owns, so nothing
 *        moves.
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { PhotosStep } from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';
import { formatPlate, normalisePlate } from '@/shared/lib/plate';
import { type PlateCandidate, extractPlateCandidates } from '@/shared/lib/plateCandidates';
import { recogniseText } from '@/shared/lib/ocr/textRecognition';
import { motion } from '@/shared/theme';
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

/** What a batch turned out to be worth saying. */
type ScanOutcome = 'none' | 'agreed' | 'offered';

interface ScanResult {
  outcome: ScanOutcome;
  /** Photos this pass stopped short of, so a rejection can pick them up. */
  unread: string[];
}

/**
 * The words shown on the tile being read, and spoken for it. Lives here rather
 * than in the grid because "number plate" is a garage sentence — `shared/ui`
 * only knows that a tile is busy.
 */
export const PLATE_SCAN_LABEL = 'Looking for a number plate';

/** Wait out the remainder of a minimum display time; no-op once it has passed. */
const settleFor = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export function PhotosWithPlateScanStep(props: WizardStepProps<AddVehicleAnswers>) {
  const { answers, setAnswers } = props;
  const sheetRef = useRef<BottomSheetRef>(null);
  // SAFETY: recognised text never leaves this component. Only a confirmed
  // plate is written to answers.
  const [candidates, setCandidates] = useState<readonly PlateCandidate[]>([]);
  // WHICH photo is being read right now — the ONE piece of scan state that
  // renders. It dims that tile and no other, so the walk from photo to photo is
  // the progress indicator. The guards below stay refs.
  const [scanningUri, setScanningUri] = useState<string | null>(null);
  // Which photo URIs have been read already, so re-renders and removals don't
  // re-scan. A ref, not state: this is bookkeeping nothing renders.
  const scanned = useRef(new Set<string>());
  // Photos waiting to be read. Added here rather than straight into `scanned`
  // because a batch arriving mid-scan used to be marked read and then dropped
  // by the guard below — never actually looked at, while the status line
  // claimed otherwise.
  const queue = useRef<string[]>([]);
  // Readings the owner has explicitly turned down. They were looking at the
  // actual car; we are not going to ask twice.
  const rejected = useRef(new Set<string>());
  const busy = useRef(false);
  // The step can be left mid-scan (Next is deliberately never blocked), and the
  // loop below outlives the unmount — it must not go on dimming a dead tree.
  const mounted = useRef(true);

  // The plate as typed RIGHT NOW. A ref because a drain can outlive the render
  // it started in: someone typing while the recogniser works must still be
  // agreed with, not asked about. Synced in an effect rather than during
  // render — a render-phase ref write is a lint error (react-hooks/refs), and
  // after-paint is soon enough for a reader that takes seconds.
  const typedPlate = useRef(answers.plate);
  useEffect(() => {
    typedPlate.current = answers.plate;
  }, [answers.plate]);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const scanBatch = useCallback(
    async (uris: string[]): Promise<ScanResult> => {
      try {
        const found: PlateCandidate[] = [];
        // What this pass never opened. Handed back so that turning a reading
        // down resumes from the next photo instead of starting over.
        let unread: string[] = [];
        const readable = uris.slice(0, MAX_PHOTOS_SCANNED);
        for (let index = 0; index < readable.length; index += 1) {
          const uri = readable[index];
          // Dim THIS tile, and only this one, for as long as it is being read.
          const shownAt = Date.now();
          if (mounted.current) {
            setScanningUri(uri);
          }

          // SAFETY: re-encode before the OCR module sees the file — a photo
          // from the camera roll carries EXIF, including the GPS of wherever
          // it was taken, which for a picture of your own car is usually home.
          const context = ImageManipulator.manipulate(uri);
          context.resize({ width: SCAN_MAX_EDGE });
          const rendered = await context.renderAsync();
          const scanFile = await rendered.saveAsync({ format: SaveFormat.JPEG });

          const result = await recogniseText(scanFile.uri);
          if (result.status === 'ok') {
            // A reading the owner has already turned down is not a finding.
            // Re-offering it would be arguing with them, and worse, it would
            // stop the walk on the very photo they just rejected.
            found.push(
              ...extractPlateCandidates(result.blocks).filter(
                (candidate) => !rejected.current.has(candidate.canon),
              ),
            );
          }

          // Stop at the first clean read — no point reading the rest. Checked
          // BEFORE the hold below, because the sheet is about to take the
          // screen: waiting to admire a tile the user is about to stop looking
          // at would only delay the answer.
          if (found.some((candidate) => candidate.coercions === 0)) {
            unread = uris.slice(index + 1);
            break;
          }

          // Moving on, so hold this tile long enough to be SEEN first. Without
          // this a fast read strobes across three tiles in a few frames and
          // reads as a glitch rather than progress. On a real device OCR takes
          // longer than this, so it almost never costs anything.
          await settleFor(motion.loaderMinVisible - (Date.now() - shownAt));
        }

        if (found.length === 0) {
          // Silence. They did not ask for this and nothing was found.
          return { outcome: 'none', unread: [] };
        }

        // Silence on a match, too: if what they typed is already one of the
        // readings, there is nothing to ask and a confirmation would be noise.
        // Read through the ref: a queued batch can start seconds after the
        // photo was added, and Next is never blocked, so they may have typed
        // the plate in the meantime.
        const typed = normalisePlate(typedPlate.current ?? '');
        if (typed && found.some((candidate) => candidate.canon === typed)) {
          log.info('plate_scan_agreed');
          return { outcome: 'agreed', unread: [] };
        }

        log.info('plate_scan_offered', {
          candidates: found.length,
          hadTypedPlate: Boolean(typed),
        });
        setCandidates(found);
        sheetRef.current?.open();
        return { outcome: 'offered', unread };
      } catch (error) {
        // Never surface this. Adding photos must not fail because a plate
        // could not be read, and typing the plate always works.
        log.warn('plate_scan_failed', { error: (error as Error).name });
        return { outcome: 'none', unread: [] };
      }
    },
    [],
  );

  /**
   * Read everything waiting, one batch at a time. Owns the re-entrancy guard
   * and the final clear, so no tile is left dimmed once the reading stops.
   */
  const drain = useCallback(async () => {
    // One pass at a time — a fast tapper adding four photos should not start
    // four concurrent OCR passes on a mid-range phone. The running drain will
    // pick up whatever they just queued.
    if (busy.current) {
      return;
    }
    busy.current = true;
    // Uninvited background work, so say once that it started. The dimmed tile
    // shows a sighted user; this is its counterpart, and it fires on both
    // platforms (a live region would not reach iOS).
    AccessibilityInfo.announceForAccessibility(PLATE_SCAN_LABEL);
    try {
      while (queue.current.length > 0) {
        const batch = queue.current;
        queue.current = [];
        // Marked as it is TAKEN UP, not when queued: a photo the guard turned
        // away must stay eligible, or it is silently never read.
        batch.forEach((uri) => scanned.current.add(uri));
        const { outcome, unread } = await scanBatch(batch);
        if (outcome === 'agreed') {
          // Their plate is already right. Nothing left worth reading for.
          queue.current = [];
          break;
        }
        if (outcome === 'offered') {
          // A question is on screen; reading on to ask again over the top of it
          // is the interruption this file exists to avoid. But PARK what was
          // never opened rather than discarding it — if they say the reading is
          // wrong, `resume` below carries on from exactly here.
          unread.forEach((uri) => scanned.current.delete(uri));
          queue.current = [...unread, ...queue.current];
          break;
        }
      }
    } finally {
      busy.current = false;
      // One exit for every path — early return, agreement, failure and throw —
      // so a tile can never be left dimmed with nothing reading it.
      if (mounted.current) {
        setScanningUri(null);
      }
    }
  }, [scanBatch]);

  const onChangePhotos = useCallback(
    (photos: AddVehicleAnswers['photos'] | undefined) => {
      setAnswers({ photos });
      // The whole array arrives on every change, so a reorder or a removal
      // mid-scan must not re-queue photos already waiting.
      const fresh = (photos ?? [])
        .map((photo) => photo.uri)
        .filter((uri) => !scanned.current.has(uri) && !queue.current.includes(uri));
      if (fresh.length === 0) {
        return;
      }
      queue.current.push(...fresh);
      // Deliberately not awaited: the step updates immediately and OCR catches
      // up. A photo grid that waits on a recogniser feels broken.
      void drain();
    },
    [drain, setAnswers],
  );

  const confirm = useCallback(
    (canon: string) => {
      // plateFromScan is what lets the plate step step aside: the question has
      // been answered, by them, just now. It is deliberately NOT inferred from
      // `plate` being non-empty — see the field's note in ../types.
      setAnswers({ plate: formatPlate(canon), plateFromScan: true });
      log.info('plate_scan_confirmed', { fromPhotos: true });
      // We have the answer. Anything still parked is no longer worth reading.
      queue.current = [];
      setCandidates([]);
      sheetRef.current?.close();
    },
    [setAnswers],
  );

  const dismiss = useCallback(() => {
    // "That's not it" is information, not just a no: every reading on offer was
    // wrong, so none of them may be offered again — otherwise the next photo
    // that reads the same plate stops the walk to ask a question already
    // answered.
    candidates.forEach((candidate) => rejected.current.add(candidate.canon));
    log.info('plate_scan_rejected', { candidates: candidates.length });
    // Whatever the recogniser saw goes the moment the question is answered.
    setCandidates([]);
    sheetRef.current?.close();
    // Carry on from where the offer interrupted us. If nothing was parked this
    // does nothing, which is the "that was the last photo" case.
    void drain();
  }, [candidates, drain]);

  return (
    <>
      {/* The shared step, untouched — same grid, same limits, same behaviour.
          We intercept the answer on its way past, and dim the ONE tile being
          read. Keyed by the uri the grid keys its tiles by (the post-resize one
          that came back through onChangePhotos), or it would never match. */}
      <PhotosStep
        {...props}
        setAnswers={({ photos }) => onChangePhotos(photos)}
        status={
          scanningUri ? { [scanningUri]: { kind: 'busy', label: PLATE_SCAN_LABEL } } : undefined
        }
      />
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
