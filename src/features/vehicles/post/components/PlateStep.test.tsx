/**
 * WHAT:  Tests for PlateStep's close photo (plate scanning v2): offered only
 *        when the photos gave nothing, read like any photo, and never written
 *        without the owner's confirmation.
 * WHY:   docs/plate-scan-decisions.md — a failed scan must never block, and a
 *        plate must never be written behind the owner's back. The field, the
 *        warning and the skip are tested through GaragePlateStep
 *        (src/features/garage/components/garageSteps.test.tsx).
 * LINKS: ./PlateStep.tsx; ../lib/readPlate.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

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

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

// The sheet as plain buttons: its own behaviour is tested in PlateScanSheet.test.
jest.mock('./PlateScanSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, Text, View } = require('react-native');
  return {
    PlateScanSheet: ({
      ref,
      candidates,
      onConfirm,
      onDecline,
    }: {
      ref?: React.Ref<unknown>;
      candidates: { canon: string; display: string }[];
      onConfirm: (canon: string) => void;
      onDecline: () => void;
    }) => {
      React.useImperativeHandle(ref, () => ({ open: jest.fn(), close: jest.fn() }));
      return React.createElement(
        View,
        { testID: 'plate-scan-sheet' },
        React.createElement(Text, null, candidates[0]?.display),
        React.createElement(Pressable, { testID: 'sheet-yes', onPress: () => onConfirm(candidates[0].canon) }),
        React.createElement(Pressable, { testID: 'sheet-no', onPress: onDecline }),
      );
    },
  };
});

let setAnswers: jest.Mock;
const renderStep = (answers: object) =>
  act(async () => render(<PlateStep answers={answers} setAnswers={setAnswers} onSkip={jest.fn()} />));

beforeEach(() => {
  jest.clearAllMocks();
  setAnswers = jest.fn();
  mockPermission.mockResolvedValue({ granted: true });
  mockCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://close.jpg' }] });
});

const tapCloseUp = async (view: Awaited<ReturnType<typeof renderStep>>) => {
  await act(async () => {
    fireEvent.press(view.getByText('Add a close photo of the plate'));
  });
};

it('offers nothing extra when the photos were not read, or gave a plate', async () => {
  const view = await renderStep({});
  expect(view.queryByText('Add a close photo of the plate')).toBeNull();
});

it('says the photos gave nothing and offers a close photo, until a plate is typed', async () => {
  const view = await renderStep({ plateScanNothing: true });
  expect(view.getByText('We couldn’t read it from your photos.')).toBeTruthy();
  expect(view.getByText('Add a close photo of the plate')).toBeTruthy();

  await act(async () => {
    view.rerender(
      <PlateStep answers={{ plateScanNothing: true, plate: 'AB12 CDE' }} setAnswers={setAnswers} />,
    );
  });
  expect(view.queryByText('Add a close photo of the plate')).toBeNull();
});

it('reads the close photo and offers the plate; only a confirmation writes it', async () => {
  mockReadPlate.mockResolvedValue({
    kind: 'read',
    sawText: true,
    sightings: [
      {
        candidate: { canon: 'AB12CDE', display: 'AB12 CDE', format: 'current', coercions: 0, cost: 0 },
        share: 0.2,
        fromCrop: true,
        lowercase: false,
        extra: 'c',
      },
    ],
  });
  const view = await renderStep({ plateScanNothing: true });
  await tapCloseUp(view);

  expect(mockReadPlate).toHaveBeenCalledWith('file://close.jpg');
  expect(view.getByTestId('plate-scan-sheet')).toBeTruthy();
  expect(setAnswers).toHaveBeenCalledWith({ plateScanOffered: 'AB12CDE' });
  expect(setAnswers.mock.calls.some(([patch]) => Object.hasOwn(patch, 'plate'))).toBe(false);

  await act(async () => {
    fireEvent.press(view.getByTestId('sheet-yes'));
  });
  expect(setAnswers).toHaveBeenCalledWith({ plate: 'AB12 CDE', plateFromScan: true });
});

it('says so when the close photo gives nothing either', async () => {
  mockReadPlate.mockResolvedValue({ kind: 'read', sightings: [], sawText: true });
  const view = await renderStep({ plateScanNothing: true });
  await tapCloseUp(view);

  expect(view.getByText('Still couldn’t read it — you can type it above.')).toBeTruthy();
  expect(view.queryByTestId('plate-scan-sheet')).toBeNull();
});

it.each([
  ['the camera is not allowed', () => mockPermission.mockResolvedValue({ granted: false })],
  ['the photo is cancelled', () => mockCamera.mockResolvedValue({ canceled: true, assets: [] })],
])('does nothing when %s', async (_name, arrange) => {
  arrange();
  const view = await renderStep({ plateScanNothing: true });
  await tapCloseUp(view);

  expect(mockReadPlate).not.toHaveBeenCalled();
  expect(setAnswers).not.toHaveBeenCalled();
});
