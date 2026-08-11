-- =============================================================
-- PED-ON - Prompt 09 - Clientes e Clube Ped-On: CPF protegido por
-- HMAC-SHA-256 e ledger de pontos append-only. O CPF nunca e
-- persistido; o banco recebe somente a fingerprint HMAC (64 hex,
-- keyed) e o token efemero chega ao checkout como hash SHA-256.
-- =============================================================

-- 1) Programa de fidelidade por organizacao. Inexistente ou
-- desabilitado = Clube indisponivel (PED51). Nenhum seed: o programa
-- passa a existir apenas quando o owner ativa via
-- set_loyalty_program_enabled.
create table public.loyalty_programs (
  organization_id uuid primary key,
  enabled boolean not null default false,
  points_per_real numeric(12, 2) not null default 1.00
    check (points_per_real > 0 and points_per_real <= 9999999999.99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_programs_organization_fk
    foreign key (organization_id)
    references public.organizations (id)
    on delete cascade
);

alter table public.loyalty_programs enable row level security;

-- 2) Clientes por organizacao. Nenhum CPF em claro; somente
-- fingerprint HMAC e ultimos 2 digitos para exibicao mascarada.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cpf_fingerprint text not null
    check (cpf_fingerprint ~ '^[a-f0-9]{64}$'),
  cpf_last2 text not null
    check (cpf_last2 ~ '^[0-9]{2}$'),
  name text,
  created_at timestamptz not null default now(),
  constraint customers_organization_fk
    foreign key (organization_id)
    references public.organizations (id)
    on delete cascade,
  constraint customers_organization_id_key unique (organization_id, id),
  constraint customers_organization_cpf_fingerprint_key
    unique (organization_id, cpf_fingerprint),
  constraint customers_name_check
    check (
      name is null
      or (
        name = btrim(name)
        and char_length(name) between 2 and 120
        and public._is_safe_plain_text(name)
      )
    )
);

alter table public.customers enable row level security;

-- 3) Vinculo cliente/organizacao. O membership e o escopo de pontos.
create table public.loyalty_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  created_at timestamptz not null default now(),
  constraint loyalty_memberships_organization_fk
    foreign key (organization_id)
    references public.organizations (id)
    on delete cascade,
  constraint loyalty_memberships_customer_fk
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id)
    on delete cascade,
  constraint loyalty_memberships_organization_id_key unique (organization_id, id),
  constraint loyalty_memberships_organization_customer_key
    unique (organization_id, customer_id)
);

alter table public.loyalty_memberships enable row level security;

-- 4) Projecao do saldo (derivada do ledger). recovery_points e a
-- divida criada quando um estorno excede o saldo disponivel; novas
-- aquisicoes quitam a divida antes de recompor o saldo.
-- Invariante: sum(loyalty_ledger.amount) = points_balance - recovery_points.
create table public.loyalty_accounts (
  membership_id uuid primary key,
  organization_id uuid not null,
  points_balance bigint not null default 0
    check (points_balance >= 0),
  recovery_points bigint not null default 0
    check (recovery_points >= 0),
  updated_at timestamptz not null default now(),
  constraint loyalty_accounts_membership_fk
    foreign key (organization_id, membership_id)
    references public.loyalty_memberships (organization_id, id)
    on delete cascade
);

alter table public.loyalty_accounts enable row level security;

-- 5) Ledger append-only. earn so existe com saldo positivo; reversal
-- so pode ser negativa. Um pedido gera no maximo uma entrada earn e
-- uma reversal (indice parcial unico), o que torna acúmulo e estorno
-- idempotentes sob lock de linha do pedido.
-- A FK do ledger para orders exige unique (organization_id, id).
alter table public.orders
  add constraint orders_organization_id_key unique (organization_id, id);

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  order_id uuid,
  entry_type text not null
    check (entry_type in ('earn', 'reversal')),
  amount bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint loyalty_ledger_membership_fk
    foreign key (organization_id, membership_id)
    references public.loyalty_memberships (organization_id, id)
    on delete restrict,
  constraint loyalty_ledger_order_fk
    foreign key (organization_id, order_id)
    references public.orders (organization_id, id)
    on delete restrict,
  constraint loyalty_ledger_entry_shape_check
    check (
      (entry_type = 'earn' and amount > 0)
      or (entry_type = 'reversal' and amount < 0)
    )
);

create unique index loyalty_ledger_order_entry_key
  on public.loyalty_ledger (order_id, entry_type)
  where order_id is not null;

create index loyalty_ledger_membership_created_idx
  on public.loyalty_ledger (membership_id, created_at desc, id desc);

alter table public.loyalty_ledger enable row level security;

-- 6) Tokens efemeros do checkout/pagina publica. Somente o hash
-- SHA-256 do token e persistido; o token em claro trafega apenas em
-- memoria no navegador.
create table public.loyalty_access_tokens (
  token_hash text primary key
    check (token_hash ~ '^[a-f0-9]{64}$'),
  organization_id uuid not null,
  membership_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint loyalty_access_tokens_membership_fk
    foreign key (organization_id, membership_id)
    references public.loyalty_memberships (organization_id, id)
    on delete cascade,
  constraint loyalty_access_tokens_expiry_check
    check (expires_at > created_at)
);

create index loyalty_access_tokens_membership_idx
  on public.loyalty_access_tokens (organization_id, membership_id, expires_at);

alter table public.loyalty_access_tokens enable row level security;

-- 7) Integracao com pedidos. A FK composta garante que o membership
-- pertenca a mesma organizacao do pedido.
alter table public.orders
  add column loyalty_membership_id uuid;

alter table public.orders
  add constraint orders_loyalty_membership_fk
  foreign key (organization_id, loyalty_membership_id)
  references public.loyalty_memberships (organization_id, id)
  on delete restrict;

create index orders_loyalty_membership_idx
  on public.orders (organization_id, loyalty_membership_id);

-- 8) ACL: nenhum papel de navegador acessa as tabelas diretamente;
-- todo acesso passa por RPCs security definer ou service_role.
revoke all on table public.loyalty_programs from public, anon, authenticated;
revoke all on table public.customers from public, anon, authenticated;
revoke all on table public.loyalty_memberships from public, anon, authenticated;
revoke all on table public.loyalty_accounts from public, anon, authenticated;
revoke all on table public.loyalty_ledger from public, anon, authenticated;
revoke all on table public.loyalty_access_tokens from public, anon, authenticated;

