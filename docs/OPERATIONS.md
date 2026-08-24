# Operations — the queues, and how to actually look at them

WHAT: The queries that read everything this app collects and nothing in it
      displays. Run them in the Supabase SQL editor.
WHY:  Six tables collect things a person is waiting on, and **no code anywhere
      reads any of them**. `bug_reports`, `post_flags`, `flags`,
      `refund_disputes`, `payout_reviews`, `onboarding_events` — no screen, no
      Edge Function, no script. `SECURITY_AND_TRUST.md` §2 says "there is no
      moderator tooling at all" and `DOMAIN.md` says it twice more, so this is
      known — but a queue nobody reads is not a deferred feature, it is a
      promise the app is already making.

      ⚠️ THE BUG REPORTER SAYS "Thanks — we'll take a look." Someone read that
      sentence and believed it. Until there is a screen, this file is the only
      thing that makes it true.

LINKS: supabase/tests/operator_queries_verification.sql — ⚠️ CI EXECUTES EVERY
      QUERY BELOW. A runbook of plausible-but-broken SQL is worse than none,
      because it fails at the moment somebody actually needs it. If you edit a
      query here, edit it there.

---

## How often

| Queue | Why it can't wait | Suggested |
|---|---|---|
| **Refund disputes** | ⚠️ A **72-hour** window. A spotter who was denied a bounty has three days to contest, and after that it closes whether or not anyone looked. | Daily |
| **Payout reviews** | Money held pending a human decision. | Daily |
| **Bug reports** | Someone was told we'd look. | Every few days |
| Post flags / flags | Safety reports — including "this person is tracking a person, not a car". | Weekly, sooner if volume moves |
| Onboarding funnel | Nobody is waiting on it. | Whenever you want the number |

---

## 1. Bug reports

Newest first, worst first. `severity = 'lost'` means they told us they lost
money or data.

```sql
select
  b.created_at,
  b.severity,
  b.frequency,
  b.area,
  b.message,
  b.expected,
  b.app_version,
  b.platform,
  b.os_version,
  b.device_model,
  coalesce(array_length(b.screenshot_paths, 1), 0) as screenshots,
  b.breadcrumbs
from public.bug_reports b
order by (b.severity = 'lost') desc, b.created_at desc
limit 50;
```

**The screenshots** are object paths in the PRIVATE `bug-screenshots` bucket —
there is no public URL and no client can read them. Open them from the Supabase
dashboard: **Storage → bug-screenshots →** the folder named with the reporter's
user id. The paths in `screenshot_paths` are exactly what you will see there.

⚠️ **`message` and `expected` are free text somebody typed.** The screen asks
them not to include a plate or an address; nothing enforces it, and nothing in
this app moderates free text. Treat what you find accordingly.

## 2. Refund disputes — the 72-hour one

```sql
select
  d.created_at,
  d.status,
  d.statement,
  d.post_id,
  d.sighting_id,
  d.spotter_id,
  d.resolved_at
from public.refund_disputes d
where d.status = 'open'
order by d.created_at asc
limit 50;
```

Oldest **first** here, deliberately — the one closest to running out of time is
the one to read next. Everywhere else newest-first is right; not here.

## 3. Payout reviews

```sql
select
  r.created_at,
  r.post_id,
  r.owner_id,
  r.spotter_id,
  r.reasons
from public.payout_reviews r
order by r.created_at asc
limit 50;
```

## 4. Safety reports

Post flags, then the generic flags table (messages, posts, sightings, photos):

```sql
select f.created_at, f.post_id, f.reporter_id, f.reason
from public.post_flags f
order by f.created_at desc
limit 50;
```

```sql
select f.created_at, f.target_type, f.target_id, f.reporter_id, f.reason
from public.flags f
order by f.created_at desc
limit 50;
```

⚠️ The safety guidelines invite people to report someone using Trackitdown **to
track a person rather than find a vehicle**. That report lands in one of these
two tables and nowhere else.

## 5. Onboarding funnel

How far people get through the intro. Runs are anonymous and unlinkable by
design — see `src/features/auth/lib/onboardingFunnel.ts`.

```sql
select
  e.slide,
  count(distinct e.run_id) as runs
from public.onboarding_events e
where e.step = 'slide_viewed'
  and e.at > now() - interval '30 days'
group by e.slide
order by e.slide;
```

Then the two ways a run ends:

```sql
select
  e.step,
  e.platform,
  count(distinct e.run_id) as runs
from public.onboarding_events e
where e.step in ('completed', 'skipped')
  and e.at > now() - interval '30 days'
group by e.step, e.platform
order by e.step, e.platform;
```

Completion rate is `completed ÷ (runs that saw slide 1)`.

⚠️ **These counts can be inflated by anyone.** `record_onboarding_step` is the
app's only anon-writable endpoint — it has to be, because onboarding runs before
sign-in. One run is capped at (slides + 2) rows, but nothing stops a script
minting run ids. If a number looks implausible, suspect that before believing
it. Full reasoning in `20260824190000_onboarding_funnel.sql`.

---

## What this file is not

A moderation tool. There is no way here to action anything — no resolving a
dispute, no removing a post, no replying to a bug report. Reading is the whole
of it, and reading is what was missing. `BUILD_PLAN.md` still has the dashboard
unticked, and this does not tick it.
