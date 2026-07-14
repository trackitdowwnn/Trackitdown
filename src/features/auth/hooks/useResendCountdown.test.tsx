/**
 * WHAT:  Tests for useResendCountdown — the tick-down, the canResend flip at 0,
 *        and restart resetting the clock.
 * WHY:   The resend button's throttle protects the tight OTP send budget; a
 *        broken countdown either spams sends or strands the user unable to
 *        resend.
 * LINKS: src/features/auth/hooks/useResendCountdown.ts, docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useResendCountdown } from './useResendCountdown';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// Advance one second at a time so the async renderer commits + reschedules the
// next timeout between ticks.
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('useResendCountdown', () => {
  it('starts blocked and counts down to a resend', async () => {
    const { result } = await renderHook(() => useResendCountdown(3));
    expect(result.current.secondsLeft).toBe(3);
    expect(result.current.canResend).toBe(false);

    await tick(2);
    expect(result.current.secondsLeft).toBe(1);
    expect(result.current.canResend).toBe(false);

    await tick(1);
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.canResend).toBe(true);
  });

  it('does not tick below zero', async () => {
    const { result } = await renderHook(() => useResendCountdown(1));
    await tick(5);
    expect(result.current.secondsLeft).toBe(0);
  });

  it('restart resets the countdown', async () => {
    const { result } = await renderHook(() => useResendCountdown(3));
    await tick(3);
    expect(result.current.canResend).toBe(true);

    await act(async () => result.current.restart());
    expect(result.current.secondsLeft).toBe(3);
    expect(result.current.canResend).toBe(false);
  });
});
