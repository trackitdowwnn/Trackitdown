/**
 * WHAT:  Tests for CalendarMonth:
 *          - the month title, and days as fully named buttons;
 *          - single and range selection states;
 *          - days outside the bounds disabled;
 *          - the ‹ › arrows stopping at the bounds, and month changes
 *            announced.
 * WHY:   This grid is how every date in the app gets picked. The failures
 *        that matter:
 *          - a day a screen reader can't identify;
 *          - a future day that can still be tapped (a false last-seen date);
 *          - an arrow that walks the user out of the allowed months.
 * LINKS: src/shared/ui/CalendarMonth.tsx; src/shared/lib/calendarDates.ts.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { CalendarMonth, type CalendarMonthProps } from './CalendarMonth';

const SEPT = { year: 2026, month: 8 };
const TODAY = '2026-09-29';

const day = (date: number, month = 'September') => new RegExp(`^\\w+,? ${date} ${month} 2026`);

function renderMonth(overrides: Partial<CalendarMonthProps> = {}) {
  const props: CalendarMonthProps = {
    month: SEPT,
    onMonthChange: jest.fn(),
    selection: { mode: 'single', day: null },
    onSelectDay: jest.fn(),
    today: TODAY,
    maxDay: TODAY,
    ...overrides,
  };
  return { props, view: render(<CalendarMonth {...props} />) };
}

describe('CalendarMonth', () => {
  it('titles the month and names every day in full', async () => {
    const { view } = renderMonth();
    const v = await view;

    expect(v.getByRole('header', { name: 'September 2026' })).toBeTruthy();
    expect(v.getAllByRole('button', { name: day(1) })).toHaveLength(1);
    expect(v.getByRole('button', { name: /^Tuesday,? 1 September 2026$/ })).toBeTruthy();
    expect(v.getByRole('button', { name: day(29) }).props.accessibilityLabel).toMatch(/, today$/);
  });

  it('hides the weekday letters, whose meaning every day label already carries', async () => {
    const v = await renderMonth().view;
    expect(v.queryByText('M')).toBeNull(); // hidden from the accessibility tree
  });

  it('selects a day on tap, and strikes out days past the bounds', async () => {
    const { props, view } = renderMonth();
    const v = await view;

    await fireEvent.press(v.getByRole('button', { name: day(12) }));
    expect(props.onSelectDay).toHaveBeenCalledWith('2026-09-12');

    const tomorrow = v.getByRole('button', { name: day(30) });
    expect(tomorrow.props.accessibilityState).toMatchObject({ disabled: true });
    expect(tomorrow.props.accessibilityLabel).toMatch(/not available$/);
    await fireEvent.press(tomorrow);
    expect(props.onSelectDay).toHaveBeenCalledTimes(1);
  });

  it('marks the single selection in state, not by repeating "selected" in the name', async () => {
    const v = await renderMonth({ selection: { mode: 'single', day: '2026-09-12' } }).view;
    const picked = v.getByRole('button', { name: day(12) });
    expect(picked.props.accessibilityState).toMatchObject({ selected: true });
    // Screen readers already speak the selected state; the name stays the date.
    expect(picked.props.accessibilityLabel).toMatch(/^\w+,? 12 September 2026$/);
    expect(v.getByRole('button', { name: day(13) }).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('always draws six weeks, so the sheet never changes height between months', async () => {
    // September 2026 needs five rows; February 2027 needs four.
    for (const month of [{ year: 2026, month: 8 }, { year: 2027, month: 1 }]) {
      const v = await renderMonth({ month, maxDay: null }).view;
      expect(v.getByTestId('calendar-grid').props.children).toHaveLength(6);
    }
  });

  it('names a range start, end, and the days between', async () => {
    const v = await renderMonth({ selection: { mode: 'range', from: '2026-09-10', to: '2026-09-14' } }).view;

    expect(v.getByRole('button', { name: day(10) }).props.accessibilityLabel).toMatch(/, start of range$/);
    expect(v.getByRole('button', { name: day(12) }).props.accessibilityLabel).toMatch(/, in selected range$/);
    expect(v.getByRole('button', { name: day(14) }).props.accessibilityLabel).toMatch(/, end of range$/);
    expect(v.getByRole('button', { name: day(10) }).props.accessibilityState).toMatchObject({ selected: true });
    expect(v.getByRole('button', { name: day(12) }).props.accessibilityState).toMatchObject({ selected: false });
    expect(v.getByRole('button', { name: day(15) }).props.accessibilityLabel).toMatch(/2026$/);
  });

  it('treats a one-day range as a plain selection', async () => {
    const v = await renderMonth({ selection: { mode: 'range', from: '2026-09-10', to: '2026-09-10' } }).view;
    const only = v.getByRole('button', { name: day(10) });
    expect(only.props.accessibilityState).toMatchObject({ selected: true });
    expect(only.props.accessibilityLabel).not.toMatch(/range/);
  });

  it('pages months, announces them, and stops at the bounds', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { props, view } = renderMonth({ minDay: '2026-08-30' });
    const v = await view;

    const next = v.getByRole('button', { name: 'Next month, October 2026' });
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(v.getByRole('button', { name: 'Previous month, August 2026' }));
    expect(props.onMonthChange).toHaveBeenCalledWith({ year: 2026, month: 7 });
    expect(announce).toHaveBeenCalledWith('August 2026');
    announce.mockRestore();
  });

  it('stops going back once the earliest day’s month is showing', async () => {
    const v = await renderMonth({ month: { year: 2026, month: 7 }, minDay: '2026-08-30' }).view;
    expect(v.getByRole('button', { name: 'Previous month, July 2026' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(v.getByRole('button', { name: day(29, 'August') }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(v.getByRole('button', { name: day(30, 'August') }).props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('leaves both arrows open without bounds', async () => {
    const v = await renderMonth({ maxDay: null }).view;
    expect(v.getByRole('button', { name: 'Next month, October 2026' }).props.accessibilityState).toMatchObject({
      disabled: false,
    });
    expect(v.getByRole('button', { name: day(30) }).props.accessibilityState).toMatchObject({ disabled: false });
  });
});
