-- =============================================================
-- PED-ON - Prompt 09 release hardening. Adds phone-bound loyalty
-- identity, explicit consent, rate limiting, auditable statement
-- deltas, and recoverable checkout attempts without changing the
-- legacy identity or checkout contracts.
-- =============================================================

-- 1) A loyalty identity is the organization-scoped CPF and phone pair.
alter table public.customers
  add column phone_fingerprint text,
  add constraint customers_phone_fingerprint_check
    check (
      phone_fingerprint is null
      or phone_fingerprint ~ '^[a-f0-9]{64}$'
    );

create index customers_organization_cpf_phone_idx
  on public.customers (
    organization_id,
    cpf_fingerprint,
    phone_fingerprint
  );

alter table public.loyalty_memberships
  add column consented_at timestamptz,
  add column consent_version text,
  add constraint loyalty_memberships_consent_version_check
    check (
      consent_version is null
      or (
        consent_version = btrim(consent_version)
        and char_length(consent_version) between 1 and 64
        and public._is_safe_plain_text(consent_version)
      )
    ),
  add constraint loyalty_memberships_consent_pair_check
    check (
      (consented_at is null and consent_version is null)
      or (consented_at is not null and consent_version is not null)
    );

-- The legacy resolver remains unchanged. New callers must bind both
-- fingerprints and record explicit consent on every enrollment.
create function public.resolve_loyalty_identity_internal_v2(
  p_organization_id uuid,
  p_cpf_fingerprint text,
  p_phone_fingerprint text,
  p_cpf_last2 text,
  p_mode text,
  p_name text,
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := nullif(btrim(p_mode), '');
  v_cpf_last2 text := nullif(btrim(p_cpf_last2), '');
  v_name text := nullif(btrim(p_name), '');
  v_token_hash text := nullif(btrim(p_token_hash), '');
  v_consent_version text := nullif(btrim(p_consent_version), '');
  v_program public.loyalty_programs;
  v_customer public.customers;
  v_membership public.loyalty_memberships;
  v_account public.loyalty_accounts;
begin
  if p_organization_id is null
     or p_cpf_fingerprint is null
     or p_cpf_fingerprint !~ '^[a-f0-9]{64}$'
     or p_phone_fingerprint is null
     or p_phone_fingerprint !~ '^[a-f0-9]{64}$'
     or v_cpf_last2 !~ '^[0-9]{2}$'
     or v_token_hash !~ '^[a-f0-9]{64}$'
     or p_token_expires_at is null
     or p_token_expires_at <= clock_timestamp()
  then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if v_mode not in ('lookup', 'enroll') then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if p_consent_version is not null
     and (
       v_consent_version is null
       or char_length(v_consent_version) > 64
       or not public._is_safe_plain_text(v_consent_version)
     )
  then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if v_mode = 'enroll' and v_consent_version is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if v_mode = 'enroll'
     and (
       v_name is null
       or char_length(v_name) not between 2 and 120
       or not public._is_safe_plain_text(v_name)
     )
  then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;

  select lp.* into v_program
  from public.loyalty_programs as lp
  where lp.organization_id = p_organization_id;

  if v_program.organization_id is null or not v_program.enabled then
    raise exception 'LOYALTY_UNAVAILABLE' using errcode = 'PED51';
  end if;

  select c.* into v_customer
  from public.customers as c
  where c.organization_id = p_organization_id
    and c.cpf_fingerprint = p_cpf_fingerprint;

  -- A CPF already associated with another or legacy-null phone is not
  -- distinguishable from an unknown identity and can never be claimed.
  if v_customer.id is not null
     and v_customer.phone_fingerprint is distinct from p_phone_fingerprint
  then
    return jsonb_build_object('found', false);
  end if;

  if v_customer.id is null and v_mode = 'lookup' then
    return jsonb_build_object('found', false);
  end if;

  if v_customer.id is null then
    begin
      insert into public.customers (
        organization_id,
        cpf_fingerprint,
        phone_fingerprint,
        cpf_last2,
        name
      ) values (
        p_organization_id,
        p_cpf_fingerprint,
        p_phone_fingerprint,
        v_cpf_last2,
        v_name
      )
      returning * into v_customer;
    exception when unique_violation then
      select c.* into v_customer
      from public.customers as c
      where c.organization_id = p_organization_id
        and c.cpf_fingerprint = p_cpf_fingerprint;

      if v_customer.id is null
         or v_customer.phone_fingerprint is distinct from p_phone_fingerprint
      then
        return jsonb_build_object('found', false);
      end if;
    end;
  end if;

  select m.* into v_membership
  from public.loyalty_memberships as m
  where m.organization_id = p_organization_id
    and m.customer_id = v_customer.id;

  if v_mode = 'lookup' and v_membership.id is null then
    return jsonb_build_object('found', false);
  end if;

  if v_mode = 'enroll' then
    insert into public.loyalty_memberships (
      organization_id,
      customer_id,
      consented_at,
      consent_version
    ) values (
      p_organization_id,
      v_customer.id,
      clock_timestamp(),
      v_consent_version
    )
    on conflict (organization_id, customer_id)
    do update set
      consented_at = excluded.consented_at,
      consent_version = excluded.consent_version
    returning * into v_membership;

    insert into public.loyalty_accounts (organization_id, membership_id)
    values (p_organization_id, v_membership.id)
    on conflict (membership_id) do nothing;
  end if;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = v_membership.id
    and ac.organization_id = p_organization_id;

  if v_account.membership_id is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  insert into public.loyalty_access_tokens (
    token_hash,
    organization_id,
    membership_id,
    expires_at
  ) values (
    v_token_hash,
    p_organization_id,
    v_membership.id,
    p_token_expires_at
  );

  return jsonb_build_object(
    'found', true,
    'membership_id', v_membership.id,
    'customer', jsonb_build_object(
      'name', v_customer.name,
      'cpf_last2', v_customer.cpf_last2
    ),
    'account', jsonb_build_object(
      'points_balance', v_account.points_balance,
      'recovery_points', v_account.recovery_points
    ),
    'token', jsonb_build_object('expires_at', p_token_expires_at)
  );
end;
$$;

revoke all on function public.resolve_loyalty_identity_internal_v2(
  uuid, text, text, text, text, text, text, timestamptz, text
)
  from public, anon, authenticated;
grant execute on function public.resolve_loyalty_identity_internal_v2(
  uuid, text, text, text, text, text, text, timestamptz, text
)
  to service_role;

-- 2) Fixed-window rate limiting stores only an opaque caller scope.
create table public.loyalty_rate_limits (
  scope_hash text not null
    check (scope_hash ~ '^[a-f0-9]{64}$'),
  bucket_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null,
  primary key (scope_hash, bucket_start),
  constraint loyalty_rate_limits_expiry_check
    check (expires_at > bucket_start)
);

