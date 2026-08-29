# Wizard — config-driven full-screen flows

**What:** A reusable full-screen wizard framework, modelled on Airbnb's
listing-creation flow. A flow is data: ordered **phases**, each with
**steps**; each step declares an id, question, screen component, and a zod
schema for its slice of the answers. The framework renders everything else —
chrome, navigation, validation gating, segmented progress, phase intro
screens, and a built-in review step. TypeScript-generic over the flow's
answers shape so consuming flows get full type safety.

**Who consumes it:** five real flows — post-a-car (details → photos → last
seen → bounty; the verification step was removed by ADR-0007), add-a-vehicle
in the garage, report-a-sighting, the alert wizard, and report-a-bug (added
2026-08-27). Read any of those as the reference. The dev-only `/wizard-demo`
route was deleted 2026-08-01: once real consumers existed, a fake one could
only drift out of date.

⚠️ Report-a-bug is the one to read for a flow that must stay SHORT: it groups
several questions per step and marks everything after the first `optional`,
because unlike the other four its user is not motivated — they are annoyed and
doing you a favour.

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
never be submitted — and since 2026-08-22 the review SAYS which answers it is
waiting on (`invalidStepIds`), because a greyed-out button over a dozen rows
named none of them. The final CTA label is per-flow config (e.g. "Publish")
— never a vague "Finish".

**The review screen has two optional slots** (`review.header`, `review.footer`)
for flows with something to SHOW or something to CHARGE — `reviewValue` returns
a string, so a list of rows can only ever describe what was typed. The FEATURE
builds the element and passes it in; `shared/` stays feature-agnostic
(ARCHITECTURE rule 2), the same way `VehicleCard` takes `topRightAction`. The
header slot is handed an `editStep(stepId)` — or a list of ordered candidate
ids, first match wins — so a flow never does index arithmetic against a screen
list the framework builds.

⚠️ Flows that pass neither slot get no slot CONTENT, but they are not otherwise
unchanged: the group rhythm, the single-hairline boundaries, the 44pt Edit
target and the blocking notice are all framework-wide. Three of the five flows
pass no slots and all three change visually. Report-a-bug passes only
`footer`, and passes it a disclosure panel rather than a price — the slot is
"something to SHOW before committing", not "something to charge".

**State:** one serializable `answers` object driven by a pure navigation
reducer (`wizardReducer`), so navigation/gating/progress are unit-testable
without rendering. Draft persistence is deliberately out of v1; the state
shape and `onExit` hook are structured so it plugs in later (see the TODO in
`useWizardController`).

**Tables / Edge Functions:** none — client-side UI infrastructure only. No
`posts.status`, no money.

**Out of scope (v1):** save-and-exit / draft persistence, themed confirm
dialog (native Alert for now), the real posting flow.
