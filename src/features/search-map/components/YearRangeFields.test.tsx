/**
 * WHAT:  Tests for YearRangeFields — the From/To year pair: the option list it
 *        offers, and the ORDERING it enforces on the pair.
 * WHY:   The ordering is the only real logic in the component, and getting it
 *        wrong fails silently: an inverted range (from 2022, to 2018) is a
 *        perfectly valid criteria object that simply matches nothing, so the
 *        user sees "No cars match" and blames the data rather than the control.
 *        SelectField is stubbed at the boundary — it opens a full-screen
 *        picker, and what matters here is the value that comes back out.
 * LINKS: src/features/search-map/components/YearRangeFields.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { YearRangeFields } from './YearRangeFields';

/**
 * Stub picker: renders one pressable per option, keyed by the field's label, so
 * a test can pick an exact year without driving SelectScreen.
 */
jest.mock('@/shared/ui/SelectField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text, View } = require('react-native');
  return {
    SelectField: ({ label, options, value, onChange }: Record<string, unknown>) =>
      React.createElement(
        View,
        { testID: `field-${label}` },
        React.createElement(Text, null, `${label}:${value ?? 'none'}`),
        (options as { value: number; label: string }[]).map((option) =>
          React.createElement(
            Text,
            {
              key: option.value,
              testID: `${label}-${option.value}`,
              onPress: () => (onChange as CallableFunction)(option.value),
            },
            option.label,
          ),
        ),
      ),
  };
});

const CURRENT_YEAR = new Date().getFullYear();

async function renderFields(from: number | null = null, to: number | null = null) {
  const onChange = jest.fn();
  const view = await render(<YearRangeFields from={from} to={to} onChange={onChange} />);
  return { view, onChange };
}

describe('YearRangeFields', () => {
  it('offers "Any" plus every year from now back to the 1900 floor', async () => {
    const { view } = await renderFields();

    // The floor mirrors posts_year_range_chk — no real car, classics included,
    // is un-searchable.
    expect(view.getByTestId('From--1')).toBeTruthy(); // the Any sentinel
    expect(view.getByTestId('From-1900')).toBeTruthy();
    expect(view.getByTestId(`From-${CURRENT_YEAR}`)).toBeTruthy();
    // No future years: a car built after now does not exist.
    expect(view.queryByTestId(`From-${CURRENT_YEAR + 1}`)).toBeNull();
  });

  it('sets each bound independently', async () => {
    const { view, onChange } = await renderFields();

    await act(async () => {
      fireEvent.press(view.getByTestId('From-2018'));
    });
    expect(onChange).toHaveBeenCalledWith({ yearFrom: 2018, yearTo: null });

    await act(async () => {
      fireEvent.press(view.getByTestId('To-2022'));
    });
    expect(onChange).toHaveBeenLastCalledWith({ yearFrom: null, yearTo: 2022 });
  });

  it('pushes To UP when From is raised above it', async () => {
    // The failure this prevents: {from: 2022, to: 2018} is a valid object that
    // matches nothing, so the user reads "No cars match" as a fact about the
    // world rather than a broken control.
    const { view, onChange } = await renderFields(2015, 2018);

    await act(async () => {
      fireEvent.press(view.getByTestId('From-2022'));
    });

    expect(onChange).toHaveBeenCalledWith({ yearFrom: 2022, yearTo: 2022 });
  });

  it('pulls From DOWN when To is lowered below it', async () => {
    const { view, onChange } = await renderFields(2020, 2022);

    await act(async () => {
      fireEvent.press(view.getByTestId('To-2016'));
    });

    expect(onChange).toHaveBeenCalledWith({ yearFrom: 2016, yearTo: 2016 });
  });

  it('leaves a valid range alone', async () => {
    const { view, onChange } = await renderFields(2015, 2022);

    await act(async () => {
      fireEvent.press(view.getByTestId('From-2018'));
    });

    // 2018 <= 2022, so the ceiling must NOT move.
    expect(onChange).toHaveBeenCalledWith({ yearFrom: 2018, yearTo: 2022 });
  });

  it('clearing one bound never drags the other with it', async () => {
    const { view, onChange } = await renderFields(2018, 2022);

    await act(async () => {
      fireEvent.press(view.getByTestId('From--1')); // "Any"
    });
    // Open-ended below, still capped above — clearing the floor must not also
    // clear the ceiling the user set separately.
    expect(onChange).toHaveBeenCalledWith({ yearFrom: null, yearTo: 2022 });

    await act(async () => {
      fireEvent.press(view.getByTestId('To--1'));
    });
    expect(onChange).toHaveBeenLastCalledWith({ yearFrom: 2018, yearTo: null });
  });
});
