-- =============================================================
-- PED-ON - Prompt 10 - Recompensas, resgates e vouchers. Domínio
-- separado do catálogo (reward não é produto), estoque próprio
-- organization-wide, redemptions imutáveis e idempotentes, vouchers
-- bearer operacionais sem expiração no Core MVP e trilhas auditáveis
-- append-only para estoque e ciclo de vida do voucher.
-- =============================================================

-- 1) Recompensas por organização. Sem valor monetário: única unidade
--    econômica é points_cost (bigint). Nunca deletada pelo browser;
--    owner apenas alterna is_active. Estoque é o saldo disponível para
--    novos resgates e é debitado na emissão do voucher.
create table public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  points_cost bigint not null,
  stock_quantity bigint not null default 0,
  is_active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint loyalty_rewards_organization_fk
    foreign key (organization_id)
    references public.organizations (id)
    on delete cascade,
  constraint loyalty_rewards_organization_id_key unique (organization_id, id),
  constraint loyalty_rewards_name_check
    check (
      name = btrim(name)
      and char_length(name) between 1 and 120
      and public._is_safe_plain_text(name)
    ),
  constraint loyalty_rewards_description_check
    check (
      description is null
      or (
        description = btrim(description)
        and char_length(description) between 1 and 500
        and public._is_safe_plain_text(description)
      )
    ),
  constraint loyalty_rewards_points_cost_check
    check (points_cost > 0),
  constraint loyalty_rewards_stock_quantity_check
    check (stock_quantity >= 0),
  constraint loyalty_rewards_sort_order_check
    check (sort_order > 0)
);

-- Nomes únicos case-insensitive dentro da organização.
create unique index loyalty_rewards_organization_name_ci_key
  on public.loyalty_rewards (organization_id, lower(name));

create index loyalty_rewards_organization_sort_idx
  on public.loyalty_rewards (organization_id, sort_order, created_at desc, id desc);

alter table public.loyalty_rewards enable row level security;

-- 2) Redemptions imutáveis. Guardam snapshot mínimo da recompensa e a
--    revisão (opaca/temporal) aceita pelo cliente. FKs compostas
--    impedem cross-tenant. recovery_hash é SHA-256 do recovery_secret.
create table public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  reward_id uuid not null,
  idempotency_key uuid not null,
  request_hash text not null
    check (request_hash ~ '^[a-f0-9]{64}$'),
  recovery_hash text not null
    check (recovery_hash ~ '^[a-f0-9]{64}$'),
  reward_name_snapshot text not null
    check (
      reward_name_snapshot = btrim(reward_name_snapshot)
      and char_length(reward_name_snapshot) between 1 and 120
      and public._is_safe_plain_text(reward_name_snapshot)
    ),
  points_cost bigint not null
    check (points_cost > 0),
  reward_revision text not null
    check (
      reward_revision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    ),
  created_at timestamptz not null default clock_timestamp(),
  constraint loyalty_redemptions_membership_fk
    foreign key (organization_id, membership_id)
    references public.loyalty_memberships (organization_id, id)
    on delete restrict,
  constraint loyalty_redemptions_reward_fk
    foreign key (organization_id, reward_id)
    references public.loyalty_rewards (organization_id, id)
    on delete restrict,
  constraint loyalty_redemptions_organization_id_key unique (organization_id, id),
  constraint loyalty_redemptions_organization_idempotency_key
    unique (organization_id, idempotency_key)
);

create index loyalty_redemptions_membership_created_idx
  on public.loyalty_redemptions (organization_id, membership_id, created_at desc, id desc);

alter table public.loyalty_redemptions enable row level security;

