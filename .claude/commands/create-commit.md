---
description: Review and test current changes, create a well-written commit, show it to me, then optionally push and open a PR
---

Create a commit from the current changes. Follow this process strictly.

## Phase 1 — Pre-flight

1. Run `git status` and `git diff` (plus `--staged`). If there are no
   changes, say so and stop.
2. **Secrets check** — scan the diff for anything resembling keys,
   tokens, or `.env` content. If found, stop immediately and tell me.
3. **Coherence check** — if the diff contains unrelated changes (e.g. a
   payments fix mixed with a profile screen), tell me and propose
   splitting into separate commits. Wait for my choice before staging.

## Phase 2 — Review and test

1. Run the `/review` logic: code-reviewer always, plus ui-reviewer /
   security-reviewer / test-writer based on what the diff touches.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, and
   `node scripts/check-file-headers.mjs`.
3. Fix Critical findings and failures, re-run once to confirm. If
   something can't be fixed cleanly, stop and explain — **never commit
   red.** Also never bypass checks with `--no-verify` or by skipping
   tests.

## Phase 3 — Commit

1. Stage the agreed files and commit with this message format:
   - **Summary line:** conventional prefix + plain English, under 70
     chars. Prefixes: `feat:` `fix:` `chore:` `docs:` `test:`
     `refactor:`. Example: `feat: sighting report flow with in-app
     camera and GPS capture`
   - **Body:** 2–6 short lines a non-developer could follow — WHAT
     changed and WHY, noting any domain rule applied (reference
     DOMAIN.md section if relevant), any migration included, and any
     doc updated. No jargon walls.
2. Show me the commit in detail: the full message, `git show --stat`,
   and a one-paragraph plain-English summary of the change.

## Phase 4 — Push and PR (my choice)

Ask me explicitly: **(a)** push to the current branch, **(b)** push AND
open a pull request, or **(c)** leave it local.

- If (a): push and confirm CI has been triggered.
- If (b): push, then `gh pr create` with a title matching the commit
  summary and a description containing: what/why, screenshots note if
  UI changed, test evidence (suite results), and a checklist of docs
  touched. Show me the PR link.
- Never force-push, and never push directly if the working tree still
  has unrelated uncommitted changes without telling me first.
