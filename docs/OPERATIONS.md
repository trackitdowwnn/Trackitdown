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
only scheduled process in the system, and most of its jobs fail *silently*:

| Job | What its silence costs |
|---|---|
| Refunds and payouts | Money strands. Loud eventually — someone complains |
| **Reward term and expiry** (ADR-0020: notices, 10/3-day reminders, `claim_reward_expiries`) | **Rewards are never ended or refunded, so money drifts towards Stripe's 90-day limit.** The 75-day deadline email (`deadlineAlerts`) is the only alarm — and it is sent BY this sweep |
| `purge_old_notifications` | Retention stops |
| `purge_sighting_location_history` | **A promise published on the website** stops being kept |
| Orphaned photo removal | **UK GDPR erasure** stops — deleted cars keep their photos |
| `claim_still_missing_checks` | Owners are never asked, so abandoned posts stay abandoned (ADR-0019) |

Only the first is self-reporting. The rest would sit broken indefinitely.

⚠️ **The sweep now moves money on a clock.** Since 2026-10-06 (ADR-0020,
both switches on) it ends rewards at the end of their 60-day term and refunds
them to their owners — the ONE timer in the system that does (ADR-0019's
"no cron moves money" is superseded for exactly this case). A stopped sweep
therefore isn't harmless: rewards past their term stay held, and because the
75-day alert is part of the same sweep, nothing will email you about it.
Check `sweep_health` whenever something looks stale, and at least weekly.

The still-missing ask fails *quietly but harmlessly*: the ask is a database
row, so a sweep that stops simply means nobody is asked until it starts
again. That job moves no money.

```sql
select public.sweep_health();
```

Returns `last_run_at`, `age_minutes`, a `healthy` flag and the counters from
that run. `healthy` goes false after **3 hours** — three consecutive misses, not
one, because a single miss is ordinary (a deploy, a cold start) and a check that
cries wolf gets ignored.

Times are **UTC** — in summer UK time is an hour ahead, so a `last_run_at` of
`14:00+00:00` was 15:00 on your clock. The sweep runs on the hour. The reward
counters to read: `rewardTermNotices` and `rewardReminders` (owners told),
`rewardsExpired` (rewards ended this run), `refunded` (money sent home, every
reason), `deadlineAlerts` (reward money 75+ days old — investigate any). A
summary WITHOUT a `rewardsExpired` key came from a sweep older than the
expiry's deploy.

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
| Post **`recovery_claimed`**, a sighting credited | The spotter hasn't finished payout onboarding. With `PAYOUT_DEADLINE_ENABLED` on (below), the sweep reminds them 7 and 2 days before their deadline (`public.payout_deadline(<payment id>)`) and, if it passes, refunds the owner **in full** and closes the post as `recovered_no_spotter`. Nothing to do unless a payout review is open: the sweep never lapses a reward under review, so decide it (§3). With the switch off, it is the old manual path: refund the owner in full from the Stripe dashboard and tell the spotter why. The webhook records it and emails you **"A credited recovery was refunded to the owner"**; close the post by hand with `update public.posts set status = 'recovered_no_spotter' where id = '<post id>';` and record why in the support log. |
| Post **`active`**, nothing else | A reward from before rewards had a term (`legacy_term`), or one the expiry hasn't reached. Tell the owner first: until automatic reward expiry ships, refunding it closes the listing. Then refund it from the Stripe dashboard; the webhook records the refund. For a `legacy_term` reward, refund the **full** amount: those owners were promised their end-of-term refund in full. |
| Status **`superseded`** | The sweep should have refunded it within the hour. If it's 75 days old, the refund keeps failing: check the logs for `refund item failed`. An open dispute on the post also holds it back on purpose until the dispute is resolved. |

⚠️ **How much to refund by hand (ADR-0021).** The Terms promise the owner the
exact figure the app quoted: **reward − (1.5% of the reward, rounded to the
nearest penny, + 20p)**. £200 → refund **£196.80** (fee £3.20); £500 → £492.30.
Never "reward minus Stripe's fee" — that was the old rule, and on a premium or
non-UK card it is less than the owner was promised. Refund the **full** amount
only for a stray capture (`refund_fee_absorbed`), a `legacy_term` reward at
the end of its term, or a credited reward whose spotter missed their payout
deadline.

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

**The two reward switches — turn them on TOGETHER.** Both are Edge Function
secrets, both default off:
- `REWARD_TERM_NOTICES_ENABLED=true` — the sweep sends the term notices and
  reminders (`claim_reward_term_notices`, `claim_reward_reminders`);
- `REWARD_EXPIRY_ENABLED=true` — the sweep ends rewards past their term
  (`claim_reward_expiries`, PR5): a system hold (72 hours if a recent sighting
  might have found the car, due now otherwise), then the refund, and the
  listing stays up as "Reward ended".

