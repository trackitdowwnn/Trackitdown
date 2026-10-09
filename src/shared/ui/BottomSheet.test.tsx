/**
 * WHAT:  Tests for the BottomSheet primitive — hidden until opened via the
 *        ref, renders title/children when open, close() dismisses and fires
 *        onDismiss, Android Back closes the open sheet (and only while it's
 *        open), the title header is omitted when no title is given, and
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

import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef, type ReactNode } from 'react';
import { BackHandler, Dimensions, Keyboard, Platform, StyleSheet, Text, TextInput } from 'react-native';

import { BottomSheet, sheetRevealOffset, type BottomSheetRef } from './BottomSheet';
import { TextField } from './TextField';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockSheetScrollTo = jest.fn();
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };

    // Faithful to @gorhom/bottom-sheet 5.2.14: dismiss() on a NON-presented
    // modal wedges its status machine (DISMISSING with no animation to
    // finish), after which present() is silently ignored forever.
    wedged = false;

    // onChange reports the snap index as the real modal does: 0 once open,
    // -1 once closed. A skipped present reports nothing.
    present = () => {
      if (this.wedged) return;
      this.setState({ visible: true });
      this.props.onChange?.(0);
    };

    dismiss = () => {
      if (!this.state.visible) {
        this.wedged = true;
        return;
      }
      this.setState({ visible: false });
      this.props.onChange?.(-1);
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
  // React 19 passes ref as a prop: expose scrollTo so the keyboard reveal's
  // scrolling can be asserted.
  const BottomSheetScrollView = ({ ref, ...props }: { ref?: unknown }) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockSheetScrollTo }));
    return React.createElement(ReactNative.ScrollView, { testID: 'sheet-scroll-view', ...props });
  };

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

  it('⚠️ Android Back closes the sheet, and only the sheet', async () => {
    // Before 2026-09-30 nothing handled Back while a sheet was up, so it went
    // to the screen underneath: the route popped with the sheet still showing.
    const addSpy = jest.spyOn(BackHandler, 'addEventListener');
    try {
      const onDismiss = jest.fn();
      const { sheetRef, view } = renderSheet({ onDismiss });
      const { queryByText } = await view;

      // Nothing registered while closed: Back belongs to the screen then.
      expect(addSpy.mock.calls.filter(([event]) => event === 'hardwareBackPress')).toHaveLength(0);

      await act(async () => sheetRef.current?.open());
      const index = addSpy.mock.calls.findIndex(([event]) => event === 'hardwareBackPress');
      expect(index).toBeGreaterThanOrEqual(0);
      const handler = addSpy.mock.calls[index][1] as () => boolean;
      const subscription = addSpy.mock.results[index].value as { remove: () => void };
      const remove = jest.spyOn(subscription, 'remove');

      let consumed = false;
      await act(async () => {
        consumed = handler();
      });
      expect(consumed).toBe(true);
      expect(queryByText('Sheet body')).toBeNull();
      expect(onDismiss).toHaveBeenCalledTimes(1);
      // ...and hands Back back to the screen once it's closed.
      expect(remove).toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
    }
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

  it('close() while not presented must not wedge the modal (regression)', async () => {
    // The real library permanently ignores present() after a dismiss() on a
    // non-presented modal — this froze DateTimeField after its Android
    // dialog flow committed. close() must be a no-op unless open.
    const { sheetRef, view } = renderSheet({ title: 'Filters' });
    const { findByText } = await view;

    await act(async () => sheetRef.current?.close()); // never opened
    await act(async () => sheetRef.current?.open());
    expect(await findByText('Sheet body')).toBeTruthy();

    // And again after a legitimate open/close cycle: a second close() once
    // already dismissed must not wedge the next open.
    await act(async () => sheetRef.current?.close());
    await act(async () => sheetRef.current?.close());
    await act(async () => sheetRef.current?.open());
    expect(await findByText('Sheet body')).toBeTruthy();
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

describe('sheetRevealOffset — where to scroll so a focused input clears the keyboard', () => {
  const base = { scrollY: 0, viewport: 700, covered: 300, margin: 48 };

  it('leaves an input that is already above the keyboard alone', () => {
    expect(sheetRevealOffset({ ...base, inputTop: 100, inputBottom: 200 })).toBeNull();
  });

  it('scrolls an input under the keyboard up to just above it, with room for its helper', () => {
    // Visible strip: 0..400. Bottom 500 + 48 must reach 400 → scroll 148.
    expect(sheetRevealOffset({ ...base, inputTop: 380, inputBottom: 500 })).toBe(148);
  });

  it('counts what is already scrolled', () => {
    expect(sheetRevealOffset({ ...base, scrollY: 200, inputTop: 380, inputBottom: 500 })).toBeNull();
  });

  it('aligns an input taller than the strip by its top, never pushing it off', () => {
    expect(sheetRevealOffset({ ...base, inputTop: 300, inputBottom: 900 })).toBe(300);
  });

  it('does nothing when the keyboard hides the whole sheet', () => {
    expect(sheetRevealOffset({ ...base, covered: 700, inputTop: 0, inputBottom: 50 })).toBeNull();
  });
});

describe('⚠️ BottomSheet scrolls the focused input above the keyboard (Android, 2026-10-09)', () => {
  // Owner report: in the withdraw sheet's note box "the keyboard covers what
  // they are typing" — a tall sheet stops growing at its cap and scrolls,
  // and nothing scrolled the box into view.
  const keyboardHandlers: Record<string, (event?: unknown) => void> = {};
  /** Content taller than the sheet's 90% cap — the case that scrolls. */
  const pastCap = () => Dimensions.get('window').height;
  /** Content the sheet can still grow to fit. */
  const belowCap = () => Dimensions.get('window').height * 0.5;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSheetScrollTo.mockClear();
    for (const key of Object.keys(keyboardHandlers)) delete keyboardHandlers[key];
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((
      eventName: string,
      handler: (event?: unknown) => void,
    ) => {
      keyboardHandlers[eventName] = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A focused input at `y` (in the sheet content), `height` tall. */
  const focusInputAt = (y: number, height: number) =>
    jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockReturnValue({
      measureLayout: (relativeTo: unknown, onSuccess: (...args: number[]) => void) => {
        // Measured against the sheet's own content view, never nothing.
        expect(relativeTo).toBeTruthy();
        onSuccess(0, y, 300, height);
      },
    } as never);

  /** Open the sheet, give it a 700-tall viewport, and raise a 300 keyboard. */
  async function openWithKeyboard(children?: ReactNode) {
    const sheetRef = createRef<BottomSheetRef>();
    const view = await render(
      <BottomSheet ref={sheetRef}>{children ?? <Text>Sheet body</Text>}</BottomSheet>,
    );
    await act(async () => sheetRef.current?.open());
    const layout = async () =>
      act(async () => {
        fireEvent(view.getByTestId('sheet-scroll-view'), 'layout', {
          nativeEvent: { layout: { height: 700 } },
        });
      });
    await layout();
    await act(async () => {
      keyboardHandlers.keyboardDidShow?.({ endCoordinates: { height: 300 } });
    });
    return { sheetRef, view, layout };
  }

  it('scrolls once the keyboard is up and the sheet has grown', async () => {
    focusInputAt(500, 120);
    await openWithKeyboard();
    // Not before the sheet has had time to grow into the lift.
    expect(mockSheetScrollTo).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    // Input 8 + 500 .. 628, + 48 → 676; visible strip 700 − 300 = 400.
    expect(mockSheetScrollTo).toHaveBeenCalledWith({ y: 276, animated: true });
  });

  it('scrolls again as a multiline field grows past the cap while they type', async () => {
    focusInputAt(500, 120);
    const { view } = await openWithKeyboard();
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(mockSheetScrollTo).toHaveBeenCalledTimes(1);
    // The scroll lands; then the field grows a line.
    await act(async () => {
      fireEvent(view.getByTestId('sheet-scroll-view'), 'scroll', {
        nativeEvent: { contentOffset: { y: 276 } },
      });
    });
    focusInputAt(500, 150);
    await act(async () => {
      fireEvent(view.getByTestId('sheet-scroll-view'), 'contentSizeChange', 390, pastCap());
    });
    expect(mockSheetScrollTo).toHaveBeenLastCalledWith({ y: 306, animated: true });
  });

  it('⚠️ never scrolls a short sheet that is about to grow to fit — no jiggle', async () => {
    focusInputAt(500, 120);
    const { view } = await openWithKeyboard();
    await act(async () => {
      fireEvent(view.getByTestId('sheet-scroll-view'), 'contentSizeChange', 390, belowCap());
    });
    expect(mockSheetScrollTo).not.toHaveBeenCalled();
  });

  it('counts where the sheet is already scrolled', async () => {
    focusInputAt(500, 120);
    const { view } = await openWithKeyboard();
    await act(async () => {
      fireEvent(view.getByTestId('sheet-scroll-view'), 'scroll', {
        nativeEvent: { contentOffset: { y: 300 } },
      });
      jest.advanceTimersByTime(250);
    });
    expect(mockSheetScrollTo).not.toHaveBeenCalled();
  });

  it('reveals a field focused while the keyboard is already up', async () => {
    const { view } = await openWithKeyboard(
      <TextField label="Second field" value="" onChangeText={() => {}} />,
    );
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    mockSheetScrollTo.mockClear();
    // Focus moves: the keyboard height and content size stay the same.
    focusInputAt(600, 56);
    await act(async () => {
      fireEvent(view.getByTestId('sheet-aware-input'), 'focus', {});
    });
    // 8 + 600 + 56 + 48 = 712; visible 400.
    expect(mockSheetScrollTo).toHaveBeenCalledWith({ y: 312, animated: true });
  });

  it('⚠️ starts from the top again after the sheet is closed and reopened', async () => {
    focusInputAt(500, 120);
    const { sheetRef, view, layout } = await openWithKeyboard();
    await act(async () => {
      fireEvent(view.getByTestId('sheet-scroll-view'), 'scroll', {
        nativeEvent: { contentOffset: { y: 276 } },
      });
      keyboardHandlers.keyboardDidHide?.();
    });
    await act(async () => sheetRef.current?.close());
    // A fresh scroll view at 0 — no scroll event says so.
    await act(async () => sheetRef.current?.open());
    await layout();
    mockSheetScrollTo.mockClear();
    await act(async () => {
      keyboardHandlers.keyboardDidShow?.({ endCoordinates: { height: 300 } });
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(mockSheetScrollTo).toHaveBeenCalledWith({ y: 276, animated: true });
  });

  it('does nothing while the keyboard is down', async () => {
    const { sheetRef, view } = renderSheet();
    await view;
    await act(async () => sheetRef.current?.open());
    focusInputAt(500, 120);
    await act(async () => {
      fireEvent((await view).getByTestId('sheet-scroll-view'), 'contentSizeChange', 390, pastCap());
      jest.advanceTimersByTime(1000);
    });
    expect(mockSheetScrollTo).not.toHaveBeenCalled();
  });
});
