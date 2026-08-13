-- =============================================================
-- PED-ON — Prompt 11 — Pilot Readiness, Observabilidade e
-- Product Hardening: RPCs de prontidão (derivada do estado
-- autoritativo) e de equipe (membership_units) somente owner.
-- Migration versionada aplicada pelo mecanismo oficial do projeto.
-- =============================================================

-- Códigos de erro estáveis (SQLSTATE próprio), continuando a série:
-- PED67 NOT_AUTHENTICATED | PED68 ORGANIZATION_REQUIRED
-- PED69 FORBIDDEN | PED70 MEMBER_NOT_FOUND | PED71 UNIT_NOT_FOUND

-- 1) Prontidão para piloto, DERIVADA do estado autoritativo.
--    Nenhuma flag manual de "piloto"; o READY é calculado sobre as
--    tabelas reais. Owner e manager podem consultar; operator não.
create or replace function public.get_org_pilot_readiness(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_role text;
  v_org_name text;
  v_active_units integer;
  v_op_config integer;
  v_hours integer;
  v_payment integer;
  v_catalog integer;
  v_menu_published integer;
  v_first_order boolean;
  v_loyalty_enabled boolean;
  v_checks jsonb;
  v_ready boolean;
  v_units_summary jsonb;
  v_blocking_ok integer;
  v_blocking_total integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED67';
  end if;
  if p_organization_id is null then
    raise exception 'ORGANIZATION_REQUIRED' using errcode = 'PED68';
  end if;

  select om.role into v_org_role
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.user_id = auth.uid();

  if v_org_role is null or v_org_role not in ('owner', 'manager') then
    raise exception 'FORBIDDEN' using errcode = 'PED69';
  end if;

  select btrim(o.name) into v_org_name
  from public.organizations o
  where o.id = p_organization_id;

  select count(*)::integer into v_active_units
  from public.units u
  where u.organization_id = p_organization_id
    and u.is_active;

  select count(*)::integer into v_op_config
  from public.units u
  join public.unit_operational_settings s on s.unit_id = u.id
  where u.organization_id = p_organization_id
    and u.is_active
    and (s.pickup_enabled or s.delivery_enabled);

  select count(distinct u.id)::integer into v_hours
  from public.units u
  join public.unit_business_hours h on h.unit_id = u.id
  where u.organization_id = p_organization_id
    and u.is_active
    and h.is_open;

  select count(distinct u.id)::integer into v_payment
  from public.units u
  join public.unit_payment_methods pm on pm.unit_id = u.id
  where u.organization_id = p_organization_id
    and u.is_active
    and pm.is_enabled;

  select count(distinct p.unit_id)::integer into v_catalog
  from public.catalog_products p
  join public.catalog_categories c
    on c.id = p.category_id
   and c.organization_id = p.organization_id
   and c.unit_id = p.unit_id
  join public.units u on u.id = p.unit_id
  where p.organization_id = p_organization_id
    and p.is_active
    and c.is_active
    and u.is_active;

  select count(*)::integer into v_menu_published
  from public.menu_publications mp
  join public.units u on u.id = mp.unit_id
  where mp.organization_id = p_organization_id
    and u.is_active;

  select exists (
    select 1
    from public.orders o
    where o.organization_id = p_organization_id
  ) into v_first_order;

  select coalesce(bool_or(lp.enabled), false) into v_loyalty_enabled
  from public.loyalty_programs lp
  where lp.organization_id = p_organization_id;

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'code', 'org_name',
      'label', 'Organização configurada',
      'ok', v_org_name is not null and char_length(v_org_name) > 0,
      'blocking', true,
      'detail', coalesce(v_org_name, 'Nenhuma organização com nome válido')
    ),
    jsonb_build_object(
      'code', 'active_unit',
      'label', 'Unidade ativa',
      'ok', v_active_units > 0,
      'blocking', true,
      'detail', v_active_units || ' unidade(s) ativa(s)'
    ),
    jsonb_build_object(
      'code', 'op_config',
      'label', 'Configuração operacional',
      'ok', v_op_config > 0,
      'blocking', true,
      'detail', v_op_config || ' unidade(s) com pickup ou delivery configurado'
    ),
    jsonb_build_object(
      'code', 'hours',
      'label', 'Horários de funcionamento',
      'ok', v_hours > 0,
      'blocking', true,
      'detail', v_hours || ' unidade(s) com pelo menos um dia aberto'
    ),
    jsonb_build_object(
      'code', 'payment',
      'label', 'Formas de pagamento',
      'ok', v_payment > 0,
      'blocking', true,
      'detail', v_payment || ' unidade(s) com ao menos uma forma de pagamento habilitada'
    ),
    jsonb_build_object(
      'code', 'catalog',
      'label', 'Catálogo com itens ativos',
      'ok', v_catalog > 0,
      'blocking', true,
      'detail', v_catalog || ' unidade(s) com produto ativo'
    ),
    jsonb_build_object(
      'code', 'menu_published',
      'label', 'Cardápio publicado',
      'ok', v_menu_published > 0,
      'blocking', true,
      'detail', v_menu_published || ' unidade(s) com cardápio publicado'
    ),
    jsonb_build_object(
      'code', 'first_order',
      'label', 'Primeiro pedido',
      'ok', v_first_order,
      'blocking', true,
      'detail', case when v_first_order then 'Pelo menos um pedido registrado' else 'Nenhum pedido registrado ainda' end
    ),
    jsonb_build_object(
      'code', 'loyalty',
      'label', 'Clube Ped-On ativo',
      'ok', v_loyalty_enabled,
      'blocking', false,
      'detail', case when v_loyalty_enabled then 'Programa de fidelidade ativo' else 'Opcional — programa ainda não ativado' end
    )
  );

  v_units_summary := (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'unit_id', u.id,
          'name', u.name,
          'is_active', u.is_active,
          'op_configured', exists (
            select 1 from public.unit_operational_settings s
            where s.unit_id = u.id and (s.pickup_enabled or s.delivery_enabled)
          ),
          'hours_ok', exists (
            select 1 from public.unit_business_hours h
            where h.unit_id = u.id and h.is_open
          ),
          'payment_ok', exists (
            select 1 from public.unit_payment_methods pm
            where pm.unit_id = u.id and pm.is_enabled
          ),
          'catalog_ok', exists (
            select 1 from public.catalog_products p
            join public.catalog_categories c on c.id = p.category_id
            where p.unit_id = u.id and p.is_active and c.is_active
          ),
          'menu_published', exists (
            select 1 from public.menu_publications mp
            where mp.unit_id = u.id
          )
        )
        order by u.name asc
      ),
      '[]'::jsonb
    )
    from public.units u
    where u.organization_id = p_organization_id
  );

  select
    count(*)::integer,
    count(*) filter (where c ->> 'ok' = 'true')::integer
    into v_blocking_total, v_blocking_ok
  from jsonb_array_elements(v_checks) as c
  where (c ->> 'blocking')::boolean;

  v_ready := v_blocking_ok = v_blocking_total;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'ready', v_ready,
    'blocking_ok', v_blocking_ok,
    'blocking_total', v_blocking_total,
    'checked_at', now(),
    'checks', v_checks,
    'units_summary', v_units_summary
  );
