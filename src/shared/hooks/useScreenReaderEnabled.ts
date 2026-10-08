/**
 * WHAT:  useScreenReaderEnabled — true while VoiceOver / TalkBack is on,
 *        following changes live.
 * WHY:   Behaviour that moves the screen on by itself must not run under a
 *        screen reader: the wizard's auto-advance (2026-10-08) would carry
 *        someone past a step before its new value had even been read back.
 *        Starts false (the common case) and corrects as soon as the OS
 *        answers.
 * LINKS: src/shared/wizard/useWizardController.ts (advanceSoon);
 *        docs/DESIGN_SYSTEM.md (Accessibility).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (alive) setEnabled(on);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
