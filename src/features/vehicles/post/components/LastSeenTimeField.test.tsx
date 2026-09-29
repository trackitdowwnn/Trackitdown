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
 *        src/shared/ui/DateTimeField.test.tsx (the sheet mock this borrows).
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

// The visibility-aware gorhom boundary from the BottomSheet / DateTimeField
// suites, so open() and close() really gate the sheet's children.
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

jest.mock('@/shared/lib/haptics', () => ({ lightHaptic: jest.fn() }));

/** Mon 28 Sep 2026, 14:37:22 local. */
const NOW = new Date(2026, 8, 28, 14, 37, 22);
const SHEET_TITLE = 'Pick a date and time';
const sheetTitle = (view: { queryByRole: (role: string, options: { name: string }) => unknown }) =>
  view.queryByRole('header', { name: SHEET_TITLE });
const CHANGE = /change date and time$/;

const hourLabel = (date: Date) => formatClock(date.toISOString());

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

  it('commits the picked day, hour and quarter hour on Confirm', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);
    await fireEvent.press(view.getByRole('radio', { name: 'Last night' }));

    await fireEvent.press(view.getByRole('button', { name: CHANGE }));
    expect(sheetTitle(view)).toBeTruthy();

    await fireEvent.press(view.getByRole('radio', { name: 'Sat 26 Sept' }));
    await fireEvent.press(view.getByRole('radio', { name: hourLabel(new Date(2026, 8, 26, 21)) }));
    await fireEvent.press(view.getByRole('radio', { name: '15 minutes past' }));
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));

    expect(onChange).toHaveBeenLastCalledWith(toLastSeenIso(new Date(2026, 8, 26, 21, 15)));
    expect(sheetTitle(view)).toBeNull();
    // An exact time is not a preset: no chip stays lit.
    expect(isChecked(view.getByRole('radio', { name: 'Last night' }))).toBe(false);
    // formatDateTimeLabel follows the device locale, so only the stable part
    // is pinned. Over a day old, the summary drops the "· 1d ago" suffix.
    expect(view.getByText(/26/)).toBeTruthy();
    expect(view.queryByText(/ · \d+[mhdw] ago$/)).toBeNull();
  });

  it('commits nothing on Cancel', async () => {
    const onChange = jest.fn();
    const view = await render(<Harness onChange={onChange} />);

    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));
    await fireEvent.press(view.getByRole('radio', { name: 'Yesterday, Sun 27 Sept' }));
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(sheetTitle(view)).toBeNull();
  });

  it('opens on the stored answer, rounded down to the quarter hour', async () => {
    const stored = toLastSeenIso(new Date(2026, 8, 26, 21, 44));
    const view = await render(<Harness initial={stored} onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('button', { name: CHANGE }));

    expect(isChecked(view.getByRole('radio', { name: 'Sat 26 Sept' }))).toBe(true);
    expect(isChecked(view.getByRole('radio', { name: hourLabel(new Date(2026, 8, 26, 21)) }))).toBe(true);
    expect(isChecked(view.getByRole('radio', { name: '30 minutes past' }))).toBe(true);
  });

  it('offers no future time today', async () => {
    const view = await render(<Harness onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));

    // Opens on now: today, 14:30.
    expect(isChecked(view.getByRole('radio', { name: 'Today, Mon 28 Sept' }))).toBe(true);
    expect(isChecked(view.getByRole('radio', { name: hourLabel(new Date(2026, 8, 28, 14)) }))).toBe(true);
    expect(view.queryByRole('radio', { name: hourLabel(new Date(2026, 8, 28, 15)) })).toBeNull();
    expect(view.queryByRole('radio', { name: '45 minutes past' })).toBeNull();
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
    await fireEvent.press(view.getByRole('radio', { name: 'Yesterday, Sun 27 Sept' }));
    expect(lightHaptic).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
    expect(lightHaptic).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByRole('button', { name: CHANGE }));
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    expect(lightHaptic).toHaveBeenCalledTimes(2);
  });

  it('says so when switching to today pulls a later time back', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const view = await render(<Harness onChange={jest.fn()} />);

    await fireEvent.press(view.getByRole('button', { name: 'Pick a date and time' }));
    await fireEvent.press(view.getByRole('radio', { name: 'Yesterday, Sun 27 Sept' }));
    await fireEvent.press(view.getByRole('radio', { name: hourLabel(new Date(2026, 8, 27, 22)) }));
    await fireEvent.press(view.getByRole('radio', { name: '45 minutes past' }));
    announce.mockClear();

    await fireEvent.press(view.getByRole('radio', { name: 'Today, Mon 28 Sept' }));

    const latest = formatClock(new Date(2026, 8, 28, 14, 30).toISOString());
    expect(announce).toHaveBeenCalledWith(`Time moved to ${latest}, the latest available`);
    expect(isChecked(view.getByRole('radio', { name: hourLabel(new Date(2026, 8, 28, 14)) }))).toBe(true);
    expect(isChecked(view.getByRole('radio', { name: '30 minutes past' }))).toBe(true);

    // A change that moves nothing else stays quiet.
    announce.mockClear();
    await fireEvent.press(view.getByRole('radio', { name: '15 minutes past' }));
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
  });
});
