# Operations — the queues, and how to actually look at them

WHAT: The queries that read everything this app collects and nothing in it
      displays. Run them in the Supabase SQL editor.
WHY:  Seven tables collect things a person is waiting on, and **no code anywhere
      reads any of them**. `bug_reports`, `post_flags`, `flags`,
      `refund_disputes`, `payout_reviews`, `onboarding_events`,
      `telemetry_events` — no screen, no Edge Function, no script. `SECURITY_AND_TRUST.md` §2 says "there is no
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

⚠️ **These counts can be inflated by anyone.** `record_onboarding_step` is one
of the app's two anon-writable endpoints — it has to be, because onboarding runs
before sign-in. One run is capped at (slides + 2) rows, but nothing stops a
script minting run ids. If a number looks implausible, suspect that before
believing it. Full reasoning in `20260824190000_onboarding_funnel.sql`.

---

## 6. The funnel — everything else

Landed 2026-08-30, closing ROADMAP critical path #2. 86 snake_case events were
already instrumented across the app as `log.info('event_name', {...})`; until
this, none of them left the Metro console, because nothing ever registered a
sink. Sessions are anonymous and unlinkable by design — no user id, and the
session id is generated in memory and never written to the device. See
`src/shared/lib/telemetry.ts`.

Which events fire, and how often:

```sql
select
  t.feature,
  t.event,
  count(*)                    as events,
  count(distinct t.session_id) as sessions
from public.telemetry_events t
where t.level = 'info'
  and t.at > now() - interval '7 days'
group by t.feature, t.event
order by events desc;
```

What is failing, worst first:

```sql
select
  t.feature,
  t.event,
  t.app_version,
  count(*) as errors
from public.telemetry_events t
where t.level = 'error'
  and t.at > now() - interval '7 days'
group by t.feature, t.event, t.app_version
order by errors desc;
```

One session in order — the closest thing to watching somebody use the app:

```sql
select t.at, t.feature, t.event, t.props
from public.telemetry_events t
where t.session_id = '00000000-0000-0000-0000-000000000000'
order by t.at;
```

⚠️ **These counts can be inflated by anyone too**, and for the same reason:
`record_telemetry_events` is the second anon-writable endpoint, because much of
the funnel worth measuring happens before sign-in. One call is capped at 50
events; nothing caps the number of calls. Full reasoning in
`20260830120000_telemetry_sink.sql`.

⚠️ **A quiet event is not the same as an absent one.** Events emitted before
`installTelemetrySink()` runs are never captured, and the last events of a
session only arrive if the app reaches `background` — so a hard crash loses the
tail. Do not read "no `checkout_started` rows" as "nobody started checkout"
without checking that the event fires at all.

---

## 7. Is the hourly sweep still running?

⚠️ **Ask this first when anything looks stale.** `release-held-refunds` is the
only scheduled process in the system, and it now carries five jobs, four of
which fail *silently*:

| Job | What its silence costs |
|---|---|
| Refunds and payouts | Money strands. Loud eventually — someone complains |
| `purge_old_notifications` | Retention stops |
| `purge_sighting_location_history` | **A promise published on the website** stops being kept |
| Orphaned photo removal | **UK GDPR erasure** stops — deleted cars keep their photos |
| `claim_still_missing_checks` | Owners are never asked, so abandoned posts stay abandoned (ADR-0019) |

Only the first is self-reporting. The other four would sit broken indefinitely.

The last one fails *quietly but harmlessly*: the ask is a database row, so a
sweep that stops simply means nobody is asked until it starts again. Nothing
expires and no money moves either way — that is the design, not a mitigation.

```sql
select public.sweep_health();
```

Returns `last_run_at`, `age_minutes`, a `healthy` flag and the counters from
that run. `healthy` goes false after **3 hours** — three consecutive misses, not
one, because a single miss is ordinary (a deploy, a cold start) and a check that
cries wolf gets ignored.

`last_run_at: null` means it has never completed a run since 2026-09-02. That is
a different problem from "ran a while ago" and usually means the pg_cron job or
its Vault secret is wrong, not that the function is broken.

The recent history, when you want to see a trend rather than a moment:

```sql
select s.ran_at, s.summary
from public.sweep_runs s
order by s.ran_at desc
limit 24;
```

⚠️ **Nothing alerts on this.** It is a query, not a pager. Making it one needs
somewhere to send it, which is an ops decision nobody has taken — but a table
you can query today beats a dashboard that does not exist.

---

## 8. Money deadlines — Stripe's 90-day limit

⚠️ **Reward money must leave the platform balance within 90 days of capture.**
Stripe lead support said so on 2026-10-05. If it happens persistently, Stripe
"may take action to offboard the account". Funds segregation does not change
this. Our own hard line is **capture + 85 days**, which leaves room for a
weekend.