-- 9) Helpers internos de earn/reversal. Executam sob lock de linha do
-- pedido ja mantido por set_order_status/set_order_payment_status.
create function public._loyalty_earn_order(p_order public.orders)
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
  if p_order.loyalty_membership_id is null then
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

  insert into public.loyalty_ledger (
    organization_id, membership_id, order_id, entry_type, amount
  ) values (
    p_order.organization_id, p_order.loyalty_membership_id,
    p_order.id, 'earn', v_points
  );

  v_repayment := least(v_points, v_account.recovery_points);
  update public.loyalty_accounts
  set points_balance = v_account.points_balance + v_points - v_repayment,
      recovery_points = v_account.recovery_points - v_repayment,
      updated_at = clock_timestamp()
  where membership_id = v_account.membership_id;
end;
$$;

revoke all on function public._loyalty_earn_order(public.orders)
  from public, anon, authenticated;

create function public._loyalty_reverse_order(p_order public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_earned bigint;
  v_account public.loyalty_accounts;
  v_debt bigint;
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

  insert into public.loyalty_ledger (
    organization_id, membership_id, order_id, entry_type, amount
  ) values (
    p_order.organization_id, p_order.loyalty_membership_id,
    p_order.id, 'reversal', -v_earned
  );

  if v_account.points_balance >= v_earned then
    update public.loyalty_accounts
    set points_balance = v_account.points_balance - v_earned,
        updated_at = clock_timestamp()
    where membership_id = v_account.membership_id;
  else
    v_debt := v_earned - v_account.points_balance;
    update public.loyalty_accounts
    set points_balance = 0,
        recovery_points = v_account.recovery_points + v_debt,
        updated_at = clock_timestamp()
    where membership_id = v_account.membership_id;
  end if;
end;
$$;

revoke all on function public._loyalty_reverse_order(public.orders)
  from public, anon, authenticated;

-- 10) Contexto publico do programa para a Edge Function loyalty-cpf
-- (service_role). Resolve o public_slug para organization_id (insumo
-- do HMAC do CPF) e reporta o estado do programa.
create function public.get_loyalty_public_context_internal(p_public_slug text)
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
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

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

  return jsonb_build_object(
    'found', true,
    'organization_id', v_publication.organization_id,
    'unit_id', v_publication.unit_id,
    'program', jsonb_build_object(
      'exists', v_program.organization_id is not null,
      'enabled', coalesce(v_program.enabled, false),
      'points_per_real', coalesce(v_program.points_per_real, 1.00)::text
    )
  );
end;
$$;

revoke all on function public.get_loyalty_public_context_internal(text)
  from public, anon, authenticated;
grant execute on function public.get_loyalty_public_context_internal(text)
  to service_role;

-- 11) Resolucao/inscricao via service_role. O HMAC do CPF e calculado
-- pela Edge Function; este RPC e idempotente, cria a arvore
-- customer/membership/account e emite o token efemero (somente o
-- hash e persistido).
create function public.resolve_loyalty_identity_internal(
  p_organization_id uuid,
  p_cpf_fingerprint text,
  p_cpf_last2 text,
  p_mode text,
  p_name text,
  p_token_hash text,
  p_token_expires_at timestamptz
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
  v_program public.loyalty_programs;
  v_customer public.customers;
  v_membership public.loyalty_memberships;
  v_account public.loyalty_accounts;
  v_constraint_name text;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  if p_organization_id is null
     or p_cpf_fingerprint is null
     or p_cpf_fingerprint !~ '^[a-f0-9]{64}$'
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

  if v_mode = 'lookup' and v_customer.id is null then
    return jsonb_build_object('found', false);
  end if;

  if v_customer.id is null then
    begin
      insert into public.customers (
        organization_id, cpf_fingerprint, cpf_last2, name
      ) values (
        p_organization_id, p_cpf_fingerprint, v_cpf_last2, v_name
      )
      returning * into v_customer;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'customers_organization_cpf_fingerprint_key' then
        raise;
      end if;
      select c.* into v_customer
      from public.customers as c
      where c.organization_id = p_organization_id
        and c.cpf_fingerprint = p_cpf_fingerprint;
    end;
  end if;

  select m.* into v_membership
  from public.loyalty_memberships as m
  where m.organization_id = p_organization_id
    and m.customer_id = v_customer.id;

  if v_membership.id is null then
    begin
      insert into public.loyalty_memberships (organization_id, customer_id)
      values (p_organization_id, v_customer.id)
      returning * into v_membership;

      insert into public.loyalty_accounts (organization_id, membership_id)
      values (p_organization_id, v_membership.id);
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'loyalty_memberships_organization_customer_key' then
        raise;
      end if;
      select m.* into v_membership
      from public.loyalty_memberships as m
      where m.organization_id = p_organization_id
        and m.customer_id = v_customer.id;
    end;
  end if;

  insert into public.loyalty_access_tokens (
    token_hash, organization_id, membership_id, expires_at
  ) values (
    v_token_hash, p_organization_id, v_membership.id, p_token_expires_at
  );

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = v_membership.id;

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

revoke all on function public.resolve_loyalty_identity_internal(
  uuid, text, text, text, text, text, timestamptz
)
  from public, anon, authenticated;
grant execute on function public.resolve_loyalty_identity_internal(
  uuid, text, text, text, text, text, timestamptz
)
  to service_role;

-- 12) Consulta publica por token efemero (anon e authenticated).
create function public.get_public_loyalty_account(p_access_token text)
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
  v_org_name text;
  v_customer_name text;
  v_cpf_last2 text;
  v_account public.loyalty_accounts;
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

  select c.name, c.cpf_last2 into v_customer_name, v_cpf_last2
  from public.loyalty_memberships as m
  join public.customers as c
    on c.id = m.customer_id
   and c.organization_id = m.organization_id
  where m.id = v_membership_id
    and m.organization_id = v_org_id;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = v_membership_id;

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
    )
  );
end;
$$;

