/**
 * WHAT:  Tests for the "already offered the garage" flag — default, round trip,
 *        the version-in-key rule, and BOTH fail-soft paths.
 * WHY:   The highest-value assertion here is that an unreadable flag SUPPRESSES.
 *        This file is copied from onboardingStorage, which fails the other way,
 *        so the inversion is exactly what a future edit would quietly undo — and
 *        undoing it means re-nagging people who already declined.
 * LINKS: src/features/garage/lib/garageNudgeStorage.ts;
 *        src/features/auth/lib/onboardingStorage.test.ts (the template);
 *        docs/TESTING.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  GARAGE_NUDGE_STORAGE_KEY,
  hasOfferedGarageNudge,
  markGarageNudgeOffered,
} from './garageNudgeStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('hasOfferedGarageNudge', () => {
  it('is false for a fresh install, so the offer can be made', async () => {
    await expect(hasOfferedGarageNudge()).resolves.toBe(false);
  });

  it('persists and reads back', async () => {
    await markGarageNudgeOffered();

    await expect(hasOfferedGarageNudge()).resolves.toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(GARAGE_NUDGE_STORAGE_KEY, 'true');
  });

  it('ignores a flag written under an older version key', async () => {
    await AsyncStorage.setItem('trackitdown.garage_nudge_offered_v0', 'true');

    // A version bump re-offers the garage to everyone, with no migration.
    await expect(hasOfferedGarageNudge()).resolves.toBe(false);
  });

  // THE assertion. Note this is the OPPOSITE of onboardingStorage's fail-soft:
  // there, an unreadable flag shows the onboarding again (harmless). Here it
  // would re-nag someone who already said no, so a broken read stays quiet.
  it('SUPPRESSES when storage is unreadable — never re-nags on an error', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage broken'));

    await expect(hasOfferedGarageNudge()).resolves.toBe(true);
  });
});

describe('markGarageNudgeOffered', () => {
  it('never throws when the write fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage broken'));

    // Failing to persist costs at most one extra nudge — not worth an error.
    await expect(markGarageNudgeOffered()).resolves.toBeUndefined();
  });
});
