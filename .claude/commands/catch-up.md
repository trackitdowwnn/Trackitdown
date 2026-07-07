---
description: Brief me on where the project stands — recent work, repo health, and what's next
---

Give me a catch-up briefing on the project. I may have been away for
days or weeks — assume I remember the big picture but not the details.

1. **Recent work** — summarise the last 10–15 commits (`git log`) in
   plain English, grouped by theme, not a raw list. Note the date of
   the last commit.
2. **Working tree** — any uncommitted or unpushed work sitting around?
   (`git status`, branch state vs remote). If yes, summarise what it
   appears to be.
3. **Health check** — quickly run `npm run lint`, `npm run typecheck`,
   and `npm test`. Report pass/fail only (one line each). If anything
   is red, flag it as the first thing to fix.
4. **Roadmap position** — read `docs/ROADMAP.md` and mark, to your best
   assessment from the codebase, which v1 checklist items look done,
   in progress, or not started. Don't guess generously — "screen exists
   but has no tests and TODOs" is in progress, not done.
5. **Loose threads** — TODOs in the code (with owners), open questions
   noted in feature READMEs, and anything `/tidy` would likely flag
   (don't run the full audit — just an eyeball).
6. **Suggested next session** — propose the single most valuable thing
   to do next, in one short paragraph, based on the roadmap order
   (foundations → payments → core loop → trust layer) and anything red
   above.

Keep the whole briefing under a screen and a half. End by asking what
I want to start with.
