/**
 * WHAT:  Tests for useClipboardCode — when the code step may read the
 *        clipboard, and what it does with what it finds.
 * WHY:   Every guardrail here is a wasted sign-in attempt (or a creepy read)
 *        if it slips: never on mount, never without text, never the same code
 *        twice, never while verifying, never on iOS.
 * LINKS: ./useClipboardCode.ts; ../lib/otpFromClipboard.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';

import { useClipboardCode } from './useClipboardCode';

const mockHasString = jest.fn();
const mockGetString = jest.fn();
jest.mock('expo-clipboard', () => ({
  hasStringAsync: () => mockHasString(),
  getStringAsync: () => mockGetString(),
}));

let appStateListener: ((state: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListener = fn as (state: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  mockHasString.mockResolvedValue(true);
  mockGetString.mockResolvedValue('12345678');
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The spotter leaves for their email and comes back. */
const returnToApp = async () => {
  await act(async () => {
    appStateListener?.('background');
  });
  await act(async () => {
    appStateListener?.('active');
  });
};

const settle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const mount = async (enabled = true) => {
  const onCode = jest.fn();
  const hook = await renderHook(
    (props: { enabled: boolean }) => useClipboardCode({ enabled: props.enabled, onCode }),
    { initialProps: { enabled } },
  );
  return { onCode, hook };
};

it('⚠️ never reads on mount — what is there is from before the code was sent', async () => {
  await mount();
  expect(mockGetString).not.toHaveBeenCalled();
  expect(mockHasString).not.toHaveBeenCalled();
});

it('back from the email with the code copied: hands it over', async () => {
  const { onCode } = await mount();
  await returnToApp();
  await waitFor(() => expect(onCode).toHaveBeenCalledWith('12345678'));
  expect(onCode).toHaveBeenCalledTimes(1);
});

it('no text on the clipboard: never reads its content (no "pasted" notice)', async () => {
  mockHasString.mockResolvedValue(false);
  const { onCode } = await mount();
  await returnToApp();
  await settle(900);
  expect(mockGetString).not.toHaveBeenCalled();
  expect(onCode).not.toHaveBeenCalled();
});

it('an empty first read (window not focused yet) looks again', async () => {
  mockGetString.mockResolvedValueOnce('').mockResolvedValue('12345678');
  const { onCode } = await mount();
  await returnToApp();
  await waitFor(() => expect(onCode).toHaveBeenCalledWith('12345678'), { timeout: 1500 });
  expect(mockGetString).toHaveBeenCalledTimes(2);
});

it('⚠️ never the same code twice — a failed one is not retried on the next return', async () => {
  const { onCode } = await mount();
  await returnToApp();
  await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
  await returnToApp();
  await settle(50);
  expect(onCode).toHaveBeenCalledTimes(1);
});

it('a typed code that failed (markTried) is never offered from the clipboard', async () => {
  const { onCode, hook } = await mount();
  await act(async () => {
    hook.result.current.markTried('12345678');
  });
  await returnToApp();
  await settle(50);
  expect(onCode).not.toHaveBeenCalled();
});

it('not a code on the clipboard: nothing', async () => {
  mockGetString.mockResolvedValue('see you at 6');
  const { onCode } = await mount();
  await returnToApp();
  await settle(50);
  expect(onCode).not.toHaveBeenCalled();
});

it('while verifying (disabled): no read at all', async () => {
  const { onCode } = await mount(false);
  await returnToApp();
  await settle(50);
  expect(mockGetString).not.toHaveBeenCalled();
  expect(onCode).not.toHaveBeenCalled();
});

it('iOS: off — Mail autofill covers it, and a read there raises a paste prompt', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const { onCode } = await mount();
  await returnToApp();
  expect(appStateListener).toBeNull();
  expect(onCode).not.toHaveBeenCalled();
});
