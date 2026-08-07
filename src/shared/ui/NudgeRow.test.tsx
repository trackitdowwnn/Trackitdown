/**
 * WHAT:  Tests for NudgeRow — the row is the action, the × is optional, and
 *        dismissing never bleeds through to the row's own press.
 * WHY:   This one component now carries all three feed nudges, so a press bug
 *        here breaks every setup offer in the app at once. The nested-pressable
 *        bleed is the specific risk: refusing an offer must not also open the
 *        flow being refused.
 * LINKS: src/shared/ui/NudgeRow.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Bell } from 'lucide-react-native';

import { NudgeRow } from './NudgeRow';

const props = {
  icon: Bell,
  title: 'Get alerts near you',
  body: "We'll tell you when a car is reported stolen nearby.",
};

describe('NudgeRow', () => {
  it('renders the title and its one supporting line', async () => {
    const { getByText } = await act(async () =>
      render(<NudgeRow {...props} onPress={jest.fn()} />),
    );

    expect(getByText('Get alerts near you')).toBeTruthy();
    expect(getByText("We'll tell you when a car is reported stolen nearby.")).toBeTruthy();
  });

  it('fires onPress from the row itself', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await act(async () =>
      render(<NudgeRow {...props} onPress={onPress} testID="nudge" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('nudge'));
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reads as one object to a screen reader, title then body', async () => {
    const { getByLabelText } = await act(async () =>
      render(<NudgeRow {...props} onPress={jest.fn()} />),
    );

    expect(
      getByLabelText("Get alerts near you. We'll tell you when a car is reported stolen nearby."),
    ).toBeTruthy();
  });

  it('shows no dismiss control when onDismiss is omitted (a setup STEP)', async () => {
    const { queryByLabelText } = await act(async () =>
      render(<NudgeRow {...props} onPress={jest.fn()} />),
    );

    expect(queryByLabelText('Dismiss')).toBeNull();
  });

  it('dismisses without also firing the row press', async () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    const { getByLabelText } = await act(async () =>
      render(<NudgeRow {...props} onPress={onPress} onDismiss={onDismiss} />),
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Dismiss'));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });
});
