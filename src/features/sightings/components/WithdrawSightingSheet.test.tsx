/**
 * WHAT:  Tests for WithdrawSightingSheet — the four fixed answers, nothing
 *        preselected; confirming with no answer sends null; a chosen answer
 *        is sent; tapping it again clears it; "Keep it" sends nothing; and a
 *        reopened sheet starts unanswered.
 * WHY:   The answer reaches an owner's lock screen (as a fixed sentence), so
 *        what the spotter chose must be exactly what is sent — and the
 *        question must stay optional, never a hurdle in front of taking back
 *        a report they doubt.
 * LINKS: src/features/sightings/components/WithdrawSightingSheet.tsx;
 *        src/features/sightings/lib/withdrawReasons.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef } from 'react';

import { WithdrawSightingSheet, type WithdrawSightingSheetRef } from './WithdrawSightingSheet';

jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);

// Sheets show only once presented — so the content is absent until opened.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});

const setup = async () => {
  const ref = createRef<WithdrawSightingSheetRef>();
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();
  const view = await render(
    <WithdrawSightingSheet ref={ref} onConfirm={onConfirm} onDismiss={onDismiss} />,
  );
  const open = async () => {
    await act(async () => ref.current?.open());
  };
  const press = async (name: string) => {
    await act(async () => {
      fireEvent.press(
        view.getByRole(name.startsWith('Take') || name === 'Keep it' ? 'button' : 'radio', {
          name,
        }),
      );
    });
  };
  return { ...view, ref, onConfirm, onDismiss, open, press };
};

it('asks why, with four fixed answers and none chosen', async () => {
  const s = await setup();
  await s.open();
  expect(s.getByText('Take this report back?')).toBeTruthy();
  for (const label of [
    'It wasn’t the car',
    'I’m not sure it was the car',
    'I reported it by mistake',
    'Something else',
  ]) {
    expect(s.getByRole('radio', { name: label }).props.accessibilityState.checked).toBe(false);
  }
  // ⚠️ No text box: the answer reaches the owner as a fixed sentence only.
  expect(JSON.stringify(s.toJSON())).not.toContain('"type":"TextInput"');
});

it('⚠️ is optional — taking it back with no answer sends null', async () => {
  const s = await setup();
  await s.open();
  await s.press('Take it back');
  expect(s.onConfirm).toHaveBeenCalledWith(null);
  expect(s.onDismiss).not.toHaveBeenCalled();
});

it('sends the answer chosen', async () => {
  const s = await setup();
  await s.open();
  await s.press('I’m not sure it was the car');
  await s.press('Take it back');
  expect(s.onConfirm).toHaveBeenCalledWith('not_sure');
});

it('clears the answer when it is tapped again', async () => {
  const s = await setup();
  await s.open();
  await s.press('It wasn’t the car');
  await s.press('It wasn’t the car');
  await s.press('Take it back');
  expect(s.onConfirm).toHaveBeenCalledWith(null);
});

it('"Keep it" takes nothing back', async () => {
  const s = await setup();
  await s.open();
  await s.press('I reported it by mistake');
  await s.press('Keep it');
  expect(s.onConfirm).not.toHaveBeenCalled();
  expect(s.onDismiss).toHaveBeenCalledTimes(1);
});

it('⚠️ a reopened sheet starts unanswered — never the last report’s answer', async () => {
  const s = await setup();
  await s.open();
  await s.press('Something else');
  await s.press('Keep it');
  await s.open();
  await s.press('Take it back');
  expect(s.onConfirm).toHaveBeenCalledWith(null);
});
