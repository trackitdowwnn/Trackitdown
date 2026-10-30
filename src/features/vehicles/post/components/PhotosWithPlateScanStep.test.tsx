/**
 * WHAT:  Tests for the photos step's side of the plate scan: it hands the grid
 *        to the scan, dims only the photo being read, and says under the grid
 *        how far the reading has got — and nothing else (no pop-up).
 * WHY:   2026-10-30 (owner): a sheet on this step interrupted people still
 *        adding photos. The reading itself is tested in ../lib/usePlateScan.test.
 * LINKS: ./PhotosWithPlateScanStep.tsx; ../lib/usePlateScan.tsx.
 */

import { act, render } from '@testing-library/react-native';

import type { PlateScan } from '../lib/usePlateScan';
import { PhotosWithPlateScanStep, PLATE_SCAN_LABEL } from './PhotosWithPlateScanStep';

let tileStatus: Record<string, { kind: string; label?: string }> | undefined;
jest.mock('./postSteps', () => ({
  PhotosStep: ({ status }: { status?: Record<string, { kind: string; label?: string }> }) => {
    tileStatus = status;
    return null;
  },
}));

let mockScan: PlateScan;
jest.mock('../lib/usePlateScan', () => ({
  ...jest.requireActual('../lib/usePlateScan'),
  usePlateScan: () => mockScan,
}));

const scan = (overrides: Partial<PlateScan> = {}): PlateScan => ({
  suggestions: [],
  reading: null,
  read: 0,
  total: 0,
  done: true,
  track: jest.fn(),
  addCloseUp: jest.fn(),
  ...overrides,
});
const found = {
  canon: 'AB12CDE',
  display: 'AB12 CDE',
  format: 'current' as const,
  coercions: 0,
  cost: 0,
  score: 1,
};
const photo = (n: number) => ({ uri: `file://${n}.jpg`, width: 100, height: 100 });

const renderStep = (photos?: ReturnType<typeof photo>[]) =>
  act(async () =>
    render(<PhotosWithPlateScanStep answers={photos ? { photos } : {}} setAnswers={jest.fn()} />),
  );

beforeEach(() => {
  tileStatus = undefined;
  mockScan = scan();
});

it('hands the grid to the scan, and again whenever it changes', async () => {
  const view = await renderStep([photo(1)]);
  expect(mockScan.track).toHaveBeenLastCalledWith([photo(1)]);

  await act(async () => {
    view.rerender(
      <PhotosWithPlateScanStep answers={{ photos: [photo(1), photo(2)] }} setAnswers={jest.fn()} />,
    );
  });
  expect(mockScan.track).toHaveBeenLastCalledWith([photo(1), photo(2)]);
});

it('dims only the photo being read, and says how far it has got', async () => {
  mockScan = scan({ reading: 'file://2.jpg', read: 1, total: 5, done: false });
  const view = await renderStep([photo(1), photo(2)]);

  expect(tileStatus).toEqual({ 'file://2.jpg': { kind: 'busy', label: PLATE_SCAN_LABEL } });
  expect(view.getByText('Reading your photos… 2 of 5')).toBeTruthy();
});

it('says a plate was found once it has read them all', async () => {
  mockScan = scan({ suggestions: [found], read: 2, total: 2 });
  const view = await renderStep([photo(1), photo(2)]);

  expect(tileStatus).toBeUndefined();
  expect(view.getByText('Plate found')).toBeTruthy();
});

it('says nothing when it found nothing, or there is nothing to read', async () => {
  mockScan = scan({ read: 2, total: 2 });
  const view = await renderStep([photo(1), photo(2)]);
  expect(view.queryByTestId('plate-scan-status')).toBeNull();

  mockScan = scan();
  await act(async () => {
    view.rerender(<PhotosWithPlateScanStep answers={{}} setAnswers={jest.fn()} />);
  });
  expect(view.queryByTestId('plate-scan-status')).toBeNull();
});
