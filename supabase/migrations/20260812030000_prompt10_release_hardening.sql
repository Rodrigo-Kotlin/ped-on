-- =============================================================
-- PED-ON - Prompt 10 release hardening.
-- Authenticated idempotent replay, organization-wide serialization,
-- same-tenant relational coherence and accurate reversal metrics.
-- =============================================================

-- Redemption is the authoritative relationship between membership and
-- reward. These keys let dependent tables enforce that same relationship.
alter table public.loyalty_redemptions
  add constraint loyalty_redemptions_organization_id_membership_key
    unique (organization_id, id, membership_id),
  add constraint loyalty_redemptions_organization_id_reward_key
    unique (organization_id, id, reward_id),
  add constraint loyalty_redemptions_organization_id_membership_reward_key
    unique (organization_id, id, membership_id, reward_id);

alter table public.loyalty_vouchers
  add constraint loyalty_vouchers_redemption_relationship_fk
    foreign key (organization_id, redemption_id, membership_id, reward_id)
    references public.loyalty_redemptions (
      organization_id,
      id,
      membership_id,
      reward_id
    )
    on delete restrict;

alter table public.loyalty_reward_stock_events
  add constraint loyalty_reward_stock_events_redemption_reward_fk
    foreign key (organization_id, redemption_id, reward_id)
    references public.loyalty_redemptions (organization_id, id, reward_id)
    on delete restrict;

alter table public.loyalty_ledger
  add constraint loyalty_ledger_redemption_membership_fk
    foreign key (organization_id, redemption_id, membership_id)
    references public.loyalty_redemptions (organization_id, id, membership_id)
    on delete restrict;

-- Replay remains before all current-state validations, but possession of
-- the original recovery secret is required to disclose the bearer voucher.
-- The advisory lock follows the organization-wide idempotency boundary,
-- so two unit slugs in the same organization serialize on the same key.
create or replace function public.redeem_public_loyalty_reward(
  p_public_slug text,
  p_idempotency_key uuid,
  p_reward_id uuid,
  p_reward_revision text,
  p_access_token text,
  p_recovery_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(p_public_slug), '');
  v_revision text := nullif(btrim(p_reward_revision), '');
  v_token text := nullif(btrim(p_access_token), '');
  v_secret text := nullif(btrim(p_recovery_secret), '');
  v_publication public.menu_publications;
  v_org_id uuid;
  v_request_hash text;
  v_recovery_hash text;
  v_existing public.loyalty_redemptions;
  v_program public.loyalty_programs;
  v_token_hash text;
  v_membership_id uuid;
  v_reward public.loyalty_rewards;
  v_account public.loyalty_accounts;
  v_redemption public.loyalty_redemptions;
  v_voucher public.loyalty_vouchers;
  v_code text;
  v_new_stock bigint;
  v_constraint_name text;
  v_inserted boolean := false;
