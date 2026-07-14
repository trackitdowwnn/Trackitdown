/**
 * WHAT:  useResendCountdown — a one-shot countdown for the "Resend code" button:
 *        starts at `seconds`, ticks to 0, then `canResend` is true; `restart()`
 *        begins it again (after a resend).
 * WHY:   The verify screen must throttle resends (and the OTP send budget is a
 *        tight 2/hour), so the button is disabled with a live "Resend in 42s"
 *        label. Kept as a pure hook so the cooldown logic is tested without a
 *        screen (docs/TESTING.md: behaviour over implementation).
 * LINKS: src/features/auth/components/AuthSheet.tsx (consumer).
 */

import { useCallback, useEffect, useState } from 'react';

export interface ResendCountdown {
  /** Seconds remaining (0 when resend is allowed). */
  secondsLeft: number;
  /** True once the countdown has reached 0. */
  canResend: boolean;
  /** Restart the countdown from the initial value (call after a resend). */
  restart: () => void;
}

export function useResendCountdown(seconds: number): ResendCountdown {
  const [secondsLeft, setSecondsLeft] = useState(seconds);

  const restart = useCallback(() => setSecondsLeft(seconds), [seconds]);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    // Re-scheduled each tick (dep on secondsLeft); cleared on unmount/restart.
    const id = setTimeout(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  return { secondsLeft, canResend: secondsLeft === 0, restart };
}
