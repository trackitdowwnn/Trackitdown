/**
 * WHAT:  Tests for DateRangeField:
 *          - the pure range rules (describeRange, speakRange, nextRange);
 *          - the field: its name kept when empty, the spoken summary, opening on
 *            the range's month;
 *          - the sheet: Airbnb's tap order, the always-present hint, Apply (a
 *            NEW lone start is one day, a stored open-ended range stays open),
 *            Clear dates;
 *          - noFuture (today read when the sheet opens);
 *          - the haptic and announcement on commit.
 * WHY:   The search's absolute window comes from here. The failures that
 *        matter:
 *          - a tap order that builds an inverted range, which silently matches
 *            nothing;
 *          - Apply reshaping a range the user didn't touch;
 *          - no way back to "any dates" (the old field's gap).
 *        Expected date strings are built with dayShortLabel, not typed out:
 *        ICU versions disagree on "Sep" vs "Sept".
 * LINKS: src/shared/ui/DateRangeField.tsx; src/shared/ui/CalendarMonth.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { dayShortLabel } from '../lib/calendarDates';
import { lightHaptic } from '../lib/haptics';
import { DateRangeField, describeRange, nextRange, speakRange, type DayRange } from './DateRangeField';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The visibility-aware gorhom boundary from the BottomSheet suite.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    wedged = false;
    present = () => {
      if (this.wedged) return;
      this.setState({ visible: true });
    };
    dismiss = () => {
      if (!this.state.visible) {
        this.wedged = true;
        return;
      }
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});

jest.mock('../lib/haptics', () => ({ lightHaptic: jest.fn() }));

/** Tue 29 Sep 2026. */
const NOW = new Date(2026, 8, 29, 10, 0);
const day = (date: number, month = 'September') => new RegExp(`^\\w+,? ${date} ${month} 2026`);
const short = (id: string) => dayShortLabel(id, NOW);
const EMPTY = 'Dates seen, any dates, pick dates';

