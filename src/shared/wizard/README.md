# Wizard — config-driven full-screen flows

**What:** A reusable full-screen wizard framework, modelled on Airbnb's
listing-creation flow. A flow is data: ordered **phases**, each with
**steps**; each step declares an id, question, screen component, and a zod
schema for its slice of the answers. The framework renders everything else —
chrome, navigation, validation gating, segmented progress, phase intro
screens, and a built-in review step. TypeScript-generic over the flow's
answers shape so consuming flows get full type safety.

**Who consumes it:** the posting stepper (details → photos → last seen →
bounty → verification), Stripe Connect onboarding, and future onboarding
flows. Not user-facing by itself — the dev-only `/wizard-demo` route
exercises it.

**Screen anatomy:** header row with the exit X top-left (dirty answers →
discard confirmation → `router.back()`) and a compact dot-pill progress
indicator top-right — one free-standing dot per phase (plus review),
completed dots sage, upcoming sand, the current slot stretched into a pill
that "worms" to the next slot on advance (the "Step 2 of 4" / "Review"
wording is screen-reader-only); one question per screen (`display` typography,
`spacing.xl` padding); fixed keyboard/safe-area-aware footer with a ghost
Back and a primary Next. Back is deliberately hidden on the first
screen AND on phase intros — intros advance only (per the flow brief);
earlier answers stay reachable via Back from steps and via the review
screen's Edit links. Next stays disabled until the step's zod schema
validates; the review screen's final CTA additionally requires EVERY step
schema to pass, so answers invalidated later (e.g. a cancelled edit) can
never be submitted. The final CTA label is per-flow config (e.g. "Publish")
— never a vague "Finish".

**State:** one serializable `answers` object driven by a pure navigation
reducer (`wizardReducer`), so navigation/gating/progress are unit-testable
without rendering. Draft persistence is deliberately out of v1; the state
shape and `onExit` hook are structured so it plugs in later (see the TODO in
`useWizardController`).

**Tables / Edge Functions:** none — client-side UI infrastructure only. No
`posts.status`, no money.

**Out of scope (v1):** save-and-exit / draft persistence, themed confirm
dialog (native Alert for now), the real posting flow.
