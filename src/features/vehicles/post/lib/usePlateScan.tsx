/**
 * WHAT:  The plate scan for one run of a car flow: reads each photo the owner
 *        adds, in the background and once each, and ranks the plates across
 *        every photo still in the grid. The photos step hands it photos and
 *        shows which one is being read; the plate step offers its suggestions.
 * WHY:   2026-10-30 (owner): no pop-up. Reading 5 photos took 12 s, and a sheet
 *        opening on the photos step interrupted people still adding photos. So
 *        the photos step only says it is reading, and the plates wait on the
 *        plate step. The reading must therefore outlive the photos step — it
 *        lives above the wizard (each screen mounts the provider), not in a step.
 *
 *        Only photos the owner ADDED are read: a saved car being edited arrives
 *        with its photos already uploaded (https), and those were never ours to
 *        scan again.
 * SAFETY: everything stays on the phone (readPlate.ts). Readings and crops are
 *         held in memory for this run only, never in drafts or logs; the plate
 *         step copies the plate offered into `answers.plateScanOffered` (UI
 *         state for the outcome log: not drafted, never sent). Telemetry is
 *         counts and kinds — never a plate.
 * LINKS: ./readPlate.ts; ../components/PhotosWithPlateScanStep.tsx;
 *        ../components/PlateStep.tsx; docs/plate-scan-decisions.md.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createLogger } from '@/shared/lib/logger';
import type { PickedPhoto } from '@/shared/ui';

import {
  rankScannedPlates,
  readPlateFromPhoto,
  type PlateScanSighting,
  type ScannedPlate,
} from './readPlate';

const log = createLogger('vehicles');

type Results = ReadonlyMap<string, readonly PlateScanSighting[]>;

export interface PlateScan {
  /** The plates to offer, best first (at most 3). */
  suggestions: readonly ScannedPlate[];
  /** The grid uri of the photo being read, or null. */
  reading: string | null;
  /** Photos in the grid read so far, of `total`. */
  read: number;
  total: number;
  /** Every photo in the grid has been read. */
  done: boolean;
  /** The photos step: the grid as it stands (on every change, and on mount). */
  track: (photos: readonly PickedPhoto[] | undefined) => void;
  /** The plate step's close photo: its readings join the suggestions. */
  addCloseUp: (sightings: readonly PlateScanSighting[]) => void;
}

const PlateScanContext = createContext<PlateScan | null>(null);

/** Outside a provider (a step rendered on its own) nothing is read. */
const INERT: PlateScan = {
  suggestions: [],
  reading: null,
  read: 0,
  total: 0,
  done: true,
  track: () => {},
  addCloseUp: () => {},
};

/** "Reading your photos… 2 of 5" — the same line on the photos and plate steps. */
export const readingLine = (read: number, total: number) =>
  `Reading your photos… ${Math.min(read + 1, total)} of ${total}`;

/** The scan of the car flow this step is in (inert outside a provider). */
export function usePlateScan(): PlateScan {
  return useContext(PlateScanContext) ?? INERT;
}

/** Mounted by each car-flow screen around its wizard, so the reading outlives
 *  the photos step and every step sees the same scan. */
export function PlateScanProvider({ children }: { children: ReactNode }) {
  // Readings per grid uri: state to render from, and a ref mirror the loop
  // reads (an await later, state would be stale).
  const [results, setResults] = useState<Results>(new Map());
  const resultsRef = useRef<Results>(new Map());
  // Photos taken up for reading, so none is read twice.
  const taken = useRef(new Set<string>());
  const [closeUp, setCloseUp] = useState<readonly PlateScanSighting[]>([]);
  const [photos, setPhotos] = useState<readonly PickedPhoto[]>([]);
  const photosRef = useRef<readonly PickedPhoto[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    // Set here too: a development double-mount runs the cleanup in between.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Read every tracked photo not yet read, one at a time. */
  const drain = useCallback(async () => {
    // One pass at a time: a fast tapper adding four photos must not start four
    // OCR passes on a mid-range phone. The running pass picks up new photos.
    if (busy.current) return;
    busy.current = true;
    const startedAt = Date.now();
    let count = 0;
    let failed = false;
    let sawText = false;
    // This pass's readings only: its log line describes what it found.
    const passSightings: PlateScanSighting[] = [];
    try {
      for (;;) {
        // Re-read the grid each time round: photos come and go while it works.
        const next = photosRef.current.find((p) => !taken.current.has(p.uri));
        if (!next || !mounted.current) break;
        taken.current.add(next.uri);
        setReading(next.uri);
        let sightings: readonly PlateScanSighting[] = [];
        try {
          // The grid shrinks picks for upload; the second read needs the original.
          const result = await readPlateFromPhoto(next.originalUri ?? next.uri);
          if (result.kind === 'error') failed = true;
          else {
            sawText ||= result.sawText;
            sightings = result.sightings;
          }
        } catch (error) {
          // Never surface this: typing the plate always works. The photo still
          // counts as read, or the plate step would wait for it for ever.
          failed = true;
          log.warn('plate_scan_failed', { error: (error as Error).name });
        }
        count += 1;
        passSightings.push(...sightings);
        resultsRef.current = new Map(resultsRef.current).set(next.uri, sightings);
        if (mounted.current) setResults(resultsRef.current);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setReading(null);
    }
    if (count === 0) return;
    // One line per pass, so real-world accuracy can be followed over time.
    const found = rankScannedPlates(passSightings).length > 0;
    const kind = found ? 'likely' : failed ? 'error' : 'none';
    log.info('plate_scan_result', {
      mode: 'v3',
      kind,
      count,
      durationMs: Date.now() - startedAt,
      ...(kind === 'none' ? { reason: sawText ? 'no_plate_shape' : 'no_text' } : {}),
    });
  }, []);

  const track = useCallback(
    (next: readonly PickedPhoto[] | undefined) => {
      // Photos already uploaded (editing a saved car) are not read again.
      photosRef.current = (next ?? []).filter((p) => !/^https?:/i.test(p.uri));
      setPhotos(photosRef.current);
      void drain();
    },
    [drain],
  );

  const addCloseUp = useCallback((sightings: readonly PlateScanSighting[]) => {
    setCloseUp((prev) => [...prev, ...sightings]);
  }, []);

  const value = useMemo<PlateScan>(() => {
    const read = photos.filter((p) => results.has(p.uri)).length;
    return {
      suggestions: rankFor(photos, results, closeUp),
      reading,
      read,
      total: photos.length,
      done: reading === null && read === photos.length,
      track,
      addCloseUp,
    };
  }, [photos, results, closeUp, reading, track, addCloseUp]);

  return <PlateScanContext.Provider value={value}>{children}</PlateScanContext.Provider>;
}

/** Rank the readings of the photos still in the grid (a removed one drops out). */
function rankFor(
  photos: readonly PickedPhoto[],
  results: Results,
  closeUp: readonly PlateScanSighting[],
): ScannedPlate[] {
  return rankScannedPlates([...photos.flatMap((p) => results.get(p.uri) ?? []), ...closeUp]);
}