function Harness({
  initial = { from: null, to: null },
  onChange,
  noFuture = false,
}: {
  initial?: DayRange;
  onChange: (r: DayRange) => void;
  noFuture?: boolean;
}) {
  const [value, setValue] = useState<DayRange>(initial);
  return (
    <DateRangeField
      label="Dates seen"
      value={value}
      maxDay={noFuture ? null : '2026-09-29'}
      noFuture={noFuture}
      onChange={(range) => {
        setValue(range);
        onChange(range);
      }}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.mocked(lightHaptic).mockClear();
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('range rules', () => {
  it('describes a range the way the field shows it', () => {
    expect(describeRange({ from: '2026-07-11', to: '2026-08-02' }, NOW)).toBe('11 Jul – 2 Aug');
    expect(describeRange({ from: '2026-07-11', to: '2026-07-11' }, NOW)).toBe('11 Jul');
    expect(describeRange({ from: '2026-07-11', to: null }, NOW)).toBe('From 11 Jul');
    expect(describeRange({ from: null, to: '2026-07-11' }, NOW)).toBe('Until 11 Jul');
    expect(describeRange({ from: null, to: null }, NOW)).toBeNull();
  });

  it('speaks a range in full words, with "to" for the dash', () => {
    expect(speakRange({ from: '2026-07-11', to: '2026-08-02' }, NOW)).toBe('11 July to 2 August');
    expect(speakRange({ from: '2025-12-24', to: '2026-01-02' }, NOW)).toBe('24 December 2025 to 2 January');
  });

  it('follows the Airbnb tap order', () => {
    expect(nextRange({ from: null, to: null }, '2026-09-10')).toEqual({ from: '2026-09-10', to: null });
    expect(nextRange({ from: '2026-09-10', to: null }, '2026-09-14')).toEqual({ from: '2026-09-10', to: '2026-09-14' });
    // On or before the start: start again, never an inverted range.
    expect(nextRange({ from: '2026-09-10', to: null }, '2026-09-08')).toEqual({ from: '2026-09-08', to: null });
    expect(nextRange({ from: '2026-09-10', to: null }, '2026-09-10')).toEqual({ from: '2026-09-10', to: null });
    // After a finished range: start again.
    expect(nextRange({ from: '2026-09-10', to: '2026-09-14' }, '2026-09-20')).toEqual({ from: '2026-09-20', to: null });
  });
});

describe('DateRangeField', () => {
  it('keeps its name when empty, and speaks the range when set', async () => {
    const empty = await render(<Harness onChange={jest.fn()} />);
    expect(empty.getByRole('button', { name: EMPTY })).toBeTruthy();
    expect(empty.getByText('Any dates')).toBeTruthy();

    const set = await render(<Harness initial={{ from: '2026-07-11', to: '2026-08-02' }} onChange={jest.fn()} />);
    expect(set.getByText('Dates seen')).toBeTruthy();
    expect(set.getByText('11 Jul – 2 Aug')).toBeTruthy();
    expect(set.getByRole('button', { name: 'Dates seen, 11 July to 2 August, change dates' })).toBeTruthy();
  });

  it('builds a range in the sheet, with a hint at every stage, and applies it', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);

    await fireEvent.press(view.getByRole('button', { name: EMPTY }));
    expect(view.getByRole('header', { name: 'September 2026' })).toBeTruthy();
    expect(view.getByText('No dates picked')).toBeTruthy();
    expect(view.getByText('Tap a day to start.')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Apply' }).props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(view.getByRole('button', { name: day(10) }));
    expect(view.getByText(`From ${short('2026-09-10')}`)).toBeTruthy();
    expect(view.getByText('Tap a later day to add an end date, or apply for just this day.')).toBeTruthy();

    await fireEvent.press(view.getByRole('button', { name: day(14) }));
    expect(view.getByText(`${short('2026-09-10')} – ${short('2026-09-14')}`)).toBeTruthy();
    expect(view.getByText('Tap any day to start again.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled(); // still a draft

    await fireEvent.press(view.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-10', to: '2026-09-14' });
    expect(lightHaptic).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('Dates seen, 10 September to 14 September');
    expect(view.queryByRole('header', { name: 'Pick dates' })).toBeNull();
    announce.mockRestore();
  });

  it('applies a NEW lone start as that one day', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);

    await fireEvent.press(view.getByRole('button', { name: EMPTY }));
    await fireEvent.press(view.getByRole('button', { name: day(10) }));
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-10', to: '2026-09-10' });
  });

  it('leaves a stored open-ended range alone when applied unchanged', async () => {
    // "From 11 Jul" can come from an older version, which allowed From alone.
    const onChange = jest.fn();
    const view = await render(<Harness initial={{ from: '2026-07-11', to: null }} onChange={onChange} />);

    await fireEvent.press(view.getByRole('button', { name: /change dates$/ }));
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith({ from: '2026-07-11', to: null });
  });

  it('opens on the stored range and clears it', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness initial={{ from: '2026-07-11', to: '2026-08-02' }} onChange={onChange} />);

    await fireEvent.press(view.getByRole('button', { name: /change dates$/ }));
    // Opens on the month of the range's end.
    expect(view.getByRole('header', { name: 'August 2026' })).toBeTruthy();
    expect(view.getByRole('button', { name: day(2, 'August') }).props.accessibilityLabel).toMatch(/end of range$/);

    await fireEvent.press(view.getByRole('button', { name: 'Clear dates' }));
    expect(onChange).toHaveBeenCalledWith({ from: null, to: null });
    expect(view.getByRole('button', { name: EMPTY })).toBeTruthy();
  });

  it('never offers a day after maxDay', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);
    await fireEvent.press(view.getByRole('button', { name: EMPTY }));
    expect(view.getByRole('button', { name: day(30) }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('with noFuture, reads today when the sheet opens, not when it first rendered', async () => {
    const view = await render(<Harness noFuture onChange={jest.fn()} />);

    // The field sat on screen past midnight: it is now Wednesday 30 September.
    jest.setSystemTime(new Date(2026, 8, 30, 0, 5));
    await fireEvent.press(view.getByRole('button', { name: EMPTY }));

    const wednesday = view.getByRole('button', { name: day(30) });
    expect(wednesday.props.accessibilityState).toMatchObject({ disabled: false });
    expect(wednesday.props.accessibilityLabel).toMatch(/, today$/);
    expect(view.getByRole('button', { name: 'Next month, October 2026' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