-- 3) Vouchers bearer operacionais. Código 16 hex uppercase, globalmente
--    único. Sem expiração no Core MVP; issued -> consumed é terminal.
create table public.loyalty_vouchers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  redemption_id uuid not null,
  membership_id uuid not null,
  reward_id uuid not null,
  voucher_code text not null
    check (voucher_code ~ '^[A-F0-9]{16}$'),
  status text not null default 'issued'
    check (status in ('issued', 'consumed')),
  issued_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  consumed_unit_id uuid,
  consumed_by_user_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  constraint loyalty_vouchers_redemption_fk
    foreign key (organization_id, redemption_id)
    references public.loyalty_redemptions (organization_id, id)
    on delete restrict,
  constraint loyalty_vouchers_membership_fk
    foreign key (organization_id, membership_id)
    references public.loyalty_memberships (organization_id, id)
    on delete restrict,
  constraint loyalty_vouchers_reward_fk
    foreign key (organization_id, reward_id)
    references public.loyalty_rewards (organization_id, id)
    on delete restrict,
  constraint loyalty_vouchers_consumed_unit_fk
    foreign key (organization_id, consumed_unit_id)
    references public.units (organization_id, id)
    on delete restrict,
  constraint loyalty_vouchers_redemption_id_key unique (redemption_id),
  constraint loyalty_vouchers_organization_id_key unique (organization_id, id),
  constraint loyalty_vouchers_voucher_code_key unique (voucher_code),
  constraint loyalty_vouchers_consumption_shape_check
    check (
      (status = 'issued'
        and consumed_at is null
        and consumed_unit_id is null
        and consumed_by_user_id is null)
      or (status = 'consumed'
        and consumed_at is not null
        and consumed_unit_id is not null
        and consumed_by_user_id is not null)
    )
);

create index loyalty_vouchers_membership_issued_idx
  on public.loyalty_vouchers (organization_id, membership_id, issued_at desc, id desc);

alter table public.loyalty_vouchers enable row level security;

-- 4) Trilha append-only de estoque. Desde estoque inicial zero,
--    SUM(stock_events.delta) = loyalty_rewards.stock_quantity.
create table public.loyalty_reward_stock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reward_id uuid not null,
  redemption_id uuid,
  delta bigint not null
    check (delta <> 0),
  balance_after bigint not null
    check (balance_after >= 0),
  event_type text not null
    check (event_type in ('initial', 'admin_adjustment', 'redemption')),
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint loyalty_reward_stock_events_reward_fk
    foreign key (organization_id, reward_id)
    references public.loyalty_rewards (organization_id, id)
    on delete restrict,
  constraint loyalty_reward_stock_events_redemption_fk
    foreign key (organization_id, redemption_id)
    references public.loyalty_redemptions (organization_id, id)
    on delete restrict,
  constraint loyalty_reward_stock_events_shape_check
    check (
      (event_type = 'redemption'
        and redemption_id is not null
        and actor_user_id is null)
      or (event_type = 'admin_adjustment'
        and redemption_id is null
        and actor_user_id is not null)
      or (event_type = 'initial'
        and redemption_id is null
        and actor_user_id is null)
    )
);

create index loyalty_reward_stock_events_reward_created_idx
  on public.loyalty_reward_stock_events (organization_id, reward_id, created_at, id);

alter table public.loyalty_reward_stock_events enable row level security;

-- 5) Trilha append-only do ciclo de vida do voucher: no máximo um
--    'issued' e um 'consumed' por voucher.
create table public.loyalty_voucher_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  voucher_id uuid not null,
  event_type text not null
    check (event_type in ('issued', 'consumed')),
  unit_id uuid,
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint loyalty_voucher_events_voucher_fk
    foreign key (organization_id, voucher_id)
    references public.loyalty_vouchers (organization_id, id)
    on delete restrict,
  constraint loyalty_voucher_events_voucher_type_key unique (voucher_id, event_type),
  constraint loyalty_voucher_events_shape_check
    check (
      (event_type = 'issued' and unit_id is null and actor_user_id is null)
      or (event_type = 'consumed' and unit_id is not null and actor_user_id is not null)
    )
);

create index loyalty_voucher_events_voucher_created_idx
  on public.loyalty_voucher_events (organization_id, voucher_id, created_at, id);

alter table public.loyalty_voucher_events enable row level security;

