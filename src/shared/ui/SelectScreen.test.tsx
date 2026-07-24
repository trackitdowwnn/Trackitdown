/**
 * WHAT:  Tests for SelectScreen — debounced filtering, selection returning
 *        the chosen value and closing, the selected row's checked state,
 *        and the empty-search state with its clear action.
 * WHY:   Every select in the app funnels choices through this screen; a
 *        filter that eats matches or a selection that returns the wrong
 *        value would corrupt form data app-wide.
 * LINKS: src/shared/ui/SelectScreen.tsx, src/shared/ui/selectOptions.ts,
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SelectScreen } from './SelectScreen';
import type { SelectOption } from './selectOptions';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

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

    it('shows no standing manual row until the user types (only "Use "<query>"")', async () => {
      const { view } = await renderScreen({ manualEntry: { onSubmit: jest.fn() } });
      // No always-present "isn't listed" row, and no "Use "<query>"" until typing.
      expect(view.queryByText(/isn’t listed/)).toBeNull();
      expect(view.queryByText(/^Use /)).toBeNull();
    });

    it('does NOT offer "Use "<query>"" when the query exactly matches a listed make', async () => {
      const { view } = await renderScreen({ manualEntry: { onSubmit: jest.fn() } });
      await typeSearch(view, 'audi');
      expect(view.queryByText(/^Use /)).toBeNull();
      expect(view.getByText('Audi')).toBeTruthy();
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
