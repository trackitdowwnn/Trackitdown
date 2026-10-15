/**
 * WHAT:  useClipboardCode — on Android, when the spotter comes BACK to the app
 *        on the code step, look for the sign-in code on the clipboard and hand
 *        it over (the step fills the boxes and signs them in).
 * WHY:   2026-10-15 (owner: "auto populate the OTP code so the user does not
 *        have to type it in"; chose fully automatic over a tap). The code is
 *        EMAILED, and Android's system autofill only knows SMS. Gmail offers
 *        "Copy code"; this is the other half of that tap.
 *
 *        ⚠️ GUARDRAILS, because a wrong guess costs an attempt and only two
 *        emails an hour are allowed (dev-team review, all four roles):
 *          • only on a RETURN (background → active) while the step is open —
 *            never on mount: what's on the clipboard then is from before the
 *            code was sent;
 *          • `hasStringAsync` first — it reads the clip's description, not its
 *            content, so it costs no "pasted from your clipboard" notice;
 *          • strict matching (extractOtp), and never the same code twice: a
 *            code is remembered as tried the moment it is handed over, and a
 *            typed code that failed is added by `markTried`;
 *          • Android 10+ answers an empty clipboard until the window has focus,
 *            which can come just AFTER `active` — so up to three looks, ~250ms
 *            and ~750ms in, stopping at the first text found;
 *          • nothing read is ever logged — only whether a code was found.
 *        iOS: off. Mail's one-time-code autofill already covers it above the
 *        keyboard, and a programmatic read there raises a paste prompt.
 * LINKS: ../lib/otpFromClipboard.ts; ../components/AuthSheet.tsx (OtpStep);
 *        docs/SECURITY_AND_TRUST.md (the clipboard read).
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { createLogger } from '@/shared/lib/logger';

import { extractOtp } from '../lib/otpFromClipboard';

const log = createLogger('auth');

/** When to look again after an empty first read (ms from the return). */
const LOOK_AT_MS = [0, 250, 750];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ClipboardCodeOptions {
  /** False while verifying, or once the code is complete. */
  enabled: boolean;
  /** Receives a code found on the clipboard — at most once per return. */
  onCode: (code: string) => void;
  length?: number;
}

export function useClipboardCode({ enabled, onCode, length = 8 }: ClipboardCodeOptions): {
  /** Never offer this code again on this step (a typed code that failed). */
  markTried: (code: string) => void;
} {
  const tried = useRef(new Set<string>());
  // Read when the return happens, not when the listener was registered.
  const latest = useRef({ enabled, onCode });
  useEffect(() => {
    latest.current = { enabled, onCode };
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let mounted = true;
    let lastState: AppStateStatus = AppState.currentState;

    const look = async () => {
      let elapsed = 0;
      for (const at of LOOK_AT_MS) {
        await wait(at - elapsed);
        elapsed = at;
        if (!mounted || !latest.current.enabled) return;
        try {
          if (!(await Clipboard.hasStringAsync())) continue;
          const text = await Clipboard.getStringAsync();
          if (!text) continue;
          const code = extractOtp(text, length);
          if (!mounted || !latest.current.enabled) return;
          if (code && !tried.current.has(code)) {
            tried.current.add(code);
            log.info('clipboard code used');
            latest.current.onCode(code);
          } else {
            log.debug('clipboard held no new code');
          }
          return;
        } catch {
          // An unreadable clipboard is simply no code.
          return;
        }
      }
    };

    const subscription = AppState.addEventListener('change', (next) => {
      const previous = lastState;
      lastState = next;
      if (next === 'active' && previous !== 'active') {
        void look();
      }
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [length]);

  const markTried = useCallback((code: string) => {
    tried.current.add(code);
  }, []);

  return { markTried };
}
