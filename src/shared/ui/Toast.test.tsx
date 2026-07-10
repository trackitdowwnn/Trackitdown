/**
 * WHAT:  Tests for Toast — show renders the message, error kind styles as
 *        error, a new toast replaces the current, auto-dismiss after the
 *        visible window, and useToast outside the provider throws.
 * WHY:   The toast is the app's only lightweight confirmation channel; a
 *        toast that never dismisses (leaked timer) or silently swallows the
 *        second message loses user feedback everywhere at once.
 * LINKS: src/shared/ui/Toast.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { motion } from '../theme';
import { ToastProvider, useToast } from './Toast';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent: (c: unknown) => c },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withTiming: (value: unknown) => value,
  };
});

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

function Trigger({
  message,
  kind,
  testID = 'trigger',
}: {
  message: string;
  kind?: 'success' | 'error';
  testID?: string;
}) {
  const toast = useToast();
  return (
    <Text testID={testID} onPress={() => toast.show(message, kind)}>
      show
    </Text>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Toast', () => {
  it('shows a success toast and auto-dismisses after the visible window', async () => {
    const { getByTestId, getByText, queryByText } = await render(
      <ToastProvider>
        <Trigger message="Profile saved" />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.press(getByTestId('trigger'));
    });
    expect(getByText('Profile saved')).toBeTruthy();
    expect(getByTestId('toast-success')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(motion.toastVisible + motion.fast + 1);
    });
    expect(queryByText('Profile saved')).toBeNull();
  });

  it('error kind renders the error pill', async () => {
    const { getByTestId } = await render(
      <ToastProvider>
        <Trigger message="Something went wrong" kind="error" />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.press(getByTestId('trigger'));
    });
    expect(getByTestId('toast-error')).toBeTruthy();
  });

  it('a new toast replaces the current one', async () => {
    const { getByTestId, getByText, queryByText } = await render(
      <ToastProvider>
        <Trigger message="First" testID="first" />
        <Trigger message="Second" testID="second" />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.press(getByTestId('first'));
    });
    expect(getByText('First')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('second'));
    });
    expect(getByText('Second')).toBeTruthy();
    expect(queryByText('First')).toBeNull();
  });

  it('useToast outside the provider throws a clear error', async () => {
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Trigger message="x" />)).rejects.toThrow(
      'useToast must be used inside a ToastProvider',
    );
    silence.mockRestore();
  });
});