-- 6) Ledger aceita entry_type = 'redeem' com redemption_id obrigatório.
--    Invariante preservada: points_delta - recovery_delta = amount
--    (para redeem: -cost - 0 = -cost) e
--    SUM(amount) = points_balance - recovery_points.
alter table public.loyalty_ledger
  drop constraint loyalty_ledger_entry_shape_check;

-- O check inline original (entry_type in ('earn','reversal')) tambem
-- precisa admitir 'redeem'.
alter table public.loyalty_ledger
  drop constraint loyalty_ledger_entry_type_check;

alter table public.loyalty_ledger
  add constraint loyalty_ledger_entry_type_check
    check (entry_type in ('earn', 'reversal', 'redeem'));

alter table public.loyalty_ledger
  add column redemption_id uuid;

alter table public.loyalty_ledger
  add constraint loyalty_ledger_entry_shape_check
    check (
      (entry_type = 'earn' and amount > 0)
      or (entry_type = 'reversal' and amount < 0)
      or (entry_type = 'redeem' and amount < 0)
    );

alter table public.loyalty_ledger
  add constraint loyalty_ledger_redemption_fk
    foreign key (organization_id, redemption_id)
    references public.loyalty_redemptions (organization_id, id)
    on delete restrict;

alter table public.loyalty_ledger
  add constraint loyalty_ledger_redeem_shape_check
    check (
      (entry_type = 'redeem'
        and redemption_id is not null
        and order_id is null
        and points_delta < 0
        and recovery_delta = 0
        and eligible_amount is null)
      or (entry_type in ('earn', 'reversal') and redemption_id is null)
    );

create unique index loyalty_ledger_redemption_entry_key
  on public.loyalty_ledger (redemption_id, entry_type)
  where redemption_id is not null;

-- 7) ACL: nenhum papel de navegador acessa as tabelas diretamente;
--    todo acesso passa por RPCs security definer.
revoke all on table public.loyalty_rewards from public, anon, authenticated;
revoke all on table public.loyalty_redemptions from public, anon, authenticated;
revoke all on table public.loyalty_vouchers from public, anon, authenticated;
revoke all on table public.loyalty_reward_stock_events from public, anon, authenticated;
revoke all on table public.loyalty_voucher_events from public, anon, authenticated;

-- 8) Helpers internos. Todos sem execute de navegador.

