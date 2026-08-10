/**
 * WHAT:  Tests for SeenRangeFields — the From/To last-seen pair: date-only
 *        pickers, no moment presets, and the ordering it enforces.
 * WHY:   Ordering is the only real logic here and it fails SILENTLY: an
 *        inverted window is a perfectly valid criteria object that simply
 *        matches nothing, so the user reads "No cars match" as a fact about the
 *        world rather than a broken control. The date-only assertions matter
 *        because a time-of-day bound would imply a precision the filter does
 *        not use.
 * LINKS: src/features/search-map/components/SeenRangeFields.tsx;
 *        src/features/search-map/components/YearRangeFields.test.tsx (sibling).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SeenRangeFields } from './SeenRangeFields';
import { startOfLocalDayIso } from '../lib/searchCriteria';

/** Stub picker: a pressable per field that emits a fixed instant. */
jest.mock('@/shared/ui/DateTimeField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text, View } = require('react-native');
  return {
    DateTimeField: ({ label, value, onChange, mode, presets }: Record<string, unknown>) =>
      React.createElement(
        View,
        { testID: `field-${label}` },
        React.createElement(Text, { testID: `mode-${label}` }, String(mode)),
        React.createElement(
          Text,
          { testID: `presets-${label}` },
          String((presets as unknown[])?.length ?? 'default'),
        ),
        React.createElement(Text, { testID: `value-${label}` }, String(value ?? 'none')),
        React.createElement(
          Text,
          {
            testID: `pick-${label}`,
            onPress: () => (onChange as CallableFunction)(mockPicked),
          },
          'pick',
        ),
      ),
  };
});

// eslint-disable-next-line no-var
var mockPicked = new Date(2026, 4, 10, 14, 30).toISOString();

const MAY_1 = startOfLocalDayIso(new Date(2026, 4, 1));
const MAY_10 = startOfLocalDayIso(new Date(2026, 4, 10));
const MAY_20 = startOfLocalDayIso(new Date(2026, 4, 20));

async function renderRange(from: string | null = null, to: string | null = null) {
  const onChange = jest.fn();
  const view = await render(<SeenRangeFields from={from} to={to} onChange={onChange} />);
  return { view, onChange };
}

describe('SeenRangeFields', () => {
  it('picks DATES, not date-times, and hides the moment presets', async () => {
    const { view } = await renderRange();

    expect(view.getByTestId('mode-From').props.children).toBe('date');
    expect(view.getByTestId('mode-To').props.children).toBe('date');
    // DEFAULT_DATE_TIME_PRESETS are "Just now"/"Yesterday" — shaped for "when
    // did you last see your car", meaningless as a range bound.
    expect(view.getByTestId('presets-From').props.children).toBe('0');
    expect(view.getByTestId('presets-To').props.children).toBe('0');
  });

  it('normalises a picked instant to the START of that local day', async () => {
    // The stub emits 14:30; the window must anchor to 00:00 so the day the user
    // tapped is fully included.
    const { view, onChange } = await renderRange();

    await act(async () => {
      fireEvent.press(view.getByTestId('pick-From'));
    });

    expect(onChange).toHaveBeenCalledWith({ seenFrom: MAY_10, seenTo: null });
  });

  it('pushes To UP when From is moved past it', async () => {
    const { view, onChange } = await renderRange(MAY_1, MAY_1);

    await act(async () => {
      fireEvent.press(view.getByTestId('pick-From')); // 10 May, past the 1 May ceiling
    });

    expect(onChange).toHaveBeenCalledWith({ seenFrom: MAY_10, seenTo: MAY_10 });
  });

  it('pulls From DOWN when To is moved before it', async () => {
    const { view, onChange } = await renderRange(MAY_20, MAY_20);

    await act(async () => {
      fireEvent.press(view.getByTestId('pick-To')); // 10 May, before the 20 May floor
    });

    expect(onChange).toHaveBeenCalledWith({ seenFrom: MAY_10, seenTo: MAY_10 });
  });

  it('leaves a valid window alone', async () => {
    const { view, onChange } = await renderRange(MAY_1, MAY_20);

    await act(async () => {
      fireEvent.press(view.getByTestId('pick-From')); // 10 May, inside the window
    });

    // 10 May <= 20 May, so the ceiling must not move.
    expect(onChange).toHaveBeenCalledWith({ seenFrom: MAY_10, seenTo: MAY_20 });
  });
});