begin
  if v_slug is null or v_slug !~ '^[a-f0-9]{24}$' then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;
  if p_idempotency_key is null
     or p_reward_id is null
     or v_revision is null
     or v_revision !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
     or v_secret is null
     or v_secret !~ '^[a-f0-9]{64}$'
  then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_LOYALTY_TOKEN' using errcode = 'PED52';
  end if;

  v_request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'reward_id', p_reward_id::text,
        'reward_revision', v_revision
      )::text,
      'sha256'
    ),
    'hex'
  );
  v_recovery_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');

  select mp.* into v_publication
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_publication.unit_id is null then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;
  v_org_id := v_publication.organization_id;

  perform pg_advisory_xact_lock(
    hashtext('pedon:rewards:redeem:' || v_org_id::text || ':' || p_idempotency_key::text)
  );

  select r.* into v_existing
  from public.loyalty_redemptions as r
  where r.organization_id = v_org_id
    and r.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.request_hash = v_request_hash
       and v_existing.recovery_hash = v_recovery_hash
    then
      return jsonb_build_object('found', true)
        || public._loyalty_redemption_public_json(v_existing.id);
    end if;
    raise exception 'REDEMPTION_CONFLICT' using errcode = 'PED59';
  end if;

  select lp.* into v_program
  from public.loyalty_programs as lp
  where lp.organization_id = v_org_id;

  if v_program.organization_id is null or not v_program.enabled then
    raise exception 'LOYALTY_UNAVAILABLE' using errcode = 'PED51';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  select lat.membership_id into v_membership_id
  from public.loyalty_access_tokens as lat
  where lat.organization_id = v_org_id
    and lat.token_hash = v_token_hash
    and lat.expires_at > clock_timestamp()
  for update of lat;

  if v_membership_id is null then
    raise exception 'INVALID_LOYALTY_TOKEN' using errcode = 'PED52';
  end if;

  select rw.* into v_reward
  from public.loyalty_rewards as rw
  where rw.organization_id = v_org_id
    and rw.id = p_reward_id
  for update of rw;

  if v_reward.id is null then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'PED54';
  end if;
  if v_revision <> public._loyalty_reward_revision(v_reward.updated_at) then
    raise exception 'REWARD_CHANGED' using errcode = 'PED56';
  end if;
  if not v_reward.is_active then
    raise exception 'REWARD_UNAVAILABLE' using errcode = 'PED55';
  end if;
  if v_reward.stock_quantity <= 0 then
    raise exception 'REWARD_OUT_OF_STOCK' using errcode = 'PED57';
  end if;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = v_membership_id
    and ac.organization_id = v_org_id
  for update of ac;

  if v_account.membership_id is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if v_account.recovery_points > 0 then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;
  if v_account.points_balance < v_reward.points_cost then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'PED58';
  end if;

  insert into public.loyalty_redemptions (
    organization_id,
    membership_id,
    reward_id,
    idempotency_key,
    request_hash,
    recovery_hash,
    reward_name_snapshot,
    points_cost,
    reward_revision
  ) values (
    v_org_id,
    v_membership_id,
    v_reward.id,
    p_idempotency_key,
    v_request_hash,
    v_recovery_hash,
    v_reward.name,
    v_reward.points_cost,
    v_revision
  )
  returning * into v_redemption;

  insert into public.loyalty_ledger (
    organization_id,
    membership_id,
    order_id,
    entry_type,
    amount,
    points_delta,
    recovery_delta,
    eligible_amount,
    redemption_id
  ) values (
    v_org_id,
    v_membership_id,
    null,
    'redeem',
    -v_reward.points_cost,
    -v_reward.points_cost,
    0,
    null,
    v_redemption.id
  );

  update public.loyalty_accounts
  set points_balance = v_account.points_balance - v_reward.points_cost,
      updated_at = clock_timestamp()
  where membership_id = v_membership_id;

  v_new_stock := v_reward.stock_quantity - 1;
  update public.loyalty_rewards
  set stock_quantity = v_new_stock
  where id = v_reward.id;

  insert into public.loyalty_reward_stock_events (
    organization_id,
    reward_id,
    redemption_id,
    delta,
    balance_after,
    event_type,
    actor_user_id
  ) values (
    v_org_id,
    v_reward.id,
    v_redemption.id,
    -1,
    v_new_stock,
    'redemption',
    null
  );

  for v_attempt in 1..10 loop
    v_code := upper(encode(extensions.gen_random_bytes(8), 'hex'));
    begin
      insert into public.loyalty_vouchers (
        organization_id,
        redemption_id,
        membership_id,
        reward_id,
        voucher_code,
        status
      ) values (
        v_org_id,
        v_redemption.id,
        v_membership_id,
        v_reward.id,
        v_code,
        'issued'
      )
      returning * into v_voucher;
      v_inserted := true;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'loyalty_vouchers_voucher_code_key' then
        raise;
      end if;
    end;
  end loop;

  if not v_inserted then
    raise exception 'REDEMPTION_INTEGRITY' using errcode = 'PED64';
  end if;

  insert into public.loyalty_voucher_events (
    organization_id,
    voucher_id,
    event_type,
    unit_id,
    actor_user_id
  ) values (
    v_org_id,
    v_voucher.id,
    'issued',
    null,
    null
  );

  delete from public.loyalty_access_tokens
  where organization_id = v_org_id
    and token_hash = v_token_hash;

  return jsonb_build_object('found', true)
    || public._loyalty_redemption_public_json(v_redemption.id);
end;
$$;

revoke all on function public.redeem_public_loyalty_reward(
  text, uuid, uuid, text, text, text
)
  from public;
grant execute on function public.redeem_public_loyalty_reward(
  text, uuid, uuid, text, text, text
)
  to anon, authenticated;

-- Redemptions are not reversals. Keep both organization and member
-- administrative metrics semantically accurate after entry_type=redeem.
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
      ), 0),
      'total_reversed', abs(coalesce((
        select sum(l.amount) filter (where l.entry_type = 'reversal')
        from public.loyalty_ledger as l
        where l.organization_id = p_organization_id
      ), 0))
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
          'points_balance', ac.points_balance,
          'recovery_points', ac.recovery_points,
          'total_earned', coalesce((
            select sum(l.amount) filter (where l.entry_type = 'earn')
            from public.loyalty_ledger as l
            where l.membership_id = m.id
          ), 0),
          'total_reversed', abs(coalesce((
            select sum(l.amount) filter (where l.entry_type = 'reversal')
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

revoke all on function public.get_loyalty_members_admin(uuid, integer, uuid)
  from public, anon;
grant execute on function public.get_loyalty_members_admin(uuid, integer, uuid)
  to authenticated;
