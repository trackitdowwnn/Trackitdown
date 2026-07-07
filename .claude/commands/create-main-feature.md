---
description: Interview me about a new feature, write a spec into the feature README, get approval, then scaffold and build it
argument-hint: <feature name or rough idea (optional)>
---

I want to create a main feature: $ARGUMENTS

Your job is to deeply understand this feature BEFORE writing any code.
Follow this process strictly:

## Phase 1 — Interview (no code yet)

First read `docs/ARCHITECTURE.md`, `docs/DOMAIN.md`, and `docs/ROADMAP.md`
so your questions are informed. Skip anything already answered by my
prompt, the docs, or the codebase. Ask in batches of 3–5 questions
maximum, wait for my answers, and follow up where answers open new
questions. Cover:

1. **Purpose & scope** — What does this feature do, in one sentence?
   Which actor is it for (owner / spotter / moderator)? ⚠️ Gatekeepers:
   if it appears in ROADMAP.md's "NOT in v1" list, stop and tell me. If
   it's really a change to an existing feature, say so and suggest where
   it belongs instead.
2. **User flow** — Where does the user enter this feature from? Walk me
   through the happy path screen by screen. Where does it exit to? What
   are the unhappy paths (validation failure, no results, offline)?
3. **Data** — What data does it read and write? New tables/columns or
   existing ones? Does anything here change `posts.status` or touch
   money (then DOMAIN.md lifecycle rules apply and logic must be
   server-side)? Realtime needed?
4. **Server side** — Any new Edge Functions? Push notifications
   triggered? Third-party APIs (DVLA, Stripe)?
5. **UI** — List the screens. Which existing `src/shared/ui` components
   will be reused? Anything new needed (if a new component is shared,
   note it — we may run /create-shared-component first)?
6. **Rules & safety** — Which DOMAIN.md rules apply? Does any part need
   the SafetyNotice, rate limits, or moderator visibility? Privacy
   implications (location, plates, documents)?
7. **Done means** — How will we know it works? What's explicitly OUT of
   scope for this feature right now?

## Phase 2 — Spec & approval

Write the spec as the feature's `README.md` content (purpose, actor,
screens, flow, tables, Edge Functions, rules applied, out-of-scope) and
show it to me together with a build plan: an ordered list of steps
(scaffold → data layer → api/hooks → screens → wiring → tests), each
small enough to review. Flag any DOMAIN.md ambiguity as an open question.
**Do not build until I approve the spec and plan.**

If the spec introduces a genuinely new product rule, remind me it should
be added to `docs/DOMAIN.md` (and an ADR if it's a big call) in the same
session.

## Phase 3 — Build

1. Scaffold `src/features/<feature-name>/` per ARCHITECTURE.md: the
   approved README.md, `index.ts` public API, `types.ts`, and only the
   subfolders the plan needs. WHAT/WHY/LINKS headers everywhere.
2. Work through the plan step by step. If schema changes are needed,
   use the **db-migration-writer** subagent. Pause and show me progress
   after each major step rather than building everything silently.
3. Keep route files in `app/` thin — they import screens only.
4. Write tests per `docs/TESTING.md` (Tier 1 is mandatory if money or
   safety is involved).
5. Finish by running `/review` (code-reviewer plus ui-reviewer /
   security-reviewer as relevant), fix criticals, and give me a summary
   plus a suggested commit message.
