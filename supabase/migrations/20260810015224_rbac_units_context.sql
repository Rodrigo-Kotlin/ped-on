-- =============================================================
-- PED-ON — Prompt 04 — RBAC administrativo mínimo, gestão de
-- unidades e contexto administrativo (escopo por unidade).
-- Migration versionada aplicada pelo mecanismo oficial do projeto.
-- =============================================================

-- 1) Evolução dos papéis administrativos.
--    Sem dados reais com role 'member' (0 linhas), o CHECK evolui de
--    ('owner','member') para ('owner','manager','operator').
alter table public.organization_members
  drop constraint organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'manager', 'operator'));

-- 2) Alvo da FK composta: unique (organization_id, id) em units.
--    Deve existir ANTES do FK em membership_units (PostgreSQL não
--    aceita referência direta a constraint criada depois, mesmo na
--    mesma transação).
alter table public.units
  add constraint units_organization_id_id_key unique (organization_id, id);

-- 3) membership_units: autorização explícita por unidade para
--    manager/operator. Integridade cross-org garantida por FK
--    composta para units(organization_id, id).
create table public.membership_units (
  organization_id uuid not null,
  user_id uuid not null,
  unit_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, unit_id),
  constraint membership_units_member_fk
    foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id)
    on delete cascade,
  constraint membership_units_unit_org_fk
    foreign key (organization_id, unit_id)
    references public.units (organization_id, id)
    on delete cascade
);

alter table public.membership_units enable row level security;

-- Índices necessários (PK já cobre o prefixo organization_id).
create index membership_units_user_id_idx on public.membership_units (user_id);
create index membership_units_unit_id_idx on public.membership_units (unit_id);

-- 4) Helpers de autorização (security definer para evitar recursão RLS).
create or replace function public.is_org_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

revoke all on function public.is_org_owner(uuid) from public;
grant execute on function public.is_org_owner(uuid) to authenticated;

create or replace function public.can_access_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.units u
      where u.id = p_unit_id
        and public.is_org_owner(u.organization_id)
    )
    or exists (
      select 1
      from public.membership_units mu
      where mu.unit_id = p_unit_id
        and mu.user_id = auth.uid()
    );
$$;

revoke all on function public.can_access_unit(uuid) from public;
grant execute on function public.can_access_unit(uuid) to authenticated;

-- 5) RLS membership_units: leitura somente do próprio vínculo ou de
--    organização onde o usuário é owner (fundação para gestão futura).
create policy "membership_units_select_own_access" on public.membership_units
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_owner(organization_id)
  );

grant select on public.membership_units to authenticated;

-- 6) RLS units: SELECT por autorização efetiva.
--    owner → todas as unidades da própria organização;
--    manager/operator → somente unidades vinculadas em membership_units.
drop policy "units_select_member" on public.units;

create policy "units_select_authorized" on public.units
  for select to authenticated
  using (
    public.is_org_owner(organization_id)
    or public.can_access_unit(id)
  );

-- 7) Contexto administrativo do usuário (leitura única para o frontend).
create or replace function public.get_my_admin_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_org_name text;
  v_role text;
begin
  select om.organization_id, o.name, om.role
    into v_org_id, v_org_name, v_role
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid()
  order by om.created_at asc, om.organization_id asc
  limit 1;

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email)
      from public.profiles p
      where p.id = auth.uid()
    ),
    'organization',
      case when v_org_id is null then null
           else jsonb_build_object('id', v_org_id, 'name', v_org_name)
      end,
    'role', v_role,
    'units', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', u.id, 'name', u.name, 'is_active', u.is_active)
          order by u.created_at asc, u.name asc
        ),
        '[]'::jsonb
      )
      from public.units u
      where u.organization_id = v_org_id
        and (
          v_role = 'owner'
          or exists (
            select 1
            from public.membership_units mu
            where mu.unit_id = u.id
              and mu.user_id = auth.uid()
          )
        )
    )
  );
end;
$$;

revoke all on function public.get_my_admin_context() from public;
grant execute on function public.get_my_admin_context() to authenticated;

