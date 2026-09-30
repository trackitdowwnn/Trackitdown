/**
 * WHAT:  Tests for LastSeenTimeField:
 *          - a preset chip commits at once and stays checked;
 *          - the summary line states the stored answer;
 *          - the row opens the sheet;
 *          - Confirm commits the day / hour / quarter-hour picked, and Cancel
 *            commits nothing;
 *          - a stored value preselects the sheet;
 *          - today's hour strip stops at the current hour.
 * WHY:   This field writes the last-seen time spotters act on. The failure
 *        modes that matter: a tap that doesn't commit (the user can't move on);
 *        Cancel committing anyway; a future hour on offer; or the sheet opening
 *        somewhere other than the stored answer, so Confirm silently moves it.
 * LINKS: src/features/vehicles/post/components/LastSeenTimeField.tsx;
 *        src/features/vehicles/post/lib/lastSeenTime.ts;
 *        src/shared/ui/BottomSheet.test.tsx (the sheet mock this borrows).
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { toLastSeenIso } from '../lib/lastSeenTime';
import { LastSeenTimeField } from './LastSeenTimeField';
import { formatClock } from '@/shared/lib';
import { lightHaptic } from '@/shared/lib/haptics';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The visibility-aware gorhom boundary from the BottomSheet suite, so open()
// and close() really gate the sheet's children.
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

jest.mock('@/shared/lib/haptics', () => ({ lightHaptic: jest.fn(), selectionHaptic: jest.fn() }));

/** Mon 28 Sep 2026, 14:37:22 local. */
const NOW = new Date(2026, 8, 28, 14, 37, 22);
type Queryable = { queryByRole: (role: string, options: { name: string }) => unknown };
/** Which stage the sheet is on, by its title; null when it's closed. */
const sheetStage = (view: Queryable) =>
  view.queryByRole('header', { name: 'Pick a date' })
    ? 'date'
    : view.queryByRole('header', { name: 'Pick a time' })
      ? 'time'
      : null;
const CHANGE = /change date and time$/;

/** A calendar day button, by its spoken name ("Saturday 26 September 2026, …"). */
const dayButton = (weekday: string, date: number) =>
  new RegExp(`^${weekday},? ${date} September 2026`);
/** A slot chip, labelled the way formatClock prints it on this machine. */
const slotLabel = (date: number, hour: number, minute: number) =>
  formatClock(new Date(2026, 8, date, hour, minute).toISOString());
const CONFIRM = /^Confirm /;
const EARLIER = '15 minutes earlier';
const LATER = '15 minutes later';

type Queryable2 = {
  getByRole: (role: string, options: { name: string | RegExp }) => {
    props: { accessibilityValue?: { text?: string }; accessibilityState?: { disabled?: boolean } };
  };
};
/** The time the large readout shows, via its adjustable value ("21:15, …"). */
const expectTime = (view: Queryable2, date: number, hour: number, minute: number) =>
  expect(view.getByRole('adjustable', { name: 'Time' }).props.accessibilityValue?.text).toMatch(
    new RegExp(`^${slotLabel(date, hour, minute).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `),
  );
/** Press a stepper `times` times. */
async function step(view: Queryable2, name: string, times: number) {
  for (let index = 0; index < times; index += 1) {
    await fireEvent.press(view.getByRole('button', { name }) as never);
  }
}

const isSelected = (element: { props: { accessibilityState?: { selected?: boolean } } }) =>
  element.props.accessibilityState?.selected === true;

/** Holds the value the way the wizard does, so the field re-renders with it. */
function Harness({ initial = null, onChange }: { initial?: string | null; onChange: (iso: string) => void }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <LastSeenTimeField
      value={value}
      onChange={(iso) => {
        setValue(iso);
        onChange(iso);
      }}
    />
  );
}

const isChecked = (element: { props: { accessibilityState?: { checked?: boolean } } }) =>
  element.props.accessibilityState?.checked === true;

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

