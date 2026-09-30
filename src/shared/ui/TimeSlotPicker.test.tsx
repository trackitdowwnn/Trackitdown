/**
 * WHAT:  Tests for TimeSlotPicker (part-of-day segments, a large time with
 *        − / + steppers):
 *          - the segments jump to the middle of their part of the day, and
 *            parts of today still ahead aren't shown;
 *          - the steppers move 15 minutes, stop at the day's first slot and at
 *            now, and repeat while held;
 *          - the large time is one adjustable element (swipe up / down);
 *          - "about N hours ago";
 *          - a detent tick per step.
 * WHY:   A future time on offer would let a false last-seen time onto a live
 *        post. A stepper that ran past now, or a jump into a part of the day
 *        that hasn't happened, would do the same through a different door.
 * LINKS: src/shared/ui/TimeSlotPicker.tsx; src/shared/lib/calendarDates.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { TimeOfDay } from '../lib/calendarDates';
import { formatClock } from '../lib/dateTimeLabel';
import { selectionHaptic } from '../lib/haptics';
import { aboutAgo, splitMeridiem, TimeSlotPicker } from './TimeSlotPicker';

jest.mock('../lib/haptics', () => ({ selectionHaptic: jest.fn() }));

/** Tue 29 Sep 2026, 14:37. */
const NOW = new Date(2026, 8, 29, 14, 37);
const clock = (date: number, hour: number, minute = 0) =>
  formatClock(new Date(2026, 8, date, hour, minute).toISOString());
type Stateful = { props: { accessibilityState?: { checked?: boolean; disabled?: boolean } } };
const checked = (element: Stateful) => element.props.accessibilityState?.checked === true;
const disabled = (element: Stateful) => element.props.accessibilityState?.disabled === true;