Turn them on only when all four are true:
1. the app update with the reward banner and "Reward ended" is live (check
   with `eas update:list`, never the exit code);
2. PR5 (`20261006130000_a_reward_expires.sql`) is deployed;
3. you have read the legacy-reward dates the first notices will give (query
   below);
4. you have run the sweep once by hand afterwards and read its summary
   (`rewardTermNotices`, `rewardsExpired`, `refunded`).

Notices on and expiry off would promise a refund nothing performs; expiry on
and notices off would end rewards nobody was told about. Nothing expires
before its owner has had the notice: a legacy reward's term is at least 14
days after its notice (3 at the floor for the oldest), and a new reward's is
60 days after capture.

**The payout deadline switch.** `PAYOUT_DEADLINE_ENABLED=true` (an Edge
Function secret, default off) lets the sweep handle a credited spotter who
never sets up payouts (`20261007100000_a_credited_reward_has_a_deadline.sql`).
Their deadline is the end of day 80 after capture, or 7 days after the credit
if that is later, and never past day 85, inside Stripe's 90-day hold.
- **Reminders.** 7 days and 2 days before, a push with their amount and the
  date (`payout_reminder`, opens Payouts). None in the first day after the
  credit, none once they can be paid, none while a payout review is open.
- **The lapse.** Past the deadline, the sweep first asks Stripe whether the
  spotter can now be paid, and syncs our copy, so a missed `account.updated`
  never costs them the reward. Then it tries the payout one last time. If the
  spotter still can't be paid, it:
  1. claims the lapse under the post lock;
  2. checks Stripe has no transfer for the post;
  3. refunds the owner **in full**;
  4. closes the post as `recovered_no_spotter`. The sighting stays credited.

  The spotter gets `payout_lapsed` and the owner `reward_ended`. The pushes are
  sent only after the refund is recorded, and are retried if a run dies.
- **Never both.** A payout that started in the last hour blocks the lapse, and
  a claimed lapse makes `release-payout` refuse with 409 `PAYOUT_LAPSED`.
- **A failed run is finished by the next one.** A claimed lapse that is still
  held (Stripe error, crash) is retried every hour under the same refund key.
  If it keeps failing (e.g. the owner has a chargeback open on the charge, and
  Stripe won't refund a disputed charge), it shows in the 75-day email. Look in
  the logs for `payout lapse refund not made`.
- **A rejected or pending payout review stops the clock.** That money waits for
  you (§3). The 75-day email still lists it, and you must refund or pay it
  before day 90.
- **Paying a spotter by hand?** Always set **transfer group = the post id** on
  the transfer. The sweep looks for transfers by group before it refunds, and
  can't see one without it. If the lapse is already claimed (the payment has
  `payout_lapse_claimed_at`), park it **first** with
  `select public.block_payout_lapse('<post id>');` so the hourly sweep can't
  refund the owner while you're paying.
- **Turning the switch off is not an emergency stop for claimed rows.** A lapse
  claimed before you switch off stays claimed: payouts refuse it and nothing
  resumes it. Settle any such row by hand (refund the owner in full from the
  Stripe dashboard; the webhook records it as the lapse).

**A lapse found a transfer** (alert: "A credited reward past its payout
deadline already has a Stripe transfer"). A payout reached Stripe that our
ledger doesn't show. The sweep has parked it (`payout_lapse_blocked_at`), will
never refund it, and `release-payout` refuses it. Settle it by hand:
1. In Stripe, open the transfer named in the alert. Check its amount (95% of
   the reward) and its destination (the credited spotter's account).
2. If it is right, record it with the payout's own function. It re-derives the
   95/5 split and refuses a mismatch, and moves payment and post together:
   `select public.mark_recovery_paid('<pi_…>', '<tr_…>', (select id from public.stripe_connected_accounts where profile_id = '<spotter id>'), <transfer pence>, <reward pence − transfer pence>);`.
   For example, a £200 reward is `19000, 1000`.
3. If it is wrong, reverse the transfer in Stripe, then refund the owner **in
   full** from the Stripe dashboard. The webhook files that refund as the lapse
   (`recovered_no_spotter`), and the next sweep sends both pushes. Don't clear
   the park instead: a reversed transfer stays in the group, so the sweep
   would find it and park the row again.

Turn it on once the app update with the new notification kinds is live
(`eas update:list`) and this migration is deployed. Then run the sweep once by
hand and read `payoutReminders` and `payoutsLapsed` in its summary.

**A reward_end hold** shows in §2's dispute query like any other. Upholding a
dispute on one credits the spotter on a listing that is still live: the post
moves to `recovery_claimed` and the payout runs as usual.

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
