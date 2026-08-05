---
description: Step back and review the whole product — what to add, cut, or change, functionally and UX-wise. Produces a strategic plan, never code.
argument-hint: <optional lens, e.g. "before beta" or "focus on the spotter side">
---

Review the entire project as a product, not a codebase. Focus: $ARGUMENTS

You are acting as a product owner here, not an engineer. This command
NEVER implements — it produces a prioritised plan and routes each item to
the right command. Do not change a single file.

## Phase 1 — Build the picture

1. Read the doc set as a whole: DOMAIN.md, ROADMAP.md, BUILD_PLAN.md,
   SECURITY_AND_TRUST.md, DESIGN_SYSTEM.md, and the ADRs. Note where
   docs and reality have diverged.
2. Inventory what actually EXISTS: walk src/features and the routes, and
   list every feature with an honest status — shipped / partial / stubbed
   / specced-but-never-built. Mark BUILD_PLAN items that are ticked but
   look thinner than their spec, and unticked items that are actually done.
3. Trace the two core journeys end to end as a user would — OWNER (find
   app → post car → verified → sightings → recover → paid) and SPOTTER
   (find app → browse → alerts → sight → report → chat → paid) — noting
   every dead end, stub, missing link, or moment where the journey breaks
   or asks too much.
4. Check the EVIDENCE we have: what the [feature] funnel logs would tell
   us (which flows are instrumented, which aren't), and flag where we're
   guessing because nothing is measured.

## Phase 2 — The four questions

Answer each with specifics, not generalities:

1. WHAT'S MISSING that the core loop genuinely needs to work? (Gaps that
   break the journey — not nice-to-haves. A recovery loop with no way to
   confirm recovery is a gap; a dark mode is not.)
2. WHAT SHOULD BE CUT OR SIMPLIFIED? Look hard for: features built but
   unreachable or unused, two components/screens doing the same job,
   scope that has quietly crept past ROADMAP's v1 fence, flows with more
   steps than their value justifies, and anything I'd have to MAINTAIN
   forever for marginal benefit. Be blunt — this section is the point of
   the review.
3. WHAT'S INCOHERENT? Places where the app contradicts itself: navigation
   that no longer matches the feature set, two different patterns for the
   same interaction, terminology drift, register drift (playful where it
   should be calm), or a screen that's had five passes while its sibling
   has had none.
4. WHAT'S RISKY? Product risks, not bugs: single points of failure in the
   loop, trust/safety exposure, moderation load we can't sustain solo,
   anything that would embarrass us in an App Store review or a press
   question.

## Phase 3 — Interview me

One batch, informed by the above: where do I think the product is weakest?
What's my timeline pressure and launch intent right now? Anything I've
been avoiding? Any real-world signal (beta testers, my own use) that
should outweigh your analysis?

## Phase 4 — The plan (the deliverable)

A prioritised report:
- **Cut / simplify** (first, deliberately) — each with what it frees up.
- **Fix or finish** — gaps and incoherences blocking the core loop.
- **Add** — ruthlessly filtered: each item must state the user problem it
  solves, why NOW rather than post-launch, and what it costs to build AND
  maintain. Anything failing that test goes to a "later / never" list with
  reasoning, and the reasoning is the valuable part.
- **UX & design** — coherence work, journey friction, register fixes.
- **Risk mitigations.**

For every item: effort S/M/L, impact, and the ROUTE — which command
handles it (/create-main-feature, /improve, /polish, /airbnb-redesign,
/diagnose-and-fix-bug, an audit command, or "just a ROADMAP line").
End with a recommended NEXT THREE SESSIONS, and offer to write the
approved outcomes into ROADMAP.md / BUILD_PLAN.md as a follow-up.

## Rules
- Bias toward subtraction. A smaller, coherent, shipped app beats a
  larger unfinished one — every addition must beat "ship without it".
- Respect the v1 fence: anything on ROADMAP's "NOT in v1" list stays out
  unless you argue explicitly that the fence was wrong, and say why.
- No feature brainstorming for its own sake. If the honest answer is
  "nothing new — finish what's started", say exactly that.
- Ground claims in what you actually read; flag guesses as guesses.
- Never implement. Plan, route, stop.