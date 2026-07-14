/**
 * WHAT:  App root route ('/') — renders nothing; AuthGate (in the root layout)
 *        redirects away based on onboarding + session + profile state.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3). The single source
 *        of routing truth is now AuthGate's state machine (it also covers the
 *        screen with the brand splash while state restores — no flash), so this
 *        landing just holds a frame until the gate redirects.
 * LINKS: src/features/auth/components/AuthGate.tsx; src/app/_layout.tsx.
 */

export default function RootIndex() {
  return null;
}