-- Revisão opaca/temporal canônica da recompensa. Texto UTC com
-- microssegundos (to_char) para round-trip exato entre servidor e
-- cliente, evitando truncamento de microssegundos via Date JS.
create function public._loyalty_reward_revision(p_updated_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(
    p_updated_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  );
$$;

revoke all on function public._loyalty_reward_revision(timestamptz)
  from public, anon, authenticated;

-- Exibição humana do código: ABCD-EF12-3456-7890.
create function public._loyalty_format_voucher_code(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select substring(p_code from 1 for 4)
    || '-' || substring(p_code from 5 for 4)
    || '-' || substring(p_code from 9 for 4)
    || '-' || substring(p_code from 13 for 4);
$$;

revoke all on function public._loyalty_format_voucher_code(text)
  from public, anon, authenticated;

-- Shape administrativo de recompensa. points_cost/stock_quantity como
-- string decimal (bigint fora do range seguro de Number no frontend).
create function public._loyalty_reward_admin_json(p_reward public.loyalty_rewards)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_reward.id,
    'organization_id', p_reward.organization_id,
    'name', p_reward.name,
    'description', p_reward.description,
    'points_cost', p_reward.points_cost::text,
    'stock_quantity', p_reward.stock_quantity::text,
    'is_active', p_reward.is_active,
    'sort_order', p_reward.sort_order,
    'created_at', p_reward.created_at,
    'updated_at', p_reward.updated_at,
    'revision', public._loyalty_reward_revision(p_reward.updated_at)
  );
$$;

revoke all on function public._loyalty_reward_admin_json(public.loyalty_rewards)
  from public, anon, authenticated;

-- Payload público de redemption + voucher (replay, recovery e resposta
-- do resgate). Sem IDs internos, membership, recompensa interna ou
-- fingerprint. Corrupção (redemption sem voucher) é PED64.
create function public._loyalty_redemption_public_json(p_redemption_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_redemption public.loyalty_redemptions;
  v_voucher public.loyalty_vouchers;
begin
  select r.* into v_redemption
  from public.loyalty_redemptions as r
  where r.id = p_redemption_id;

  if v_redemption.id is null then
    return null;
  end if;

  select v.* into v_voucher
  from public.loyalty_vouchers as v
  where v.redemption_id = v_redemption.id;

  if v_voucher.id is null then
    raise exception 'REDEMPTION_INTEGRITY' using errcode = 'PED64';
  end if;

  return jsonb_build_object(
    'redemption', jsonb_build_object(
      'reward_name', v_redemption.reward_name_snapshot,
      'points_cost', v_redemption.points_cost::text,
      'created_at', v_redemption.created_at
    ),
    'voucher', jsonb_build_object(
      'code', public._loyalty_format_voucher_code(v_voucher.voucher_code),
      'status', v_voucher.status,
      'issued_at', v_voucher.issued_at
    )
  );
end;
$$;

revoke all on function public._loyalty_redemption_public_json(uuid)
  from public, anon, authenticated;

-- 9) Catálogo público de recompensas. available = is_active E stock > 0;
--    estoque exato e IDs internos nunca expostos.
create function public.get_public_loyalty_rewards(p_public_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(p_public_slug), '');
  v_publication public.menu_publications;
  v_program public.loyalty_programs;
  v_rewards jsonb;
begin
  if v_slug is null or v_slug !~ '^[a-f0-9]{24}$' then
    return jsonb_build_object('found', false);
  end if;

  select mp.* into v_publication
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_publication.unit_id is null then
    return jsonb_build_object('found', false);
  end if;

  select lp.* into v_program
  from public.loyalty_programs as lp
  where lp.organization_id = v_publication.organization_id;

  if v_program.organization_id is null or not v_program.enabled then
    return jsonb_build_object(
      'found', true,
      'loyalty_enabled', false,
      'rewards', '[]'::jsonb
    );
  end if;

  v_rewards := (
    select coalesce(
      jsonb_agg(t.payload order by t.sort_order asc, t.created_at desc, t.id desc),
      '[]'::jsonb
    )
    from (
      select
        r.id,
        r.sort_order,
        r.created_at,
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'description', r.description,
          'points_cost', r.points_cost::text,
          'available', r.stock_quantity > 0,
          'revision', public._loyalty_reward_revision(r.updated_at)
        ) as payload
      from public.loyalty_rewards as r
      where r.organization_id = v_publication.organization_id
        and r.is_active
      order by r.sort_order asc, r.created_at desc, r.id desc
    ) as t
  );

  return jsonb_build_object(
    'found', true,
    'loyalty_enabled', true,
    'rewards', v_rewards
  );
end;
$$;

revoke all on function public.get_public_loyalty_rewards(text)
  from public;
grant execute on function public.get_public_loyalty_rewards(text)
  to anon, authenticated;

-- 10) Resgate: UMA transação. Ordem de locks (spec §45):
--     advisory lock de idempotência -> token row -> reward row ->
--     account row. Replay idempotente resolve ANTES das validações
--     correntes de token/programa/reward/estoque/revisão.
create function public.redeem_public_loyalty_reward(
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
  v_attempt integer;
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

  perform pg_advisory_xact_lock(
    hashtext('pedon:rewards:redeem:' || v_slug || ':' || p_idempotency_key::text)
  );

  select mp.* into v_publication
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_publication.unit_id is null then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;
  v_org_id := v_publication.organization_id;

  select r.* into v_existing
  from public.loyalty_redemptions as r
  where r.organization_id = v_org_id
    and r.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.request_hash = v_request_hash then
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

  -- Código 16 hex uppercase (64 bits de entropia). Somente colisão de
  -- código é retryável.
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

-- 11) Recuperação por tentativa do cliente (resposta HTTP perdida).
--     Sem PII: match por (organization, idempotency_key, recovery_hash).
create function public.get_public_redemption_by_attempt(
  p_public_slug text,
  p_idempotency_key uuid,
  p_recovery_secret text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(p_public_slug), '');
  v_secret text := nullif(btrim(p_recovery_secret), '');
  v_publication public.menu_publications;
  v_recovery_hash text;
  v_redemption_id uuid;
