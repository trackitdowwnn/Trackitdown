/**
 * WHAT:  Tests for useOnboardingGate — starts 'loading', resolves to
 *        'unseen' on first launch and 'seen' once the flag is set.
 * WHY:   The root route maps these states to blank / redirect / home; a
 *        wrong resolution either traps returning users in the intro or
 *        skips it for new ones.
 * LINKS: src/features/auth/hooks/useOnboardingGate.ts; src/app/index.tsx.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { markOnboardingSeen } from '../lib/onboardingStorage';
import { useOnboardingGate } from './useOnboardingGate';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('useOnboardingGate', () => {
  it('starts loading, then resolves unseen on first launch', async () => {
    const { result } = await renderHook(() => useOnboardingGate());
    await waitFor(() => expect(result.current).toBe('unseen'));
  });

  it('resolves seen once the flag is set', async () => {
    await markOnboardingSeen();
    const { result } = await renderHook(() => useOnboardingGate());
    await waitFor(() => expect(result.current).toBe('seen'));
  });
});
