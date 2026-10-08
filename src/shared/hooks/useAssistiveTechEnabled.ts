/**
 * WHAT:  useAssistiveTechEnabled — true while a screen reader (VoiceOver /
 *        TalkBack) is on, or, on Android, any accessibility service (Switch
 *        Access and the like). The screen reader is followed live; a service
 *        is read once per mount (Android sends no change event for it).
 * WHY:   Behaviour that moves the screen on by itself must not run for these
 *        users: the wizard's auto-advance (2026-10-08) would carry a screen
 *        reader past a step before its new value had been read back, and
 *        would cost a switch user their scan position (WCAG 3.2.2, On Input).
 *        Android reports switch-style services only as "an accessibility
 *        service", which also covers some password managers — their users
 *        simply press Next themselves, the cheap side of the trade. Starts
 *        false (the common case) and corrects as soon as the OS answers.
 * LINKS: src/shared/wizard/useWizardController.ts (advanceSoon);
 *        docs/DESIGN_SYSTEM.md (Accessibility).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Whether assistive technology that a self-moving screen would disrupt is on. */
export function useAssistiveTechEnabled(): boolean {
  const [screenReader, setScreenReader] = useState(false);
  const [service, setService] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (alive) setScreenReader(on);
      })
      .catch(() => {});
    if (Platform.OS === 'android') {
      AccessibilityInfo.isAccessibilityServiceEnabled()
        .then((on) => {
          if (alive) setService(on);
        })
        .catch(() => {});
    }
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return screenReader || service;
}
