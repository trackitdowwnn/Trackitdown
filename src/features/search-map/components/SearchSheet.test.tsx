/**
 * WHAT:  Tests for SearchSheet — the footer count label + apply, the
 *        no-results guidance, assembling criteria (a suggestion sets the make),
 *        the bounty quick chip, and Clear all. Heavy children (the pickers, the
 *        range slider) and the live-count hook are mocked at the boundary.
 * WHY:   The surface is where a whole query is assembled then applied once; a
 *        wiring slip would apply the wrong criteria or a stale count.
 * LINKS: src/features/search-map/components/SearchSheet.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SearchSheet } from './SearchSheet';
import { emptyCriteria } from '../lib/searchCriteria';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useRef } = require('react');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.reduceMotion = () => chain;
    return chain;
  };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    FadeIn: builder(),
    LinearTransition: builder(),
    ReduceMotion: { System: 'system' },
    Extrapolation: { CLAMP: 'clamp' },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    withSpring: (value: unknown) => value,
    interpolate: (_value: number, _input: number[], output: number[]) => output[0],
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
  };
});

// The pickers pull the full SelectScreen/native graph — stub the whole
// vehicles feature barrel to just the two fields SearchSheet imports.
jest.mock('@/features/vehicles', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text } = require('react-native');
  return {
    MakeField: ({ value }: { value: string | null }) =>
      React.createElement(Text, null, `make:${value ?? 'none'}`),
    ModelField: ({ value }: { value: string | null }) =>
      React.createElement(Text, null, `model:${value ?? 'none'}`),
  };
});

// Stub TextField + MoneyRangeSlider; keep the real (pure) ChoiceChips.
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { TextInput, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { ChoiceChips } = require('@/shared/ui/ChoiceChips');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Button } = require('@/shared/ui/Button');
  return {
    UK_DEFAULT_REGION: { latitude: 54.5, longitude: -2.5, latitudeDelta: 9, longitudeDelta: 9 },
    ChoiceChips,
    Button,
    TextField: ({ value, onChangeText, testID }: Record<string, unknown>) =>
      React.createElement(TextInput, { testID, value, onChangeText }),
    MoneyRangeSlider: () => React.createElement(Text, null, 'range-slider'),
  };
});

let mockCountState = { count: 5 as number | null, counting: false };
jest.mock('../hooks/useSearchCount', () => ({
  useSearchCount: () => mockCountState,
}));

const REGION = { latitude: 51.77, longitude: -0.34, latitudeDelta: 0.5, longitudeDelta: 0.5 };

async function renderSheet(onApply = jest.fn(), onClose = jest.fn()) {
  const view = await render(
    <SearchSheet
      initialCriteria={emptyCriteria()}
      region={REGION}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { view, onApply, onClose };
}

/** The primary apply CTA (shared Button — matched by its dynamic label). */
const applyButton = (view: Awaited<ReturnType<typeof render>>) =>
  view.getByRole('button', { name: /^(Show|No cars match|Searching)/ });

beforeEach(() => {
  mockCountState = { count: 5, counting: false };
});

describe('SearchSheet footer', () => {
  it('shows the live count on the apply button and applies criteria + region', async () => {
    const { view, onApply } = await renderSheet();
    expect(view.getByText('Show 5 cars')).toBeTruthy();

    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    const [criteria, region] = onApply.mock.calls[0];
    expect(criteria).toMatchObject({ text: '', make: null });
    // "Any" distance keeps the current view (no teleport).
    expect(region).toMatchObject({ latitude: 51.77, longitude: -0.34 });
  });

  it('shows a spinner on the apply button while a count is in flight', async () => {
    mockCountState = { count: 3, counting: true };
    const { view } = await renderSheet();
    // The shared Button reports `busy` while loading.
    expect(applyButton(view).props.accessibilityState).toMatchObject({ busy: true });
  });

  it('shows guidance and disables apply when nothing matches', async () => {
    mockCountState = { count: 0, counting: false };
    const { view, onApply } = await renderSheet();

    expect(view.getByText(/try widening the bounty or distance/)).toBeTruthy();
    expect(applyButton(view).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('assembling criteria', () => {
  it('the £500+ quick chip sets the bounty floor', async () => {
    const { view, onApply } = await renderSheet();
    // Bounty is a collapsed accordion card — expand it to reach the chip.
    await act(async () => {
      fireEvent.press(view.getByTestId('section-bounty'));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('£500+'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    const [criteria] = onApply.mock.calls[0];
    expect(criteria.bountyMinPence).toBe(50000);
  });

  it('Clear all resets the assembled criteria', async () => {
    const { view, onApply } = await renderSheet();
    // Set a facet, then Clear all should reset it.
    await act(async () => {
      fireEvent.press(view.getByTestId('section-bounty'));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('£500+'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('search-clear-all'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    const [criteria] = onApply.mock.calls[0];
    expect(criteria.bountyMinPence).toBe(5000);
  });

  it('closes without applying via the ×', async () => {
    const { view, onApply, onClose } = await renderSheet();
    await act(async () => {
      fireEvent.press(view.getByTestId('search-close'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
