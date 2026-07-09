/**
 * WHAT:  Wiring tests for PhotoGridPicker — render states (empty, partial,
 *        at max, V5C single-photo), the gallery/camera pick pipelines
 *        (selection-limit maths, processing shimmer, resize fallback), the
 *        permission-denied inline state, the ⋯ sheet actions with the
 *        cover-removal confirm, status overlays, and the disabled state.
 * WHY:   The photo list becomes the post's public images; a wiring slip here
 *        publishes wrong photos or strands the wizard. The ordering maths are
 *        pinned in photoGridModel.test.ts — this file proves the component
 *        obeys them. Native modules (picker, manipulator, sheet, reanimated)
 *        are mocked at the boundary, same pattern as MoneySlider.test.tsx and
 *        BottomSheet.test.tsx.
 * LINKS: src/shared/ui/PhotoGridPicker.tsx; src/shared/ui/photoGridModel.ts;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { PhotoGridPicker, type PickedPhoto } from './PhotoGridPicker';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (component: unknown) => component,
    },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedProps: () => ({}),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    // Like the real hook, the box must survive re-renders.
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

const mockRequestLibraryPermission = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockRequestCameraPermission = jest.fn();
const mockLaunchCamera = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestLibraryPermission(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPermission(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
}));

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    get manipulate() {
      return mockManipulate;
    },
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

/** manipulate(uri) → context that saves to `${uri}-resized` at the target. */
function mockResizePipeline() {
  mockManipulate.mockImplementation((uri: string) => ({
    resize: jest.fn(),
    renderAsync: async () => ({
      saveAsync: async () => ({ uri: `${uri}-resized`, width: 2000, height: 1500 }),
    }),
  }));
}

const photo = (n: number, oversized = false): PickedPhoto => ({
  uri: `file:///photo-${n}.jpg`,
  width: oversized ? 4000 : 1600,
  height: oversized ? 3000 : 1200,
});
const photos = (count: number) => Array.from({ length: count }, (_, n) => photo(n));

const baseProps = {
  onChangePhotos: jest.fn(),
  minPhotos: 3,
  maxPhotos: 6,
  testID: 'pgp',
};

const granted = { granted: true, canAskAgain: true };

async function renderPicker(props: Partial<React.ComponentProps<typeof PhotoGridPicker>> = {}) {
  const view = await render(<PhotoGridPicker photos={[]} {...baseProps} {...props} />);
  // Give the grid a width so tiles get real cells.
  await act(async () => {
    fireEvent(view.getByTestId('pgp-grid'), 'layout', {
      nativeEvent: { layout: { width: 328 } },
    });
  });
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestLibraryPermission.mockResolvedValue(granted);
  mockRequestCameraPermission.mockResolvedValue(granted);
  mockResizePipeline();
});

describe('render states', () => {
  it('empty: full-width add tile with the gentle minimum copy, no cover hint', async () => {
    const { getByTestId, getByText, queryByText } = await renderPicker();
    expect(getByTestId('pgp-add')).toBeTruthy();
    expect(getByText('Add at least 3 more')).toBeTruthy();
    expect(queryByText('This is the first photo spotters will see.')).toBeNull();
  });

  it('partial: photos render, cover pill on the first only, hint appears', async () => {
    const { getAllByText, getByText, getByTestId } = await renderPicker({ photos: photos(3) });
    expect(getByTestId('pgp-photo-0')).toBeTruthy();
    expect(getByTestId('pgp-photo-2')).toBeTruthy();
    expect(getAllByText('Cover photo')).toHaveLength(1);
    expect(getByText('This is the first photo spotters will see.')).toBeTruthy();
  });

  it('at max: add tile and camera row disappear', async () => {
    const { queryByTestId } = await renderPicker({ photos: photos(6) });
    expect(queryByTestId('pgp-add')).toBeNull();
    expect(queryByTestId('pgp-camera')).toBeNull();
  });

  it('tiles carry position labels with a reorder hint', async () => {
    const { getByTestId } = await renderPicker({ photos: photos(3) });
    expect(getByTestId('pgp-photo-1').props.accessibilityLabel).toBe('Photo 2 of 3');
    expect(getByTestId('pgp-photo-0').props.accessibilityLabel).toBe(
      'Cover photo, photo 1 of 3',
    );
  });

  it('V5C single-photo mode hides the cover chrome, including in labels', async () => {
    const { queryByText, getByTestId } = await renderPicker({
      photos: photos(1),
      minPhotos: 1,
      maxPhotos: 1,
    });
    expect(queryByText('Cover photo')).toBeNull();
    expect(queryByText('This is the first photo spotters will see.')).toBeNull();
    expect(getByTestId('pgp-photo-0').props.accessibilityLabel).toBe('Photo 1 of 1');
  });

  it('tips card shows and dismisses via the consumer callback', async () => {
    const onDismissTips = jest.fn();
    const { getByTestId, getByText } = await renderPicker({ onDismissTips });
    expect(getByText(/Clear photos help spotters/)).toBeTruthy();
    fireEvent.press(getByTestId('pgp-dismiss-tips'));
    expect(onDismissTips).toHaveBeenCalled();
  });
});

