---
description: Interview me about a new shared UI component, write a spec, get approval, then build it in src/shared/ui
argument-hint: <component name or rough idea (optional)>
---

I want to create a shared component: $ARGUMENTS

Your job is to deeply understand this component BEFORE writing any code.
Follow this process strictly:

## Phase 1 — Interview (no code yet)

First, read `docs/DESIGN_SYSTEM.md` and skim `src/shared/ui/` so your
questions are informed. Skip any question already answered by my prompt
or the codebase. Ask in batches of 3–5 questions maximum, wait for my
answers, and ask follow-ups where my answers open new questions. Cover:

1. **Purpose & placement** — What is it, in one sentence? Which features
   and screens will use it? ⚠️ Gatekeeper: a shared component must be
   needed by 2+ features OR be a design-system primitive. If it's only
   used by one feature, tell me it belongs in that feature's
   `components/` folder instead, and stop.
2. **Anatomy** — What does it contain (text, image, icon, input…)? Is
   there an existing component in `src/shared/ui/` it should compose or
   that already half-does this?
3. **Variants & states** — sizes/variants? Interactive states (pressed,
   disabled, focused)? Data states (loading skeleton, empty, error)?
4. **API** — What data goes in (props)? What events come out? Any
   sensible defaults?
5. **Behaviour edges** — very long text, missing image, small screens,
   RTL not needed (UK only) but dynamic type is: how should it degrade?
6. **Design specifics** — which tokens (colour roles, radius, spacing)?
   Any motion (keep within 200–250ms ease-out)? Anything Airbnb-reference
   I should mimic?
7. **Accessibility** — label strategy, touch target, is it purely
   decorative or interactive?
8. **Domain rules** — does it display money (must use the shared pence
   formatter), plates (PlateChip), or safety copy (fixed wording)? Check
   `docs/DOMAIN.md` / `docs/SECURITY_AND_TRUST.md` if relevant.

## Phase 2 — Spec & approval

Write back a short spec: purpose, prop table, variants/states matrix,
tokens used, edge-case behaviour, and where it will live. Ask me to
approve or amend. **Do not build until I approve.**

## Phase 3 — Build

1. Create `src/shared/ui/<ComponentName>.tsx` with the WHAT/WHY/LINKS
   header; the WHY should summarise the spec.
2. Use theme tokens only — zero magic values.
3. Add a usage example in the header comment (one JSX snippet).
4. Write component tests per `docs/TESTING.md` (render states +
   interactions).
5. Export it from the appropriate barrel so features can import it.
6. Run the **ui-reviewer** subagent, fix criticals, then show me the
   component with a summary and suggested commit message.
