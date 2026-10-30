/**
 * WHAT:  Tests for the plate scan that runs above the wizard: each photo read
 *        once, in the background; the reading outliving the photos step; a
 *        removed photo's plates dropping out; ranking across photos; the close
 *        photo joining in; one telemetry line per pass, with why nothing.
 * WHY:   2026-10-30 (owner): no pop-up — the plates wait on the plate step, so
 *        the reading must survive leaving the photos step, and must never read
 *        a photo twice (it costs ~2 s each on a phone).
 * LINKS: ./usePlateScan.tsx; ./readPlate.ts (mocked here; tested there).
 */

import { act, render } from '@testing-library/react-native';
import { useEffect, useState } from 'react';

import type { PickedPhoto } from '@/shared/ui';

import { PlateScanProvider, usePlateScan, type PlateScan } from './usePlateScan';

const mockReadPlate = jest.fn();
jest.mock('./readPlate', () => ({
  ...jest.requireActual('./readPlate'),
  readPlateFromPhoto: (...args: unknown[]) => mockReadPlate(...args),
}));

const mockLogInfo = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

/** One reading of a plate, `share` of the photo tall. */
const seen = (canon: string, share = 0.05) => ({
  candidate: { canon, display: canon, format: 'current' as const, coercions: 0, cost: 0 },
  share,
  fromCrop: true,
  lowercase: false,
  extra: `file://crop-${canon}.jpg`,
});
const read = (...sightings: ReturnType<typeof seen>[]) => ({
  kind: 'read',
  sightings,
  sawText: true,
});
const photo = (n: number, originalUri?: string): PickedPhoto => ({
  uri: `file://${n}.jpg`,
  width: 2000,
  height: 1500,
  ...(originalUri ? { originalUri } : {}),
});

/** Hands the scan it sees to the test, every render. */
function Probe({ onScan }: { onScan: (scan: PlateScan) => void }) {
  const value = usePlateScan();
  useEffect(() => {
    onScan(value);
  });
  return null;
}
/** A consumer that can be unmounted (like the photos step on Continue). */
function Host({
  onScan,
  onHide,
}: {
  onScan: (s: PlateScan) => void;
  onHide: (h: () => void) => void;
}) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    onHide(() => setShown(false));
  }, [onHide]);
  return shown ? <Probe onScan={onScan} /> : null;
}

let scan: PlateScan;
let outer: PlateScan;
let hideProbe: () => void;
const mount = () =>
  act(async () =>
    render(
      <PlateScanProvider>
        <Host onScan={(s) => (scan = s)} onHide={(h) => (hideProbe = h)} />
        {/* A consumer that stays, like the plate step. */}
        <Probe onScan={(s) => (outer = s)} />
      </PlateScanProvider>,
    ),
  );
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const track = (photos: PickedPhoto[]) =>
  act(async () => {
    scan.track(photos);
    await flush();
  });
const results = () =>
  mockLogInfo.mock.calls.filter(([e]) => e === 'plate_scan_result').map(([, d]) => d);

beforeEach(() => {
  jest.clearAllMocks();
  mockReadPlate.mockResolvedValue(read());
});

it('reads each photo once, from the full-size original when there is one', async () => {
  await mount();
  await track([photo(1, 'file://camera-1.jpg'), photo(2)]);
  await track([photo(1, 'file://camera-1.jpg'), photo(2)]);

  expect(mockReadPlate.mock.calls).toEqual([['file://camera-1.jpg'], ['file://2.jpg']]);
  expect(outer).toEqual(expect.objectContaining({ read: 2, total: 2, done: true, reading: null }));
});

it('ranks across photos: a plate in two photos beats one seen once', async () => {
  mockReadPlate
    .mockResolvedValueOnce(read(seen('XY34ZZZ')))
    .mockResolvedValueOnce(read(seen('AB12CDE')))
    .mockResolvedValueOnce(read(seen('AB12CDE')));
  await mount();
  await track([photo(1), photo(2), photo(3)]);

  expect(outer.suggestions.map((p) => p.canon)).toEqual(['AB12CDE', 'XY34ZZZ']);
  expect(outer.suggestions[0].cropUri).toBe('file://crop-AB12CDE.jpg');
});

