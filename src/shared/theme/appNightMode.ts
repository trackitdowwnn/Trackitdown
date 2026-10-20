/**
 * WHAT:  setAppNightMode — hands the Light/Dark choice to Android as THIS app's
 *        own night mode (modules/app-night-mode), so the system-drawn launch
 *        splash follows it from the next cold start.
 * WHY:   The launch splash is drawn before any JS runs and could only see the
 *        phone's theme: a dark phone with the app on Light opened black, then
 *        turned white a second or two later (owner, 2026-10-20). Android 12+
 *        persists a per-app night mode that the splash respects.
 *
 *        OPTIONAL by design: the native module exists only in builds made
 *        after 2026-10-20, and the same JS ships by OTA to every older APK on
 *        runtime 1.1.0. There it is simply absent and this does nothing —
 *        those phones keep the old splash until they install a new build.
 *        Never throws: a theme switch must not fail over a splash colour.
 * LINKS: modules/app-night-mode (the native module);
 *        src/shared/theme/ThemeProvider.tsx (the only caller);
 *        docs/decisions/ADR-0013-dark-mode.md.
 */

import { requireOptionalNativeModule } from 'expo';

import type { ThemePreference } from './themePreferenceTypes';

interface AppNightModeModule {
  setApplicationNightMode(mode: ThemePreference): boolean;
}

const native = requireOptionalNativeModule<AppNightModeModule>('AppNightMode');

/** Persist `preference` as the app's night mode for the launch splash.
 *  Returns whether Android took it (false: older build, or below Android 12). */
export function setAppNightMode(preference: ThemePreference): boolean {
  if (!native) return false;
  try {
    return native.setApplicationNightMode(preference);
  } catch {
    return false;
  }
}
