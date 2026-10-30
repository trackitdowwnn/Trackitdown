/**
 * WHAT:  Tests for PlateStep's plate scan side: the plates read from the photos
 *        offered as rows (tap to fill, never filled by themselves), the reading
 *        line, and the close photo when the photos gave nothing.
 * WHY:   2026-10-30 (owner): no pop-up — the plates wait here — and a scanned
 *        plate must never be written behind the owner's back, because a
 *        listing's plate cannot change. The field, the warning and the skip are
 *        tested through GaragePlateStep (src/features/garage/components/
 *        garageSteps.test.tsx).
 * LINKS: ./PlateStep.tsx; ../lib/usePlateScan.tsx; ../lib/readPlate.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PlateScan } from '../lib/usePlateScan';
import { PlateStep } from './PlateStep';

const mockPermission = jest.fn();
const mockCamera = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: () => mockPermission(),
  launchCameraAsync: (...args: unknown[]) => mockCamera(...args),
}));

const mockReadPlate = jest.fn();
jest.mock('../lib/readPlate', () => ({
  ...jest.requireActual('../lib/readPlate'),
  readPlateFromPhoto: (...args: unknown[]) => mockReadPlate(...args),
}));

let mockScan: PlateScan;
jest.mock('../lib/usePlateScan', () => ({
  ...jest.requireActual('../lib/usePlateScan'),
  usePlateScan: () => mockScan,
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

const plate = (canon: string, display: string) => ({
  canon,
  display,
  format: 'current' as const,
  coercions: 0,
  cost: 0,
  score: 1,
  cropUri: `file://crop-${canon}.jpg`,
});

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

let setAnswers: jest.Mock;
const renderStep = (answers: object) =>
  act(async () =>
    render(<PlateStep answers={answers} setAnswers={setAnswers} onSkip={jest.fn()} />),
  );

beforeEach(() => {
  jest.clearAllMocks();
  setAnswers = jest.fn();
  mockScan = scan();
  mockPermission.mockResolvedValue({ granted: true });
  mockCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://close.jpg' }] });
});

describe('the plates read from the photos', () => {
  beforeEach(() => {
    mockScan = scan({
      suggestions: [plate('AB12CDE', 'AB12 CDE'), plate('AB12CDF', 'AB12 CDF')],
      read: 3,
      total: 3,
    });
  });

  it('are offered best first, and NOT written until one is tapped', async () => {
    const view = await renderStep({});

    expect(view.getByText('From your photos')).toBeTruthy();
    expect(view.getByTestId('plate-suggestion-AB12CDE')).toBeTruthy();
    expect(view.getByTestId('plate-suggestion-AB12CDF')).toBeTruthy();
    expect(setAnswers.mock.calls.some(([patch]) => Object.hasOwn(patch, 'plate'))).toBe(false);
  });

  it('fill the field when tapped', async () => {
    const view = await renderStep({});
    await act(async () => {
      fireEvent.press(view.getByTestId('plate-suggestion-AB12CDF'));
    });

    expect(setAnswers).toHaveBeenCalledWith({ plate: 'AB12 CDF' });
    expect(mockLogInfo).toHaveBeenCalledWith('plate_scan_picked', { index: 1 });
  });

  it('mark the one matching the field, and no other', async () => {
    const view = await renderStep({ plate: 'ab12 cde' });

    expect(view.getByTestId('plate-suggestion-AB12CDE').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(view.getByTestId('plate-suggestion-AB12CDF').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('record the best one for the outcome log', async () => {
    await renderStep({});
    expect(setAnswers).toHaveBeenCalledWith({ plateScanOffered: 'AB12CDE' });
  });

  it('record the one picked, so picking the second is "accepted"', async () => {
    await renderStep({ plate: 'AB12 CDF' });
    expect(setAnswers).toHaveBeenCalledWith({ plateScanOffered: 'AB12CDF' });
  });

  it('clear the record when no suggestion is left', async () => {
    mockScan = scan({ read: 3, total: 3 });
    await renderStep({ plateScanOffered: 'AB12CDE' });
    expect(setAnswers).toHaveBeenCalledWith({ plateScanOffered: undefined });
  });
});

it('⚠️ shows no rows until every photo is read — they would move under a finger', async () => {
  mockScan = scan({
    suggestions: [plate('AB12CDE', 'AB12 CDE')],
    reading: 'file://2.jpg',
    read: 1,
    total: 4,
    done: false,
  });
  const view = await renderStep({});

  expect(view.getByText('Reading your photos… 2 of 4')).toBeTruthy();
  expect(view.queryByTestId('plate-suggestion-AB12CDE')).toBeNull();
  expect(view.queryByText('Add a close photo of the plate')).toBeNull();
});

it('offers nothing extra when there were no photos to read', async () => {
  const view = await renderStep({});
  expect(view.queryByText('From your photos')).toBeNull();
  expect(view.queryByText('Add a close photo of the plate')).toBeNull();
});

describe('when the photos gave nothing', () => {
  beforeEach(() => {
    mockScan = scan({ read: 3, total: 3 });
  });

  const tapCloseUp = async (view: Awaited<ReturnType<typeof renderStep>>) => {
    await act(async () => {
      fireEvent.press(view.getByText('Add a close photo of the plate'));
    });
  };

  it('says so and offers a close photo, until a plate is typed', async () => {
    const view = await renderStep({});
    expect(view.getByText('We couldn’t read it from your photos.')).toBeTruthy();

    await act(async () => {
      view.rerender(<PlateStep answers={{ plate: 'AB12 CDE' }} setAnswers={setAnswers} />);
    });
    expect(view.queryByText('Add a close photo of the plate')).toBeNull();
  });

  it('adds what the close photo reads to the suggestions, writing nothing', async () => {
    const sightings = [
      {
        candidate: {
          canon: 'AB12CDE',
          display: 'AB12 CDE',
          format: 'current',
          coercions: 0,
          cost: 0,
        },
        share: 0.2,
        fromCrop: true,
        lowercase: false,
        extra: 'c',
      },
    ];
    mockReadPlate.mockResolvedValue({ kind: 'read', sawText: true, sightings });
    const view = await renderStep({});
    await tapCloseUp(view);

    expect(mockReadPlate).toHaveBeenCalledWith('file://close.jpg');
    expect(mockScan.addCloseUp).toHaveBeenCalledWith(sightings);
    expect(setAnswers.mock.calls.some(([patch]) => Object.hasOwn(patch, 'plate'))).toBe(false);
  });

  it('says so when the close photo gives nothing either', async () => {
    mockReadPlate.mockResolvedValue({ kind: 'read', sightings: [], sawText: true });
    const view = await renderStep({});
    await tapCloseUp(view);

    expect(view.getByText('Still couldn’t read it — you can type it above.')).toBeTruthy();
  });

  it.each([
    ['the camera is not allowed', () => mockPermission.mockResolvedValue({ granted: false })],
    ['the photo is cancelled', () => mockCamera.mockResolvedValue({ canceled: true, assets: [] })],
  ])('does nothing when %s', async (_name, arrange) => {
    arrange();
    const view = await renderStep({});
    await tapCloseUp(view);

    expect(mockReadPlate).not.toHaveBeenCalled();
    expect(setAnswers).not.toHaveBeenCalled();
  });
});
