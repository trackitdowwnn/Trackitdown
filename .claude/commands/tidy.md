---
description: Audit the repo for structural drift, stale docs, oversized files, and dead code — run weekly
---

Run a full housekeeping audit of the repository. Do NOT change anything
during the audit — report first, fix only after I approve.

Audit checklist:

1. **Structure drift** — compare the actual folder tree against
   `docs/ARCHITECTURE.md`: files outside `src/features/*` or `src/shared/*`,
   top-level `components/`/`utils/` folders sneaking in, feature folders
   missing `index.ts` or `README.md`, route files in `app/` containing
   real logic.
2. **Import hygiene** — grep for cross-feature deep imports (anything
   importing `features/<x>/...` from outside that feature, except via its
   `index.ts`) and any `shared/` file importing from `features/`.
3. **Oversized files** — list source files over 300 lines with a one-line
   suggestion for how each could be split. (Long ≠ wrong, but every one
   needs a reason.)
4. **Comment rot** — sample changed-recently files: do WHAT/WHY headers
   still match what the code does? Flag headers that have drifted.
5. **Dead weight** — exported functions/components with zero imports,
   unused dependencies in package.json, commented-out code blocks,
   `TODO`s without an owner (per COMMENTING_STANDARDS.md).
6. **Doc freshness** — do feature READMEs list the tables/screens that
   actually exist now? Does DOMAIN.md match the implemented lifecycle?
   Any decision made recently that deserves an ADR in `docs/decisions/`?
7. **Test gaps** — any `// MONEY:` or `// SAFETY:` lines without
   corresponding tests (cross-check docs/TESTING.md Tier 1).

Output a report grouped as: **Fix now** (violations of hard rules),
**Fix soon** (drift that will compound), **Consider** (judgement calls).
Keep each item to one line with a file path.

After I approve, fix the "Fix now" items, run `/review`, and suggest a
single commit message for the cleanup (e.g. `chore: weekly tidy — …`).
