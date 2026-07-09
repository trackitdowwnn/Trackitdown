/**
 * WHAT:  Tests for DateTimeField — placeholder/value rendering, the
 *        composed a11y label, ISO-UTC output with minute precision,
 *        presets clamping to maxDate, error-slot rendering, and the
 *        Android two-step dialog flow committing only when both steps set.
 * WHY:   This field records "when was the car last seen" — the timestamp
 *        spotters act on. Emitting the wrong instant (unclamped future,
 *        stray seconds, timezone slips) would corrupt every post's
 *        timeline at the source.
 * LINKS: src/shared/ui/DateTimeField.tsx, src/shared/lib/dateTimeLabel.ts,
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { DateTimeField } from './DateTimeField';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// BottomSheet is gorhom-based; reuse the visibility-aware boundary mock the
// BottomSheet suite established so open()/close() actually gate children.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    // Faithful to @gorhom/bottom-sheet 5.2.14: dismiss() on a NON-presented
    // modal wedges its status machine; present() is then ignored forever.
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

// Native picker boundary: capture DateTimePickerAndroid.open calls so tests
// can drive the two-step date→time dialog flow.
const androidOpenCalls: Record<string, unknown>[] = [];
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null, // the iOS spinner renders nothing in tests
  DateTimePickerAndroid: {
    open: (options: Record<string, unknown>) => {
      androidOpenCalls.push(options);
    },
  },
}));

const NOW = new Date('2026-07-08T15:00:00.000Z');

beforeEach(() => {
  androidOpenCalls.length = 0;
  jest.useFakeTimers({ now: NOW });
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('DateTimeField', () => {
  it('shows the placeholder unset, and label + formatted local value when set', async () => {
    const unset = await render(
      <DateTimeField
        label="Last seen"
        placeholder="When did you last see it?"
        value={null}
        onChange={() => {}}
      />,
    );
    expect(unset.getByText('When did you last see it?')).toBeTruthy();
    expect(unset.getByLabelText('Last seen, not set, opens date picker')).toBeTruthy();

    const set = await render(
      <DateTimeField
        label="Last seen"
        value={new Date(NOW.getTime() - 2 * 3600_000).toISOString()}
        onChange={() => {}}
      />,
    );
    expect(set.getByText(/^Today, /)).toBeTruthy();
    expect(set.getByLabelText(/^Last seen, Today, .*opens date picker$/)).toBeTruthy();
  });

  it('emits presets as minute-precise UTC ISO, clamped to maxDate', async () => {
    const onChange = jest.fn();
    const maxDate = new Date(NOW.getTime() - 30 * 60_000); // 30 min ago
    const { getByLabelText } = await render(
      <DateTimeField label="Last seen" value={null} onChange={onChange} maxDate={maxDate} />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Last seen, not set, opens date picker'));
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Just now')); // "now" is AFTER maxDate
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const iso = onChange.mock.calls[0][0] as string;
    expect(iso).toBe(maxDate.toISOString()); // clamped, seconds already zero
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso).getSeconds()).toBe(0);
  });

  it('emits an un-clamped preset faithfully (About an hour ago)', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <DateTimeField label="Last seen" value={null} onChange={onChange} />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Last seen, not set, opens date picker'));
    });
    await act(async () => {
      fireEvent.press(getByLabelText('About an hour ago'));
    });

    expect(onChange).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 60 * 60_000).toISOString(),
    );
  });

  it('renders the error slot in place of helper text', async () => {
    const { getByText, queryByText } = await render(
      <DateTimeField
        label="Last seen"
        value={null}
        onChange={() => {}}
        helperText="Rough is fine"
        error="Tell us roughly when"
      />,
    );

    expect(getByText('Tell us roughly when')).toBeTruthy();
    expect(queryByText('Rough is fine')).toBeNull();
  });

  it('hides the presets row when presets is empty', async () => {
    const { getByLabelText, queryByLabelText } = await render(
      <DateTimeField label="Pick a time" value={null} onChange={() => {}} presets={[]} />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Pick a time, not set, opens date picker'));
    });

    expect(queryByLabelText('Just now')).toBeNull();
  });

  it('announces presets as buttons, not radios', async () => {
    const { getByLabelText } = await render(
      <DateTimeField label="Last seen" value={null} onChange={() => {}} />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Last seen, not set, opens date picker'));
    });

    const chip = getByLabelText('Just now');
    expect(chip.props.accessibilityRole).toBe('button');
    expect(chip.props.accessibilityState?.checked).toBeUndefined();
  });

  describe('Android two-step flow', () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'android');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function openExactPicker(onChange: jest.Mock) {
      const view = await render(
        <DateTimeField label="Last seen" value={null} onChange={onChange} />,
      );
      await act(async () => {
        fireEvent.press(view.getByLabelText('Last seen, not set, opens date picker'));
      });
      await act(async () => {
        fireEvent.press(view.getByRole('button', { name: 'Pick exact date & time' }));
      });
      return view;
    }

    it('commits only after BOTH date and time are set', async () => {
      const onChange = jest.fn();
      await openExactPicker(onChange);

      expect(androidOpenCalls).toHaveLength(1);
      expect(androidOpenCalls[0].mode).toBe('date');

      const pickedDate = new Date('2026-07-07T00:00:00.000Z');
      await act(async () => {
        (androidOpenCalls[0].onValueChange as (e: unknown, d?: Date) => void)(
          { nativeEvent: {} },
          pickedDate,
        );
      });

      expect(androidOpenCalls).toHaveLength(2);
      expect(androidOpenCalls[1].mode).toBe('time');
      expect(onChange).not.toHaveBeenCalled(); // date alone must not commit

      const pickedDateTime = new Date('2026-07-07T09:30:00.000Z');
      await act(async () => {
        (androidOpenCalls[1].onValueChange as (e: unknown, d?: Date) => void)(
          { nativeEvent: {} },
          pickedDateTime,
        );
      });

      expect(onChange).toHaveBeenCalledWith(pickedDateTime.toISOString());
    });

    it('commits nothing when the date step is dismissed', async () => {
      const onChange = jest.fn();
      await openExactPicker(onChange);

      await act(async () => {
        // 9.x API: dismissal fires onDismiss; onValueChange never fires.
        (androidOpenCalls[0].onDismiss as (() => void) | undefined)?.();
      });

      expect(androidOpenCalls).toHaveLength(1); // time dialog never opened
      expect(onChange).not.toHaveBeenCalled();
    });

    it('reopens the sheet after committing via the exact date & time dialogs (regression)', async () => {
      // The dialogs close the sheet up-front, so commit's later close() hits
      // a non-presented modal — which used to wedge it and leave the field
      // dead to all further taps.
      const onChange = jest.fn();
      const view = await openExactPicker(onChange);

      await act(async () => {
        (androidOpenCalls[0].onValueChange as (e: unknown, d?: Date) => void)(
          { nativeEvent: {} },
          new Date('2026-07-07T00:00:00.000Z'),
        );
      });
      await act(async () => {
        (androidOpenCalls[1].onValueChange as (e: unknown, d?: Date) => void)(
          { nativeEvent: {} },
          new Date('2026-07-07T09:30:00.000Z'),
        );
      });
      expect(onChange).toHaveBeenCalledTimes(1);

      // The field must still open its sheet after the commit.
      await act(async () => {
        fireEvent.press(view.getByLabelText('Last seen, not set, opens date picker'));
      });
      expect(view.getByLabelText('Just now')).toBeTruthy();
    });

    it('skips the dead-hop sheet and opens the date dialog directly with no presets', async () => {
      const onChange = jest.fn();
      const { getByLabelText } = await render(
        <DateTimeField label="Pick a time" value={null} onChange={onChange} presets={[]} />,
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Pick a time, not set, opens date picker'));
      });

      expect(androidOpenCalls).toHaveLength(1);
      expect(androidOpenCalls[0].mode).toBe('date');
    });
  });
});
