/**
 * WHAT:  Tests for the BottomSheet primitive — hidden until opened via the
 *        ref, renders title/children when open, close() dismisses and fires
 *        onDismiss, the title header is omitted when no title is given, and
 *        on Android the sheet content pads by the keyboard height so the
 *        sheet rises clear of the keyboard (regression: keyboard used to
 *        cover the sheet entirely).
 * WHY:   Every sheet in the app rides on this wrapper; a sheet that renders
 *        prematurely, swallows its dismiss callback, or loses its header
 *        semantics would break every filter/action flow at once.
 * LINKS: src/shared/ui/BottomSheet.tsx, docs/TESTING.md.
 *
 * The library is mocked at the boundary with @gorhom's official Jest mock.
 * Its BottomSheetModal renders children unconditionally and its present/
 * dismiss are inert, so we extend it with a minimal visibility-aware modal
 * that mirrors the real contract: mounts children only after present(),
 * unmounts them and fires onDismiss on dismiss().
 */

import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';
import { Keyboard, Platform, StyleSheet, Text } from 'react-native';

import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { TextField } from './TextField';

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

    present = () => {
      this.setState({ visible: true });
    };

    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };

    render() {
      return this.state.visible ? this.props.children : null;
    }
  }

  // Tagged so tests can assert that inputs inside the sheet render the
  // sheet-aware input (the real one drives the keyboard avoidance), and that
  // the content container pads for the keyboard (the Android lift).
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  const BottomSheetTextInput = (props: object) =>
    React.createElement(ReactNative.TextInput, { testID: 'sheet-aware-input', ...props });
  const BottomSheetScrollView = (props: object) =>
    React.createElement(ReactNative.ScrollView, { testID: 'sheet-scroll-view', ...props });

  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetTextInput,
    BottomSheetScrollView,
  };
});

function renderSheet(props: { title?: string; onDismiss?: () => void } = {}) {
  const sheetRef = createRef<BottomSheetRef>();
  const view = render(
    <BottomSheet ref={sheetRef} {...props}>
      <Text>Sheet body</Text>
    </BottomSheet>,
  );
  return { sheetRef, view };
}

describe('BottomSheet', () => {
  it('renders nothing until opened through the ref', async () => {
    const { sheetRef, view } = renderSheet({ title: 'Filters' });
    const { queryByText, findByText } = await view;

    expect(queryByText('Filters')).toBeNull();
    expect(queryByText('Sheet body')).toBeNull();

    await act(async () => sheetRef.current?.open());

    expect(await findByText('Filters')).toBeTruthy();
    expect(await findByText('Sheet body')).toBeTruthy();
  });

  it('announces the title as a header to screen readers', async () => {
    const { sheetRef, view } = renderSheet({ title: 'Filters' });
    const { findByRole } = await view;

    await act(async () => sheetRef.current?.open());

    expect(await findByRole('header', { name: 'Filters' })).toBeTruthy();
  });

  it('omits the header row when no title is given', async () => {
    const { sheetRef, view } = renderSheet();
    const { findByText, queryByRole } = await view;

    await act(async () => sheetRef.current?.open());

    expect(await findByText('Sheet body')).toBeTruthy();
    expect(queryByRole('header')).toBeNull();
  });

  it('close() hides the sheet and fires onDismiss', async () => {
    const onDismiss = jest.fn();
    const { sheetRef, view } = renderSheet({ title: 'Filters', onDismiss });
    const { findByText, queryByText } = await view;

    await act(async () => sheetRef.current?.open());
    expect(await findByText('Sheet body')).toBeTruthy();

    await act(async () => sheetRef.current?.close());

    expect(queryByText('Sheet body')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders TextFields inside the sheet with the sheet-aware input so the sheet rises with the keyboard', async () => {
    const sheetRef = createRef<BottomSheetRef>();
    const { findByTestId } = await render(
      <BottomSheet ref={sheetRef} title="Form">
        <TextField label="Full name" value="" onChangeText={() => {}} />
      </BottomSheet>,
    );

    await act(async () => sheetRef.current?.open());

    expect(await findByTestId('sheet-aware-input')).toBeTruthy();
  });

  it('does not fire onDismiss when closed without ever opening', async () => {
    const onDismiss = jest.fn();
    const { sheetRef, view } = renderSheet({ onDismiss });
    await view;

    await act(async () => sheetRef.current?.close());

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

/**
 * Regression: on Android (edge-to-edge, Expo SDK 57+) the library's own
 * keyboard handling is a no-op and the modal's bottomInset prop ignores
 * runtime changes, so the keyboard used to cover the sheet completely. The
 * fix pads the sheet content by the measured keyboard height instead, which
 * enableDynamicSizing reacts to. These tests pin that mechanism.
 */
describe('BottomSheet keyboard lift (Android)', () => {
  const keyboardHandlers: Record<string, (event?: unknown) => void> = {};

  beforeEach(() => {
    for (const key of Object.keys(keyboardHandlers)) {
      delete keyboardHandlers[key];
    }
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((
      eventName: string,
      handler: (event?: unknown) => void,
    ) => {
      keyboardHandlers[eventName] = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function contentPaddingBottom(getByTestId: (testId: string) => { props: Record<string, unknown> }) {
    const scrollView = getByTestId('sheet-scroll-view');
    const style = StyleSheet.flatten(
      scrollView.props.contentContainerStyle,
    ) as { paddingBottom: number };
    return style.paddingBottom;
  }

  it('pads the sheet content by the keyboard height while the keyboard is up', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { sheetRef, view } = renderSheet({ title: 'Form' });
    const { getByTestId } = await view;

    await act(async () => sheetRef.current?.open());
    const restingPadding = contentPaddingBottom(getByTestId);

    await act(async () => {
      keyboardHandlers.keyboardDidShow?.({ endCoordinates: { height: 312 } });
    });
    expect(contentPaddingBottom(getByTestId)).toBe(restingPadding + 312);

    await act(async () => {
      keyboardHandlers.keyboardDidHide?.();
    });
    expect(contentPaddingBottom(getByTestId)).toBe(restingPadding);
  });

  it('does not watch the keyboard on iOS (the library handles it natively)', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { sheetRef, view } = renderSheet({ title: 'Form' });
    await view;

    await act(async () => sheetRef.current?.open());

    expect(Keyboard.addListener).not.toHaveBeenCalled();
  });
});
