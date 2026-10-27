/**
 * WHAT:  Tests for the chat "Turn on notifications" row's once-only flag.
 * WHY:   A refusal must stick, and a broken store must read as "dismissed" —
 *        the wrong way round would nag someone who already said no.
 * LINKS: src/features/chat/lib/notifyNudgeStorage.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  NOTIFY_NUDGE_STORAGE_KEY,
  hasDismissedNotifyNudge,
  markNotifyNudgeDismissed,
} from './notifyNudgeStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('is not dismissed on a fresh install, and remembers a dismissal', async () => {
  await expect(hasDismissedNotifyNudge()).resolves.toBe(false);
  await markNotifyNudgeDismissed();
  await expect(hasDismissedNotifyNudge()).resolves.toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(NOTIFY_NUDGE_STORAGE_KEY, 'true');
});

it('an unreadable store reads as dismissed — quiet, never a nag', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await expect(hasDismissedNotifyNudge()).resolves.toBe(true);
});

it('a failed write never throws', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await expect(markNotifyNudgeDismissed()).resolves.toBeUndefined();
});
