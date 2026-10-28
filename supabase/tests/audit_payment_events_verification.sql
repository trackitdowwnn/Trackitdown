-- =============================================================================
-- WHAT:  Verification for 20261028170000_money_changes_are_kept_as_evidence.sql.
--        NOT a migration.
-- WHY:   docs/logging-decisions.md §2 — the money trail is evidence. Each
--        property below is one a six-year record must have and none is
--        visible by reading the trigger.
-- CHECKS: 1 a new payment writes one `insert` row, actor = the API role ·
--        2 a refund writes one `update` row with from/to and the amount ·
--        3 a reminder stamp writes nothing · 4 ⚠️ a deleted payment keeps its
--        trail and gains a `delete` row · 5 ⚠️ UPDATE, DELETE and TRUNCATE of
--        audit rows raise · 6 ⚠️ no API role holds any privilege on the table ·
--        7 a change that rolls back leaves no audit row · 8 ⚠️ the columns
--        are exactly the agreed set (no personal data can be added unnoticed).
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
-- LINKS: supabase/migrations/20261028170000_money_changes_are_kept_as_evidence.sql.
-- =============================================================================

begin;

-- CHECK 1 — created by the API role the functions use.
set local role service_role;
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('a0d10000-0000-4000-8000-000000000001', null, 'pi_audit_1', 'held', 25000, 'bounty_escrow');
reset role;

do $$
declare
  v_row public.audit_payment_events;
begin
  select * into strict v_row from public.audit_payment_events
   where payment_id = 'a0d10000-0000-4000-8000-000000000001';
  if v_row.operation <> 'insert' or v_row.to_status <> 'held' or v_row.from_status is not null
     or v_row.amount_pence <> 25000 or v_row.kind <> 'bounty_escrow'
     or v_row.stripe_payment_intent_id <> 'pi_audit_1' or v_row.actor <> 'service_role' then
    raise exception 'CHECK 1 FAILED: %', row_to_json(v_row);
  end if;
  raise notice 'CHECK 1 passed: a new payment is recorded, with the role that made it.';
end $$;

-- CHECK 2 — a refund.
update public.payments
   set status = 'refunded', refunded_amount_pence = 25000, stripe_refund_id = 're_audit_1'
 where id = 'a0d10000-0000-4000-8000-000000000001';

do $$
declare
  v_row public.audit_payment_events;
begin
  select * into strict v_row from public.audit_payment_events
   where payment_id = 'a0d10000-0000-4000-8000-000000000001' and operation = 'update';
  if v_row.from_status <> 'held' or v_row.to_status <> 'refunded'
     or v_row.refunded_amount_pence <> 25000 or v_row.stripe_refund_id <> 're_audit_1' then
    raise exception 'CHECK 2 FAILED: %', row_to_json(v_row);
  end if;
  raise notice 'CHECK 2 passed: a refund is recorded with its before and after.';
end $$;

-- CHECK 3 — not a money change.
update public.payments set reminded_10d_at = now()
 where id = 'a0d10000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.audit_payment_events
       where payment_id = 'a0d10000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'CHECK 3 FAILED: a reminder stamp wrote an audit row.';
  end if;
  raise notice 'CHECK 3 passed: a reminder stamp is not a money change.';
end $$;

-- CHECK 4 — the row goes, its trail stays.
delete from public.payments where id = 'a0d10000-0000-4000-8000-000000000001';

do $$
begin
  if (select array_agg(operation order by id) from public.audit_payment_events
       where payment_id = 'a0d10000-0000-4000-8000-000000000001')
     is distinct from array['insert', 'update', 'delete'] then
    raise exception 'CHECK 4 FAILED: the trail of a deleted payment is incomplete.';
  end if;
  if (select from_status from public.audit_payment_events
       where payment_id = 'a0d10000-0000-4000-8000-000000000001' and operation = 'delete')
     <> 'refunded' then
    raise exception 'CHECK 4 FAILED: the delete row does not say what was deleted.';
  end if;
  raise notice 'CHECK 4 passed: a deleted payment keeps its whole trail.';
end $$;

-- CHECK 5 — append-only, even for the owner.
do $$
declare
  v_attempt text;
begin
  foreach v_attempt in array array['update', 'delete', 'truncate'] loop
    begin
      if v_attempt = 'update' then
        update public.audit_payment_events set amount_pence = 1
         where payment_id = 'a0d10000-0000-4000-8000-000000000001';
      elsif v_attempt = 'delete' then
        delete from public.audit_payment_events
         where payment_id = 'a0d10000-0000-4000-8000-000000000001';
      else
        truncate public.audit_payment_events;
      end if;
      raise exception 'CHECK 5 FAILED: % of audit rows was allowed.', v_attempt;
    exception when raise_exception then
      if sqlerrm <> 'AUDIT_APPEND_ONLY' then raise; end if;
    end;
  end loop;
  raise notice 'CHECK 5 passed: audit rows cannot be changed, deleted or truncated.';
end $$;

-- CHECK 6 — no API role can read or write the record.
do $$
declare
  v_role text;
  v_privilege text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_privilege in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege(v_role, 'public.audit_payment_events', v_privilege) then
        raise exception 'CHECK 6 FAILED: % has % on audit_payment_events.', v_role, v_privilege;
      end if;
    end loop;
  end loop;
  raise notice 'CHECK 6 passed: no API role holds any privilege on the audit record.';
end $$;

-- CHECK 7 — rolled back means never happened.
savepoint before_rollback;
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('a0d10000-0000-4000-8000-000000000002', null, 'pi_audit_2', 'held', 25000, 'bounty_escrow');
rollback to savepoint before_rollback;

do $$
begin
  if exists (select 1 from public.audit_payment_events
              where payment_id = 'a0d10000-0000-4000-8000-000000000002') then
    raise exception 'CHECK 7 FAILED: a rolled-back payment left an audit row.';
  end if;
  raise notice 'CHECK 7 passed: a change that rolls back leaves no audit row.';
end $$;

-- CHECK 8 — exactly the agreed columns.
do $$
begin
  if (select array_agg(column_name::text order by column_name)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_payment_events')
     is distinct from array[
       'actor', 'amount_pence', 'from_status', 'id', 'kind', 'occurred_at', 'operation',
       'payment_id', 'platform_fee_pence', 'post_id', 'refunded_amount_pence',
       'stripe_payment_intent_id', 'stripe_refund_id', 'stripe_transfer_id', 'to_status',
       'transfer_amount_pence'] then
    raise exception 'CHECK 8 FAILED: audit_payment_events columns changed — review for personal data.';
  end if;
  raise notice 'CHECK 8 passed: the audit record holds ids, statuses and amounts only.';
end $$;

rollback;
