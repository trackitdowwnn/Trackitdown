/**
 * WHAT:  useAuthGate — resolves what a cold start should land on: 'loading'
 *        (hold the splash) | 'onboarding' (first launch) | 'app' (the tabs —
 *        signed in OR guest).
 * WHY:   Guest-first: being signed out no longer walls anything, so the gate's
 *        only jobs are first-launch onboarding and holding the brand splash
 *        while the onboarding flag + session restore. Startup permission
 *        prompts are NOT a route: once 'app' resolves, AuthGate fires the
 *        native OS dialogs directly (useStartupPermissionRequests) — no gate
 *        screen. The profiles-row check deliberately does NOT hold the splash
 *        — it never changes WHERE we land, only how a later gated action
 *        resolves (useRequireAuth).
 * LINKS: src/features/auth/components/AuthGate.tsx (renders splash + redirects,
 *        calls the permission prompts); useOnboardingGate, useSession;
 *        gate/useRequireAuth.ts + useAuthStanding (the per-action auth this
 *        hook deliberately no longer does).
 */

import { useOnboardingGate } from './useOnboardingGate';
import { useSession } from './useSession';

export type AuthRoute = 'loading' | 'onboarding' | 'app';

export function useAuthGate(): AuthRoute {
  const onboarding = useOnboardingGate();
  const session = useSession();

  if (onboarding === 'loading' || session.status === 'loading') return 'loading';
  if (onboarding === 'unseen') return 'onboarding';
  return 'app';
}