revoke all on function public.get_public_loyalty_account(text)
  from public;
grant execute on function public.get_public_loyalty_account(text)
  to anon, authenticated;

-- 13) Painel administrativo (owner da organizacao).
create function public.get_loyalty_program_admin(p_organization_id uuid)
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
        select sum(l.amount) filter (where l.amount > 0)
        from public.loyalty_ledger as l
        where l.organization_id = p_organization_id
      ), 0),
      'total_reversed', abs(coalesce((
        select sum(l.amount) filter (where l.amount < 0)
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

create function public.set_loyalty_program_enabled(
  p_organization_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
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
  if p_enabled is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  insert into public.loyalty_programs (organization_id, enabled)
  values (p_organization_id, p_enabled)
  on conflict (organization_id)
  do update set enabled = excluded.enabled, updated_at = clock_timestamp()
  returning * into v_program;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'program', jsonb_build_object(
      'exists', true,
      'enabled', v_program.enabled,
      'points_per_real', v_program.points_per_real::text,
      'created_at', v_program.created_at,
      'updated_at', v_program.updated_at
    )
  );
end;
$$;

revoke all on function public.set_loyalty_program_enabled(uuid, boolean)
  from public, anon;
grant execute on function public.set_loyalty_program_enabled(uuid, boolean)
  to authenticated;

create function public.get_loyalty_members_admin(
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
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  v_limit := coalesce(p_limit, 50);
  if v_limit < 1 or v_limit > 200 then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  v_members := (
    select coalesce(
      jsonb_agg(t.payload order by t.created_at desc, t.id desc),
      '[]'::jsonb
    )
    from (
      select m.id, m.created_at, jsonb_build_object(
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

-- 14) Checkout publico: aceita loyalty_token opcional (token efemero
-- consumido na mesma transacao). Retry idempotente ocorre antes da
-- validacao do token (DEC-100), entao o replay nunca reconsome.
create or replace function public.create_public_order(
  p_public_slug text,
  p_idempotency_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_publication public.menu_publications;
  v_initial_unit_id uuid;
  v_unit public.units;
  v_settings public.unit_operational_settings;
  v_existing public.orders;
  v_order public.orders;
  v_menu_item public.menu_version_products;
  v_canonical jsonb;
  v_request_hash text;
  v_menu_version_id uuid;
  v_menu_version_number integer;
  v_sent_revision timestamptz;
  v_service_mode text;
  v_payment_method text;
  v_customer jsonb;
  v_customer_name text;
  v_phone_input text;
  v_customer_phone text;
  v_delivery jsonb;
  v_delivery_street text;
  v_delivery_number text;
  v_delivery_complement text;
  v_delivery_neighborhood text;
  v_delivery_city text;
  v_delivery_state text;
  v_delivery_postal_code text;
  v_delivery_reference text;
  v_notes text;
  v_items jsonb;
  v_item jsonb;
  v_item_note text;
  v_cart jsonb := '[]'::jsonb;
  v_menu_item_id uuid;
  v_quantity integer;
  v_seen uuid[] := array[]::uuid[];
  v_available boolean;
  v_line_total numeric := 0;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_cash_change numeric;
  v_cash_text text;
  v_estimated_minutes integer;
  v_order_number bigint;
  v_tracking_token text;
  v_inserted boolean := false;
  v_inserted_item_count integer;
  v_constraint_name text;
  v_loyalty_token_hash text;
  v_loyalty_membership_id uuid;
begin
  -- Resolver slug e unidade antes de definir o escopo da idempotencia.
  v_slug := nullif(btrim(p_public_slug), '');
  if v_slug is null or v_slug !~ '^[a-f0-9]{24}$' then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;

  select mp.* into v_publication
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_publication.unit_id is null then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;

  select u.* into v_unit
  from public.units as u
  where u.id = v_publication.unit_id
    and u.organization_id = v_publication.organization_id;

  if v_unit.id is null then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;
  v_initial_unit_id := v_unit.id;

  -- JSONB ja fornece representacao canonica independente da ordem das
  -- chaves. Validacao de dominio ocorre somente depois do replay.
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_CART' using errcode = 'PED37';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_CART' using errcode = 'PED37';
  end if;

  v_canonical := p_payload;
  v_request_hash := encode(
    extensions.digest(v_canonical::text, 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtext(
      'pedon:orders:key:' || v_initial_unit_id::text || ':' ||
      p_idempotency_key::text
    )
  );

  select o.* into v_existing
  from public.orders as o
  where o.unit_id = v_initial_unit_id
    and o.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.request_hash = v_request_hash then
      return public._order_creation_json(v_existing.id);
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PED42';
  end if;

  -- Leitores concorrentes compartilham os locks; publicacao e save de
  -- configuracao usam os mesmos identificadores em modo exclusivo.
  perform pg_advisory_xact_lock_shared(
    hashtext('pedon:menu:publish:' || v_initial_unit_id::text)
  );
  perform pg_advisory_xact_lock_shared(
    hashtext('pedon:unit:' || v_initial_unit_id::text)
  );

  select mp.* into v_publication
  from public.menu_publications as mp
  where mp.public_slug = v_slug;

  if v_publication.unit_id is null
     or v_publication.unit_id <> v_initial_unit_id
  then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;

  -- FOR SHARE impede update de is_active ate o commit do pedido.
  select u.* into v_unit
  from public.units as u
  where u.id = v_publication.unit_id
    and u.organization_id = v_publication.organization_id
  for share of u;

  if v_unit.id is null then
    raise exception 'MENU_NOT_FOUND' using errcode = 'PED33';
  end if;

  select s.* into v_settings
  from public.unit_operational_settings as s
  where s.unit_id = v_unit.id;

  -- Versao publicada e revision operacional sao validadas antes dos
  -- demais campos do checkout.
  if jsonb_typeof(p_payload -> 'menu_version_id') is distinct from 'string' then
    raise exception 'MENU_CHANGED' using errcode = 'PED35';
  end if;
  begin
    v_menu_version_id := (p_payload ->> 'menu_version_id')::uuid;
  exception when others then
    raise exception 'MENU_CHANGED' using errcode = 'PED35';
  end;

  if v_menu_version_id is distinct from v_publication.current_menu_version_id then
    raise exception 'MENU_CHANGED' using errcode = 'PED35';
  end if;

  select mv.version_number into v_menu_version_number
  from public.menu_versions as mv
  where mv.organization_id = v_publication.organization_id
    and mv.unit_id = v_publication.unit_id
    and mv.id = v_menu_version_id;

  if v_menu_version_number is null then
    raise exception 'MENU_CHANGED' using errcode = 'PED35';
  end if;

  if v_settings.unit_id is null then
    raise exception 'ORDERS_UNAVAILABLE' using errcode = 'PED34';
  end if;
  if jsonb_typeof(p_payload -> 'operation_revision') is distinct from 'string' then
    raise exception 'CHECKOUT_CHANGED' using errcode = 'PED36';
  end if;
  begin
    v_sent_revision := (p_payload ->> 'operation_revision')::timestamptz;
  exception when others then
    raise exception 'CHECKOUT_CHANGED' using errcode = 'PED36';
  end;
  if v_sent_revision is distinct from v_settings.updated_at then
    raise exception 'CHECKOUT_CHANGED' using errcode = 'PED36';
  end if;

  if not v_unit.is_active
     or not v_settings.accepting_orders
     or not public._is_unit_open_at(v_unit.id, clock_timestamp())
  then
    raise exception 'ORDERS_UNAVAILABLE' using errcode = 'PED34';
  end if;

  -- Payload top-level estrito. Campos autoritativos e desconhecidos
  -- sao rejeitados em vez de silenciosamente ignorados.
  if exists (
    select 1
    from jsonb_object_keys(p_payload) as k(key)
    where k.key not in (
      'menu_version_id', 'operation_revision', 'service_mode',
      'payment_method', 'customer', 'delivery_address', 'items',
      'notes', 'cash_change_for', 'loyalty_token'
    )
  ) then
    raise exception 'INVALID_CART' using errcode = 'PED37';
  end if;

  -- Clube Ped-On: token efemero opcional. O consumo unico acontece
  -- nesta mesma transacao (DELETE), entao qualquer falha posterior
  -- devolve o token ao cliente; concorrentes ficam bloqueados pelo
  -- FOR UPDATE e observam o token ja consumido.
  if p_payload ? 'loyalty_token'
     and jsonb_typeof(p_payload -> 'loyalty_token') <> 'null'
  then
    if jsonb_typeof(p_payload -> 'loyalty_token') <> 'string'
       or (p_payload ->> 'loyalty_token') !~ '^[a-f0-9]{64}$'
    then
      raise exception 'INVALID_LOYALTY_TOKEN' using errcode = 'PED52';
    end if;

    v_loyalty_token_hash := encode(
      extensions.digest(p_payload ->> 'loyalty_token', 'sha256'),
      'hex'
    );

    if not exists (
      select 1
      from public.loyalty_programs as lp
      where lp.organization_id = v_publication.organization_id
        and lp.enabled
    ) then
      raise exception 'LOYALTY_UNAVAILABLE' using errcode = 'PED51';
    end if;

    select lat.membership_id into v_loyalty_membership_id
    from public.loyalty_access_tokens as lat
    where lat.organization_id = v_publication.organization_id
      and lat.token_hash = v_loyalty_token_hash
      and lat.expires_at > clock_timestamp()
    for update of lat;

    if v_loyalty_membership_id is null then
      raise exception 'INVALID_LOYALTY_TOKEN' using errcode = 'PED52';
    end if;

    delete from public.loyalty_access_tokens
    where organization_id = v_publication.organization_id
      and token_hash = v_loyalty_token_hash;
  end if;

  if jsonb_typeof(p_payload -> 'service_mode') is distinct from 'string' then
    raise exception 'INVALID_SERVICE_MODE' using errcode = 'PED39';
  end if;
  v_service_mode := p_payload ->> 'service_mode';
  if v_service_mode = 'pickup' then
    if not v_settings.pickup_enabled then
      raise exception 'INVALID_SERVICE_MODE' using errcode = 'PED39';
    end if;
    v_estimated_minutes := v_settings.estimated_pickup_minutes;
  elsif v_service_mode = 'delivery' then
    if not v_settings.delivery_enabled then
      raise exception 'INVALID_SERVICE_MODE' using errcode = 'PED39';
    end if;
    v_estimated_minutes := v_settings.estimated_delivery_minutes;
  else
    raise exception 'INVALID_SERVICE_MODE' using errcode = 'PED39';
  end if;

  if jsonb_typeof(p_payload -> 'payment_method') is distinct from 'string' then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode = 'PED40';
  end if;
  v_payment_method := p_payload ->> 'payment_method';
  if v_payment_method not in ('cash', 'pix', 'credit_card', 'debit_card') then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode = 'PED40';
  end if;
  if not exists (
    select 1
    from public.unit_payment_methods as pm
    where pm.unit_id = v_unit.id
      and pm.method = v_payment_method
      and pm.is_enabled
  ) then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode = 'PED40';
  end if;

  -- Cliente: somente name e phone, ambos strings.
  v_customer := p_payload -> 'customer';
  if v_customer is null or jsonb_typeof(v_customer) <> 'object' then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_customer) as k(key)
    where k.key not in ('name', 'phone')
  ) then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;
  if jsonb_typeof(v_customer -> 'name') is distinct from 'string'
     or jsonb_typeof(v_customer -> 'phone') is distinct from 'string'
  then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;

  v_customer_name := btrim(v_customer ->> 'name');
  if char_length(v_customer_name) not between 2 and 120
     or not public._is_safe_plain_text(v_customer_name)
  then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;

  v_phone_input := btrim(v_customer ->> 'phone');
  if char_length(v_phone_input) > 20
     or v_phone_input !~ (
       '^([0-9]{10,11}|[(][0-9]{2}[)] ?[0-9]{4,5}-[0-9]{4}'
       || '|[0-9]{2} ?[0-9]{4,5}-[0-9]{4})$'
     )
  then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;
  v_customer_phone := regexp_replace(v_phone_input, '\D', '', 'g');
  if v_customer_phone !~ '^[0-9]{10,11}$' then
    raise exception 'INVALID_CUSTOMER' using errcode = 'PED43';
  end if;

  -- Observacao geral opcional, texto simples, ate 500 caracteres.
  if p_payload ? 'notes'
     and jsonb_typeof(p_payload -> 'notes') <> 'null'
  then
    if jsonb_typeof(p_payload -> 'notes') <> 'string' then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
    v_notes := nullif(btrim(p_payload ->> 'notes'), '');
    if v_notes is not null
       and (
         char_length(v_notes) > 500
         or not public._is_safe_plain_text(v_notes)
       )
    then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
  end if;

  -- Endereco e ausente/null para pickup e objeto completo para delivery.
  if v_service_mode = 'pickup' then
    if p_payload ? 'delivery_address'
       and jsonb_typeof(p_payload -> 'delivery_address') <> 'null'
    then
      raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
    end if;
  else
    v_delivery := p_payload -> 'delivery_address';
    if v_delivery is null or jsonb_typeof(v_delivery) <> 'object' then
      raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_delivery) as k(key)
      where k.key not in (
        'street', 'number', 'complement', 'neighborhood',
        'city', 'state', 'postal_code', 'reference'
      )
    ) then
      raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
    end if;
    if jsonb_typeof(v_delivery -> 'street') is distinct from 'string'
       or jsonb_typeof(v_delivery -> 'number') is distinct from 'string'
       or jsonb_typeof(v_delivery -> 'neighborhood') is distinct from 'string'
       or jsonb_typeof(v_delivery -> 'city') is distinct from 'string'
       or jsonb_typeof(v_delivery -> 'state') is distinct from 'string'
    then
      raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
    end if;

    v_delivery_street := btrim(v_delivery ->> 'street');
    v_delivery_number := btrim(v_delivery ->> 'number');
    v_delivery_neighborhood := btrim(v_delivery ->> 'neighborhood');
    v_delivery_city := btrim(v_delivery ->> 'city');
    v_delivery_state := upper(btrim(v_delivery ->> 'state'));

    if char_length(v_delivery_street) not between 2 and 120
       or not public._is_safe_plain_text(v_delivery_street)
       or char_length(v_delivery_number) not between 1 and 20
       or not public._is_safe_plain_text(v_delivery_number)
       or char_length(v_delivery_neighborhood) not between 2 and 80
       or not public._is_safe_plain_text(v_delivery_neighborhood)
       or char_length(v_delivery_city) not between 2 and 80
       or not public._is_safe_plain_text(v_delivery_city)
       or v_delivery_state !~ '^[A-Z]{2}$'
    then
      raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
    end if;

    if v_delivery ? 'complement'
       and jsonb_typeof(v_delivery -> 'complement') <> 'null'
    then
      if jsonb_typeof(v_delivery -> 'complement') <> 'string' then
        raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
      end if;
      v_delivery_complement := nullif(
        btrim(v_delivery ->> 'complement'),
        ''
      );
      if v_delivery_complement is not null
         and (
            char_length(v_delivery_complement) > 120
           or not public._is_safe_plain_text(v_delivery_complement)
         )
      then
        raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
      end if;
    end if;

    if v_delivery ? 'postal_code'
       and jsonb_typeof(v_delivery -> 'postal_code') <> 'null'
    then
      if jsonb_typeof(v_delivery -> 'postal_code') <> 'string' then
        raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
      end if;
      if btrim(v_delivery ->> 'postal_code') !~ '^[0-9]{5}-?[0-9]{3}$' then
        raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
      end if;
      v_delivery_postal_code := regexp_replace(
        btrim(v_delivery ->> 'postal_code'),
        '\D',
        '',
        'g'
      );
    end if;

    if v_delivery ? 'reference'
       and jsonb_typeof(v_delivery -> 'reference') <> 'null'
    then
      if jsonb_typeof(v_delivery -> 'reference') <> 'string' then
        raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
      end if;
      v_delivery_reference := nullif(btrim(v_delivery ->> 'reference'), '');
      if v_delivery_reference is not null
         and (
           char_length(v_delivery_reference) > 160
           or not public._is_safe_plain_text(v_delivery_reference)
         )
      then
        raise exception 'INVALID_DELIVERY_ADDRESS' using errcode = 'PED44';
      end if;
    end if;
  end if;

  -- Itens estritos: menu_item_id, quantity inteiro JSON e note opcional.
  v_items := p_payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'INVALID_CART' using errcode = 'PED37';
  end if;
  if jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 50 then
    raise exception 'INVALID_CART' using errcode = 'PED37';
  end if;

  for v_item in
    select entry.value
    from jsonb_array_elements(v_items) as entry(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_item) as k(key)
      where k.key not in ('menu_item_id', 'quantity', 'note')
    ) then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
    if jsonb_typeof(v_item -> 'menu_item_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
       or (v_item ->> 'quantity') !~ '^[1-9][0-9]?$'
    then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;

    begin
      v_menu_item_id := (v_item ->> 'menu_item_id')::uuid;
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end;
    if v_menu_item_id is null
       or v_quantity is null
       or v_quantity not between 1 and 99
    then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
    if v_menu_item_id = any(v_seen) then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
    v_seen := array_append(v_seen, v_menu_item_id);

    v_item_note := null;
    if v_item ? 'note' and jsonb_typeof(v_item -> 'note') <> 'null' then
      if jsonb_typeof(v_item -> 'note') <> 'string' then
        raise exception 'INVALID_CART' using errcode = 'PED37';
      end if;
      v_item_note := nullif(btrim(v_item ->> 'note'), '');
      if v_item_note is not null
         and (
           char_length(v_item_note) > 300
           or not public._is_safe_plain_text(v_item_note)
         )
      then
        raise exception 'INVALID_CART' using errcode = 'PED37';
      end if;
    end if;

    select mp.* into v_menu_item
    from public.menu_version_products as mp
    where mp.organization_id = v_publication.organization_id
      and mp.unit_id = v_publication.unit_id
      and mp.menu_version_id = v_menu_version_id
      and mp.id = v_menu_item_id
    for share of mp;

    if v_menu_item.id is null or v_menu_item.source_product_id is null then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'PED38';
    end if;

    -- Consulta separada permite row lock valido e serializa mudancas de
    -- disponibilidade ate o commit do pedido.
    select cp.is_available into v_available
    from public.catalog_products as cp
    where cp.id = v_menu_item.source_product_id
      and cp.organization_id = v_menu_item.organization_id
      and cp.unit_id = v_menu_item.unit_id
    for share of cp;

    if not found or not v_available then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'PED38';
    end if;

    v_line_total := v_menu_item.price * v_quantity;
    if v_line_total > 9999999999.99 then
      raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
    end if;
    v_subtotal := v_subtotal + v_line_total;
    if v_subtotal > 9999999999.99 then
      raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
    end if;

    v_cart := v_cart || jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'quantity', v_quantity,
      'note', v_item_note
    );
  end loop;

  if v_subtotal < v_settings.min_order_value then
    raise exception 'MINIMUM_ORDER_NOT_MET' using errcode = 'PED41';
  end if;

  v_delivery_fee := case
    when v_service_mode = 'delivery' then v_settings.delivery_fee
    else 0
  end;
  if v_delivery_fee > 9999999999.99 then
    raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
  end if;
  v_total := v_subtotal + v_delivery_fee;
  if v_total > 9999999999.99 then
    raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
  end if;

  -- Troco e opcional e exclusivamente uma string decimal para cash.
  if p_payload ? 'cash_change_for'
     and jsonb_typeof(p_payload -> 'cash_change_for') <> 'null'
  then
    if v_payment_method <> 'cash'
       or jsonb_typeof(p_payload -> 'cash_change_for') <> 'string'
    then
      raise exception 'INVALID_CASH_CHANGE' using errcode = 'PED45';
    end if;
    v_cash_text := btrim(p_payload ->> 'cash_change_for');
    if v_cash_text !~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' then
      raise exception 'INVALID_CASH_CHANGE' using errcode = 'PED45';
    end if;
    begin
      v_cash_change := v_cash_text::numeric;
    exception when others then
      raise exception 'INVALID_CASH_CHANGE' using errcode = 'PED45';
    end;
    if v_cash_change < v_total or v_cash_change > 9999999999.99 then
      raise exception 'INVALID_CASH_CHANGE' using errcode = 'PED45';
    end if;
  elsif v_payment_method <> 'cash' then
    v_cash_change := null;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('pedon:orders:number:' || v_unit.id::text)
  );
  select coalesce(max(o.order_number), 0::bigint) into v_order_number
  from public.orders as o
  where o.unit_id = v_unit.id;
  if v_order_number = 9223372036854775807 then
    raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
  end if;
  v_order_number := v_order_number + 1;

  -- Somente colisao da constraint de tracking e retryavel.
  for v_attempt in 1..10 loop
    v_tracking_token := replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.orders (
        organization_id, unit_id, menu_version_id, menu_version_number,
        order_number, idempotency_key, request_hash, tracking_token,
        status, payment_status, service_mode, payment_method,
        customer_name, customer_phone, loyalty_membership_id,
        delivery_street, delivery_number, delivery_complement,
        delivery_neighborhood, delivery_city, delivery_state,
        delivery_postal_code, delivery_reference,
        delivery_fee, subtotal, total,
        cash_change_for, estimated_minutes, operation_revision, notes
      ) values (
        v_publication.organization_id, v_unit.id,
        v_menu_version_id, v_menu_version_number,
        v_order_number, p_idempotency_key, v_request_hash, v_tracking_token,
        'new', 'pending', v_service_mode, v_payment_method,
        v_customer_name, v_customer_phone, v_loyalty_membership_id,
        v_delivery_street, v_delivery_number, v_delivery_complement,
        v_delivery_neighborhood, v_delivery_city, v_delivery_state,
        v_delivery_postal_code, v_delivery_reference,
        v_delivery_fee, v_subtotal, v_total,
        v_cash_change, v_estimated_minutes, v_settings.updated_at, v_notes
      )
      returning * into v_order;
      v_inserted := true;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'orders_tracking_token_key' then
        raise;
      end if;
    end;
  end loop;

  if not v_inserted then
    raise exception 'TRACKING_TOKEN_CONFLICT' using errcode = 'PED49';
  end if;

  insert into public.order_items (
    organization_id, unit_id, order_id, menu_version_id,
    menu_item_id, product_name, unit_price, quantity, line_total, note
  )
  select
    v_order.organization_id,
    v_order.unit_id,
    v_order.id,
    v_order.menu_version_id,
    mp.id,
    mp.name,
    mp.price,
    (entry.value ->> 'quantity')::integer,
    mp.price * (entry.value ->> 'quantity')::integer,
    entry.value ->> 'note'
  from jsonb_array_elements(v_cart) as entry(value)
  join public.menu_version_products as mp
    on mp.organization_id = v_order.organization_id
   and mp.unit_id = v_order.unit_id
   and mp.menu_version_id = v_order.menu_version_id
   and mp.id = (entry.value ->> 'menu_item_id')::uuid;

  get diagnostics v_inserted_item_count = row_count;
  if v_inserted_item_count <> jsonb_array_length(v_cart) then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'PED38';
  end if;

  insert into public.order_events (
    organization_id, unit_id, order_id, event_type,
    from_value, to_value, note, actor_type, actor_user_id
  ) values (
    v_order.organization_id, v_order.unit_id, v_order.id, 'created',
    null, 'new', null, 'customer', null
  );

  return public._order_creation_json(v_order.id);
end;
$$;

-- Reaplica explicitamente as ACLs do contrato publico apos o replace.
revoke all on function public.create_public_order(text, uuid, jsonb)
  from public;
grant execute on function public.create_public_order(text, uuid, jsonb)
  to anon, authenticated;

-- 15) Detalhe administrativo passa a expor o vinculo Clube de forma
-- mascarada.
create or replace function public._order_admin_json(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id;

  if v_order.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'organization_id', v_order.organization_id,
    'unit_id', v_order.unit_id,
    'menu_version_id', v_order.menu_version_id,
    'menu_version_number', v_order.menu_version_number,
    'order_number', v_order.order_number,
    'tracking_token', v_order.tracking_token,
    'tracking_path', '/pedido/' || v_order.tracking_token,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'service_mode', v_order.service_mode,
    'payment_method', v_order.payment_method,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'loyalty',
      case when v_order.loyalty_membership_id is null then null
           else jsonb_build_object(
             'linked', true,
             'cpf_masked', (
               select '***.***.***-' || c.cpf_last2
               from public.loyalty_memberships as m
               join public.customers as c
                 on c.id = m.customer_id
                and c.organization_id = m.organization_id
               where m.id = v_order.loyalty_membership_id
                 and m.organization_id = v_order.organization_id
             )
           )
      end,
    'delivery_address',
      case when v_order.service_mode = 'pickup' then null
           else jsonb_build_object(
             'street', v_order.delivery_street,
             'number', v_order.delivery_number,
             'complement', v_order.delivery_complement,
             'neighborhood', v_order.delivery_neighborhood,
              'city', v_order.delivery_city,
              'state', v_order.delivery_state,
              'postal_code', v_order.delivery_postal_code,
              'reference', v_order.delivery_reference
           )
      end,
    'subtotal', v_order.subtotal::text,
    'delivery_fee', v_order.delivery_fee::text,
    'total', v_order.total::text,
    'cash_change_for',
      case when v_order.cash_change_for is null then null
           else v_order.cash_change_for::text
      end,
    'estimated_minutes', v_order.estimated_minutes,
    'operation_revision', v_order.operation_revision,
    'notes', v_order.notes,
    'item_count', (
      select count(*)::integer
      from public.order_items as oi
      where oi.order_id = p_order_id
    ),
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'status_updated_at', v_order.status_updated_at,
    'payment_status_updated_at', v_order.payment_status_updated_at,
    'completed_at', v_order.completed_at,
    'cancelled_at', v_order.cancelled_at,
    'paid_at', v_order.paid_at,
    'refunded_at', v_order.refunded_at,
    'items', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'menu_item_id', oi.menu_item_id,
            'product_name', oi.product_name,
            'unit_price', oi.unit_price::text,
            'quantity', oi.quantity,
            'line_total', oi.line_total::text,
            'note', oi.note,
            'created_at', oi.created_at
          )
          order by oi.created_at, oi.id
        ),
        '[]'::jsonb
      )
      from public.order_items as oi
      where oi.order_id = p_order_id
    ),
    'events', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'event_type', e.event_type,
            'from_value', e.from_value,
            'to_value', e.to_value,
            'note', e.note,
            'actor_type', e.actor_type,
            'actor_user_id', e.actor_user_id,
            'created_at', e.created_at
          )
          order by e.created_at, e.id
        ),
        '[]'::jsonb
      )
      from public.order_events as e
      where e.order_id = p_order_id
    )
  );
