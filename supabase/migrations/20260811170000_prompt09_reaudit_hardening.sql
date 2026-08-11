-- =============================================================
-- PED-ON - Prompt 09 focused re-audit hardening. Closes the legacy
-- service-role identity path, records append-only consent evidence,
-- bounds token TTL, and cleans expired tokens incrementally.
-- =============================================================

-- Public identity is v2-only after the Edge deployment.
revoke execute on function public.resolve_loyalty_identity_internal(
  uuid, text, text, text, text, text, timestamptz
)
  from service_role;

-- Consent history is append-only and unavailable to browser roles.
create table public.loyalty_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  consent_version text not null
    check (
      consent_version = btrim(consent_version)
      and char_length(consent_version) between 1 and 64
      and public._is_safe_plain_text(consent_version)
    ),
  consented_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint loyalty_consent_events_membership_fk
    foreign key (organization_id, membership_id)
    references public.loyalty_memberships (organization_id, id)
    on delete cascade
);

create index loyalty_consent_events_membership_created_idx
  on public.loyalty_consent_events (
    organization_id,
    membership_id,
    created_at desc,
    id desc
  );

alter table public.loyalty_consent_events enable row level security;
revoke all on table public.loyalty_consent_events
  from public, anon, authenticated;

insert into public.loyalty_consent_events (
  organization_id,
  membership_id,
  consent_version,
  consented_at
)
select
  m.organization_id,
  m.id,
  m.consent_version,
  m.consented_at
from public.loyalty_memberships as m
where m.consent_version is not null
  and m.consented_at is not null;

create function public._loyalty_record_consent_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consent_version is not null
     and new.consented_at is not null
     and (
       tg_op = 'INSERT'
       or old.consent_version is distinct from new.consent_version
       or old.consented_at is distinct from new.consented_at
     )
  then
    insert into public.loyalty_consent_events (
      organization_id,
      membership_id,
      consent_version,
      consented_at
    ) values (
      new.organization_id,
      new.id,
      new.consent_version,
      new.consented_at
    );
  end if;
  return new;
end;
$$;

revoke all on function public._loyalty_record_consent_event()
  from public, anon, authenticated;

create trigger loyalty_memberships_consent_audit
after insert or update of consented_at, consent_version
on public.loyalty_memberships
for each row execute function public._loyalty_record_consent_event();

-- The Edge emits exactly two hours. The small tolerance covers request
-- and transaction clock differences while rejecting arbitrary TTLs.
delete from public.loyalty_access_tokens
where expires_at > created_at + interval '2 hours 5 minutes';

alter table public.loyalty_access_tokens
  add constraint loyalty_access_tokens_max_ttl_check
    check (expires_at <= created_at + interval '2 hours 5 minutes');

create index loyalty_access_tokens_expiry_idx
  on public.loyalty_access_tokens (expires_at);

create or replace function public.consume_loyalty_rate_limit_internal(
  p_scope_hash text,
  p_window_seconds integer,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket_start timestamptz;
  v_expires_at timestamptz;
  v_attempts integer;
  v_allowed boolean;
  v_retry_after integer;
begin
  if p_scope_hash is null
     or p_scope_hash !~ '^[a-f0-9]{64}$'
     or p_window_seconds is null
     or p_window_seconds not between 1 and 86400
     or p_max_attempts is null
     or p_max_attempts not between 1 and 1000000
  then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  delete from public.loyalty_rate_limits
  where ctid in (
    select rl.ctid
    from public.loyalty_rate_limits as rl
    where rl.expires_at <= v_now
    order by rl.expires_at
    limit 100
  );

  delete from public.loyalty_access_tokens
  where token_hash in (
    select lat.token_hash
    from public.loyalty_access_tokens as lat
    where lat.expires_at <= v_now
    order by lat.expires_at
    limit 100
  );

  v_bucket_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds)
      * p_window_seconds
  );
  v_expires_at := v_bucket_start
    + make_interval(secs => p_window_seconds);

  insert into public.loyalty_rate_limits (
    scope_hash,
    bucket_start,
    attempts,
    expires_at
  ) values (
    p_scope_hash,
    v_bucket_start,
    1,
    v_expires_at
  )
  on conflict (scope_hash, bucket_start)
  do update set
    attempts = public.loyalty_rate_limits.attempts + 1,
    expires_at = greatest(
      public.loyalty_rate_limits.expires_at,
      excluded.expires_at
    )
  returning attempts, expires_at into v_attempts, v_expires_at;

  v_allowed := v_attempts <= p_max_attempts;
  v_retry_after := case
    when v_allowed then 0
    else greatest(1, ceil(extract(epoch from v_expires_at - v_now))::integer)
  end;

  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after', v_retry_after,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function public.consume_loyalty_rate_limit_internal(
  text, integer, integer
)
  from public, anon, authenticated;
grant execute on function public.consume_loyalty_rate_limit_internal(
  text, integer, integer
)
  to service_role;
