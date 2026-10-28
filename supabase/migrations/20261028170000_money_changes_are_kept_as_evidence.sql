-- =============================================================================
-- WHAT: public.audit_payment_events — an append-only record of every change
--       to a payments row that moves or re-states money: created, status
--       changed, an amount changed, a Stripe id attached, or the row deleted.
--       Written by an AFTER trigger on payments, in the same transaction as
--       the change, so a change that rolls back leaves no audit row and a
--       committed one always has one.
--
-- WHY:  docs/logging-decisions.md §2 (owner, 2026-10-28): the money trail is
--       EVIDENCE, kept 6 years (HMRC financial records). `payments` is
--       overwritten in place, so until now a refund, a payout or a deleted
--       draft intent left no history — only its latest state. A log line can
--       be lost; an audit row cannot.
--
--       ⚠️ NO PERSONAL DATA. Ids, kinds, statuses, amounts and Stripe ids
--       only: no user id, no payee account, no snapshot, no name, no place.
--       NO FOREIGN KEYS, so a row outlives the post, payment or account it
--       describes — that is the point of a record kept for six years.
--
--       ⚠️ APPEND-ONLY. UPDATE, DELETE and TRUNCATE raise; no API role
--       (anon, authenticated, service_role) holds any privilege on the table,
--       so the trigger function (SECURITY DEFINER) is the only writer. Only
--       the database owner can read it, from the SQL editor.
--
-- HOW:  `actor` = app.actor if code set it, else the session's API role
--       (service_role / authenticated), else the session user (postgres for
--       the SQL editor and pg_cron). The existing 10 payments rows get one
--       `baseline` row each, so every payment's trail starts from a known
--       state. Retention: 6 years; nothing is old enough to purge before
--       2032, so no purge job exists yet (RECORD_OF_PROCESSING §4.11).
-- =============================================================================

create table public.audit_payment_events (
  id                        bigint generated always as identity primary key,
  occurred_at               timestamptz not null default now(),
  operation                 text not null
                              check (operation in ('baseline', 'insert', 'update', 'delete')),
  payment_id                uuid not null,
  post_id                   uuid,
  kind                      text not null,
  from_status               text,
  to_status                 text,
  amount_pence              integer,
  refunded_amount_pence     integer,
  transfer_amount_pence     integer,
  platform_fee_pence        integer,
  stripe_payment_intent_id  text,
  stripe_refund_id          text,
  stripe_transfer_id        text,
  actor                     text not null
);

comment on table public.audit_payment_events is
  'Append-only evidence of every money change to public.payments (docs/logging-decisions.md §2). Written only by the payments_audit trigger; UPDATE/DELETE/TRUNCATE raise; no API role can read or write it. No personal data, no foreign keys. Kept 6 years.';

create index audit_payment_events_payment_idx on public.audit_payment_events (payment_id, id);

alter table public.audit_payment_events enable row level security;
revoke all on table public.audit_payment_events from public, anon, authenticated, service_role;

-- --- Append-only ---------------------------------------------------------------
create function public.audit_payment_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_APPEND_ONLY'
    using hint = 'audit_payment_events is evidence: rows cannot be changed or removed.';
end $$;

create trigger audit_payment_events_no_change
  before update or delete on public.audit_payment_events
  for each row execute function public.audit_payment_events_append_only();

create trigger audit_payment_events_no_truncate
  before truncate on public.audit_payment_events
  for each statement execute function public.audit_payment_events_append_only();

-- --- The writer ------------------------------------------------------------------
create function public.record_payment_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         public.payments;
  v_from_status text;
  v_to_status   text;
begin
  if tg_op = 'INSERT' then
    v_row := new;
    v_to_status := new.status::text;
  elsif tg_op = 'DELETE' then
    v_row := old;
    v_from_status := old.status::text;
  else
    -- A reminder stamp or a claim token is not a money change.
    if (old.status, old.amount_pence, old.refunded_amount_pence, old.transfer_amount_pence,
        old.platform_fee_pence, old.stripe_payment_intent_id, old.stripe_refund_id,
        old.stripe_transfer_id)
       is not distinct from
       (new.status, new.amount_pence, new.refunded_amount_pence, new.transfer_amount_pence,
        new.platform_fee_pence, new.stripe_payment_intent_id, new.stripe_refund_id,
        new.stripe_transfer_id) then
      return null;
    end if;
    v_row := new;
    v_from_status := old.status::text;
    v_to_status := new.status::text;
  end if;

  insert into public.audit_payment_events (
    operation, payment_id, post_id, kind, from_status, to_status,
    amount_pence, refunded_amount_pence, transfer_amount_pence, platform_fee_pence,
    stripe_payment_intent_id, stripe_refund_id, stripe_transfer_id, actor
  ) values (
    lower(tg_op), v_row.id, v_row.post_id, v_row.kind::text, v_from_status, v_to_status,
    v_row.amount_pence, v_row.refunded_amount_pence, v_row.transfer_amount_pence,
    v_row.platform_fee_pence, v_row.stripe_payment_intent_id, v_row.stripe_refund_id,
    v_row.stripe_transfer_id,
    coalesce(nullif(current_setting('app.actor', true), ''),
             nullif(current_setting('role', true), 'none'),
             session_user)
  );
  return null;
end $$;

comment on function public.record_payment_audit_event() is
  'AFTER INSERT/UPDATE/DELETE on payments: appends one audit_payment_events row per money change (status, an amount or a Stripe id), in the same transaction. docs/logging-decisions.md §2.';

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.record_payment_audit_event();

revoke execute on function public.record_payment_audit_event() from public, anon, authenticated, service_role;
revoke execute on function public.audit_payment_events_append_only() from public, anon, authenticated, service_role;

-- --- Where each existing payment's trail starts -----------------------------------
insert into public.audit_payment_events (
  operation, payment_id, post_id, kind, to_status,
  amount_pence, refunded_amount_pence, transfer_amount_pence, platform_fee_pence,
  stripe_payment_intent_id, stripe_refund_id, stripe_transfer_id, actor
)
select 'baseline', id, post_id, kind::text, status::text,
       amount_pence, refunded_amount_pence, transfer_amount_pence, platform_fee_pence,
       stripe_payment_intent_id, stripe_refund_id, stripe_transfer_id, 'migration'
  from public.payments
 order by created_at, id;
