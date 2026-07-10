/**
 * WHAT:  Public API of the auth feature.
 * WHY:   Other code (routes, later the profile feature's "How Trackitdown
 *        works" link) imports ONLY from here (docs/ARCHITECTURE.md rule 1).
 * LINKS: src/features/auth/README.md.
 */

// Deliberately small: routes need the screens and the gate, nothing else.
// Storage helpers and slide data stay internal until a real consumer
// (settings' "How Trackitdown works") needs them — no dead-end surface.
export { useOnboardingGate, type OnboardingGateState } from './hooks/useOnboardingGate';
export { AuthPlaceholderScreen } from './screens/AuthPlaceholderScreen';
export { OnboardingScreen } from './screens/OnboardingScreen';
