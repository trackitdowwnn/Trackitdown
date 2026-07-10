# Feature: auth

Sign up / sign in, session handling, and onboarding. First slice: the
**onboarding intro** — four calm, animated, swipeable slides shown once on
first launch (before auth) teaching how Trackitdown works: post your stolen
car → people nearby get alerted → spot it and report from a distance (the
app's first safety message) → recovered, bounty paid. Re-viewable later via
`/onboarding?revisit=1` ("How Trackitdown works" in settings).

**Screens:** `OnboardingScreen` (slide pager), `AuthPlaceholderScreen`
(stub the real sign-in replaces).
**Routes:** `src/app/onboarding.tsx`, `src/app/auth.tsx`; the gate lives in
`src/app/index.tsx` via `useOnboardingGate`.
**Data:** local AsyncStorage flag only (`trackitdown.onboarding_seen_v1` —
version in the key so a redesign can re-show). No tables, no Edge Functions.
**Out of scope here:** real auth, the alert-radius/permission flow (separate
work), final slide illustrations (placeholder emoji, TODO(art)).
