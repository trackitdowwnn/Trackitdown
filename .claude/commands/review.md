---
description: Run the appropriate Trackitdown review subagents on recent changes
---

Review the current changes end-to-end.

1. Run `git status` and `git diff` (and `git diff --staged`) to determine
   what changed. If there are no changes, say so and stop.
2. Always run the **code-reviewer** subagent on the changes.
3. Additionally, based on what the diff touches:
   - Screens, components, styles, or anything under `src/shared/ui` or
     `src/shared/theme` → also run the **ui-reviewer** subagent.
   - Auth, payments/Stripe, sightings, location, uploads, RLS policies,
     migrations, or Edge Functions → also run the **security-reviewer**
     subagent.
   - Lines marked `// MONEY:` or `// SAFETY:` without corresponding test
     changes → also run the **test-writer** subagent to close the gap.
4. Consolidate all findings into a single report:
   - **Critical** (must fix before this work is done)
   - **Warnings**
   - **Suggestions**
5. Fix the Critical items, then re-run the relevant subagent(s) once to
   confirm. Do not loop more than twice — if something still fails after
   two passes, stop and explain the blocker.

Keep the final summary short: what was reviewed, what was fixed, what
remains (if anything).
