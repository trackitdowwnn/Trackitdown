/**
 * WHAT:  Public API of the auth feature.
 * WHY:   Other code (routes, gated actions across features) imports ONLY from
 *        here (docs/ARCHITECTURE.md rule 1).
 * LINKS: src/features/auth/README.md.
 */

// The root layout needs AuthGate + AuthSheet; gated actions everywhere need
// useRequireAuth; other features read useSession. Storage helpers, the intent
// store internals, and slide data stay internal.
export { AuthGate } from './components/AuthGate';
export { AuthSheet } from './components/AuthSheet';
export { type GateContext } from './gate/gateIntent';
export { useRequireAuth } from './gate/useRequireAuth';
export { useAuthStanding, type AuthStanding } from './hooks/useAuthStanding';
export { useOnboardingGate, type OnboardingGateState } from './hooks/useOnboardingGate';
export { useSession, type SessionState } from './hooks/useSession';
export { OnboardingScreen } from './screens/OnboardingScreen';
