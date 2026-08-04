-- -----------------------------------------------------------------------------
-- WHAT:  `read_cron_secret()` — hands the sweep the Vault-held cron secret so
--        it can verify the `x-cron-secret` header.
-- WHY:   The cron secret is GENERATED INSIDE POSTGRES (one-off SQL in the
--        dashboard: `vault.create_secret(encode(gen_random_bytes(24),'hex'),
--        'cron_secret')`) and consumed by two server-side parties only: the
--        pg_cron job builds the header by reading Vault directly, and
--        `release-held-refunds` compares the incoming header via this RPC.
--        The secret therefore never exists in git, in a client, in a
--        deploy command, or in any conversation transcript — and rotating it
--        is one SQL statement.
--
--        PostgREST does not expose the `vault` schema, which is exactly right;
--        this SECURITY DEFINER function is the one narrow, service-role-only
--        door through it, returning one named secret and nothing else.
-- SAFETY: service_role ONLY. Returns null (not an error) when the secret has
--        not been created yet — the function fails CLOSED on a null.
-- LINKS: supabase/functions/release-held-refunds/index.ts (the consumer);
--        docs/decisions/ADR-0011-refund-holds-and-disputes.md (cron setup).
-- -----------------------------------------------------------------------------

create or replace function public.read_cron_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret';
  return v_secret;
end $$;

comment on function public.read_cron_secret() is
  'The one door through the vault schema: returns the cron_secret used by the pg_cron job and verified by release-held-refunds. Generated and rotated entirely inside Postgres — never in git, a client, or a transcript. SERVICE ROLE ONLY; null when unset (callers fail closed).';

revoke all on function public.read_cron_secret() from public;
revoke all on function public.read_cron_secret() from anon;
revoke all on function public.read_cron_secret() from authenticated;
grant execute on function public.read_cron_secret() to service_role;