describe('LastSeenTimeField', () => {
  it('starts with the presets and the picker row, and no summary', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);

    for (const label of ['Just now', 'About an hour ago', 'Earlier today', 'Last night', 'Yesterday']) {
      expect(view.getByRole('radio', { name: label })).toBeTruthy();
    }
    expect(view.getByRole('button', { name: 'Pick a date and time' })).toBeTruthy();
    expect(view.queryByText('Last seen')).toBeNull();
  });

  it('commits a preset at once, keeps it checked, and shows it in the field', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);

    await fireEvent.press(view.getByRole('radio', { name: 'Last night' }));

    expect(onChange).toHaveBeenCalledWith(toLastSeenIso(new Date(2026, 8, 27, 22, 0)));
    expect(isChecked(view.getByRole('radio', { name: 'Last night' }))).toBe(true);
    expect(isChecked(view.getByRole('radio', { name: 'Just now' }))).toBe(false);
    expect(view.getByText('Last seen')).toBeTruthy();
    expect(view.getByText(/^Yesterday, .* · 16h ago$/)).toBeTruthy();
    expect(view.getByRole('button', { name: CHANGE })).toBeTruthy();
    // VoiceOver hears the time itself, not just "selected", and with a comma
    // where the screen shows " · ".
    expect(announce).toHaveBeenLastCalledWith(expect.stringMatching(/^Last seen Yesterday, .*, 16h ago$/));
    announce.mockRestore();
  });

  it('asks for the date first, then the time, and commits both on Confirm', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);
    await fireEvent.press(view.getByRole('radio', { name: 'Last night' }));

    // Stage 1: the calendar alone. No time chips, no Confirm yet.
    await fireEvent.press(view.getByRole('button', { name: CHANGE }));
    expect(sheetStage(view)).toBe('date');
    expect(view.queryByRole('adjustable', { name: 'Time' })).toBeNull();
    expect(view.queryByRole('button', { name: CONFIRM })).toBeNull();

    // Picking a day moves straight on to stage 2, and says so.
    await fireEvent.press(view.getByRole('button', { name: dayButton('Saturday', 26) }));
    expect(sheetStage(view)).toBe('time');
    // Shown without the year; spoken with it.
    const heading = view.getByRole('header', { name: /^Saturday,? 26 September 2026$/ });
    expect(heading.props.children).toMatch(/^Saturday,? 26 September$/);
    expect(announce).toHaveBeenLastCalledWith(expect.stringMatching(/26 September 2026\. Now pick a time\.$/));
    expect(view.queryByRole('header', { name: 'September 2026' })).toBeNull(); // the calendar has gone

    // "Last night" opened on 22:00. Hour, then minutes: 21:15.
    expect(view.getByRole('adjustable', { name: 'Time' })).toBeTruthy();
    expectTime(view, 26, 22, 0);
    await step(view, EARLIER, 3);
    expectTime(view, 26, 21, 15);
    // Confirm repeats the time it will save.
    await fireEvent.press(view.getByRole('button', { name: `Confirm ${slotLabel(26, 21, 15)}` }));

    expect(onChange).toHaveBeenLastCalledWith(toLastSeenIso(new Date(2026, 8, 26, 21, 15)));
    expect(sheetStage(view)).toBeNull();
    announce.mockRestore();
    // An exact time is not a preset: no chip stays lit.
    expect(isChecked(view.getByRole('radio', { name: 'Last night' }))).toBe(false);
    // formatDateTimeLabel follows the device locale, so only the stable part
    // is pinned. Over a day old, the summary drops the "· 1d ago" suffix.
    expect(view.getByText(/26/)).toBeTruthy();
    expect(view.queryByText(/ · \d+[mhdw] ago$/)).toBeNull();
  });

  it('commits nothing on Cancel, from either stage', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);

    // From the date stage...
    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
    expect(sheetStage(view)).toBeNull();

    // ...and from the time stage.
    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));
    expect(sheetStage(view)).toBe('date'); // always opens on the date
    await fireEvent.press(view.getByRole('button', { name: dayButton('Sunday', 27) }));
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(sheetStage(view)).toBeNull();
  });

  it('opens on the stored answer: its day selected, then its time', async () => {
    const stored = toLastSeenIso(new Date(2026, 8, 26, 21, 44));
    const view = await render(<Harness initial={stored} onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('button', { name: CHANGE }));
    expect(view.getByRole('header', { name: 'September 2026' })).toBeTruthy();
    const stored26 = view.getByRole('button', { name: dayButton('Saturday', 26) });
    expect(isSelected(stored26)).toBe(true);

    // One tap on the stored day goes straight to its time, rounded down.
    await fireEvent.press(stored26);
    expectTime(view, 26, 21, 30);
    expect(isChecked(view.getByRole('radio', { name: 'Evening' }))).toBe(true);
  });

  it('goes back to the calendar from the time, keeping the draft', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);
    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));
    await fireEvent.press(view.getByRole('button', { name: dayButton('Sunday', 27) }));
    // Evening lands on 21:00; three steps on is 21:45.
    await fireEvent.press(view.getByRole('radio', { name: 'Evening' }));
    await step(view, LATER, 3);

    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await fireEvent.press(view.getByRole('button', { name: 'Change date' }));
    expect(sheetStage(view)).toBe('date');
    // The focused link unmounted, so the new stage is said out loud.
    expect(announce).toHaveBeenLastCalledWith('Pick a date');
    announce.mockRestore();
    expect(isSelected(view.getByRole('button', { name: dayButton('Sunday', 27) }))).toBe(true);

    // Another past day keeps 21:45: it's valid there too.
    await fireEvent.press(view.getByRole('button', { name: dayButton('Friday', 25) }));
    expectTime(view, 25, 21, 45);
  });

  it('offers no future time today', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));

    // Opens on now: today, 14:30.
    const today = view.getByRole('button', { name: dayButton('Monday', 28) });
    expect(isSelected(today)).toBe(true);
    expect(today.props.accessibilityLabel).toMatch(/, today$/);
    // Tomorrow is struck through and can't be picked.
    const tomorrow = view.getByRole('button', { name: dayButton('Tuesday', 29) });
    expect(tomorrow.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(today);
    // 14:37: it opens on 14:30, "+" can't go further, and Evening isn't offered.
    expectTime(view, 28, 14, 30);
    expect(view.getByRole('button', { name: LATER }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(view.queryByRole('radio', { name: /Evening/ })).toBeNull();
  });

  it('stops the month arrows at the 30-day window', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);
    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));

    // Next month is all future: its arrow is disabled.
    expect(view.getByRole('button', { name: 'Next month, October 2026' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    // August holds the window's first day (30 Aug), so back is allowed once...
    await fireEvent.press(view.getByRole('button', { name: 'Previous month, August 2026' }));
    expect(view.getByRole('header', { name: 'August 2026' })).toBeTruthy();
    expect(view.getByRole('button', { name: /^Sunday,? 30 August 2026/ }).props.accessibilityState).toMatchObject({
      disabled: false,
    });
    expect(view.getByRole('button', { name: /^Saturday,? 29 August 2026/ }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    // ...and no further.
    expect(view.getByRole('button', { name: 'Previous month, July 2026' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('keeps "how long ago" true while the step stays open', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);
    await fireEvent.press(view.getByRole('radio', { name: 'Last night' }));
    expect(view.getByText(/ · 16h ago$/)).toBeTruthy();

    // 23 minutes later it's 15:00, 17 hours after 22:00.
    await act(async () => {
      jest.advanceTimersByTime(23 * 60_000);
    });

    expect(view.getByText(/ · 17h ago$/)).toBeTruthy();
  });

  it('gives the "picked it" haptic on a preset and on Confirm, never on Cancel', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('radio', { name: 'Just now' }));
    expect(lightHaptic).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByRole('button', { name: CHANGE }));
    // Draft edits in the sheet aren't answers yet: no haptic.
    await fireEvent.press(view.getByRole('button', { name: dayButton('Sunday', 27) }));
    expect(lightHaptic).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
    expect(lightHaptic).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByRole('button', { name: CHANGE }));
    await fireEvent.press(view.getByRole('button', { name: dayButton('Monday', 28) }));
    await fireEvent.press(view.getByRole('button', { name: CONFIRM }));
    expect(lightHaptic).toHaveBeenCalledTimes(2);
  });

  it('pulls a later time back when the day changes to today', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));
    await fireEvent.press(view.getByRole('button', { name: dayButton('Sunday', 27) }));
    // Evening lands on 21:00; seven steps on is 22:45.
    await fireEvent.press(view.getByRole('radio', { name: 'Evening' }));
    await step(view, LATER, 7);
    expectTime(view, 27, 22, 45);

    await fireEvent.press(view.getByRole('button', { name: 'Change date' }));
    await fireEvent.press(view.getByRole('button', { name: dayButton('Monday', 28) }));

    // 22:45 hasn't happened yet today: the latest slot that has is 14:30.
    expectTime(view, 28, 14, 30);
    expect(isChecked(view.getByRole('radio', { name: 'Afternoon' }))).toBe(true);
    expect(view.queryByRole('radio', { name: /Evening/ })).toBeNull();
  });
});
