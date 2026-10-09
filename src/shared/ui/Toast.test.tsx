/**
 * WHAT:  Tests for Toast — show renders the message with the icon for its
 *        kind (2026-10-09 card redesign), long messages wrap uncut and stay
 *        longer (toastDuration), it sits above the tab bar only on tab screens, a new toast replaces the current, auto-dismiss after the
 *        visible window, useToast outside the provider throws, and the
 *        optional inline action (renders, runs onPress, dismisses; a plain
 *        toast stays non-pressable).
 * WHY:   The toast is the app's only lightweight confirmation channel; a
 *        toast that never dismisses (leaked timer) or silently swallows the
 *        second message loses user feedback everywhere at once.
 * LINKS: src/shared/ui/Toast.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { motion, sizes } from '../theme';
import { type ToastAction, ToastProvider, toastDuration, useToast } from './Toast';

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

  it('error kind renders the error card', async () => {
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

  describe('the card (2026-10-09 redesign)', () => {
    // The icon is hidden from screen readers, so queries must opt in to see it.
    const HIDDEN = { includeHiddenElements: true };
    const LONG =
      'Report taken back — the owner no longer sees it. You can’t re-file it for this car today.';

    const showIn = async (
      message: string,
      kind?: 'success' | 'error',
      props: { aboveTabBar?: boolean } = {},
    ) => {
      const view = await render(
        <ToastProvider {...props}>
          <Trigger message={message} kind={kind} />
        </ToastProvider>,
      );
      await act(async () => {
        fireEvent.press(view.getByTestId('trigger'));
      });
      return view;
    };

    it('says which kind it is with an icon — a tick, or an alert', async () => {
      const ok = await showIn('Profile saved');
      expect(ok.getByTestId('toast-icon-success', HIDDEN)).toBeTruthy();
      expect(ok.queryByTestId('toast-icon-error', HIDDEN)).toBeNull();
      await ok.unmount();
      const bad = await showIn('Couldn’t save that.', 'error');
      expect(bad.getByTestId('toast-icon-error', HIDDEN)).toBeTruthy();
      expect(bad.queryByTestId('toast-icon-success', HIDDEN)).toBeNull();
    });

    it('keeps the icon from screen readers — they hear the message', async () => {
      const { getByTestId } = await showIn('Profile saved');
      expect(getByTestId('toast-icon-success', HIDDEN).props.importantForAccessibility).toBe(
        'no-hide-descendants',
      );
      expect(getByTestId('toast-success').props.accessibilityLabel).toBe('Profile saved');
    });

    it('⚠️ never cuts a long message off', async () => {
      const { getByTestId } = await showIn(LONG);
      expect(getByTestId('toast-message').props.numberOfLines).toBeUndefined();
    });

    it('⚠️ stays long enough to read a long message', async () => {
      const { queryByText } = await showIn(LONG);
      // Still there when a short toast would long be gone…
      await act(async () => {
        jest.advanceTimersByTime(motion.toastVisible + motion.fast + 1);
      });
      expect(queryByText(LONG)).toBeTruthy();
      // …and gone once its own reading time has passed.
      await act(async () => {
        jest.advanceTimersByTime(toastDuration(LONG, 'success'));
      });
      expect(queryByText(LONG)).toBeNull();
    });

    it('clears the tab bar on a tab screen, and a footer button elsewhere', async () => {
      const onTabs = await showIn('Saved', 'success', { aboveTabBar: true });
      const tabBottom = StyleSheet.flatten(onTabs.getByTestId('toast-host').props.style).bottom;
      await onTabs.unmount();
      const elsewhere = await showIn('Saved');
      const stackBottom = StyleSheet.flatten(
        elsewhere.getByTestId('toast-host').props.style,
      ).bottom;
      // Above the tab bar where there is one…
      expect(tabBottom).toBeGreaterThan(sizes.tabBar);
      // …and above a standard sticky footer button where there isn't.
      expect(stackBottom).toBeGreaterThan(sizes.control);
      expect(stackBottom).not.toBe(tabBottom);
    });
  });
});

describe('toastDuration — how long a toast stays', () => {
  it('gives a short message the standard window', () => {
    expect(toastDuration('Profile saved', 'success')).toBe(motion.toastVisible);
  });

  it('adds reading time for each word past the first few', () => {
    const twelveWords = 'one two three four five six seven eight nine ten eleven twelve';
    expect(toastDuration(twelveWords, 'success')).toBe(
      motion.toastVisible + 6 * motion.toastPerWord,
    );
  });

  it('never stays longer than the cap', () => {
    expect(toastDuration('word '.repeat(200), 'success')).toBe(motion.toastMax);
  });

  it('keeps an error up for at least the error minimum', () => {
    expect(toastDuration('Couldn’t save.', 'error')).toBe(motion.toastErrorMin);
  });
});
