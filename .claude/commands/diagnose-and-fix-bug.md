---
description: Interview me about a bug, reproduce it, propose a fix for approval, implement, test, and retry with explanation if the fix fails
argument-hint: <description of the bug (optional)>
---

There is a bug: $ARGUMENTS

Follow this process strictly. Do not jump to fixing.

## Phase 1 — Understand the bug

Investigate first so your questions are informed: check `git log` for
recent changes, read the code in the suspected area, and check for
related tests. Then interview me in batches of 3–5 questions, skipping
anything already answered. Cover:

1. **Symptom** — what happens vs what should happen? Exact error
   messages, red screens, or wrong values (paste anything you have).
2. **Reproduction** — exact steps to trigger it. Every time or
   intermittent? Specific data (a particular post/plate/amount)?
3. **Context** — iOS, Android, or both? Simulator or device? Logged in
   as owner, spotter, or moderator?
4. **Timeline** — when did it start? What changed around then (check
   git log and tell me what you find)?
5. **Blast radius** — does it touch money, post status, or safety
   features? If yes, treat as high severity: check `docs/DOMAIN.md`
   for what the correct behaviour is *supposed* to be.

## Phase 2 — Reproduce and diagnose

1. Reproduce the bug before changing anything — ideally by writing a
   **failing test** that captures it. If it can't be captured in a test
   (pure UI/device issue), state how you'll verify the fix instead.
2. Find the root cause. Distinguish the *root cause* from the *symptom*
   — do not propose patching the symptom.
3. Explain the diagnosis to me in plain English: what's broken, why,
   and how it got introduced (if determinable from git history).

## Phase 3 — Propose, approve, fix

1. Propose the fix. If there are multiple viable approaches, show 2
   with trade-offs and a recommendation. **Wait for my approval.**
2. Implement the approved fix, keeping the change as small as possible.
   Never weaken tests, delete `// SAFETY:`/`// MONEY:` code, or loosen
   validation to make the bug "go away".

## Phase 4 — Verify, and retry if needed

1. Run the failing test from Phase 2 (it must now pass), then the full
   suite, lint, and typecheck. Nothing else may have broken.
2. **If the fix works:** keep the regression test permanently, summarise
   what was wrong and what changed, and suggest a commit message
   (`fix: …`). If the bug revealed a wrong assumption in the docs,
   remind me to update the relevant doc.
3. **If the fix does not work:** revert it cleanly, then explain —
   what did we expect, what actually happened, and what that tells us
   about the real cause. Update the diagnosis and propose the next fix
   for approval. Maximum 3 fix attempts: after the third failure, stop,
   revert to a clean state, and give me a full write-up of everything
   learned and recommended next steps (e.g. more logging, upstream bug,
   needs a fresh session). Thrashing is worse than stopping.
