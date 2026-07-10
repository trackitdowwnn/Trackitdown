/**
 * WHAT:  Route file for the first-launch onboarding intro (also re-viewable
 *        as /onboarding?revisit=1 from settings later).
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — all behaviour lives
 *        in the auth feature's OnboardingScreen.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx; src/app/index.tsx
 *        (the first-launch gate that redirects here).
 */

import { OnboardingScreen } from '@/features/auth';

export default OnboardingScreen;
