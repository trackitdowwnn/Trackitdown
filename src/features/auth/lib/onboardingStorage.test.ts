/**
 * WHAT:  Tests for the onboarding seen-flag — default unseen, marking
 *        persists, the version lives in the key (bumping re-shows), and
 *        stale old-version flags don't count.
 * WHY:   This flag decides whether a new user meets the intro or lands on a
 *        blank auth screen; the version-in-key rule is what lets a redesign
 *        re-show without a migration, so both are pinned.
 * LINKS: src/features/auth/lib/onboardingStorage.ts; docs/TESTING.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  hasSeenOnboarding,
  markOnboardingSeen,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
} from './onboardingStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('onboardingStorage', () => {
  it('is unseen by default (first launch shows the intro)', async () => {
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('marking seen persists and reads back', async () => {
    await markOnboardingSeen();
    expect(await hasSeenOnboarding()).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, 'true');
  });

  it('the key carries the version, so a bump re-shows the intro', async () => {
    expect(ONBOARDING_STORAGE_KEY).toBe(`trackitdown.onboarding_seen_v${ONBOARDING_VERSION}`);
    // A flag from a previous onboarding version does not count as seen.
    await AsyncStorage.setItem('trackitdown.onboarding_seen_v0', 'true');
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('an unreadable flag shows the (skippable) intro rather than blocking', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage broken'));
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('a failed write never throws out of markOnboardingSeen', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage broken'));
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
  });
});
