/**
 * WHAT:  Tests for YearField — placeholder vs selected-year rendering, the
 *        open → pick loop returning the year as a NUMBER, and the "Not sure"
 *        row clearing the optional year to null.
 * WHY:   Year is a nullable integer bounded by the posts.year CHECK; the picker
 *        must emit an int (not a string) and preserve the ability to blank it,
 *        or the year lands wrong (or un-clearable) on the post.
 * LINKS: src/features/vehicles/post/components/YearField.tsx;
 *        src/shared/ui/SelectField.tsx, src/shared/ui/SelectScreen.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { YearField } from './YearField';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.easing = () => chain;
    chain.reduceMotion = () => chain;
    chain.delay = () => chain;
    chain.withCallback = () => chain;
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

const CURRENT_YEAR = new Date().getFullYear();

describe('YearField', () => {
  it('shows the placeholder when no year is set, and the year once picked', async () => {
    const empty = await render(<YearField value={null} onChange={() => {}} />);
    expect(empty.getByText('Select the year')).toBeTruthy();

    const set = await render(<YearField value={2019} onChange={() => {}} />);
    expect(set.getByText('2019')).toBeTruthy();
  });

  it('opens the picker and returns the chosen year as a number', async () => {
    const onChange = jest.fn();
    const view = await render(<YearField value={null} onChange={onChange} />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Year, not selected, opens selection screen'));
    });
    // Newest year leads the browse list.
    await act(async () => {
      fireEvent.press(view.getByText(String(CURRENT_YEAR)));
    });

    expect(onChange).toHaveBeenCalledWith(CURRENT_YEAR);
    expect(typeof onChange.mock.calls[0][0]).toBe('number');
  });

  it('clears the optional year via the "Not sure" row', async () => {
    const onChange = jest.fn();
    const view = await render(<YearField value={2019} onChange={onChange} />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Year, 2019, opens selection screen'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Not sure'));
    });

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
