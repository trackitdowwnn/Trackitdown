---
description: Analyse the most recently built component or feature and interview me about improvements, then implement the approved ones
argument-hint: <component/feature name (optional — detects latest from git if omitted)>
---

Analyse and improve: $ARGUMENTS

## Phase 1 — Identify the target

If I named a component/feature, that's the target. Otherwise inspect
`git log` (last ~10 commits) and the working tree to determine the most
recently built or substantially changed component or feature. State
what you've identified and confirm with me before proceeding — never
guess silently.

## Phase 2 — Investigate (before asking me anything)

Read the target's code, its tests, its feature README (if any), and the
relevant docs: DESIGN_SYSTEM.md for UI, DOMAIN.md if it touches posts/
sightings/money, LOGGING.md, TESTING.md. Run the test suite for the
target. Form your own view of its weaknesses first so the interview is
informed, not lazy.

## Phase 3 — Interview me

Ask in one batch of 3–5 questions, skipping anything your investigation
already answered. Cover:

1. **What prompted this?** Something specific bothering me, or a
   general polish pass?
2. **How does it feel in use?** Anything janky, slow, confusing, or
   ugly on the actual device? (UI targets only)
3. **Priorities** — rank what matters most right now: UX/design polish,
   performance, code quality/readability, accessibility, test coverage,
   error-handling robustness.
4. **Constraints** — is its public API (props/exports) frozen because
   other code consumes it? Any behaviour that must not change?
5. **Appetite** — quick wins only (this session), or is deeper rework
   on the table?

## Phase 4 — Analysis report (no changes yet)

Combine your investigation and my answers into a report, grouped as:

- **Bugs & correctness** — anything actually wrong, including domain-
  rule or logging/privacy violations found against the docs
- **UX & design** — gaps vs DESIGN_SYSTEM.md and the feel I described
- **Code quality** — readability, structure, naming, comment drift,
  oversized files
- **Accessibility** — labels, touch targets, contrast, dynamic type
- **Performance** — re-renders, list performance, unnecessary work
- **Tests** — missing coverage, weak assertions

Each item: one line, file:line where relevant, estimated effort
(S/M/L), and expected impact. ⚠️ Gatekeeper: if an "improvement" is
really a NEW capability, list it separately under **"Not improvements —
new scope"** and recommend /create-main-feature or a ROADMAP.md entry
instead. Do not smuggle new features into a polish pass.

Ask me to pick which items to implement. **Do not change anything until
I choose.**

## Phase 5 — Implement approved items only

1. Work through my selections smallest-first, keeping each change
   minimal and honouring any API-freeze constraint from Phase 3.
2. Update file headers/JSDoc where behaviour changed; update tests, and
   add the missing ones I approved.
3. Run the full checks (lint, typecheck, tests) and the `/review` logic
   with the relevant subagents; fix criticals.
4. Summarise: what improved, what was deliberately left, and anything
   from the report worth revisiting later. Suggest a commit message
   (`refactor:` or `fix:` as appropriate) — or run /create-commit if I
   say go.

## Rules

- Never rework for its own sake — every change traces to a report item
  I approved.
- Never weaken tests, validation, or `// SAFETY:`/`// MONEY:` code in
  the name of "cleanup".
- If the target turns out to be genuinely fine, say so and stop — "no
  changes needed" is a valid, successful outcome.