describe('gallery selection', () => {
  it('passes the remaining slots as selectionLimit', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    const { getByTestId } = await renderPicker({ photos: photos(4) });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(mockLaunchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 2,
      }),
    );
  });

  it('one slot left: single selection', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    const { getByTestId } = await renderPicker({ photos: photos(5) });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(mockLaunchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: false, selectionLimit: 1 }),
    );
  });

  it('resizes oversized picks, keeps small ones, appends in order', async () => {
    const onChangePhotos = jest.fn();
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [photo(10, true), photo(11)],
    });
    const { getByTestId } = await renderPicker({ photos: photos(1), onChangePhotos });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    await waitFor(() => expect(onChangePhotos).toHaveBeenCalled());
    const next: PickedPhoto[] = onChangePhotos.mock.calls[0][0];
    expect(next.map((p) => p.uri)).toEqual([
      photo(0).uri,
      `${photo(10).uri}-resized`, // longest edge > 2000 → processed
      photo(11).uri, // within bounds → untouched
    ]);
  });

  it('shows processing tiles while the resize pipeline runs', async () => {
    let releaseSave: (() => void) | undefined;
    mockManipulate.mockImplementation((uri: string) => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: () =>
          new Promise((resolve) => {
            releaseSave = () => resolve({ uri: `${uri}-resized`, width: 2000, height: 1500 });
          }),
      }),
    }));
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [photo(10, true)] });
    const { getByTestId, queryByTestId } = await renderPicker();
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(getByTestId('pgp-pending-0')).toBeTruthy();
    await act(async () => {
      releaseSave?.();
    });
    await waitFor(() => expect(queryByTestId('pgp-pending-0')).toBeNull());
  });

  it('a failed resize keeps the original photo — never blocks', async () => {
    const onChangePhotos = jest.fn();
    mockManipulate.mockImplementation(() => {
      throw new Error('manipulator unavailable');
    });
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [photo(10, true)] });
    const { getByTestId } = await renderPicker({ onChangePhotos });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    await waitFor(() =>
      expect(onChangePhotos).toHaveBeenCalledWith([
        expect.objectContaining({ uri: photo(10).uri }),
      ]),
    );
  });

  it('cancelled picker changes nothing', async () => {
    const onChangePhotos = jest.fn();
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    const { getByTestId } = await renderPicker({ onChangePhotos });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(onChangePhotos).not.toHaveBeenCalled();
  });

  it('disabled: the add tile is inert', async () => {
    const { getByTestId } = await renderPicker({ disabled: true });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(mockRequestLibraryPermission).not.toHaveBeenCalled();
  });
});

describe('camera path', () => {
  it('adds a camera capture through the same pipeline', async () => {
    const onChangePhotos = jest.fn();
    mockLaunchCamera.mockResolvedValue({ canceled: false, assets: [photo(20)] });
    const { getByTestId } = await renderPicker({ onChangePhotos });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-camera'));
    });
    await waitFor(() =>
      expect(onChangePhotos).toHaveBeenCalledWith([expect.objectContaining({ uri: photo(20).uri })]),
    );
  });

  it('camera permission refusal fails quietly (gallery stays primary)', async () => {
    mockRequestCameraPermission.mockResolvedValue({ granted: false, canAskAgain: false });
    const { getByTestId, queryByTestId } = await renderPicker();
    await act(async () => {
      fireEvent.press(getByTestId('pgp-camera'));
    });
    expect(mockLaunchCamera).not.toHaveBeenCalled();
    expect(queryByTestId('pgp-permission')).toBeNull();
  });

  it('allowCamera=false hides the camera row', async () => {
    const { queryByTestId } = await renderPicker({ allowCamera: false });
    expect(queryByTestId('pgp-camera')).toBeNull();
  });
});

