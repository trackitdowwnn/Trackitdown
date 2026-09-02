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

  // ⚠️ A WARNING, NEVER A GATE (whole-app review #33). isValidPlate was written
  // and tested and then called by nothing; wiring it as a hard check would put
  // a wall in front of every plate our FORMATS list does not know — and
  // personalised, Northern Irish, pre-2001 and imported plates are all real.
  describe('the format warning', () => {
    it('stays quiet while the plate is valid', async () => {
      const { queryByTestId } = await act(async () =>
        render(<PlateStep answers={{ plate: 'AB12 CDE' }} setAnswers={jest.fn()} />),
      );
      expect(queryByTestId('plate-format-warning')).toBeNull();
    });

    it('stays quiet mid-type — two characters is not a wrong answer', async () => {
      const { queryByTestId } = await act(async () =>
        render(<PlateStep answers={{ plate: 'AB' }} setAnswers={jest.fn()} />),
      );
      expect(queryByTestId('plate-format-warning')).toBeNull();
    });

    it('asks a question when the shape is unfamiliar', async () => {
      const { getByTestId } = await act(async () =>
        render(<PlateStep answers={{ plate: 'ZZZZZZZ9' }} setAnswers={jest.fn()} />),
      );
      // Phrased as a question, because it may well be right and we are the
      // ones who might be wrong.
      expect(getByTestId('plate-format-warning')).toBeTruthy();
    });

    it('⚠️ still lets the owner continue, and still offers the skip', async () => {
      const onSkip = jest.fn();
      const { getByTestId } = await act(async () =>
        render(
          <PlateStep answers={{ plate: 'ZZZZZZZ9' }} setAnswers={jest.fn()} onSkip={onSkip} />,
        ),
      );
      // The whole decision in one assertion: an unrecognised plate disables
      // nothing. A car with a plate we do not recognise is still a car that
      // has been stolen.
      expect(getByTestId('plate-format-warning')).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId('plate-skip'));
      });
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('ignores spacing and case, as the canonical form does', async () => {
      const { queryByTestId } = await act(async () =>
        render(<PlateStep answers={{ plate: 'ab12cde' }} setAnswers={jest.fn()} />),
      );
      expect(queryByTestId('plate-format-warning')).toBeNull();
    });
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
