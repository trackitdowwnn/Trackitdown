---
description: Review the app's animations, research best practices, and suggest a coherent motion system plus specific animation improvements
argument-hint: <specific concern or area (optional, e.g. "screen transitions feel abrupt")>
---

Review and improve the app's motion design. Focus: $ARGUMENTS

## Phase 1 — Audit what we have

1. Inventory every animation in the codebase: grep for Reanimated
   usage (withTiming, withSpring, useAnimatedStyle, entering/exiting),
   Animated API, LayoutAnimation, and navigation transition config.
   For each: where it lives, duration/easing values, and whether it
   runs on the UI thread.
2. Identify INCONSISTENCIES: different durations/easings for the same
   kind of gesture, springs configured differently per component,
   hard-coded values that should be shared.
3. Map the DEAD ZONES — interactions with no motion at all where users
   would expect it: screen pushes, list item appearance, state changes
   (status badges, counts), button presses, pull-to-refresh, tab
   switches, sheet transitions, empty→content transitions.
4. Check every existing animation against reduced-motion support.

## Phase 2 — Research

1. Airbnb's motion language (our inspiration): restrained, springy,
   continuity-focused — shared-element feel between card and detail,
   gentle scale feedback, calm easing. What they animate and — just as
   important — what they DON'T.
2. Platform conventions: iOS vs Android transition norms, what feels
   native on each.
3. Reanimated best practice: UI-thread-only animation, entering/exiting
   layout animations, spring configs that feel physical, avoiding
   JS-thread jank in lists.
4. Motion accessibility: reduced-motion patterns, vestibular-safe
   choices (fades over large translations/zooms when reduced).

## Phase 3 — Interview me

One batch, 3–5 questions, informed by the audit:
1. Where does the app currently feel dead, abrupt, or janky to me on
   the phone?
2. Personality dial: how springy/playful vs strictly calm? (Context:
   distressed owners use this app — my default lean is calm with
   warmth in spotter/success moments; challenge if the research
   disagrees.)
3. Priority surfaces: which flows matter most right now?
4. Appetite: quick wins only, or is a motion-token refactor on the
   table this session?

## Phase 4 — Report (no changes yet)

Part A — THE MOTION SYSTEM: propose motion tokens for shared/theme +
DESIGN_SYSTEM.md: duration scale (instant/fast/base/slow), named
easings, 2–3 named spring configs (e.g. gentle/standard/bouncy), and
usage rules (which token for which class of interaction). Include the
reduced-motion policy as part of the system, not a footnote.

Part B — SPECIFIC IMPROVEMENTS, grouped:
- Fix