**This one does alert.** Two emails go to `OPS_ALERT_TO_ADDRESS`; if that
isn't set, they go to the bug-report inbox.

- **"N reward payment(s) approaching Stripe's 90-day limit"**: the sweep
  found reward money (held, or superseded and still owed back) **75+ days**
  after capture. It repeats daily per payment until the money leaves. Each line
  gives the payment and post ids, the states, the days held, the resolve-by
  date, and any open dispute, payout review or refund hold. That last part
  usually tells you why the money is stuck.
- **"A refund failed"**: Stripe accepted a refund and the bank later bounced
  it. The ledger says `refunded`, but the money is back on our balance. This
  needs the Stripe endpoint subscribed to `charge.refund.updated`.

The same list on demand, without claiming or emailing anything:

```sql
select p.id, p.post_id, p.status, po.status as post_status,
       coalesce(p.captured_at, p.created_at) as captured,
       coalesce(p.captured_at, p.created_at) + interval '85 days' as resolve_by
from public.payments p
left join public.posts po on po.id = p.post_id
where p.kind = 'bounty_escrow'
  and p.status in ('held', 'superseded')
order by captured;
```

**What to do, by what's stuck:**

| The row shows | Do this |
|---|---|
| An **open dispute** | Resolve it (§2) before the resolve-by date. Upheld pays the spotter; rejected lets the sweep refund the owner within the hour. |
| A **payout review** pending or rejected | Decide it (§3). A rejected review keeps the money held, so it must still end in a refund or a payout. |
| Post **`recovery_claimed`**, nothing credited | The owner never finished "found it another way". Ask them to finish it, or refund from the Stripe dashboard: the `charge.refunded` webhook then closes the recovery (`reconcile_payment_refund`). |
| Post **`recovery_claimed`**, a sighting credited | The spotter hasn't finished payout onboarding. Chase them. If day 80 comes first, refund the owner from the Stripe dashboard and tell the spotter why. The webhook records the refund, leaves the post in `recovery_claimed` (no final state is true here) and emails you **"A credited recovery was refunded to the owner"**. Then close the post by hand: `update public.posts set status = 'recovered_no_spotter' where id = '<post id>';`. Note this status normally means "nobody was credited", so record why in the support log. |
| Post **`active`**, nothing else | A reward from before rewards had a term (`legacy_term`), or one the expiry hasn't reached. Tell the owner first: until automatic reward expiry ships, refunding it closes the listing. Then refund it from the Stripe dashboard; the webhook records the refund. For a `legacy_term` reward, refund the **full** amount: those owners were promised their end-of-term refund in full. |
| Status **`superseded`** | The sweep should have refunded it within the hour. If it's 75 days old, the refund keeps failing: check the logs for `refund item failed`. An open dispute on the post also holds it back on purpose until the dispute is resolved. |

⚠️ **A refund from the Stripe dashboard is always recorded correctly.** The
webhook reconciles it from the ledger:
- A superseded payment's refund never touches its post.
- The post's current reward closes the listing, as an owner deactivation
  would.
- A recovery where nobody was credited finishes as `recovered_no_spotter`.
- A credited recovery is the one case that leaves a post for you to close
  (see above).

A partial refund made by hand is recorded as the refund; settling any
remainder is up to you.

**The reward-term switch.** The sweep sends the term notices and reminders
(`claim_reward_term_notices`, `claim_reward_reminders`) only when the Edge
Function secret `REWARD_TERM_NOTICES_ENABLED` is `true`. Turn it on only
when all three are true:
1. the app update with the reward banner is live (check with
   `eas update:list`, never the exit code);
2. the reward expiry (PR5) is deployed;
3. you have read the legacy-reward dates the first notices will give.

```sql
select p.id, p.post_id, coalesce(p.captured_at, p.created_at) as captured,
       least(public.reward_term_end(greatest(
               least(coalesce(p.captured_at, p.created_at) + interval '80 days',
                     greatest(coalesce(p.captured_at, p.created_at) + interval '60 days', now() + interval '14 days')),
               now() + interval '3 days')),
             coalesce(p.captured_at, p.created_at) + interval '85 days') as would_end
from public.payments p
join public.posts po on po.id = p.post_id
where p.status = 'held' and p.kind = 'bounty_escrow' and p.term_ends_at is null
  and po.status in ('active', 'pending_verification')
order by would_end;
```

---

## What this file is not

A moderation tool. There is no way here to action anything — no resolving a
dispute, no removing a post, no replying to a bug report. Reading is the whole
of it, and reading is what was missing. `BUILD_PLAN.md` still has the dashboard
unticked, and this does not tick it.