-- 8) RPCs server-authoritative de unidades (nunca INSERT/UPDATE direto).
--    Contrato de erro estável via SQLSTATE próprio:
--    PED00 NOT_AUTHENTICATED | PED01 FORBIDDEN | PED02 UNIT_NOT_FOUND
--    PED03 UNIT_NAME_REQUIRED | PED04 LAST_ACTIVE_UNIT | PED05 UNIT_NAME_TOO_LONG

create or replace function public.create_unit(p_name text)
returns public.units
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_name text := nullif(btrim(p_name), '');
  v_unit public.units;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED00';
  end if;
  if v_name is null then
    raise exception 'UNIT_NAME_REQUIRED' using errcode = 'PED03';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'UNIT_NAME_TOO_LONG' using errcode = 'PED05';
  end if;

  select om.organization_id into v_org_id
  from public.organization_members om
  where om.user_id = auth.uid()
    and om.role = 'owner'
  order by om.created_at asc, om.organization_id asc
  limit 1;

  if v_org_id is null then
    raise exception 'FORBIDDEN' using errcode = 'PED01';
  end if;

  insert into public.units (organization_id, name)
  values (v_org_id, v_name)
  returning * into v_unit;

  return v_unit;
end;
$$;

revoke all on function public.create_unit(text) from public;
grant execute on function public.create_unit(text) to authenticated;

create or replace function public.update_unit(p_unit_id uuid, p_name text)
returns public.units
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_name text := nullif(btrim(p_name), '');
  v_unit public.units;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED00';
  end if;
  if v_name is null then
    raise exception 'UNIT_NAME_REQUIRED' using errcode = 'PED03';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'UNIT_NAME_TOO_LONG' using errcode = 'PED05';
  end if;

  select om.organization_id into v_org_id
  from public.organization_members om
  where om.user_id = auth.uid()
    and om.role = 'owner'
  order by om.created_at asc, om.organization_id asc
  limit 1;

  if v_org_id is null then
    raise exception 'FORBIDDEN' using errcode = 'PED01';
  end if;

  select u.* into v_unit
  from public.units u
  where u.id = p_unit_id
    and u.organization_id = v_org_id;

  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED02';
  end if;

  update public.units
  set name = v_name, updated_at = now()
  where id = p_unit_id
  returning * into v_unit;

  return v_unit;
end;
$$;

revoke all on function public.update_unit(uuid, text) from public;
grant execute on function public.update_unit(uuid, text) to authenticated;

create or replace function public.set_unit_active(p_unit_id uuid, p_is_active boolean)
returns public.units
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_unit public.units;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED00';
  end if;
  if p_is_active is null then
    raise exception 'FORBIDDEN' using errcode = 'PED01';
  end if;

  select om.organization_id into v_org_id
  from public.organization_members om
  where om.user_id = auth.uid()
    and om.role = 'owner'
  order by om.created_at asc, om.organization_id asc
  limit 1;

  if v_org_id is null then
    raise exception 'FORBIDDEN' using errcode = 'PED01';
  end if;

  select u.* into v_unit
  from public.units u
  where u.id = p_unit_id
    and u.organization_id = v_org_id;

  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED02';
  end if;

  -- Proteção da última unidade ativa com lock transacional por organização
  -- (evita race condition entre desativações concorrentes).
  if not p_is_active and v_unit.is_active then
    perform pg_advisory_xact_lock(hashtext('pedon:org:' || v_org_id::text));
    if (
      select count(*)
      from public.units
      where organization_id = v_org_id
        and is_active
    ) <= 1 then
      raise exception 'LAST_ACTIVE_UNIT' using errcode = 'PED04';
    end if;
  end if;

  update public.units
  set is_active = p_is_active, updated_at = now()
  where id = p_unit_id
  returning * into v_unit;

  return v_unit;
end;
$$;

revoke all on function public.set_unit_active(uuid, boolean) from public;
grant execute on function public.set_unit_active(uuid, boolean) to authenticated;