end;
$$;

revoke all on function public._order_admin_json(uuid)
  from public, anon, authenticated;

-- 16) Conclusao acumula pontos; estorno reverte pontos (com recovery
-- quando o estorno excede o saldo).
create or replace function public.set_order_status(
  p_order_id uuid,
  p_next_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_next text := nullif(btrim(p_next_status), '');
  v_note text := nullif(btrim(p_note), '');
  v_now timestamptz;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id
  for update of o;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PED46';
  end if;
  if not public.can_access_unit(v_order.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if v_next is null
     or v_next not in (
       'new', 'confirmed', 'preparing', 'ready',
       'out_for_delivery', 'completed', 'cancelled'
     )
  then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'PED47';
  end if;
  if v_note is not null
     and (
       char_length(v_note) > 500
       or not public._is_safe_plain_text(v_note)
     )
  then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'PED47';
  end if;

  if not (
    (v_order.status = 'new' and v_next in ('confirmed', 'cancelled'))
    or (
      v_order.status = 'confirmed'
      and v_next in ('preparing', 'cancelled')
    )
    or (
      v_order.status = 'preparing'
      and v_next in ('ready', 'cancelled')
    )
    or (
      v_order.status = 'ready'
      and v_order.service_mode = 'pickup'
      and v_next in ('completed', 'cancelled')
    )
    or (
      v_order.status = 'ready'
      and v_order.service_mode = 'delivery'
      and v_next in ('out_for_delivery', 'cancelled')
    )
    or (
      v_order.status = 'out_for_delivery'
      and v_order.service_mode = 'delivery'
      and v_next in ('completed', 'cancelled')
    )
  ) then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'PED47';
  end if;

  v_now := clock_timestamp();
  update public.orders
  set status = v_next,
      status_updated_at = v_now,
      completed_at = case when v_next = 'completed' then v_now else null end,
      cancelled_at = case when v_next = 'cancelled' then v_now else null end
  where id = v_order.id;

  insert into public.order_events (
    organization_id, unit_id, order_id, event_type,
    from_value, to_value, note, actor_type, actor_user_id
  ) values (
    v_order.organization_id, v_order.unit_id, v_order.id,
    'status_changed', v_order.status, v_next, v_note, 'staff', auth.uid()
  );

  -- Earn: primeira (e unica) transicao para completed com pagamento
  -- nao estornado. Pedidos sem Clube (membership null) sao no-op.
  if v_next = 'completed' then
    perform public._loyalty_earn_order(v_order);
  end if;

  return public._order_admin_json(v_order.id);
end;
$$;

revoke all on function public.set_order_status(uuid, text, text)
  from public, anon;
grant execute on function public.set_order_status(uuid, text, text)
  to authenticated;

create or replace function public.set_order_payment_status(
  p_order_id uuid,
  p_payment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_next text := nullif(btrim(p_payment_status), '');
  v_now timestamptz;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id
  for update of o;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PED46';
  end if;
  -- Verificar acesso antes de revelar qualquer detalhe da transicao.
  if not public.can_access_unit(v_order.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if v_next is null or v_next not in ('pending', 'paid', 'refunded') then
    raise exception 'INVALID_PAYMENT_TRANSITION' using errcode = 'PED48';
  end if;
  if not (
    (v_order.payment_status = 'pending' and v_next = 'paid')
    or (v_order.payment_status = 'paid' and v_next = 'refunded')
  ) then
    raise exception 'INVALID_PAYMENT_TRANSITION' using errcode = 'PED48';
  end if;
  if v_next = 'refunded' and not public.can_manage_unit(v_order.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  v_now := clock_timestamp();
  update public.orders
  set payment_status = v_next,
      payment_status_updated_at = v_now,
      paid_at = case when v_next = 'paid' then v_now else paid_at end,
      refunded_at = case when v_next = 'refunded' then v_now else null end
  where id = v_order.id;

  insert into public.order_events (
    organization_id, unit_id, order_id, event_type,
    from_value, to_value, note, actor_type, actor_user_id
  ) values (
    v_order.organization_id, v_order.unit_id, v_order.id,
    'payment_changed', v_order.payment_status, v_next,
    null, 'staff', auth.uid()
  );

  -- Reversal: estorno de pagamento apos earn devolve os pontos (ou
  -- vira recovery quando excede o saldo). No-op para pedidos sem
  -- Clube ou sem earn.
  if v_next = 'refunded' then
    perform public._loyalty_reverse_order(v_order);
  end if;

  return public._order_admin_json(v_order.id);
end;
$$;

revoke all on function public.set_order_payment_status(uuid, text)
  from public, anon;
grant execute on function public.set_order_payment_status(uuid, text)
  to authenticated;

-- 17) Menu publico expoe a disponibilidade do Clube para a pagina
-- publica e para o checkout.
create or replace function public.get_public_menu(p_public_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(p_public_slug), '');
  v_publication public.menu_publications;
  v_unit public.units;
  v_organization public.organizations;
  v_settings public.unit_operational_settings;
  v_accepting boolean;
  v_open_now boolean;
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

  select u.* into v_unit
  from public.units as u
  where u.id = v_publication.unit_id;
  select org.* into v_organization
  from public.organizations as org
  where org.id = v_publication.organization_id;

  if v_unit.id is null or v_organization.id is null then
    return jsonb_build_object('found', false);
  end if;

  select s.* into v_settings
  from public.unit_operational_settings as s
  where s.unit_id = v_publication.unit_id;

  v_accepting := v_unit.is_active
    and coalesce(v_settings.accepting_orders, false);
  v_open_now := public._is_unit_open_at(v_publication.unit_id, now());

  return jsonb_build_object(
    'found', true,
    'organization', jsonb_build_object('name', v_organization.name),
    'unit', jsonb_build_object(
      'name', v_unit.name,
      'is_active', v_unit.is_active
    ),
    'loyalty', jsonb_build_object(
      'enabled', coalesce((
        select lp.enabled
        from public.loyalty_programs as lp
        where lp.organization_id = v_publication.organization_id
      ), false)
    ),
    'menu', jsonb_build_object(
      'version_id', v_publication.current_menu_version_id,
      'version_number', (
        select mv.version_number
        from public.menu_versions as mv
        where mv.id = v_publication.current_menu_version_id
      ),
      'published_at', v_publication.published_at
    ),
    'operation', jsonb_build_object(
      'configured', v_settings.unit_id is not null,
      'accepting_orders', v_accepting,
      'revision',
        case when v_settings.unit_id is null then null
             else to_char(
               v_settings.updated_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
        end,
      'open_now', v_open_now,
      'can_order_now', v_unit.is_active
        and v_settings.unit_id is not null
        and coalesce(v_settings.accepting_orders, false)
        and v_open_now,
      'pickup_enabled', coalesce(v_settings.pickup_enabled, true),
      'delivery_enabled', coalesce(v_settings.delivery_enabled, false),
      'delivery_fee', coalesce(v_settings.delivery_fee, 0)::text,
      'minimum_order_amount', coalesce(v_settings.min_order_value, 0)::text,
      'estimated_pickup_minutes', v_settings.estimated_pickup_minutes,
      'estimated_delivery_minutes', v_settings.estimated_delivery_minutes,
      'payment_methods', (
        select jsonb_agg(
          jsonb_build_object(
            'method', methods.method,
            'is_enabled', coalesce(pm.is_enabled, false)
          )
          order by methods.ord
        )
        from (values
          (1, 'cash'),
          (2, 'pix'),
          (3, 'credit_card'),
          (4, 'debit_card')
        ) as methods(ord, method)
        left join public.unit_payment_methods as pm
          on pm.unit_id = v_publication.unit_id
         and pm.method = methods.method
      ),
      'business_hours', (
        select jsonb_agg(
          jsonb_build_object(
            'weekday', weekdays.day,
            'is_open', coalesce(h.is_open, false),
            'is_24h', coalesce(h.is_24h, false),
            'open_time',
              case when h.open_time is null then null
                   else to_char(h.open_time, 'HH24:MI')
              end,
            'close_time',
              case when h.close_time is null then null
                   else to_char(h.close_time, 'HH24:MI')
              end
          )
          order by weekdays.day
        )
        from generate_series(0, 6) as weekdays(day)
        left join public.unit_business_hours as h
          on h.unit_id = v_publication.unit_id
         and h.weekday = weekdays.day
      )
    ),
    'categories', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'sort_order', c.sort_order,
            'products', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', p.id,
                    'name', p.name,
                    'description', p.description,
                    'price', p.price::text,
                    'sort_order', p.sort_order,
                    'is_available', coalesce(
                      (
                        select cp.is_available
                        from public.catalog_products as cp
                        where cp.id = p.source_product_id
                          and cp.organization_id = p.organization_id
                          and cp.unit_id = p.unit_id
                      ),
                      false
                    )
                  )
                  order by p.sort_order, p.id
                ),
                '[]'::jsonb
              )
              from public.menu_version_products as p
              where p.organization_id = c.organization_id
                and p.unit_id = c.unit_id
                and p.menu_version_id = c.menu_version_id
                and p.menu_category_id = c.id
            )
          )
          order by c.sort_order, c.id
        ),
        '[]'::jsonb
      )
      from public.menu_version_categories as c
      where c.organization_id = v_publication.organization_id
        and c.unit_id = v_publication.unit_id
        and c.menu_version_id = v_publication.current_menu_version_id
    )
  );
end;
$$;

revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text)
  to anon, authenticated;

-- Contrato de erros adicionais (Prompt 09):
-- PED51 LOYALTY_UNAVAILABLE     | PED52 INVALID_LOYALTY_TOKEN
-- PED53 LOYALTY_INTEGRITY
