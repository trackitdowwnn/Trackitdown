/**
 * WHAT:  Tests for Toast — show renders the message, error kind styles as
 *        error, a new toast replaces the current, auto-dismiss after the
 *        visible window, useToast outside the provider throws, and the
 *        optional inline action (renders, runs onPress, dismisses; a plain
 *        toast stays non-pressable).
 * WHY:   The toast is the app's only lightweight confirmation channel; a
 *        toast that never dismisses (leaked timer) or silently swallows the
 *        second message loses user feedback everywhere at once.
 * LINKS: src/shared/ui/Toast.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { motion } from '../theme';
import { type ToastAction, ToastProvider, useToast } from './Toast';

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
  action,
  testID = 'trigger',
}: {
  message: string;
  kind?: 'success' | 'error';
  action?: ToastAction;
  testID?: string;
}) {
  const toast = useToast();
  return (
    <Text testID={testID} onPress={() => toast.show(message, kind, action)}>
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

  it('renders the action label; pressing it runs onPress and dismisses now', async () => {
    const onPress = jest.fn();
    const { getByTestId, getByRole, queryByText } = await render(
      <ToastProvider>
        <Trigger message="Added to your watchlist" action={{ label: 'View', onPress }} />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.press(getByTestId('trigger'));
    });

    const action = getByRole('button');
    expect(action.props.accessibilityLabel).toBe('View');

    await act(async () => {
      fireEvent.press(action);
    });
    expect(onPress).toHaveBeenCalledTimes(1);

    // Dismisses after the fade — well before the full visible window.
    await act(async () => {
      jest.advanceTimersByTime(motion.fast + 1);
    });
    expect(queryByText('Added to your watchlist')).toBeNull();
  });

  it('a plain toast renders no action button and stays non-pressable', async () => {
    const { getByTestId, queryByRole } = await render(
      <ToastProvider>
        <Trigger message="Profile saved" />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.press(getByTestId('trigger'));
    });

    expect(queryByRole('button')).toBeNull();
    // The host must never block taps on the screen beneath a plain toast.
    expect(getByTestId('toast-host').props.pointerEvents).toBe('none');
  });

  it('useToast outside the provider throws a clear error', async () => {
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Trigger message="x" />)).rejects.toThrow(
      'useToast must be used inside a ToastProvider',
    );
    silence.mockRestore();
  });
});
