/**
 * WHAT:  Tests for the paid-moment flag — default, round trip, a newer payout,
 *        and the fail-soft read.
 * WHY:   The assertion that matters is that an unreadable flag stays QUIET:
 *        a celebration on every visit is the failure anyone would notice.
 * LINKS: ./paidMomentStorage.ts; src/features/garage/lib/garageNudgeStorage.test.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PAID_MOMENT_STORAGE_KEY,
  hasCelebratedPayout,
  markPayoutCelebrated,
} from './paidMomentStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('is false for a payout never celebrated', async () => {
  await expect(hasCelebratedPayout('paid:1')).resolves.toBe(false);
});

it('persists and reads back', async () => {
  await markPayoutCelebrated('paid:1');
  await expect(hasCelebratedPayout('paid:1')).resolves.toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(PAID_MOMENT_STORAGE_KEY, 'paid:1');
});

it('a newer payout gets its own moment', async () => {
  await markPayoutCelebrated('paid:1');
  await expect(hasCelebratedPayout('paid:2')).resolves.toBe(false);
});

it('⚠️ reads as SEEN when storage is unreadable — never a moment on every visit', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage broken'));
  await expect(hasCelebratedPayout('paid:1')).resolves.toBe(true);
});

it('never throws on a failed write', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  await expect(markPayoutCelebrated('paid:1')).resolves.toBeUndefined();
});