begin
  if v_slug is null
     or v_slug !~ '^[a-f0-9]{24}$'
     or p_idempotency_key is null
     or v_secret is null
     or v_secret !~ '^[a-f0-9]{64}$'
  then
    return jsonb_build_object('found', false);
  end if;

  select mp.* into v_publication
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_publication.unit_id is null then
    return jsonb_build_object('found', false);
  end if;

  v_recovery_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');

  select r.id into v_redemption_id
  from public.loyalty_redemptions as r
  where r.organization_id = v_publication.organization_id
    and r.idempotency_key = p_idempotency_key
    and r.recovery_hash = v_recovery_hash;

  if v_redemption_id is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object('found', true)
    || public._loyalty_redemption_public_json(v_redemption_id);
end;
$$;

revoke all on function public.get_public_redemption_by_attempt(text, uuid, text)
  from public;
grant execute on function public.get_public_redemption_by_attempt(text, uuid, text)
  to anon, authenticated;

-- 12) Consulta pública da conta passa a incluir vouchers ativos do
--     membership (máximo 20 emitidos mais recentes). Aditivo: extrato
--     e demais campos permanecem inalterados.
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
      'points_balance', v_account.points_balance,
      'recovery_points', v_account.recovery_points,
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

-- 13) Administração de recompensas (owner only).
create function public.get_loyalty_rewards_admin(
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
  v_rewards jsonb;
  v_has_more boolean := false;
  v_next_cursor uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  v_limit := coalesce(p_limit, 50);
  if v_limit < 1 or v_limit > 200 then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  v_rewards := (
    select coalesce(
      jsonb_agg(t.payload order by t.created_at desc, t.id desc),
      '[]'::jsonb
    )
    from (
      select
        r.id,
        r.created_at,
        public._loyalty_reward_admin_json(r) as payload
      from public.loyalty_rewards as r
      where r.organization_id = p_organization_id
        and (
          p_cursor is null
          or (r.created_at, r.id) < (
            select rs.created_at, rs.id
            from public.loyalty_rewards as rs
            where rs.id = p_cursor
              and rs.organization_id = p_organization_id
          )
        )
      order by r.created_at desc, r.id desc
      limit v_limit + 1
    ) as t
  );

  if jsonb_array_length(v_rewards) > v_limit then
    v_rewards := v_rewards - v_limit;
    v_has_more := true;
    v_next_cursor := (
      v_rewards -> (jsonb_array_length(v_rewards) - 1) ->> 'id'
    )::uuid;
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'count', (
      select count(*)::integer
      from public.loyalty_rewards as r
      where r.organization_id = p_organization_id
    ),
    'has_more', v_has_more,
    'next_cursor', v_next_cursor,
    'rewards', v_rewards
  );
end;
$$;

revoke all on function public.get_loyalty_rewards_admin(uuid, integer, uuid)
  from public, anon;
grant execute on function public.get_loyalty_rewards_admin(uuid, integer, uuid)
  to authenticated;