it('⚠️ keeps reading after the photos step has gone', async () => {
  let release!: () => void;
  mockReadPlate.mockImplementationOnce(
    () => new Promise((resolve) => (release = () => resolve(read(seen('AB12CDE'))))),
  );
  await mount();
  await track([photo(1)]);
  expect(outer.reading).toBe('file://1.jpg');

  await act(async () => hideProbe());
  await act(async () => {
    release();
    await flush();
  });

  expect(outer.suggestions.map((p) => p.canon)).toEqual(['AB12CDE']);
  expect(outer.done).toBe(true);
});

it("drops a removed photo's plates", async () => {
  mockReadPlate.mockResolvedValueOnce(read(seen('AB12CDE'))).mockResolvedValueOnce(read());
  await mount();
  await track([photo(1), photo(2)]);
  expect(outer.suggestions).toHaveLength(1);

  await track([photo(2)]);
  expect(outer.suggestions).toEqual([]);
});

it("adds the close photo's readings to the suggestions", async () => {
  await mount();
  await track([photo(1)]);
  await act(async () => outer.addCloseUp([seen('AB12CDE', 0.3)]));

  expect(outer.suggestions.map((p) => p.canon)).toEqual(['AB12CDE']);
});

it('logs one line per pass — counts and kinds, with why nothing was found', async () => {
  mockReadPlate.mockResolvedValue({ kind: 'read', sightings: [], sawText: false });
  await mount();
  await track([photo(1), photo(2)]);

  expect(results()).toEqual([
    expect.objectContaining({ mode: 'v3', kind: 'none', count: 2, reason: 'no_text' }),
  ]);
});

it('logs a found plate as likely, and an unreadable photo as an error', async () => {
  mockReadPlate.mockResolvedValueOnce({ kind: 'error' });
  await mount();
  await track([photo(1)]);
  mockReadPlate.mockResolvedValueOnce(read(seen('AB12CDE')));
  await track([photo(1), photo(2)]);

  expect(results()).toEqual([
    expect.objectContaining({ kind: 'error', count: 1 }),
    expect.objectContaining({ kind: 'likely', count: 1 }),
  ]);
});

it('logs what THIS pass found, not the whole grid', async () => {
  mockReadPlate.mockResolvedValueOnce(read(seen('AB12CDE')));
  await mount();
  await track([photo(1)]);
  await track([photo(1), photo(2)]); // photo 2 reads nothing

  expect(results()).toEqual([
    expect.objectContaining({ kind: 'likely', count: 1 }),
    expect.objectContaining({ kind: 'none', count: 1 }),
  ]);
});

it('⚠️ never reads a photo already uploaded (editing a saved car)', async () => {
  await mount();
  await track([{ uri: 'https://cdn.example/saved.jpg', width: 1, height: 1 }]);

  expect(mockReadPlate).not.toHaveBeenCalled();
  expect(outer).toEqual(expect.objectContaining({ total: 0, done: true }));
  expect(results()).toEqual([]);
});

describe('while a photo is being read', () => {
  let release: () => void;
  beforeEach(() => {
    mockReadPlate.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(read(seen('AB12CDE'))))),
    );
  });

  it('a photo added now is read in the same pass, once', async () => {
    await mount();
    await track([photo(1)]);
    await track([photo(1), photo(2)]);
    await act(async () => {
      release();
      await flush();
    });

    expect(mockReadPlate.mock.calls).toEqual([['file://1.jpg'], ['file://2.jpg']]);
    expect(results()).toEqual([expect.objectContaining({ count: 2 })]);
  });

  it('a photo removed now drops out when its reading lands', async () => {
    await mount();
    await track([photo(1), photo(2)]);
    await track([photo(2)]);
    await act(async () => {
      release();
      await flush();
    });

    expect(outer.suggestions).toEqual([]);
    expect(outer).toEqual(expect.objectContaining({ read: 1, total: 1, done: true }));
  });
});
