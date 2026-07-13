---
description: Deep-research how Airbnb designs the equivalent of a given section, then redesign our section using that knowledge
argument-hint: <section of the app (e.g. "the chat screen", "post detail", "filters sheet")>
---

Research Airbnb's design for the equivalent of this section, then
redesign ours to match that standard: $ARGUMENTS

## Phase 1 — Map the analogue

1. Read our section's code, its feature README, and DESIGN_SYSTEM.md.
   State what the section IS in product terms (its job, its user, its
   emotional context).
2. Determine Airbnb's closest analogue — directly (feed↔Explore,
   detail↔listing page, wizard↔listing creation, chat↔guest-host
   messaging, profile↔profile) or by pattern when no twin exists
   (sighting report ≈ their review/photo submission; moderation has
   no consumer analogue → use their design LANGUAGE applied to admin
   patterns). State the mapping and its confidence. If the analogue
   is weak, say so and adjust expectations — we borrow their design
   language, not a screen that doesn't exist.

## Phase 2 — Deep research (this phase deserves real time)

1. SCREENSHOTS FIRST: check docs/design-refs/<section>/ for images —
   if present they are the primary reference; analyse them for
   measurable specifics. If absent, tell me this command works
   dramatically better if I add 5–8 screenshots of Airbnb's analogue
   there, and offer to pause while I do (my choice — continue on web
   research alone if I say go).
2. Web research, multiple angles: UX breakdowns/teardowns of the
   analogue, Airbnb design-team writing about it, redesign case
   studies, and the 2025 design-language context (modular components,
   restrained motion, photography-first).
3. Produce the REFERENCE SPEC — concrete and measurable, not vibes:
   layout structure and rhythm (spacings in pt), type hierarchy,
   component anatomy, what floats vs scrolls vs sticks, interaction
   patterns (gestures, transitions, states), motion behaviours, and
   the emotional register of the copy. Map every observation to our
   nearest token; propose token additions where none fits.

## Phase 3 — Gap analysis

Our section vs the reference spec, every divergence grouped: layout &
rhythm / component anatomy / typography & hierarchy / interaction &
motion / states (loading, empty, error) / copy register. Each:
current → reference → proposed change → effort S/M/L → visual impact.
Call out the 3 changes that close most of the gap.

## Phase 4 — Interview me

One informed batch: what bothers me about the current section? Full
fidelity to the reference or selective adoption? Any behaviours that
must not change? Where translation is needed (their context ≠ ours —
e.g. their joyful register vs our distressed owner), present the
tension and let me pick the register.

## Phase 5 — Options, then build

Present 2–3 coherent redesign directions (one always "current +
highest-impact fixes only"). After I choose: implement
smallest-visual-risk first, showing me the section after each
significant change; tokens only; new reusable patterns promoted to
shared/ui properly; shared components that ripple (VehicleCard,
AppSheet, etc.) checked in their OTHER contexts and skeletons updated
to match.

## Phase 6 — Verify

Updated reference-spec checklist (matched / adapted / deliberately
skipped, with reasons), ui-reviewer run, reminder to judge on BOTH
phones side-by-side with the real Airbnb screen, then /create-commit.

## Hard rules
- System, not trade dress: adopt structure, rhythm, anatomy, motion
  feel — never their coral, Cereal-like type, icon set, or verbatim
  copy. Our palette, Inter, lucide stay unless /theme-audit decides
  otherwise.
- Emotional translation is mandatory: Airbnb designs for anticipation
  and joy; parts of our app serve distress. Where the reference's
  register is wrong for our moment, adapt and note it — fidelity to
  the FEELING appropriate for our user beats fidelity to Airbnb.
- Feature architecture and data layer stay unless a visual change
  strictly requires otherwise — flag any such case.
- If our section already matches the reference well, say so — "minor
  fixes only" is a valid outcome.