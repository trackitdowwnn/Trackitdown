---
description: Interview me about the work I'm starting, then create a properly named and configured git branch
argument-hint: <rough description of the work (optional)>
---

I want to create a branch for: $ARGUMENTS

## Phase 1 — Interview

Check the current state first (`git status`, `git branch --show-current`),
then ask me in one small batch (skip anything already answered):

1. **What's the work?** One sentence. Which BUILD_PLAN.md /
   ROADMAP.md item does it belong to, if any?
2. **What type is it?**
   - `feature/` — new functionality
   - `fix/` — bug fix
   - `chore/` — tooling, config, dependencies, docs
   - `refactor/` — restructuring without behaviour change
   - `experiment/` — trying something that may be thrown away
3. **Base branch** — branch off `main` (default) or somewhere else?
4. **Uncommitted changes** — if `git status` shows any, ask what to do:
   bring them onto the new branch (default — they come along
   automatically), commit them to the current branch first via
   `/create-commit`, or stash them. Never silently lose or carry work.

⚠️ Gatekeepers:
- If the described work is really 2+ unrelated pieces of work, say so
  and suggest separate branches.
- If it's a v2 item per ROADMAP.md's "NOT in v1" list, flag it before
  creating anything.
- If I'm not on `main` and didn't say so deliberately, warn me I'd be
  branching off a branch.

## Phase 2 — Create and configure

1. Propose the branch name: `type/short-kebab-description` — lowercase,
   2–4 words, describes the work not the date (e.g.
   `feature/dvla-plate-lookup`, `fix/refund-on-expiry`). Confirm with me.
2. If branching from `main`, make sure it's current first:
   `git checkout main && git pull` (skip pull gracefully if offline).
3. Create and switch: `git checkout -b <name>`.
4. Handle uncommitted changes per my Phase 1 answer.
5. Publish it so it's backed up and CI-visible:
   `git push -u origin <name>`.
6. Tell me the branch is ready, restate in one line what this branch is
   for (so it's in the session record), and remind me: work here ends
   with `/create-commit`, and when the work is complete, merging back
   to `main` happens via a PR (`/create-commit` option b) or
   `git checkout main && git merge <name>` — then delete the branch to
   keep the repo tidy.

## Rules

- Never create a branch with uncommitted-changes ambiguity unresolved.
- Never branch off a stale `main` without pulling (or telling me pull
  failed).
- Experiment branches: remind me they're throwaway — if the experiment
  succeeds, the real work gets a fresh `feature/` branch or clean
  commits, not a merged mess of exploration.