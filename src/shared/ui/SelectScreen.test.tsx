/**
 * WHAT:  Tests for SelectScreen — debounced filtering, selection returning
 *        the chosen value and closing, the selected row's checked state,
 *        the empty-search state with its clear action, free-text entry
 *        ("Use "<query>"", its length cap) and the floating "Not listed?"
 *        pill with its type-it-in box (2026-10-12).
 * WHY:   Every select in the app funnels choices through this screen; a
 *        filter that eats matches or a selection that returns the wrong
 *        value would corrupt form data app-wide.
 * LINKS: src/shared/ui/SelectScreen.tsx, src/shared/ui/selectOptions.ts,
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard } from 'react-native';

import { SelectScreen, fitAnchors } from './SelectScreen';
import type { SelectOption } from './selectOptions';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The type-it-in sheet (2026-10-12) shows only once presented, so its content
// is absent until the pill opens it — the house visibility-aware modal.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => {
      this.setState({ visible: true });
      this.props.onChange?.(0);
    };
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onChange?.(-1);
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
    BottomSheetTextInput: (props: object) => React.createElement(ReactNative.TextInput, props),
  };
});

// Mock at the boundary: SelectScreen needs Animated.View, the slide/fade
// builders (chainable no-ops here), Easing, and ReduceMotion. withCallback
// callbacks are CAPTURED so tests can fire them late, the way Reanimated
// fires a stale exit callback on-device after a fast close→reopen.
const mockExitCallbacks: ((finished: boolean) => void)[] = [];
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.delay = () => chain;
    chain.easing = () => chain;
    chain.reduceMotion = () => chain;
    chain.withCallback = (callback: (finished: boolean) => void) => {
      mockExitCallbacks.push(callback);
      return chain;
    };
    return chain;
  };
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (fn: unknown) => fn, quad: () => 0 },
    ReduceMotion: { System: 'system' },
    FadeIn: builder(),
    FadeInDown: builder(),
    FadeOut: builder(),
    SlideInDown: builder(),
    SlideOutDown: builder(),
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
  };
});

const MAKES: SelectOption[] = [
  { value: 'aston-martin', label: 'Aston Martin', section: 'A' },
  { value: 'audi', label: 'Audi', section: 'A' },
  { value: 'bmw', label: 'BMW', section: 'B' },
];

async function renderScreen(overrides: Partial<Parameters<typeof SelectScreen<string>>[0]> = {}) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  const view = await render(
    <SelectScreen
      visible
      title="Car make"
      options={MAKES}
      value={null}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { view, onSelect, onClose };
}

async function typeSearch(view: Awaited<ReturnType<typeof render>>, text: string) {
  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Search'), text);
  });
  await act(async () => {
    jest.advanceTimersByTime(200); // past the 150ms debounce
  });
}

describe('fitAnchors (the letter rail on short screens)', () => {
  const anchors = 'ABCDEFGHIJKLMNOPRSTVX'.split('').map((title, index) => ({ title, index }));

  it('shows every letter when they fit, or before anything is measured', () => {
    expect(fitAnchors(anchors, 0, 0)).toHaveLength(21);
    expect(fitAnchors(anchors, 21 * 24, 24)).toHaveLength(21);
  });

  it('thins evenly to what fits, keeping the first and last letters', () => {
    const shown = fitAnchors(anchors, 11 * 24, 24);
    expect(shown).toHaveLength(11);
    expect(shown[0].title).toBe('A');
    expect(shown[shown.length - 1].title).toBe('X');
    expect(new Set(shown.map((anchor) => anchor.title)).size).toBe(11);
  });
});

describe('SelectScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('filters options after the debounce, case-insensitively', async () => {
    const { view } = await renderScreen();

    expect(view.getByText('BMW')).toBeTruthy();
    await typeSearch(view, '  aUdI ');

    expect(view.getByText('Audi')).toBeTruthy();
    expect(view.queryByText('BMW')).toBeNull();
    expect(view.queryByText('Aston Martin')).toBeNull();
  });

  it('returns the chosen value and asks to close on selection', async () => {
    const { view, onSelect, onClose } = await renderScreen();

    await act(async () => {
      fireEvent.press(view.getByText('BMW'));
    });

    expect(onSelect).toHaveBeenCalledWith('bmw');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the controlled value as checked', async () => {
    const { view } = await renderScreen({ value: 'audi' });

    expect(view.getByLabelText('Audi').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(view.getByLabelText('BMW').props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  describe('manual entry (free-text selects, e.g. car make)', () => {
    it('offers "Use "<query>"" for an unmatched query and submits the trimmed text', async () => {
      const onSubmit = jest.fn();
      const { view, onClose } = await renderScreen({ manualEntry: { onSubmit } });
      await typeSearch(view, '  Reliant ');

      const useRow = view.getByText('Use “Reliant”');
      await act(async () => {
        fireEvent.press(useRow);
      });
      expect(onSubmit).toHaveBeenCalledWith('Reliant');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // 2026-10-08: the wizard's auto-advance hangs off this.
    it('a "Use …" pick is reported as a pick once the screen has closed', async () => {
      const onClosed = jest.fn();
      const { view } = await renderScreen({ manualEntry: { onSubmit: jest.fn() }, onClosed });
      await typeSearch(view, 'Reliant');
      await act(async () => {
        fireEvent.press(view.getByText('Use “Reliant”'));
      });
      await act(async () => {
        view.rerender(
          <SelectScreen
            visible={false}
            title="Car make"
            options={MAKES}
            value={null}
            onSelect={jest.fn()}
            onClose={jest.fn()}
            manualEntry={{ onSubmit: jest.fn() }}
            onClosed={onClosed}
          />,
        );
      });
      await act(async () => {
        jest.advanceTimersByTime(300); // past the close (the fallback unmount)
      });
      expect(onClosed).toHaveBeenCalledWith(true);
    });

    it('without a `button`, shows no standing way in until the user types', async () => {
      const { view } = await renderScreen({ manualEntry: { onSubmit: jest.fn() } });
      // No floating pill unless the caller asked for one (2026-10-12: only
      // car make/model do), and no "Use "<query>"" until typing.
      expect(view.queryByTestId('select-manual-pill')).toBeNull();
      expect(view.queryByText(/^Use /)).toBeNull();
    });

    it('does NOT offer "Use "<query>"" when the query exactly matches a listed make', async () => {
      const { view } = await renderScreen({ manualEntry: { onSubmit: jest.fn() } });
      await typeSearch(view, 'audi');
      expect(view.queryByText(/^Use /)).toBeNull();
      expect(view.getByText('Audi')).toBeTruthy();
    });

    it('treats an accent-less or keyword match as exact too', async () => {
      const options: SelectOption[] = [
        { value: 'Škoda', label: 'Škoda', section: 'S' },
        { value: 'Volkswagen', label: 'Volkswagen', section: 'V', keywords: ['vw'] },
      ];
      const { view } = await renderScreen({ options, manualEntry: { onSubmit: jest.fn() } });
      await typeSearch(view, 'skoda');
      expect(view.queryByText(/^Use /)).toBeNull();
      expect(view.getByText('Škoda')).toBeTruthy();
      await typeSearch(view, 'VW');
      expect(view.queryByText(/^Use /)).toBeNull();
      expect(view.getByText('Volkswagen')).toBeTruthy();
    });
  });

  describe('the floating "Not listed?" pill (2026-10-12, owner request)', () => {
    const BUTTON = {
      label: 'Not listed? Type it in',
      accessibilityLabel: 'Not listed? Type your make in',
      sheetTitle: 'Type your car’s make',
      fieldLabel: 'Make',
      submitLabel: 'Use this make',
      helper: 'As it’s shown on your logbook (V5C)',
    };
    const withPill = (overrides: Partial<Parameters<typeof SelectScreen<string>>[0]> = {}) => {
      const onSubmit = jest.fn();
      return renderScreen({
        manualEntry: { onSubmit, maxLength: 40, button: BUTTON },
        ...overrides,
      }).then(
        (rendered) => ({ ...rendered, onSubmit }),
      );
    };
    const openBox = async (view: Awaited<ReturnType<typeof render>>) => {
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Not listed? Type your make in' }));
      });
    };

    it('floats over the list before anything is typed', async () => {
      const { view } = await withPill();
      expect(view.getByTestId('select-manual-pill')).toBeTruthy();
      expect(view.getByText('Not listed? Type it in')).toBeTruthy();
    });

    it('steps aside while searching — the "Use …" row offers the same', async () => {
      const { view } = await withPill();
      await typeSearch(view, 'Reliant');
      expect(view.queryByTestId('select-manual-pill')).toBeNull();
      expect(view.getByText('Use “Reliant”')).toBeTruthy();
    });

    it('opens a type-it-in sheet over the list', async () => {
      const { view } = await withPill();
      await openBox(view);
      expect(view.getByTestId('select-manual-entry')).toBeTruthy();
      expect(view.getByText('Type your car’s make')).toBeTruthy();
      const input = view.getByTestId('select-manual-input');
      // Focused once the sheet has risen, not mid-slide (no autoFocus).
      expect(input.props.autoFocus).toBeUndefined();
      expect(input.props.maxLength).toBe(40);
      expect(view.getByText('As it’s shown on your logbook (V5C)')).toBeTruthy();
      // …and spoken with the field, which TextField would otherwise not read.
      expect(input.props.accessibilityHint).toBe('As it’s shown on your logbook (V5C)');
      // The list stays behind the sheet — but out of a screen reader's
      // reach while it's up; only its pill steps aside.
      expect(view.getByText('BMW', { includeHiddenElements: true })).toBeTruthy();
      expect(view.queryByText('BMW')).toBeNull();
      expect(view.queryByTestId('select-manual-pill')).toBeNull();
    });

    it('carries over anything already typed in the search', async () => {
      const { view } = await withPill();
      await act(async () => {
        fireEvent.changeText(view.getByLabelText('Search'), 'Trab');
      });
      // Before the debounce, so the pill is still up.
      await openBox(view);
      expect(view.getByTestId('select-manual-input').props.value).toBe('Trab');
    });

    it('cannot be used blank', async () => {
      const { view, onSubmit } = await withPill();
      await openBox(view);
      const use = view.getByRole('button', { name: 'Use this make' });
      expect(use.props.accessibilityState).toMatchObject({ disabled: true });
      await act(async () => {
        fireEvent.changeText(view.getByTestId('select-manual-input'), '   ');
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Use this make' }));
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits the trimmed text and closes as a pick', async () => {
      const { view, onSubmit, onClose } = await withPill();
      await openBox(view);
      await act(async () => {
        fireEvent.changeText(view.getByTestId('select-manual-input'), '  Trabant ');
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Use this make' }));
      });
      expect(onSubmit).toHaveBeenCalledWith('Trabant');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('submits from the keyboard’s Done key too', async () => {
      const { view, onSubmit } = await withPill();
      await openBox(view);
      const input = view.getByTestId('select-manual-input');
      await act(async () => {
        fireEvent.changeText(input, 'Trabant');
      });
      await act(async () => {
        fireEvent(view.getByTestId('select-manual-input'), 'submitEditing');
      });
      expect(onSubmit).toHaveBeenCalledWith('Trabant');
    });

    it('Cancel closes the sheet, back to the list', async () => {
      const { view, onClose } = await withPill();
      await openBox(view);
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
      });
      expect(view.queryByTestId('select-manual-entry')).toBeNull();
      expect(view.getByText('BMW')).toBeTruthy();
      expect(view.getByTestId('select-manual-pill')).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('⚠️ a box submit is reported as a pick once closed — the wizard advances on it', async () => {
      const onClosed = jest.fn();
      const { view } = await withPill({ onClosed });
      await openBox(view);
      await act(async () => {
        fireEvent.changeText(view.getByTestId('select-manual-input'), 'Trabant');
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Use this make' }));
      });
      await act(async () => {
        view.rerender(
          <SelectScreen
            visible={false}
            title="Car make"
            options={MAKES}
            value={null}
            onSelect={jest.fn()}
            onClose={jest.fn()}
            manualEntry={{ onSubmit: jest.fn(), maxLength: 40, button: BUTTON }}
            onClosed={onClosed}
          />,
        );
      });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(onClosed).toHaveBeenCalledWith(true);
    });

    it('Android Back closes the sheet first, without closing the picker', async () => {
      const { view, onClose } = await withPill();
      await openBox(view);
      await act(async () => {
        fireEvent(view.getByTestId('select-screen-modal'), 'requestClose');
      });
      expect(view.queryByTestId('select-manual-entry')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      // A second Back, at the list, closes it.
      await act(async () => {
        fireEvent(view.getByTestId('select-screen-modal'), 'requestClose');
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps what was typed across Cancel and back again', async () => {
      const { view } = await withPill();
      await openBox(view);
      await act(async () => {
        fireEvent.changeText(view.getByTestId('select-manual-input'), 'Trabant');
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
      });
      await openBox(view);
      expect(view.getByTestId('select-manual-input').props.value).toBe('Trabant');
    });

    it('⚠️ a reopened picker starts at the list, never with the last sheet up', async () => {
      const { view } = await withPill();
      await openBox(view);
      const at = (visible: boolean) => (
        <SelectScreen
          visible={visible}
          title="Car make"
          options={MAKES}
          value={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          manualEntry={{ onSubmit: jest.fn(), maxLength: 40, button: BUTTON }}
        />
      );
      await act(async () => {
        view.rerender(at(false));
      });
      await act(async () => {
        view.rerender(at(true));
      });
      expect(view.queryByTestId('select-manual-entry')).toBeNull();
      expect(view.getByTestId('select-manual-pill')).toBeTruthy();
    });

    it('steps aside while the search is focused — the keyboard would sit on it', async () => {
      const { view } = await withPill();
      await act(async () => {
        fireEvent(view.getByLabelText('Search'), 'focus');
      });
      expect(view.queryByTestId('select-manual-pill')).toBeNull();
      await act(async () => {
        fireEvent(view.getByLabelText('Search'), 'blur');
      });
      expect(view.getByTestId('select-manual-pill')).toBeTruthy();
    });

    it('⚠️ bounds the search’s "Use …" row too — no way round the cap', async () => {
      const { view, onSubmit } = await withPill();
      expect(view.getByLabelText('Search').props.maxLength).toBe(40);
      // A paste that slipped past the input is still cut at the cap.
      const long = 'x'.repeat(45);
      await typeSearch(view, long);
      await act(async () => {
        fireEvent.press(view.getByText(`Use “${long}”`));
      });
      expect(onSubmit).toHaveBeenCalledWith('x'.repeat(40));
    });

    it('⚠️ closes the keyboard with the sheet — Cancel, Back, and a submit', async () => {
      // Owner report (2026-10-12): Cancel left the keyboard open.
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      const { view } = await withPill();
      await openBox(view);
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
      });
      expect(dismiss).toHaveBeenCalled();

      dismiss.mockClear();
      await openBox(view);
      await act(async () => {
        fireEvent(view.getByTestId('select-screen-modal'), 'requestClose');
      });
      expect(dismiss).toHaveBeenCalled();

      dismiss.mockClear();
      await openBox(view);
      await act(async () => {
        fireEvent.changeText(view.getByTestId('select-manual-input'), 'Trabant');
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Use this make' }));
      });
      expect(dismiss).toHaveBeenCalled();
      dismiss.mockRestore();
    });

    it('Cancel hands screen-reader focus back to the pill', async () => {
      const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
      const { view } = await withPill();
      await openBox(view);
      await act(async () => {
        jest.advanceTimersByTime(300); // the field's own focus, once risen
      });
      send.mockClear();
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
      });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
      send.mockRestore();
    });

    it('…but not after "Use this make" — the picker closes with the sheet', async () => {
      const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
      const { view } = await withPill();
      await openBox(view);
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      send.mockClear();
      await act(async () => {
        fireEvent.changeText(view.getByTestId('select-manual-input'), 'Trabant');
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Use this make' }));
      });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(send).not.toHaveBeenCalled();
      send.mockRestore();
    });

    it('comes back when the keyboard is closed without leaving the search (Android Back)', async () => {
      const handlers: Record<string, () => void> = {};
      const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
        name: string,
        handler: () => void,
      ) => {
        handlers[name] = handler;
        return { remove: jest.fn() };
      }) as unknown as typeof Keyboard.addListener);
      const { view } = await withPill();
      await act(async () => {
        fireEvent(view.getByLabelText('Search'), 'focus');
      });
      expect(view.queryByTestId('select-manual-pill')).toBeNull();
      // Back closes the keyboard; the search is never blurred.
      await act(async () => {
        handlers.keyboardDidHide?.();
      });
      expect(view.getByTestId('select-manual-pill')).toBeTruthy();
      spy.mockRestore();
    });
  });

  describe('pinnedLayout="grid" (popular tiles)', () => {
    const grid = {
      recentValues: ['bmw', 'audi'],
      pinnedTitle: 'Popular makes',
      pinnedLayout: 'grid' as const,
      allTitle: 'All makes',
    };
    const radios = (view: Awaited<ReturnType<typeof render>>) =>
      view.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel as string);

    it('draws the pinned values as tiles, in order, above "All makes" and the list', async () => {
      const { view } = await renderScreen(grid);
      expect(view.getByRole('header', { name: 'Popular makes' })).toBeTruthy();
      expect(view.getByRole('header', { name: 'All makes' })).toBeTruthy();
      // Tiles first (BMW, Audi), then the A–Z rows; each make appears once
      // as a tile and once in its section, not twice in a row at the top.
      expect(radios(view)).toEqual(['BMW', 'Audi', 'Aston Martin', 'Audi', 'BMW']);
    });

    it('checks the selected tile, and a tile press selects and closes', async () => {
      const { view, onSelect, onClose } = await renderScreen({ ...grid, value: 'audi' });
      const [bmwTile, audiTile] = view.getAllByRole('radio');
      expect(audiTile.props.accessibilityState).toMatchObject({ checked: true });
      expect(bmwTile.props.accessibilityState).toMatchObject({ checked: false });

      await act(async () => {
        fireEvent.press(bmwTile);
      });
      expect(onSelect).toHaveBeenCalledWith('bmw');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('⚠️ keeps the letter headers sticky with the grid above them', async () => {
      // The grid sits in the list's header cell, which FlatList counts as
      // cell 0. The letter headers (data 0 and 3) must stick at cells 1 and
      // 4; unshifted, the Any/grid header stuck instead (2026-09-30 regression).
      const withGrid = (await renderScreen(grid)).view;
      expect(withGrid.getByLabelText('Car make').props.stickyHeaderIndices).toEqual([1, 4]);
      const plain = (await renderScreen()).view;
      expect(plain.getByLabelText('Car make').props.stickyHeaderIndices).toEqual([0, 3]);
    });

    it('skips a pinned value that isn’t an option, and shows no grid if none is', async () => {
      const some = (await renderScreen({ ...grid, recentValues: ['tesla', 'bmw'] })).view;
      expect(radios(some)).toEqual(['BMW', 'Aston Martin', 'Audi', 'BMW']);

      const none = (await renderScreen({ ...grid, recentValues: ['tesla'] })).view;
      expect(none.queryByRole('header', { name: 'Popular makes' })).toBeNull();
      expect(none.queryByRole('header', { name: 'All makes' })).toBeNull();
    });

    it('in a filter: "Any make" first, then the tiles, then the rows', async () => {
      const { view } = await renderScreen({
        ...grid,
        anyOption: { label: 'Any make', onSelect: jest.fn() },
      });
      expect(radios(view)).toEqual(['Any make', 'BMW', 'Audi', 'Aston Martin', 'Audi', 'BMW']);
    });

    it('hides the tiles while searching: results are rows only', async () => {
      const { view } = await renderScreen(grid);
      await typeSearch(view, 'au');
      expect(view.queryByRole('header', { name: 'Popular makes' })).toBeNull();
      expect(radios(view)).toEqual(['Audi']);
    });
  });

  it('divides rows with a hairline, never beside a section header', async () => {
    const { view } = await renderScreen();
    // A: Aston Martin, Audi (one divider between); B: BMW alone (none).
    expect(view.getAllByTestId('select-row-divider')).toHaveLength(1);
  });

  describe('the "Any" row (filters)', () => {
    it('leads the list, is checked while nothing is chosen, and picks "no value"', async () => {
      const onAny = jest.fn();
      const { view, onSelect, onClose } = await renderScreen({
        anyOption: { label: 'Any make', onSelect: onAny },
      });
      const any = view.getByRole('radio', { name: 'Any make' });
      expect(any.props.accessibilityState).toMatchObject({ checked: true });

      await act(async () => {
        fireEvent.press(any);
      });
      expect(onAny).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('is unchecked once a value is chosen, and hidden while searching', async () => {
      const { view } = await renderScreen({
        value: 'audi',
        anyOption: { label: 'Any make', onSelect: jest.fn() },
      });
      expect(view.getByRole('radio', { name: 'Any make' }).props.accessibilityState).toMatchObject({
        checked: false,
      });
      await typeSearch(view, 'bm');
      expect(view.queryByRole('radio', { name: 'Any make' })).toBeNull();
    });
  });

  it('keeps content mounted through the exit window, then unmounts (fallback timer)', async () => {
    const { view } = await renderScreen();
    expect(view.getByText('BMW')).toBeTruthy();

    await act(async () => {
      view.rerender(
        <SelectScreen
          visible={false}
          title="Car make"
          options={MAKES}
          value={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });
    // The Modal shell stays mounted while the exit animation would be
    // running (reanimated animates a native snapshot; the React children
    // leave immediately)…
    expect(view.toJSON()).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(300); // past MOTION_MS
    });
    expect(view.toJSON()).toBeNull();
  });

  it('survives a stale exit callback landing after a fast close→reopen (regression)', async () => {
    const { view } = await renderScreen();
    const rerenderWith = (visible: boolean) =>
      view.rerender(
        <SelectScreen
          visible={visible}
          title="Car make"
          options={MAKES}
          value={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
        />,
      );

    // Close, then reopen before the exit animation would have finished.
    await act(async () => {
      rerenderWith(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
      rerenderWith(true);
    });

    // On-device, Reanimated now fires the OLD exit animation's callback.
    // It must NOT unmount the reopened screen…
    await act(async () => {
      mockExitCallbacks.forEach((callback) => callback(true));
    });
    expect(view.getByText('BMW')).toBeTruthy();

    // …and the screen must still be recoverable/usable afterwards.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(view.getByText('BMW')).toBeTruthy();
  });

  it('cancels the pending unmount when reopened within the exit window', async () => {
    const { view } = await renderScreen();
    const rerenderWith = (visible: boolean) =>
      view.rerender(
        <SelectScreen
          visible={visible}
          title="Car make"
          options={MAKES}
          value={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
        />,
      );

    await act(async () => {
      rerenderWith(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(100); // inside the exit window
      rerenderWith(true);
    });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(view.getByText('BMW')).toBeTruthy();
  });

  it('shows the empty state for a fruitless search and clears it', async () => {
    const { view } = await renderScreen();

    await typeSearch(view, 'zonda');
    expect(view.getByText('No matches for “zonda”')).toBeTruthy();

    // Two controls legitimately share this name (search-bar icon + empty-state
    // action, identical behaviour); exercise the empty-state one (last in tree).
    const clearButtons = view.getAllByRole('button', { name: 'Clear search' });
    await act(async () => {
      fireEvent.press(clearButtons[clearButtons.length - 1]);
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(view.getByText('BMW')).toBeTruthy();
  });
});
