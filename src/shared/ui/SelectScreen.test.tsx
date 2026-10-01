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

import { SelectScreen, fitAnchors } from './SelectScreen';
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