create function public.create_loyalty_reward(
  p_organization_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := p_payload;
  v_name text;
  v_description text;
  v_cost_text text;
  v_stock_text text;
  v_cost bigint;
  v_stock bigint;
  v_next_sort integer;
  v_reward public.loyalty_rewards;
  v_constraint_name text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if v_payload is null or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_payload) as k(key)
    where k.key not in ('name', 'description', 'points_cost', 'initial_stock')
  ) then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;

  if jsonb_typeof(v_payload -> 'name') is distinct from 'string'
     or jsonb_typeof(v_payload -> 'points_cost') is distinct from 'string'
     or jsonb_typeof(v_payload -> 'initial_stock') is distinct from 'string'
  then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;

  v_name := btrim(v_payload ->> 'name');
  if char_length(v_name) not between 1 and 120
     or not public._is_safe_plain_text(v_name)
  then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;

  v_description := null;
  if v_payload ? 'description'
     and jsonb_typeof(v_payload -> 'description') <> 'null'
  then
    if jsonb_typeof(v_payload -> 'description') <> 'string' then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end if;
    v_description := nullif(btrim(v_payload ->> 'description'), '');
    if v_description is not null
       and (
         char_length(v_description) > 500
         or not public._is_safe_plain_text(v_description)
       )
    then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end if;
  end if;

  v_cost_text := v_payload ->> 'points_cost';
  if v_cost_text !~ '^[1-9][0-9]*$' then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;
  begin
    v_cost := v_cost_text::bigint;
  exception when others then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end;

  v_stock_text := v_payload ->> 'initial_stock';
  if v_stock_text !~ '^[0-9]+$' then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;
  begin
    v_stock := v_stock_text::bigint;
  exception when others then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end;

  perform pg_advisory_xact_lock(
    hashtext('pedon:rewards:create:' || p_organization_id::text)
  );

  select coalesce(max(r.sort_order), 0)::integer + 1 into v_next_sort
  from public.loyalty_rewards as r
  where r.organization_id = p_organization_id;

  begin
    insert into public.loyalty_rewards (
      organization_id,
      name,
      description,
      points_cost,
      stock_quantity,
      sort_order
    ) values (
      p_organization_id,
      v_name,
      v_description,
      v_cost,
      v_stock,
      v_next_sort
    )
    returning * into v_reward;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'loyalty_rewards_organization_name_ci_key' then
      raise;
    end if;
    raise exception 'REWARD_NAME_CONFLICT' using errcode = 'PED65';
  end;

  if v_stock > 0 then
    insert into public.loyalty_reward_stock_events (
      organization_id,
      reward_id,
      redemption_id,
      delta,
      balance_after,
      event_type,
      actor_user_id
    ) values (
      p_organization_id,
      v_reward.id,
      null,
      v_stock,
      v_stock,
      'initial',
      null
    );
  end if;

  return public._loyalty_reward_admin_json(v_reward);
end;
$$;

revoke all on function public.create_loyalty_reward(uuid, jsonb)
  from public, anon;
grant execute on function public.create_loyalty_reward(uuid, jsonb)
  to authenticated;

