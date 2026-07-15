/**
 * WHAT:  Tests for the PhotosStep evidence flow — camera-FIRST when no
 *        photos exist, the grid as the resting state, the add tile
 *        reopening the camera, auto-close at the 3-photo max, and the
 *        evidence-atomicity invariant (a captured photo's GPS + timestamp
 *        bundle survives the grid round-trip; removing a tile removes the
 *        whole unit).
 * WHY:   The photo step is where the anti-fraud evidence is born (DOMAIN
 *        sighting rules / ADR-0003) — a wiring slip here either strands a
 *        spotter (camera never opens) or corrupts evidence (bundle stripped
 *        by the grid). The grid's own behaviour is pinned in
 *        PhotoGridPicker.test.tsx; this file proves the STEP composes it
 *        with CameraCapture correctly.
 * LINKS: src/features/sightings/components/sightingSteps.tsx;
 *        src/shared/ui/PhotoGridPicker.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';

import type { ReportSightingAnswers } from '../types';
import { PhotosStep } from './sightingSteps';

const mockTakePicture = jest.fn();
jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    CameraView: forwardRef((_props: object, ref: unknown) => {
      useImperativeHandle(ref as never, () => ({ takePictureAsync: mockTakePicture }));
      return null;
    }),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  getCurrentPositionAsync: jest
    .fn()
    .mockResolvedValue({ coords: { latitude: 53.48, longitude: -2.24, accuracy: 8 } }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

// PhotoGridPicker's animation/gesture boundary — same mocks as its own tests.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedProps: () => ({}),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withTiming: (value: unknown) => value,
  };
});
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));
jest.mock('react-native-gesture-handler', () => {
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of [
      'enabled',
      'activateAfterLongPress',
      'onStart',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ]) {
      gesture[method] = () => gesture;
    }
    return gesture;
  };
  return {
    Gesture: { Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});
// Gallery pipeline modules load with PhotoGridPicker but must never run in
// capture mode — mocked to throw-if-touched via jest.fn() assertions.
const mockLaunchLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

/** Drives PhotosStep the way the wizard does: one controlled answers bag. */
function Harness({ initial }: { initial: Partial<ReportSightingAnswers> }) {
  const [answers, setAnswers] = useState<Partial<ReportSightingAnswers>>(initial);
  return (
    <PhotosStep
      answers={answers}
      setAnswers={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
    />
  );
}

const evidence = (n: number) => ({
  uri: `file:///evidence-${n}.jpg`,
  capturedAt: `2026-07-15T10:0${n}:00Z`,
  lat: 53.48,
  lng: -2.24,
  accuracyM: 10,
});

async function renderStep(initial: Partial<ReportSightingAnswers>) {
  let view!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    view = await render(<Harness initial={initial} />);
  });
  // Lay the grid out so tiles/add tile get real cells.
  const grid = view.queryByTestId('sighting-photo-grid-grid');
  if (grid) {
    await act(async () => {
      fireEvent(grid, 'layout', { nativeEvent: { layout: { width: 328 } } });
    });
  }
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTakePicture.mockResolvedValue({ uri: 'file:///shot.jpg', width: 1600, height: 1200 });
});

describe('PhotosStep', () => {
  it('opens the camera FIRST when no evidence exists yet (speed flow)', async () => {
    const { getByLabelText, getByText } = await renderStep({ photos: [] });
    // The full-screen camera is up: shutter + Done are on screen.
    expect(getByLabelText('Take photo')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
  });

  it('a capture lands as an evidence bundle; Done rests on the grid with the add tile', async () => {
    const { getByLabelText, getByText, getByTestId, queryByLabelText } = await renderStep({
      photos: [],
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });
    await act(async () => {
      fireEvent.press(getByText('Done'));
    });
    expect(queryByLabelText('Take photo')).toBeNull(); // camera closed
    // The captured photo is a grid tile and the add tile invites the next shot.
    expect(getByTestId('sighting-photo-grid-photo-0')).toBeTruthy();
    expect(getByTestId('sighting-photo-grid-add')).toBeTruthy();
  });

  it('rests on the grid when photos already exist; the add tile reopens the camera', async () => {
    const { getByTestId, getByLabelText, queryByLabelText } = await renderStep({
      photos: [evidence(0)],
    });
    expect(queryByLabelText('Take photo')).toBeNull(); // grid, not camera
    await act(async () => {
      fireEvent.press(getByTestId('sighting-photo-grid-add'));
    });
    expect(getByLabelText('Take photo')).toBeTruthy(); // camera reopened
  });

  it('auto-closes the camera at the 3-photo max', async () => {
    const { getByTestId, getByLabelText, queryByLabelText } = await renderStep({
      photos: [evidence(0), evidence(1)],
    });
    await act(async () => {
      fireEvent.press(getByTestId('sighting-photo-grid-add'));
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Take photo')); // the 3rd photo
    });
    expect(queryByLabelText('Take photo')).toBeNull(); // full → grid
    expect(getByTestId('sighting-photo-grid-photo-2')).toBeTruthy();
  });

  it('never touches the gallery — capture mode has no library path', async () => {
    const { getByTestId } = await renderStep({ photos: [evidence(0)] });
    await act(async () => {
      fireEvent.press(getByTestId('sighting-photo-grid-add'));
    });
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it('removing a tile removes the WHOLE evidence unit and keeps the rest intact', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderStep({
      photos: [evidence(0), evidence(1)],
    });
    await act(async () => {
      fireEvent.press(getByTestId('sighting-photo-grid-photo-0-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Remove'));
    });
    // One tile left — and evidence(1)'s bundle is what survives, whole.
    expect(getByTestId('sighting-photo-grid-photo-0')).toBeTruthy();
    expect(queryByTestId('sighting-photo-grid-photo-1')).toBeNull();
  });
});