create index loyalty_rate_limits_expiry_idx
  on public.loyalty_rate_limits (expires_at);

alter table public.loyalty_rate_limits enable row level security;
revoke all on table public.loyalty_rate_limits
  from public, anon, authenticated;

create function public.consume_loyalty_rate_limit_internal(
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

-- 3) Statement deltas record the exact account projection change.
alter table public.loyalty_ledger
  add column points_delta bigint,
  add column recovery_delta bigint,
  add column eligible_amount numeric(12, 2);

update public.loyalty_ledger as l
set points_delta = l.amount,
    recovery_delta = 0,
    eligible_amount = o.subtotal
from public.orders as o
where o.id = l.order_id
  and o.organization_id = l.organization_id;

update public.loyalty_ledger
set points_delta = amount,
    recovery_delta = 0
where points_delta is null;

alter table public.loyalty_ledger
  alter column points_delta set not null,
  alter column recovery_delta set not null,
  add constraint loyalty_ledger_delta_balance_check
    check (points_delta - recovery_delta = amount),
  add constraint loyalty_ledger_eligible_amount_check
    check (eligible_amount is null or eligible_amount >= 0);

create or replace function public._loyalty_earn_order(p_order public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.loyalty_programs;
  v_account public.loyalty_accounts;
  v_points bigint;
  v_repayment bigint;
begin
  if p_order.loyalty_membership_id is null
     or p_order.payment_status = 'refunded'
  then
    return;
  end if;

  if exists (
    select 1
    from public.loyalty_ledger as l
    where l.order_id = p_order.id
      and l.entry_type in ('earn', 'reversal')
  ) then
    return;
  end if;

  select lp.* into v_program
  from public.loyalty_programs as lp
  where lp.organization_id = p_order.organization_id;

  if v_program.organization_id is null or not v_program.enabled then
    return;
  end if;

  v_points := floor(p_order.subtotal * v_program.points_per_real)::bigint;
  if v_points <= 0 then
    return;
  end if;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = p_order.loyalty_membership_id
  for update of ac;

  if v_account.membership_id is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  v_repayment := least(v_points, v_account.recovery_points);

  insert into public.loyalty_ledger (
    organization_id,
    membership_id,
    order_id,
    entry_type,
    amount,
    points_delta,
    recovery_delta,
    eligible_amount
  ) values (
    p_order.organization_id,
    p_order.loyalty_membership_id,
    p_order.id,
    'earn',
    v_points,
    v_points - v_repayment,
    -v_repayment,
    p_order.subtotal
  );

  update public.loyalty_accounts
  set points_balance = v_account.points_balance + v_points - v_repayment,
      recovery_points = v_account.recovery_points - v_repayment,
      updated_at = clock_timestamp()
  where membership_id = v_account.membership_id;
end;
$$;

revoke all on function public._loyalty_earn_order(public.orders)
  from public, anon, authenticated;

create or replace function public._loyalty_reverse_order(p_order public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_earned bigint;
  v_account public.loyalty_accounts;
  v_points_delta bigint;
  v_recovery_delta bigint;
begin
  if p_order.loyalty_membership_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.loyalty_ledger as l
    where l.order_id = p_order.id
      and l.entry_type = 'reversal'
  ) then
    return;
  end if;

  select l.amount into v_earned
  from public.loyalty_ledger as l
  where l.order_id = p_order.id
    and l.entry_type = 'earn';

  if v_earned is null then
    return;
  end if;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = p_order.loyalty_membership_id
  for update of ac;

  if v_account.membership_id is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  v_points_delta := -least(v_account.points_balance, v_earned);
  v_recovery_delta := v_earned + v_points_delta;

  insert into public.loyalty_ledger (
    organization_id,
    membership_id,
    order_id,
    entry_type,
    amount,
    points_delta,
    recovery_delta,
    eligible_amount
  ) values (
    p_order.organization_id,
    p_order.loyalty_membership_id,
    p_order.id,
    'reversal',
    -v_earned,
    v_points_delta,
    v_recovery_delta,
    p_order.subtotal
  );

  update public.loyalty_accounts
  set points_balance = v_account.points_balance + v_points_delta,
      recovery_points = v_account.recovery_points + v_recovery_delta,
      updated_at = clock_timestamp()
  where membership_id = v_account.membership_id;
end;
$$;

revoke all on function public._loyalty_reverse_order(public.orders)
  from public, anon, authenticated;

-- A valid token is repeatable until checkout consumes it. Missing rows
-- behind a valid token are corruption, not an unknown identity.
create or replace function public.get_public_loyalty_account(
  p_access_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := nullif(btrim(p_access_token), '');
  v_token_hash text;
  v_org_id uuid;
  v_membership_id uuid;
  v_customer_id uuid;
  v_org_name text;
  v_customer_name text;
  v_cpf_last2 text;
  v_account public.loyalty_accounts;
  v_statement jsonb;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('found', false);
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select lat.organization_id, lat.membership_id
  into v_org_id, v_membership_id
  from public.loyalty_access_tokens as lat
  where lat.token_hash = v_token_hash
    and lat.expires_at > now();

  if v_membership_id is null then
    return jsonb_build_object('found', false);
  end if;

  select org.name into v_org_name
  from public.organizations as org
  where org.id = v_org_id;

  select m.customer_id, c.name, c.cpf_last2
  into v_customer_id, v_customer_name, v_cpf_last2
  from public.loyalty_memberships as m
  join public.customers as c
    on c.id = m.customer_id
   and c.organization_id = m.organization_id
  where m.id = v_membership_id
    and m.organization_id = v_org_id;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = v_membership_id
    and ac.organization_id = v_org_id;

  if v_org_name is null
     or v_customer_id is null
     or v_account.membership_id is null
  then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  v_statement := (
    select coalesce(
      jsonb_agg(t.payload order by t.created_at desc, t.id desc),
      '[]'::jsonb
    )
    from (
      select
        l.id,
        l.created_at,
        jsonb_build_object(
          'entry_type', l.entry_type,
          'gross_points', abs(l.amount),
          'points_delta', l.points_delta,
          'recovery_delta', l.recovery_delta,
          'eligible_amount', l.eligible_amount,
          'order_number', o.order_number,
          'created_at', l.created_at
        ) as payload
      from public.loyalty_ledger as l
      left join public.orders as o
        on o.id = l.order_id
       and o.organization_id = l.organization_id
      where l.organization_id = v_org_id
        and l.membership_id = v_membership_id
      order by l.created_at desc, l.id desc
      limit 50
    ) as t
  );

  return jsonb_build_object(
    'found', true,
    'organization', jsonb_build_object('name', v_org_name),
    'customer', jsonb_build_object(
      'name', v_customer_name,
      'cpf_last2', v_cpf_last2
    ),
    'account', jsonb_build_object(
      'points_balance', v_account.points_balance,
      'recovery_points', v_account.recovery_points,
      'updated_at', v_account.updated_at
    ),
    'statement', v_statement
  );
end;
$$;

revoke all on function public.get_public_loyalty_account(text)
  from public;
grant execute on function public.get_public_loyalty_account(text)
  to anon, authenticated;

-- Preserve the admin payload and cursor behavior, but never hide an
-- integrity gap by dropping a membership through the account join.
create or replace function public.get_loyalty_members_admin(
  p_organization_id uuid,
  p_limit integer default 50,
  p_cursor uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_members jsonb;
  v_has_more boolean := false;
  v_next_cursor uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_organization_id is null
     or not public.is_org_owner(p_organization_id)
  then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  v_limit := coalesce(p_limit, 50);
  if v_limit < 1 or v_limit > 200 then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  if exists (
    select 1
    from public.loyalty_memberships as m
    left join public.loyalty_accounts as ac
      on ac.membership_id = m.id
     and ac.organization_id = m.organization_id
    where m.organization_id = p_organization_id
      and ac.membership_id is null
  ) then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  v_members := (
    select coalesce(
      jsonb_agg(t.payload order by t.created_at desc, t.id desc),
      '[]'::jsonb
    )
    from (
      select
        m.id,
        m.created_at,
        jsonb_build_object(
          'id', m.id,
          'cpf_last2', c.cpf_last2,
          'name', c.name,
          'points_balance', ac.points_balance,
          'recovery_points', ac.recovery_points,
          'total_earned', coalesce((
            select sum(l.amount) filter (where l.amount > 0)
            from public.loyalty_ledger as l
            where l.membership_id = m.id
          ), 0),
          'total_reversed', abs(coalesce((
            select sum(l.amount) filter (where l.amount < 0)
            from public.loyalty_ledger as l
            where l.membership_id = m.id
          ), 0)),
          'member_since', m.created_at
        ) as payload
      from public.loyalty_memberships as m
      join public.customers as c
        on c.id = m.customer_id
       and c.organization_id = m.organization_id
      join public.loyalty_accounts as ac
        on ac.membership_id = m.id
       and ac.organization_id = m.organization_id
      where m.organization_id = p_organization_id
        and (
          p_cursor is null
          or (m.created_at, m.id) < (
            select ms.created_at, ms.id
            from public.loyalty_memberships as ms
            where ms.id = p_cursor
              and ms.organization_id = p_organization_id
          )
        )
      order by m.created_at desc, m.id desc
      limit v_limit + 1
    ) as t
  );

  if jsonb_array_length(v_members) > v_limit then
    v_members := v_members - v_limit;
    v_has_more := true;
    v_next_cursor := (
      v_members -> (jsonb_array_length(v_members) - 1) ->> 'id'
    )::uuid;
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'count', (
      select count(*)::integer
      from public.loyalty_memberships as m
      where m.organization_id = p_organization_id
    ),
    'has_more', v_has_more,
    'next_cursor', v_next_cursor,
    'members', v_members
  );
end;
$$;

revoke all on function public.get_loyalty_members_admin(
  uuid, integer, uuid
)
  from public, anon;
grant execute on function public.get_loyalty_members_admin(
  uuid, integer, uuid
)
  to authenticated;

-- 4) A client attempt hash recovers a creation response when the HTTP
-- response is lost, while remaining scoped by public unit and key.
alter table public.orders
  add column client_attempt_hash text,
  add constraint orders_client_attempt_hash_check
    check (
      client_attempt_hash is null
      or client_attempt_hash ~ '^[a-f0-9]{64}$'
    );

create index orders_public_attempt_idx
  on public.orders (unit_id, idempotency_key, client_attempt_hash)
  where client_attempt_hash is not null;

create function public.create_public_order_v2(
  p_public_slug text,
  p_idempotency_key uuid,
  p_payload jsonb,
  p_attempt_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_hash text := nullif(btrim(p_attempt_hash), '');
  v_creation jsonb;
  v_order public.orders;
begin
  if v_attempt_hash is null
     or v_attempt_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'INVALID_CART' using errcode = 'PED37';
  end if;

  v_creation := public.create_public_order(
    p_public_slug,
    p_idempotency_key,
    p_payload
  );

  select o.* into v_order
  from public.orders as o
  where o.tracking_token = v_creation ->> 'tracking_token'
  for update of o;

  if v_order.id is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if v_order.client_attempt_hash is not null
     and v_order.client_attempt_hash <> v_attempt_hash
  then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PED42';
  end if;

  if v_order.client_attempt_hash is null then
    update public.orders
    set client_attempt_hash = v_attempt_hash
    where id = v_order.id;
  end if;

  return v_creation;
end;
$$;

revoke all on function public.create_public_order_v2(
  text, uuid, jsonb, text
)
  from public;
grant execute on function public.create_public_order_v2(
  text, uuid, jsonb, text
)
  to anon, authenticated;

create function public.get_public_order_by_attempt(
  p_public_slug text,
  p_idempotency_key uuid,
  p_attempt_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(p_public_slug), '');
  v_attempt_hash text := nullif(btrim(p_attempt_hash), '');
  v_unit_id uuid;
  v_order_id uuid;
begin
  if v_slug is null
     or v_slug !~ '^[a-f0-9]{24}$'
     or p_idempotency_key is null
     or v_attempt_hash is null
     or v_attempt_hash !~ '^[a-f0-9]{64}$'
  then
    return jsonb_build_object('found', false);
  end if;

  select mp.unit_id into v_unit_id
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_unit_id is null then
    return jsonb_build_object('found', false);
  end if;

  select o.id into v_order_id
  from public.orders as o
  where o.unit_id = v_unit_id
    and o.idempotency_key = p_idempotency_key
    and o.client_attempt_hash = v_attempt_hash;

  if v_order_id is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object('found', true)
    || public._order_creation_json(v_order_id);
end;
$$;

revoke all on function public.get_public_order_by_attempt(
  text, uuid, text
)
  from public;
grant execute on function public.get_public_order_by_attempt(
  text, uuid, text
)
  to anon, authenticated;

-- 5) Public tracking omits free-form item notes because they can carry
-- user-entered PII. Administrative order details retain the note.
create or replace function public._order_tracking_json(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_organization_name text;
  v_unit_name text;
begin
  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id;

  if v_order.id is null then
    return null;
  end if;

  select org.name into v_organization_name
  from public.organizations as org
  where org.id = v_order.organization_id;

  select u.name into v_unit_name
  from public.units as u
  where u.id = v_order.unit_id
    and u.organization_id = v_order.organization_id;

  return jsonb_build_object(
    'organization', jsonb_build_object('name', v_organization_name),
    'unit', jsonb_build_object('name', v_unit_name),
    'order', jsonb_build_object(
      'order_number', v_order.order_number,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'service_mode', v_order.service_mode,
      'payment_method', v_order.payment_method,
      'subtotal', v_order.subtotal::text,
      'delivery_fee', v_order.delivery_fee::text,
      'total', v_order.total::text,
      'estimated_minutes', v_order.estimated_minutes,
      'created_at', v_order.created_at,
      'status_updated_at', v_order.status_updated_at,
      'completed_at', v_order.completed_at,
      'cancelled_at', v_order.cancelled_at,
      'items', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'name', oi.product_name,
              'unit_price', oi.unit_price::text,
              'quantity', oi.quantity,
              'line_total', oi.line_total::text
            )
            order by oi.created_at, oi.id
          ),
          '[]'::jsonb
        )
        from public.order_items as oi
        where oi.order_id = p_order_id
      )
    )
  );
end;
$$;

revoke all on function public._order_tracking_json(uuid)
  from public, anon, authenticated;