/** Holds the value as a parent would, so the picker re-renders with it. */
function Harness({ day, initial, onChange = jest.fn() }: { day: string; initial: TimeOfDay; onChange?: (t: TimeOfDay) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeSlotPicker
      day={day}
      value={value}
      now={NOW}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const shownTime = (view: { getByRole: (role: string, options: { name: string }) => { props: { accessibilityValue?: { text?: string } } } }) =>
  view.getByRole('adjustable', { name: 'Time' }).props.accessibilityValue?.text ?? '';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.mocked(selectionHaptic).mockClear();
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('aboutAgo', () => {
  it('puts the gap in plain words, rounded down', () => {
    expect(aboutAgo(new Date(2026, 8, 29, 14, 36, 30), NOW)).toBe('just now');
    expect(aboutAgo(new Date(2026, 8, 29, 14, 15), NOW)).toBe('about 22 minutes ago');
    expect(aboutAgo(new Date(2026, 8, 29, 13, 30), NOW)).toBe('about 1 hour ago');
    expect(aboutAgo(new Date(2026, 8, 28, 21, 0), NOW)).toBe('about 17 hours ago');
    expect(aboutAgo(new Date(2026, 8, 25, 21, 0), NOW)).toBe('about 3 days ago');
  });
});

describe('splitMeridiem', () => {
  it('sets AM / PM apart from the digits, whatever space ICU used', () => {
    expect(splitMeridiem('21:15')).toEqual(['21:15', null]);
    expect(splitMeridiem('9:15 pm')).toEqual(['9:15', 'pm']);
    expect(splitMeridiem('9:15 PM')).toEqual(['9:15', 'PM']);
    expect(splitMeridiem('12:45 a.m.')).toEqual(['12:45', 'a.m.']);
  });
});

describe('TimeSlotPicker', () => {
  it('shows the four parts of the day and one large time', async () => {
    const view = await render(<Harness day="2026-09-28" initial={{ hour: 21, minute: 0 }} />);

    for (const part of ['Night', 'Morning', 'Afternoon', 'Evening']) {
      expect(view.getByRole('radio', { name: part })).toBeTruthy();
    }
    expect(checked(view.getByRole('radio', { name: 'Evening' }))).toBe(true);
    // The digits are shown large (any AM / PM is a smaller nested text).
    expect(view.getByText(new RegExp(`^${splitMeridiem(clock(28, 21))[0]}`))).toBeTruthy();
    expect(view.getByText('about 17 hours ago')).toBeTruthy();
    expect(shownTime(view)).toBe(`${clock(28, 21)}, about 17 hours ago`);
  });

  it('jumps to the middle of a part of the day, and says so', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onChange = jest.fn();
    const view = await render(<Harness day="2026-09-28" initial={{ hour: 21, minute: 0 }} onChange={onChange} />);

    await fireEvent.press(view.getByRole('radio', { name: 'Morning' }));

    expect(onChange).toHaveBeenLastCalledWith({ hour: 9, minute: 0 });
    expect(checked(view.getByRole('radio', { name: 'Morning' }))).toBe(true);
    expect(announce).toHaveBeenCalledWith(`Time set to ${clock(28, 9)}`);
    announce.mockRestore();
  });

  it('leaves out the parts of today still ahead, and caps a jump at now', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness day="2026-09-29" initial={{ hour: 9, minute: 0 }} onChange={onChange} />);

    // 14:37: Evening hasn't started, so it isn't there; the other three share the row.
    expect(view.queryByRole('radio', { name: /Evening/ })).toBeNull();
    expect(view.getAllByRole('radio')).toHaveLength(3);

    // Afternoon's middle (15:00) is still ahead: the jump lands on 14:30.
    await fireEvent.press(view.getByRole('radio', { name: 'Afternoon' }));
    expect(onChange).toHaveBeenLastCalledWith({ hour: 14, minute: 30 });
  });

  it('drops the row when only Night has started: one segment is no choice', async () => {
    const view = await render(
      <TimeSlotPicker day="2026-09-29" value={{ hour: 0, minute: 0 }} onChange={jest.fn()} now={new Date(2026, 8, 29, 0, 20)} />,
    );
    expect(view.queryAllByRole('radio')).toHaveLength(0);
    expect(view.getByRole('adjustable', { name: 'Time' })).toBeTruthy();
  });

  it('shows a part from its first minute, not before', async () => {
    const segmentsAt = async (hour: number, minute: number) => {
      const view = await render(
        <TimeSlotPicker day="2026-09-29" value={{ hour: 9, minute: 0 }} onChange={jest.fn()} now={new Date(2026, 8, 29, hour, minute)} />,
      );
      const labels = view.getAllByRole('radio').map((segment) => segment.props.accessibilityLabel);
      await view.unmount();
      return labels;
    };
    expect(await segmentsAt(11, 59)).toEqual(['Night', 'Morning']);
    expect(await segmentsAt(12, 0)).toEqual(['Night', 'Morning', 'Afternoon']);
  });

  it('jumps to 12:00 at noon itself, the only afternoon slot yet', async () => {
    const onChange = jest.fn();
    const view = await render(
      <TimeSlotPicker day="2026-09-29" value={{ hour: 9, minute: 0 }} onChange={onChange} now={new Date(2026, 8, 29, 12, 0)} />,
    );
    await fireEvent.press(view.getByRole('radio', { name: 'Afternoon' }));
    expect(onChange).toHaveBeenLastCalledWith({ hour: 12, minute: 0 });
  });

  it('steps a quarter hour either way, with a detent tick each time, and speaks the time', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onChange = jest.fn();
    const view = await render(<Harness day="2026-09-28" initial={{ hour: 21, minute: 0 }} onChange={onChange} />);

    await fireEvent.press(view.getByRole('button', { name: '15 minutes later' }));
    expect(onChange).toHaveBeenLastCalledWith({ hour: 21, minute: 15 });
    expect(announce).toHaveBeenLastCalledWith(clock(28, 21, 15));
    announce.mockRestore();
    await fireEvent.press(view.getByRole('button', { name: '15 minutes earlier' }));
    await fireEvent.press(view.getByRole('button', { name: '15 minutes earlier' }));
    expect(onChange).toHaveBeenLastCalledWith({ hour: 20, minute: 45 });
    expect(selectionHaptic).toHaveBeenCalledTimes(3);
  });

  it('stops at the start of the day, and at now', async () => {
    const start = await render(<Harness day="2026-09-28" initial={{ hour: 0, minute: 0 }} />);
    expect(disabled(start.getByRole('button', { name: '15 minutes earlier' }))).toBe(true);

    const latest = await render(<Harness day="2026-09-29" initial={{ hour: 14, minute: 30 }} />);
    expect(disabled(latest.getByRole('button', { name: '15 minutes later' }))).toBe(true);
    expect(disabled(latest.getByRole('button', { name: '15 minutes earlier' }))).toBe(false);
  });

  it('steps at once when a hold starts, then repeats, and stops at now', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness day="2026-09-29" initial={{ hour: 13, minute: 0 }} onChange={onChange} />);
    const later = view.getByRole('button', { name: '15 minutes later' });

    await fireEvent(later, 'longPress');
    // No dead half-second: the first step lands with the long press itself.
    expect(onChange).toHaveBeenLastCalledWith({ hour: 13, minute: 15 });
    await act(async () => {
      jest.advanceTimersByTime(120 * 10);
    });
    await fireEvent(later, 'pressOut');

    // 13:00 → 14:30 is six steps; the hold can't run past 14:30.
    expect(onChange).toHaveBeenLastCalledWith({ hour: 14, minute: 30 });
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('is one adjustable control for screen readers', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness day="2026-09-28" initial={{ hour: 21, minute: 0 }} onChange={onChange} />);
    const time = view.getByRole('adjustable', { name: 'Time' });

    await fireEvent(time, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith({ hour: 21, minute: 15 });
    await fireEvent(time, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith({ hour: 21, minute: 0 });
  });
});
