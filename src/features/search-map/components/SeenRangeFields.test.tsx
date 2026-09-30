/**
 * WHAT:  Tests for SeenRangeFields, the adapter between the search criteria's
 *        start-of-local-day instants and DateRangeField's day IDs. Covers both
 *        directions, Clear, and the "no future" bound.
 * WHY:   The conversion is the only logic here, and a slip fails SILENTLY. A
 *        day ID parsed as UTC, or an instant read in the wrong zone, shifts the
 *        window by a day. The user then reads "No cars match" as a fact about
 *        the world rather than a broken control. The field's own behaviour is
 *        covered in DateRangeField.test.tsx.
 * LINKS: src/features/search-map/components/SeenRangeFields.tsx;
 *        src/shared/ui/DateRangeField.tsx.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { SeenRangeFields } from './SeenRangeFields';
import { startOfLocalDayIso } from '../lib/searchCriteria';

/** Stub field: shows the day IDs it was given, and emits a fixed range. */
jest.mock('@/shared/ui/DateRangeField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text, View } = require('react-native');
  return {
    DateRangeField: ({ value, onChange, noFuture }: Record<string, unknown>) => {
      const range = value as { from: string | null; to: string | null };
      return React.createElement(
        View,
        null,
        React.createElement(Text, { testID: 'from' }, String(range.from)),
        React.createElement(Text, { testID: 'to' }, String(range.to)),
        React.createElement(Text, { testID: 'no-future' }, String(noFuture)),
        React.createElement(
          Text,
          { testID: 'apply', onPress: () => (onChange as CallableFunction)({ from: '2026-05-01', to: '2026-05-10' }) },
          'apply',
        ),
        React.createElement(
          Text,
          { testID: 'clear', onPress: () => (onChange as CallableFunction)({ from: null, to: null }) },
          'clear',
        ),
      );
    },
  };
});

const MAY_1 = startOfLocalDayIso(new Date(2026, 4, 1));
const MAY_10 = startOfLocalDayIso(new Date(2026, 4, 10));

describe('SeenRangeFields', () => {
  it('hands the field local day IDs, whatever the stored instant', async () => {
    const view = await render(<SeenRangeFields from={MAY_1} to={MAY_10} onChange={jest.fn()} />);
    expect(view.getByTestId('from').props.children).toBe('2026-05-01');
    expect(view.getByTestId('to').props.children).toBe('2026-05-10');
  });

  it('stores what the field picks as start-of-local-day instants', async () => {
    const onChange = jest.fn();
    const view = await render(<SeenRangeFields from={null} to={null} onChange={onChange} />);

    await fireEvent.press(view.getByTestId('apply'));

    expect(onChange).toHaveBeenCalledWith({ seenFrom: MAY_1, seenTo: MAY_10 });
  });

  it('clears both bounds', async () => {
    const onChange = jest.fn();
    const view = await render(<SeenRangeFields from={MAY_1} to={MAY_10} onChange={onChange} />);

    await fireEvent.press(view.getByTestId('clear'));

    expect(onChange).toHaveBeenCalledWith({ seenFrom: null, seenTo: null });
  });

  it('never lets a range reach past today', async () => {
    // noFuture, not a maxDay computed at render: the field reads "today" when
    // its sheet opens (DateRangeField.test.tsx covers that).
    const view = await render(<SeenRangeFields from={null} to={null} onChange={jest.fn()} />);
    expect(view.getByTestId('no-future').props.children).toBe('true');
  });
});