end;
$$;

revoke all on function public.get_org_pilot_readiness(uuid) from public, anon;
grant execute on function public.get_org_pilot_readiness(uuid) to authenticated;

-- 2) Listagem de membros da organização (owner-only). Nenhum dado
--    sensível além de e-mail/nome/perfil do usuário é exposto.
create or replace function public.get_org_members_admin(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED67';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED69';
  end if;

  return (
    select coalesce(
      jsonb_agg(t.payload order by t.created_at asc, t.email asc),
      '[]'::jsonb
    )
    from (
      select
        om.user_id,
        om.role,
        om.created_at,
        p.email,
        (
          select coalesce(
            jsonb_agg(mu.unit_id order by mu.unit_id),
            '[]'::jsonb
          )
          from public.membership_units mu
          where mu.organization_id = om.organization_id
            and mu.user_id = om.user_id
        ) as unit_ids,
        jsonb_build_object(
          'id', om.user_id,
          'full_name', p.full_name,
          'email', p.email,
          'role', om.role,
          'unit_ids', (
            select coalesce(
              jsonb_agg(mu.unit_id order by mu.unit_id),
              '[]'::jsonb
            )
            from public.membership_units mu
            where mu.organization_id = om.organization_id
              and mu.user_id = om.user_id
          ),
          'created_at', om.created_at
        ) as payload
      from public.organization_members om
      join public.profiles p on p.id = om.user_id
      where om.organization_id = p_organization_id
    ) as t
  );
end;
$$;

revoke all on function public.get_org_members_admin(uuid) from public, anon;
grant execute on function public.get_org_members_admin(uuid) to authenticated;

-- 3) Vínculo de unidade a membro (owner-only, transacional).
create or replace function public.assign_unit_to_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_active boolean;
  v_already boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED67';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED69';
  end if;
  if p_user_id is null or p_unit_id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'PED70';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'PED70';
  end if;

  select u.is_active into v_unit_active
  from public.units u
  where u.organization_id = p_organization_id
    and u.id = p_unit_id;

  if v_unit_active is null or not v_unit_active then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED71';
  end if;

  select exists (
    select 1
    from public.membership_units mu
    where mu.organization_id = p_organization_id
      and mu.user_id = p_user_id
      and mu.unit_id = p_unit_id
  ) into v_already;

  insert into public.membership_units (organization_id, user_id, unit_id)
  values (p_organization_id, p_user_id, p_unit_id)
  on conflict do nothing;

  return jsonb_build_object(
    'assigned', not v_already,
    'already_assigned', v_already,
    'organization_id', p_organization_id,
    'user_id', p_user_id,
    'unit_id', p_unit_id
  );
end;
$$;

revoke all on function public.assign_unit_to_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_unit_to_member(uuid, uuid, uuid) to authenticated;

-- 4) Remoção de vínculo de unidade (owner-only).
create or replace function public.remove_unit_from_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED67';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED69';
  end if;
  if p_user_id is null or p_unit_id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'PED70';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'PED70';
  end if;

  delete from public.membership_units mu
  where mu.organization_id = p_organization_id
    and mu.user_id = p_user_id
    and mu.unit_id = p_unit_id;

  v_removed := found;

  return jsonb_build_object(
    'removed', v_removed,
    'organization_id', p_organization_id,
    'user_id', p_user_id,
    'unit_id', p_unit_id
  );
end;
$$;

revoke all on function public.remove_unit_from_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.remove_unit_from_member(uuid, uuid, uuid) to authenticated;
