/**
 * WHAT:  Tests for FinishDraftSheet — it names the draft's car, and each
 *        button closes the sheet and opens the right place.
 * WHY:   Continue must open THAT listing (to edit and pay), and Start a new
 *        one the usual report — swapping them would lose a paid-for draft or
 *        trap someone in an old one.
 * LINKS: ./FinishDraftSheet.tsx; ./SaveYourCarSheet.test.tsx (same mocks).
 */

import { act, createRef } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { FinishDraftSheet, type FinishDraftSheetRef } from './FinishDraftSheet';

const mockOpen = jest.fn();
const mockClose = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
    BottomSheet: ({ ref, children }: { ref?: React.Ref<unknown>; children: React.ReactNode }) => {
      React.useImperativeHandle(ref, () => ({ open: mockOpen, close: mockClose }));
      return React.createElement(View, null, children);
    },
    Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement(
        Pressable,
        { testID: `btn-${label}`, onPress },
        React.createElement(Text, null, label),
      ),
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const openWithDraft = async () => {
  const ref = createRef<FinishDraftSheetRef>();
  const view = await render(<FinishDraftSheet ref={ref} />);
  await act(async () => {
    ref.current?.open({ id: 'd1', label: 'Ford Fiesta · Blue' });
  });
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('opens naming the draft car', async () => {
  const view = await openWithDraft();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(view.getByText('Ford Fiesta · Blue')).toBeTruthy();
});

it('Continue draft closes and opens that listing', async () => {
  const view = await openWithDraft();
  await fireEvent.press(view.getByTestId('btn-Continue draft'));
  expect(mockClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/post/d1');
});

it('Start a new one closes and opens the usual report', async () => {
  const view = await openWithDraft();
  await fireEvent.press(view.getByTestId('btn-Start a new one'));
  expect(mockClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/post-a-car');
});