describe('library permission', () => {
  it('permanently denied: inline card with a settings link, add tile gone', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    mockRequestLibraryPermission.mockResolvedValue({ granted: false, canAskAgain: false });
    const { getByTestId, getByText, queryByTestId } = await renderPicker();
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(getByTestId('pgp-permission')).toBeTruthy();
    expect(queryByTestId('pgp-add')).toBeNull();
    fireEvent.press(getByText('Open settings'));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('denied but re-askable: no inline card (the system dialog owns it)', async () => {
    mockRequestLibraryPermission.mockResolvedValue({ granted: false, canAskAgain: true });
    const { getByTestId, queryByTestId } = await renderPicker();
    await act(async () => {
      fireEvent.press(getByTestId('pgp-add'));
    });
    expect(queryByTestId('pgp-permission')).toBeNull();
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });
});

describe('⋯ sheet actions', () => {
  it('make cover promotes the photo to index 0', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText } = await renderPicker({
      photos: photos(3),
      onChangePhotos,
    });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-2-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Make cover photo'));
    });
    expect(onChangePhotos.mock.calls[0][0].map((p: PickedPhoto) => p.uri)).toEqual(
      [2, 0, 1].map((n) => photo(n).uri),
    );
  });

  it('move up / move down are the no-drag reorder path', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText } = await renderPicker({
      photos: photos(3),
      onChangePhotos,
    });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-1-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Move down'));
    });
    expect(onChangePhotos.mock.calls[0][0].map((p: PickedPhoto) => p.uri)).toEqual(
      [0, 2, 1].map((n) => photo(n).uri),
    );
  });

  it('the cover has no Make cover / Move up actions', async () => {
    const { getByTestId, queryByText, getByText } = await renderPicker({ photos: photos(3) });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-0-menu'));
    });
    expect(queryByText('Make cover photo')).toBeNull();
    expect(queryByText('Move up')).toBeNull();
    expect(getByText('Move down')).toBeTruthy();
  });

  it('removing a non-cover photo needs no confirm', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderPicker({
      photos: photos(3),
      onChangePhotos,
    });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-1-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Remove'));
    });
    expect(queryByText('Remove photo')).toBeNull(); // no confirm step
    expect(onChangePhotos.mock.calls[0][0]).toHaveLength(2);
  });

  it('removing the cover confirms first, then the next photo takes over', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText } = await renderPicker({
      photos: photos(3),
      onChangePhotos,
    });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-0-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Remove'));
    });
    expect(onChangePhotos).not.toHaveBeenCalled(); // waiting on the confirm
    expect(getByText(/next photo becomes your cover/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Remove photo'));
    });
    const next: PickedPhoto[] = onChangePhotos.mock.calls[0][0];
    expect(next[0].uri).toBe(photo(1).uri);
    expect(next).toHaveLength(2);
  });

  it('removing the ONLY photo needs no confirm — no next-cover story to tell', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderPicker({
      photos: photos(1),
      minPhotos: 1,
      maxPhotos: 1,
      onChangePhotos,
    });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-0-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Remove'));
    });
    expect(queryByText(/next photo becomes your cover/)).toBeNull();
    expect(onChangePhotos).toHaveBeenCalledWith([]);
  });

  it('"Keep it" backs out of the cover confirm without changes', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText } = await renderPicker({
      photos: photos(3),
      onChangePhotos,
    });
    await act(async () => {
      fireEvent.press(getByTestId('pgp-photo-0-menu'));
    });
    await act(async () => {
      fireEvent.press(getByText('Remove'));
    });
    await act(async () => {
      fireEvent.press(getByText('Keep it'));
    });
    expect(onChangePhotos).not.toHaveBeenCalled();
    expect(getByText('Remove')).toBeTruthy(); // back on the actions list
  });
});

describe('accessibility actions', () => {
  const a11yAction = (name: string) => ({ nativeEvent: { actionName: name } });

  it('exposes reorder/remove as actions on the tile (the no-drag path)', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId } = await renderPicker({ photos: photos(3), onChangePhotos });
    const tile = getByTestId('pgp-photo-1');
    expect(tile.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'makeCover',
      'moveUp',
      'moveDown',
      'removePhoto',
    ]);
    fireEvent(tile, 'accessibilityAction', a11yAction('moveDown'));
    expect(onChangePhotos.mock.calls[0][0].map((p: PickedPhoto) => p.uri)).toEqual(
      [0, 2, 1].map((n) => photo(n).uri),
    );
  });

  it('the cover exposes no makeCover/moveUp actions', async () => {
    const { getByTestId } = await renderPicker({ photos: photos(3) });
    const names = getByTestId('pgp-photo-0').props.accessibilityActions.map(
      (a: { name: string }) => a.name,
    );
    expect(names).toEqual(['moveDown', 'removePhoto']);
  });

  it('removing the cover via an accessibility action still routes to the confirm', async () => {
    const onChangePhotos = jest.fn();
    const { getByTestId, getByText } = await renderPicker({
      photos: photos(3),
      onChangePhotos,
    });
    await act(async () => {
      fireEvent(getByTestId('pgp-photo-0'), 'accessibilityAction', a11yAction('removePhoto'));
    });
    expect(onChangePhotos).not.toHaveBeenCalled();
    expect(getByText(/next photo becomes your cover/)).toBeTruthy();
  });
});

describe('status overlays', () => {
  it('shows upload progress on the flagged tile', async () => {
    const { getByText } = await renderPicker({
      photos: photos(2),
      status: { [photo(1).uri]: { kind: 'uploading', progress: 0.42 } },
    });
    expect(getByText('Uploading 42%')).toBeTruthy();
  });

  it('error overlay retries through the consumer callback', async () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId } = await renderPicker({
      photos: photos(2),
      status: { [photo(1).uri]: { kind: 'error' } },
      onRetry,
    });
    expect(getByText('Upload failed')).toBeTruthy();
    fireEvent.press(getByTestId('pgp-photo-1-retry'));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ uri: photo(1).uri }));
  });
});
