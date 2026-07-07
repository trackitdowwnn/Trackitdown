---
description: Draft a Supabase migration with RLS, using the db-migration-writer subagent
argument-hint: <what the migration should do>
---

Create a database migration for: $ARGUMENTS

1. Delegate the drafting to the **db-migration-writer** subagent — it owns
   the schema conventions (RLS on every table, deny by default, money in
   integer pence, snake_case, PostGIS for locations).
2. When the draft comes back, run the **security-reviewer** subagent on
   the new migration file.
3. Fix anything Critical, then show me:
   - the final SQL,
   - a plain-English summary of each table/policy/function added,
   - the command to apply it locally (`npx supabase db reset` or
     `npx supabase migration up`),
   - a warning if the migration is destructive (drops/renames columns or
     tables) — destructive migrations always need my explicit approval
     before being applied anywhere.

Never apply a migration to a remote/production database from this
command; local only.
