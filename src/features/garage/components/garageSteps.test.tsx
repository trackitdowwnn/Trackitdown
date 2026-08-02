/**
 * WHAT:  Tests for the two garage-only wizard steps — that each writes its own
 *        answer slice, and that BOTH offer a working skip.
 * WHY:   The skip is not cosmetic. `optional: true` exempts a step from the
 *        final CTA gate but its schema still gates its OWN Next, so an optional
 *        step whose schema demands input and renders no skip is a dead end. The
 *        plate step shipped that way: an owner without their plate to hand could
 *        not get past the first screen of the flow. These tests are what stop
 *        that returning.
 *
 *        Renders and events are wrapped in `await act(async …)`: TextField
 *        animates its floating label, and a pending RN Animated update landing
 *        after the assertion makes these flaky in a full run (docs/TESTING.md
 *        stack gotchas).
 * LINKS: src/features/garage/components/garageSteps.tsx;
 *        src/shared/ui/StepSkipButton.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { NicknameStep, PlateStep } from './garageSteps';

// PlateStep now hosts the scan confirmation sheet, which reaches safe-area
// insets and the gorhom modal. Neither is what these tests are about, so both
// are mocked and the sheet stays CLOSED — otherwise its content would answer
// the queries below and a match could come from the wrong surface.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  class ClosedModal extends React.Component {
    present = () => {};
    dismiss = () => {};
    render() {
      return null;
    }
  }
  return {
    ...mock,
    BottomSheetModal: ClosedModal,
    BottomSheetScrollView: (props: object) =>
      React.createElement(ReactNative.ScrollView, props),
  };
});

describe('PlateStep', () => {
  it('writes the plate as the user types', async () => {
    const setAnswers = jest.fn();
    const { getByLabelText } = await act(async () =>
      render(<PlateStep answers={{}} setAnswers={setAnswers} />),
    );

    await act(async () => {
      fireEvent.changeText(getByLabelText('Number plate'), 'AB12CDE');
    });

    expect(setAnswers).toHaveBeenCalledWith({ plate: 'AB12CDE' });
  });

  it('offers a skip, so an owner without their plate is never stuck', async () => {
    const onSkip = jest.fn();
    const { getByTestId } = await act(async () =>
      render(<PlateStep answers={{}} setAnswers={jest.fn()} onSkip={onSkip} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('plate-skip'));
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('says what skipping MEANS rather than a bare "Skip"', async () => {
    const { getByText } = await act(async () =>
      render(<PlateStep answers={{}} setAnswers={jest.fn()} onSkip={jest.fn()} />),
    );

    expect(getByText("I don't have it to hand")).toBeTruthy();
  });

  it('hides the skip when the framework gives no onSkip', async () => {
    const { queryByTestId } = await act(async () =>
      render(<PlateStep answers={{}} setAnswers={jest.fn()} />),
    );

    expect(queryByTestId('plate-skip')).toBeNull();
  });
});

describe('NicknameStep', () => {
  it('writes the nickname', async () => {
    const setAnswers = jest.fn();
    const { getByLabelText } = await act(async () =>
      render(<NicknameStep answers={{}} setAnswers={setAnswers} />),
    );

    await act(async () => {
      fireEvent.changeText(getByLabelText('Nickname'), "Mum's Golf");
    });

    expect(setAnswers).toHaveBeenCalledWith({ nickname: "Mum's Golf" });
  });

  // This one is the LAST screen before saving, so without a skip a car with no
  // pet name could not be saved at all.
  it('offers a skip', async () => {
    const onSkip = jest.fn();
    const { getByTestId } = await act(async () =>
      render(<NicknameStep answers={{}} setAnswers={jest.fn()} onSkip={onSkip} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('nickname-skip'));
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
