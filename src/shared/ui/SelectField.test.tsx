/**
 * WHAT:  Tests for SelectField — placeholder vs selected-value rendering,
 *        the composed screen-reader label, and the open → pick → close loop
 *        returning the value through onChange.
 * WHY:   This is the piece forms actually mount; if the trigger renders the
 *        wrong value or the selection loop drops the choice, every select-
 *        backed form field breaks identically.
 * LINKS: src/shared/ui/SelectField.tsx, src/shared/ui/SelectScreen.tsx,
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SelectField } from './SelectField';
import type { SelectOption } from './selectOptions';

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
    chain.withCallback = () => chain;
    return chain;
  };
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (fn: unknown) => fn, quad: () => 0 },
    ReduceMotion: { System: 'system' },
    FadeIn: builder(),
    FadeOut: builder(),
    SlideInDown: builder(),
    SlideOutDown: builder(),
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
  };
});

const COLOURS: SelectOption[] = [
  { value: 'sage', label: 'Sage' },
  { value: 'sand', label: 'Sand' },
];

describe('SelectField', () => {
  it('shows the placeholder while nothing is selected, and the label + value after', async () => {
    const first = await render(
      <SelectField label="Colour" placeholder="Pick a colour" options={COLOURS} value={null} onChange={() => {}} />,
    );
    expect(first.getByText('Pick a colour')).toBeTruthy();

    const second = await render(
      <SelectField label="Colour" options={COLOURS} value="sage" onChange={() => {}} />,
    );
    expect(second.getByText('Colour')).toBeTruthy();
    expect(second.getByText('Sage')).toBeTruthy();
  });

  it('composes the screen-reader label from label and selection state', async () => {
    const empty = await render(
      <SelectField label="Colour" options={COLOURS} value={null} onChange={() => {}} />,
    );
    expect(empty.getByLabelText('Colour, not selected, opens selection screen')).toBeTruthy();

    const chosen = await render(
      <SelectField label="Colour" options={COLOURS} value="sand" onChange={() => {}} />,
    );
    expect(chosen.getByLabelText('Colour, Sand, opens selection screen')).toBeTruthy();
  });

  it('opens the screen, returns the picked value, and closes', async () => {
    const onChange = jest.fn();
    const view = await render(
      <SelectField label="Colour" options={COLOURS} value={null} onChange={onChange} />,
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText('Colour, not selected, opens selection screen'));
    });
    expect(view.getByText('Sand')).toBeTruthy(); // screen is open

    await act(async () => {
      fireEvent.press(view.getByText('Sand'));
    });

    expect(onChange).toHaveBeenCalledWith('sand');
  });
});
