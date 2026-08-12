-- =============================================================
-- PED-ON - Prompt 10 final integrity hardening.
-- Exact bigint JSON contracts and structural voucher/stock guards.
-- =============================================================

create unique index loyalty_reward_stock_events_redemption_key
  on public.loyalty_reward_stock_events (redemption_id)
  where redemption_id is not null;

alter table public.loyalty_vouchers
  add constraint loyalty_vouchers_consumption_relationship_key
    unique (organization_id, id, consumed_unit_id, consumed_by_user_id);

alter table public.loyalty_voucher_events
  add constraint loyalty_voucher_events_consumption_relationship_fk
    foreign key (organization_id, voucher_id, unit_id, actor_user_id)
    references public.loyalty_vouchers (
      organization_id,
      id,
      consumed_unit_id,
      consumed_by_user_id
    )
    on delete restrict;

-- PostgreSQL bigint values cross the JSON boundary as decimal text. The
-- browser converts them to BigInt only after validating the wire contract.
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
  v_vouchers jsonb;
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
          'gross_points', abs(l.amount)::text,
          'points_delta', l.points_delta::text,
          'recovery_delta', l.recovery_delta::text,
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

  v_vouchers := (
    select coalesce(
      jsonb_agg(t.payload order by t.issued_at desc, t.id desc),
      '[]'::jsonb
    )
    from (
      select
        v.id,
        v.issued_at,
        jsonb_build_object(
          'code', public._loyalty_format_voucher_code(v.voucher_code),
          'reward_name', r.reward_name_snapshot,
          'points_cost', r.points_cost::text,
          'issued_at', v.issued_at
        ) as payload
      from public.loyalty_vouchers as v
      join public.loyalty_redemptions as r
        on r.id = v.redemption_id
       and r.organization_id = v.organization_id
      where v.organization_id = v_org_id
        and v.membership_id = v_membership_id
        and v.status = 'issued'
      order by v.issued_at desc, v.id desc
      limit 20
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
      'points_balance', v_account.points_balance::text,
      'recovery_points', v_account.recovery_points::text,
      'updated_at', v_account.updated_at
    ),
    'statement', v_statement,
    'vouchers', v_vouchers
  );
end;
$$;

revoke all on function public.get_public_loyalty_account(text)
  from public;
grant execute on function public.get_public_loyalty_account(text)
  to anon, authenticated;

create or replace function public.get_loyalty_program_admin(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_program public.loyalty_programs;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select lp.* into v_program
  from public.loyalty_programs as lp
  where lp.organization_id = p_organization_id;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'program',
      case when v_program.organization_id is null then null
           else jsonb_build_object(
             'exists', true,
             'enabled', v_program.enabled,
             'points_per_real', v_program.points_per_real::text,
             'created_at', v_program.created_at,
             'updated_at', v_program.updated_at
           )
      end,
    'stats', jsonb_build_object(
      'members_count', (
        select count(*)::integer
        from public.loyalty_memberships as m
        where m.organization_id = p_organization_id
      ),
      'total_earned', coalesce((
        select sum(l.amount) filter (where l.entry_type = 'earn')
        from public.loyalty_ledger as l
        where l.organization_id = p_organization_id
      ), 0)::text,
      'total_redeemed', abs(coalesce((
        select sum(l.amount) filter (where l.entry_type = 'redeem')
        from public.loyalty_ledger as l
        where l.organization_id = p_organization_id
      ), 0))::text,
      'total_reversed', abs(coalesce((
        select sum(l.amount) filter (where l.entry_type = 'reversal')
        from public.loyalty_ledger as l
        where l.organization_id = p_organization_id
      ), 0))::text
    )
  );
end;
$$;

revoke all on function public.get_loyalty_program_admin(uuid)
  from public, anon;
grant execute on function public.get_loyalty_program_admin(uuid)
  to authenticated;

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
          'points_balance', ac.points_balance::text,
          'recovery_points', ac.recovery_points::text,
          'total_earned', coalesce((
            select sum(l.amount) filter (where l.entry_type = 'earn')
            from public.loyalty_ledger as l
            where l.membership_id = m.id
          ), 0)::text,
          'total_redeemed', abs(coalesce((
            select sum(l.amount) filter (where l.entry_type = 'redeem')
            from public.loyalty_ledger as l
            where l.membership_id = m.id
          ), 0))::text,
          'total_reversed', abs(coalesce((
            select sum(l.amount) filter (where l.entry_type = 'reversal')
            from public.loyalty_ledger as l
            where l.membership_id = m.id
          ), 0))::text,
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

revoke all on function public.get_loyalty_members_admin(uuid, integer, uuid)
  from public, anon;
grant execute on function public.get_loyalty_members_admin(uuid, integer, uuid)
  to authenticated;