create function public.update_loyalty_reward(
  p_reward_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := p_payload;
  v_reward public.loyalty_rewards;
  v_name text;
  v_description text;
  v_cost_text text;
  v_cost bigint;
  v_constraint_name text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_reward_id is null
     or v_payload is null
     or jsonb_typeof(v_payload) <> 'object'
  then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_payload) as k(key)
    where k.key not in ('name', 'description', 'points_cost')
  ) then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;
  if not (
    v_payload ? 'name' or v_payload ? 'description' or v_payload ? 'points_cost'
  ) then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;

  select r.* into v_reward
  from public.loyalty_rewards as r
  where r.id = p_reward_id
  for update of r;

  if v_reward.id is null then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'PED54';
  end if;
  if not public.is_org_owner(v_reward.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  if v_payload ? 'name' then
    if jsonb_typeof(v_payload -> 'name') is distinct from 'string' then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end if;
    v_name := btrim(v_payload ->> 'name');
    if char_length(v_name) not between 1 and 120
       or not public._is_safe_plain_text(v_name)
    then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end if;
  end if;

  if v_payload ? 'description' then
    v_description := null;
    if jsonb_typeof(v_payload -> 'description') <> 'null' then
      if jsonb_typeof(v_payload -> 'description') <> 'string' then
        raise exception 'INVALID_REWARD' using errcode = 'PED63';
      end if;
      v_description := nullif(btrim(v_payload ->> 'description'), '');
      if v_description is not null
         and (
           char_length(v_description) > 500
           or not public._is_safe_plain_text(v_description)
         )
      then
        raise exception 'INVALID_REWARD' using errcode = 'PED63';
      end if;
    end if;
  end if;

  if v_payload ? 'points_cost' then
    if jsonb_typeof(v_payload -> 'points_cost') is distinct from 'string' then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end if;
    v_cost_text := v_payload ->> 'points_cost';
    if v_cost_text !~ '^[1-9][0-9]*$' then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end if;
    begin
      v_cost := v_cost_text::bigint;
    exception when others then
      raise exception 'INVALID_REWARD' using errcode = 'PED63';
    end;
  end if;

  begin
    update public.loyalty_rewards
    set name = case when v_payload ? 'name' then v_name else name end,
        description = case
          when v_payload ? 'description' then v_description
          else description
        end,
        points_cost = case
          when v_payload ? 'points_cost' then v_cost
          else points_cost
        end,
        updated_at = clock_timestamp()
    where id = v_reward.id
    returning * into v_reward;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'loyalty_rewards_organization_name_ci_key' then
      raise;
    end if;
    raise exception 'REWARD_NAME_CONFLICT' using errcode = 'PED65';
  end;

  return public._loyalty_reward_admin_json(v_reward);
end;
$$;

revoke all on function public.update_loyalty_reward(uuid, jsonb)
  from public, anon;
grant execute on function public.update_loyalty_reward(uuid, jsonb)
  to authenticated;

create function public.set_loyalty_reward_active(
  p_reward_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.loyalty_rewards;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_active is null then
    raise exception 'INVALID_REWARD' using errcode = 'PED63';
  end if;

  select r.* into v_reward
  from public.loyalty_rewards as r
  where r.id = p_reward_id
  for update of r;

  if v_reward.id is null then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'PED54';
  end if;
  if not public.is_org_owner(v_reward.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  update public.loyalty_rewards
  set is_active = p_active
  where id = v_reward.id
  returning * into v_reward;

  return public._loyalty_reward_admin_json(v_reward);
end;
$$;

revoke all on function public.set_loyalty_reward_active(uuid, boolean)
  from public, anon;
grant execute on function public.set_loyalty_reward_active(uuid, boolean)
  to authenticated;

create function public.set_loyalty_reward_stock(
  p_reward_id uuid,
  p_stock bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.loyalty_rewards;
  v_delta bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;
  if p_reward_id is null or p_stock is null or p_stock < 0 then
    raise exception 'INVALID_REWARD_STOCK' using errcode = 'PED66';
  end if;

  select r.* into v_reward
  from public.loyalty_rewards as r
  where r.id = p_reward_id
  for update of r;

  if v_reward.id is null then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'PED54';
  end if;
  if not public.is_org_owner(v_reward.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  v_delta := p_stock - v_reward.stock_quantity;
  if v_delta = 0 then
    return public._loyalty_reward_admin_json(v_reward);
  end if;

  update public.loyalty_rewards
  set stock_quantity = p_stock
  where id = v_reward.id
  returning * into v_reward;

  insert into public.loyalty_reward_stock_events (
    organization_id,
    reward_id,
    redemption_id,
    delta,
    balance_after,
    event_type,
    actor_user_id
  ) values (
    v_reward.organization_id,
    v_reward.id,
    null,
    v_delta,
    p_stock,
    'admin_adjustment',
    auth.uid()
  );

  return public._loyalty_reward_admin_json(v_reward);
end;
$$;

revoke all on function public.set_loyalty_reward_stock(uuid, bigint)
  from public, anon;
grant execute on function public.set_loyalty_reward_stock(uuid, bigint)
  to authenticated;

-- 14) Operação de voucher por unidade (owner/manager/operator com
--     acesso à unidade). Código é normalizado (uppercase, sem hífens/
--     espaços) e validado; código desconhecido/cross-tenant é seguro.
create function public.get_loyalty_voucher_staff(
  p_unit_id uuid,
  p_voucher_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_code text;
  v_voucher public.loyalty_vouchers;
  v_redemption public.loyalty_redemptions;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select u.* into v_unit
  from public.units as u
  where u.id = p_unit_id
    and u.is_active;

  if v_unit.id is null or not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  v_code := regexp_replace(upper(btrim(p_voucher_code)), '[ -]', '', 'g');
  if v_code is null or v_code !~ '^[A-F0-9]{16}$' then
    raise exception 'INVALID_VOUCHER_CODE' using errcode = 'PED62';
  end if;

  select v.* into v_voucher
  from public.loyalty_vouchers as v
  where v.voucher_code = v_code;

  if v_voucher.id is null or v_voucher.organization_id <> v_unit.organization_id then
    return jsonb_build_object('found', false);
  end if;

  select r.* into v_redemption
  from public.loyalty_redemptions as r
  where r.id = v_voucher.redemption_id
    and r.organization_id = v_voucher.organization_id;

  return jsonb_build_object(
    'found', true,
    'code', public._loyalty_format_voucher_code(v_voucher.voucher_code),
    'status', v_voucher.status,
    'reward_name', v_redemption.reward_name_snapshot,
    'points_cost', v_redemption.points_cost::text,
    'issued_at', v_voucher.issued_at,
    'consumed_at', v_voucher.consumed_at
  );
end;
$$;

revoke all on function public.get_loyalty_voucher_staff(uuid, text)
  from public, anon;
grant execute on function public.get_loyalty_voucher_staff(uuid, text)
  to authenticated;

create function public.consume_loyalty_voucher(
  p_unit_id uuid,
  p_voucher_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_code text;
  v_voucher public.loyalty_vouchers;
  v_redemption public.loyalty_redemptions;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select u.* into v_unit
  from public.units as u
  where u.id = p_unit_id
    and u.is_active;

  if v_unit.id is null or not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  v_code := regexp_replace(upper(btrim(p_voucher_code)), '[ -]', '', 'g');
  if v_code is null or v_code !~ '^[A-F0-9]{16}$' then
    raise exception 'INVALID_VOUCHER_CODE' using errcode = 'PED62';
  end if;

  select v.* into v_voucher
  from public.loyalty_vouchers as v
  where v.voucher_code = v_code
  for update of v;

  if v_voucher.id is null or v_voucher.organization_id <> v_unit.organization_id then
    raise exception 'VOUCHER_NOT_FOUND' using errcode = 'PED60';
  end if;
  if v_voucher.status <> 'issued' then
    raise exception 'VOUCHER_ALREADY_CONSUMED' using errcode = 'PED61';
  end if;

  update public.loyalty_vouchers
  set status = 'consumed',
      consumed_at = clock_timestamp(),
      consumed_unit_id = p_unit_id,
      consumed_by_user_id = auth.uid(),
      updated_at = clock_timestamp()
  where id = v_voucher.id
  returning * into v_voucher;

  insert into public.loyalty_voucher_events (
    organization_id,
    voucher_id,
    event_type,
    unit_id,
    actor_user_id
  ) values (
    v_unit.organization_id,
    v_voucher.id,
    'consumed',
    p_unit_id,
    auth.uid()
  );

  select r.* into v_redemption
  from public.loyalty_redemptions as r
  where r.id = v_voucher.redemption_id
    and r.organization_id = v_voucher.organization_id;

  return jsonb_build_object(
    'found', true,
    'code', public._loyalty_format_voucher_code(v_voucher.voucher_code),
    'status', v_voucher.status,
    'reward_name', v_redemption.reward_name_snapshot,
    'points_cost', v_redemption.points_cost::text,
    'issued_at', v_voucher.issued_at,
    'consumed_at', v_voucher.consumed_at
  );
end;
$$;

revoke all on function public.consume_loyalty_voucher(uuid, text)
  from public, anon;
grant execute on function public.consume_loyalty_voucher(uuid, text)
  to authenticated;
