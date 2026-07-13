---
description: Investigate the app's colour usage and recommend the best colour theme options, with live previews, before changing anything
argument-hint: <specific concern or goal (optional, e.g. "feels too beige")>
---

Investigate and recommend the best colour theme for this app. Focus: $ARGUMENTS

## Phase 1 — Audit what we have

1. Read docs/DESIGN_SYSTEM.md and src/shared/theme in full; inventory
   every colour token and its stated role.
2. Grep the codebase for how tokens are ACTUALLY used: which dominate
   by surface area (backgrounds, cards), which carry meaning (bounty
   terracotta, status colours, danger), and any hard-coded hex values
   that escaped the token system (report these as violations).
3. Identify the app's colour-critical moments: the borderless
   VehicleCard feed (photos sit directly on the background), bounty/
   money moments, safety notices, status system, and the map's palette.

## Phase 2 — Research

Web-research colour direction for this app's specific character:
1. Airbnb's actual palette system (our stated inspiration): how they
   use near-white surfaces, one vivid accent used sparingly, and let
   photography carry colour.
2. Trust/safety/finance app conventions — this app holds money and
   deals with crime; which palettes signal "calm and credible" vs
   "alarmist" vs "toy-like".
3. Colour psychology relevant to our tensions: an app about theft that
   must not feel frightening; a bounty that must feel rewarding, not
   casino-like.
4. Accessibility ground rules: WCAG AA contrast on our chosen
   backgrounds, colour-blind-safe status distinctions (never colour
   alone for status meaning).

## Phase 3 — Interview me

One batch, 3–5 questions, informed by Phases 1–2. Must include:
1. The standing open question: keep the warm cream base (#FAF7F2) or
   move to Airbnb pure-white — present what the audit says each does
   to the photo-led feed before I answer.
2. How the current palette FEELS to me on the phone right now — what's
   working, what's bothering me.
3. Brand ambition: distinctive-and-ownable vs quietly-neutral.
4. Any colours that are off-limits or must stay (e.g. attachment to
   the sage/terracotta pairing).

## Phase 4 — Options report (no changes yet)

Present 2–3 COMPLETE theme options (not single-colour swaps). For each:
- The full token set (every token in our theme, with hex values)
- Rationale in one paragraph: what it signals, how it serves the
  photo-led feed, money moments, and safety copy
- A contrast table: every text-on-background pairing with its WCAG
  ratio, pass/fail at AA (fix or flag anything failing)
- Status-system check: the five status colours distinguishable for
  common colour-blindness types, with a non-colour cue confirmed
- What changes vs today, in plain English ("warmer", "higher contrast",
  "accent moves from terracotta to X")
One option should always be "refined current" (keep the identity, fix
the audit's findings) so change is a choice, not an assumption.

## Phase 5 — Live preview, then decide

For my 1–2 shortlisted options: apply each as a TEMPORARY theme (a
switchable theme object or a branch — spec the mechanism) so I can view
the REAL app — feed, detail page, wizard, profile — on my actual phone
in each candidate. I decide by looking, not by hex values in a report.

## Phase 6 — Apply (only after my explicit choice)

1. Update src/shared/theme tokens and DESIGN_SYSTEM.md in the same
   change; add an ADR (docs/decisions/) recording the decision and
   rationale.
2. Run ui-reviewer; fix criticals; remind me to eyeball every major
   screen on BOTH phones and check the map style still harmonises.
3. Suggest the commit (or /create-commit).

## Rules
- NEVER change brand tokens before Phase 6 approval — investigation
  and preview only.
- Palette meaning survives any change: accent = value/bounty moments
  only, danger = destructive/error only, statuses keep semantic roles.
- We adopt systems, not trade dress: no copying Airbnb's exact coral
  or another brand's signature colour.
- If the audit concludes the current theme is genuinely right, say so
  — "keep it, fix the violations" is a valid outcome.