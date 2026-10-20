/**
 * WHAT:  launchScheme — the colour scheme the phone was in when the app
 *        launched, read ONCE as this module loads.
 * WHY:   The native splash is drawn in the phone's scheme; it cannot see the
 *        in-app Light/Dark preference. ThemeProvider pushes that preference
 *        into Appearance as soon as storage answers, after which Appearance
 *        reports the PREFERENCE, not the phone. The opening screen must match
 *        the native splash, so it needs the scheme from before that push —
 *        and module load (the bundle starting) is before any effect can run.
 *        Its own module so tests can stub it: reading it inside the component
 *        would be too late, and a module-scope read there cannot be mocked.
 *        After an IN-PROCESS reload (an update applied on launch, a dev
 *        reload) the override survives, so this is the previous preference —
 *        accepted: no native splash precedes that start, and a screen in the
 *        preference matches what was just showing.
 * LINKS: src/features/auth/components/BrandSplash.tsx (the one consumer);
 *        src/shared/theme/ThemeProvider.tsx (the push it must beat);
 *        docs/decisions/ADR-0013-dark-mode.md.
 */

import { Appearance } from 'react-native';

// 'unspecified' and null land on light, as ThemeProvider reads them.
const LAUNCH_SCHEME: 'light' | 'dark' = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';

/** The phone's scheme when the app launched — the native splash's scheme. */
export function launchScheme(): 'light' | 'dark' {
  return LAUNCH_SCHEME;
}
