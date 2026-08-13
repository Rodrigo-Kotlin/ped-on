-- =============================================================
-- PED-ON — Prompt 12 - Opcoes de produto (variacoes, adicionais e
-- remocoes). Contrato congelado no PROMPT 12 — CONTRACT FREEZE
-- (APROVADO). Catálogo mutavel ganha grupos/opcoes; a publicacao
-- congela um snapshot imutavel (menu_version_option_groups /
-- menu_version_options); o checkout valida selecao no servidor,
-- calcula final_unit_price = base + SUM(price_delta) e preserva um
-- snapshot append-only por linha (order_item_options).
-- =============================================================

-- 1) Grupos de opcoes no catalogo mutavel. A chave composta preserva
--    tenant, unidade e produto nas referencias feitas pelas opcoes.
create table public.catalog_product_option_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  product_id uuid not null,
  name text not null,
  kind text not null,
  selection_mode text not null,
  min_select integer not null,
  max_select integer not null,
  is_active boolean not null default true,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_option_groups_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint catalog_product_option_groups_kind_check
    check (kind in ('variation', 'addon', 'removal')),
  constraint catalog_product_option_groups_selection_mode_check
    check (selection_mode in ('single', 'multiple')),
  constraint catalog_product_option_groups_min_max_check
    check (min_select >= 0 and max_select <= 50 and min_select <= max_select),
  constraint catalog_product_option_groups_variation_check
    check (kind <> 'variation' or (selection_mode = 'single' and max_select = 1)),
  constraint catalog_product_option_groups_removal_check
    check (kind <> 'removal' or (selection_mode = 'multiple' and min_select = 0)),
  constraint catalog_product_option_groups_product_fk
    foreign key (organization_id, unit_id, product_id)
    references public.catalog_products (organization_id, unit_id, id)
    on delete cascade,
  constraint catalog_product_option_groups_organization_unit_product_id_key
    unique (organization_id, unit_id, product_id, id)
);

create index catalog_product_option_groups_product_order_idx
  on public.catalog_product_option_groups (organization_id, unit_id, product_id, sort_order, id);

alter table public.catalog_product_option_groups enable row level security;

create trigger set_catalog_product_option_groups_updated_at
before update on public.catalog_product_option_groups
for each row execute function public.set_updated_at();

-- 2) Opcoes pertencem a um grupo da mesma organizacao e unidade.
--    price_delta usa decimal exato, nunca float.
create table public.catalog_product_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  product_id uuid not null,
  group_id uuid not null,
  name text not null,
  price_delta numeric(12, 2) not null,
  is_active boolean not null default true,
  is_available boolean not null default true,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_options_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint catalog_product_options_price_delta_check
    check (price_delta >= -9999999999.99 and price_delta <= 9999999999.99),
  constraint catalog_product_options_group_fk
    foreign key (organization_id, unit_id, product_id, group_id)
    references public.catalog_product_option_groups (organization_id, unit_id, product_id, id)
    on delete cascade,
  constraint catalog_product_options_organization_unit_product_group_id_key
    unique (organization_id, unit_id, product_id, group_id, id)
);

create index catalog_product_options_group_order_idx
  on public.catalog_product_options (organization_id, unit_id, group_id, sort_order, id);

alter table public.catalog_product_options enable row level security;

create trigger set_catalog_product_options_updated_at
before update on public.catalog_product_options
for each row execute function public.set_updated_at();

-- 3) Invariantes cross-table entre kind do grupo e price_delta da
--    opcao. PostgreSQL CHECK nao valida colunas do parent, entao a
--    regra e mantida por trigger (estrutural). Nenhuma correcao
--    silenciosa: mudanca de kind com filhos que violem o novo kind
--    e rejeitada.
create function public._validate_option_delta_by_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_product_id uuid;
begin
  select g.kind, g.product_id into v_kind, v_product_id
  from public.catalog_product_option_groups as g
  where g.id = new.group_id
    and g.organization_id = new.organization_id
    and g.unit_id = new.unit_id;

  if v_kind is null then
    raise exception 'INVALID_OPTION_GROUP' using errcode = 'PED72';
  end if;

  if v_kind = 'removal' and new.price_delta <> 0 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_kind = 'addon' and new.price_delta < 0 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;

  new.product_id := v_product_id;
  return new;
end;
$$;

revoke all on function public._validate_option_delta_by_kind()
  from public, anon, authenticated;

create trigger catalog_product_options_delta_by_kind
before insert or update on public.catalog_product_options
for each row execute function public._validate_option_delta_by_kind();

create function public._guard_option_group_kind_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_violations integer;
begin
  if new.kind = old.kind then
    return new;
  end if;

  select count(*) into v_violations
  from public.catalog_product_options as o
  where o.organization_id = new.organization_id
    and o.unit_id = new.unit_id
    and o.group_id = new.id
    and (
      (new.kind = 'removal' and o.price_delta <> 0)
      or (new.kind = 'addon' and o.price_delta < 0)
    );

  if v_violations > 0 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;

  return new;
end;
$$;

revoke all on function public._guard_option_group_kind_change()
  from public, anon, authenticated;

create trigger catalog_product_option_groups_kind_guard
before update on public.catalog_product_option_groups
for each row execute function public._guard_option_group_kind_change();

-- 4) RLS/ACL do catalogo mutavel: somente identidades autenticadas
--    com acesso efetivo a unidade leem; nenhum papel de navegador
--    recebe INSERT, UPDATE ou DELETE.
create policy "catalog_product_option_groups_select_unit_access" on public.catalog_product_option_groups
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "catalog_product_options_select_unit_access" on public.catalog_product_options
  for select to authenticated
  using (public.can_access_unit(unit_id));

revoke all on table public.catalog_product_option_groups from public, anon, authenticated;
revoke all on table public.catalog_product_options from public, anon, authenticated;
grant select on public.catalog_product_option_groups to authenticated;
grant select on public.catalog_product_options to authenticated;

-- 5) Helper de validacao textual de price_delta. Aceita sinal
--    negativo (variation), rejeita expoente/sinais duplos/NaN e
--    aplica as regras de kind do freeze.
create function public._validate_option_delta(p_delta text, p_kind text)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_text text := btrim(p_delta);
  v_delta numeric;
begin
  if v_text is null or v_text !~ '^-?(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' then
    raise exception 'INVALID_PRICE' using errcode = 'PED28';
  end if;

  begin
    v_delta := v_text::numeric;
  exception when others then
    raise exception 'INVALID_PRICE' using errcode = 'PED28';
  end;

  if v_delta < -9999999999.99 or v_delta > 9999999999.99 then
    raise exception 'INVALID_PRICE' using errcode = 'PED28';
  end if;

  if p_kind = 'removal' and v_delta <> 0 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if p_kind = 'addon' and v_delta < 0 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;

  return v_delta;
end;
$$;

revoke all on function public._validate_option_delta(text, text)
  from public, anon, authenticated;

-- 6) Fingerprint canonical e determinístico da selecao de opcoes.
--    Calculado exclusivamente no servidor: deduplica, ordena os IDs
--    de snapshot e gera um valor estavel para o conjunto vazio.
--    Nunca e aceito do frontend.
create function public._options_fingerprint(p_option_ids uuid[])
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_canonical text;
begin
  select '[' || coalesce(
    string_agg('"' || t.id::text || '"', ',' order by t.id::text),
    ''
  ) || ']'
  into v_canonical
  from (
    select distinct unnest(coalesce(p_option_ids, array[]::uuid[])) as id
  ) as t;

  return encode(extensions.digest(v_canonical, 'sha256'), 'hex');
end;
$$;

revoke all on function public._options_fingerprint(uuid[])
  from public, anon, authenticated;

-- Contrato de erros (Prompt 12):
-- PED72 INVALID_OPTION_GROUP     | PED73 INVALID_SELECTION_RULE
-- PED74 OPTION_NOT_FOUND         | PED75 OPTION_UNAVAILABLE
-- PED76 SELECTION_REQUIRED       | PED77 SELECTION_LIMIT_EXCEEDED
-- PED78 SELECTION_MENU_MISMATCH

-- 7) Grupos de opcoes: owner/manager estrutura. Ordenacao calculada
--    sob lock do produto de destino.
create function public.create_catalog_product_option_group(
  p_unit_id uuid,
  p_product_id uuid,
  p_name text,
  p_kind text,
  p_selection_mode text,
  p_min_select integer,
  p_max_select integer
)
returns public.catalog_product_option_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_product public.catalog_products;
  v_name text := nullif(btrim(p_name), '');
  v_kind text := nullif(btrim(p_kind), '');
  v_selection_mode text := nullif(btrim(p_selection_mode), '');
  v_sort_order integer;
  v_group public.catalog_product_option_groups;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_unit from public.units u where u.id = p_unit_id;
  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;
  if not public.can_manage_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select * into v_product
  from public.catalog_products p
  where p.id = p_product_id
    and p.organization_id = v_unit.organization_id
    and p.unit_id = p_unit_id;
  if v_product is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'PED24';
  end if;

  if v_name is null then
    raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'PED25';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'PRODUCT_NAME_TOO_LONG' using errcode = 'PED26';
  end if;
  if v_kind not in ('variation', 'addon', 'removal') then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_selection_mode not in ('single', 'multiple') then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if p_min_select is null or p_max_select is null
     or p_min_select < 0 or p_max_select < p_min_select or p_max_select > 50
  then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_kind = 'variation' and (v_selection_mode <> 'single' or p_max_select <> 1) then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_kind = 'removal' and (v_selection_mode <> 'multiple' or p_min_select <> 0) then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('pedon:catalog:option-groups:product:' || p_product_id::text)
  );
  select coalesce(max(g.sort_order), 0) + 100 into v_sort_order
  from public.catalog_product_option_groups g
  where g.organization_id = v_unit.organization_id
    and g.unit_id = p_unit_id
    and g.product_id = p_product_id;

  insert into public.catalog_product_option_groups (
    organization_id, unit_id, product_id, name, kind, selection_mode,
    min_select, max_select, sort_order
  ) values (
    v_unit.organization_id, p_unit_id, p_product_id, v_name, v_kind, v_selection_mode,
    p_min_select, p_max_select, v_sort_order
  )
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.create_catalog_product_option_group(
  uuid, uuid, text, text, text, integer, integer
) from public, anon;
grant execute on function public.create_catalog_product_option_group(
  uuid, uuid, text, text, text, integer, integer
) to authenticated;

create function public.update_catalog_product_option_group(
  p_group_id uuid,
  p_name text,
  p_kind text,
  p_selection_mode text,
  p_min_select integer,
  p_max_select integer
)
returns public.catalog_product_option_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.catalog_product_option_groups;
  v_name text := nullif(btrim(p_name), '');
  v_kind text := nullif(btrim(p_kind), '');
  v_selection_mode text := nullif(btrim(p_selection_mode), '');
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_group
  from public.catalog_product_option_groups g
  where g.id = p_group_id;
  if v_group is null then
    raise exception 'INVALID_OPTION_GROUP' using errcode = 'PED72';
  end if;
  if not public.can_manage_unit(v_group.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  if v_name is null then
    raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'PED25';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'PRODUCT_NAME_TOO_LONG' using errcode = 'PED26';
  end if;
  if v_kind not in ('variation', 'addon', 'removal') then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_selection_mode not in ('single', 'multiple') then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if p_min_select is null or p_max_select is null
     or p_min_select < 0 or p_max_select < p_min_select or p_max_select > 50
  then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_kind = 'variation' and (v_selection_mode <> 'single' or p_max_select <> 1) then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  if v_kind = 'removal' and (v_selection_mode <> 'multiple' or p_min_select <> 0) then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;

  -- A mudanca de kind com filhos que violem o novo kind e rejeitada
  -- pelo trigger _guard_option_group_kind_change (PED73).
  update public.catalog_product_option_groups
  set name = v_name,
      kind = v_kind,
      selection_mode = v_selection_mode,
      min_select = p_min_select,
      max_select = p_max_select
  where id = p_group_id
    and organization_id = v_group.organization_id
    and unit_id = v_group.unit_id
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.update_catalog_product_option_group(
  uuid, text, text, text, integer, integer
) from public, anon;
grant execute on function public.update_catalog_product_option_group(
  uuid, text, text, text, integer, integer
) to authenticated;

create function public.set_catalog_product_option_group_active(
  p_group_id uuid,
  p_is_active boolean
)
returns public.catalog_product_option_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.catalog_product_option_groups;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_group
  from public.catalog_product_option_groups g
  where g.id = p_group_id;
  if v_group is null then
    raise exception 'INVALID_OPTION_GROUP' using errcode = 'PED72';
  end if;
  if not public.can_manage_unit(v_group.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if p_is_active is null then
    raise exception 'INVALID_CATALOG_FLAG' using errcode = 'PED30';
  end if;

  update public.catalog_product_option_groups
  set is_active = p_is_active
  where id = p_group_id
    and organization_id = v_group.organization_id
    and unit_id = v_group.unit_id
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.set_catalog_product_option_group_active(uuid, boolean)
  from public, anon;
grant execute on function public.set_catalog_product_option_group_active(uuid, boolean)
  to authenticated;

-- 8) Opcoes: owner/manager estrutura; disponibilidade operacional por
--    owner/manager/operator (padrao de disponibilidade do catalogo).
create function public.create_catalog_product_option(
  p_group_id uuid,
  p_name text,
  p_price_delta text
)
returns public.catalog_product_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.catalog_product_option_groups;
  v_name text := nullif(btrim(p_name), '');
  v_price_delta numeric;
  v_sort_order integer;
  v_option public.catalog_product_options;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_group
  from public.catalog_product_option_groups g
  where g.id = p_group_id;
  if v_group is null then
    raise exception 'INVALID_OPTION_GROUP' using errcode = 'PED72';
  end if;
  if not public.can_manage_unit(v_group.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if v_name is null then
    raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'PED25';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'PRODUCT_NAME_TOO_LONG' using errcode = 'PED26';
  end if;
  v_price_delta := public._validate_option_delta(p_price_delta, v_group.kind);

  perform pg_advisory_xact_lock(
    hashtext('pedon:catalog:option-groups:product:' || v_group.product_id::text)
  );
  select coalesce(max(o.sort_order), 0) + 100 into v_sort_order
  from public.catalog_product_options o
  where o.organization_id = v_group.organization_id
    and o.unit_id = v_group.unit_id
    and o.group_id = p_group_id;

  insert into public.catalog_product_options (
    organization_id, unit_id, product_id, group_id, name, price_delta, sort_order
  ) values (
    v_group.organization_id, v_group.unit_id, v_group.product_id, p_group_id,
    v_name, v_price_delta, v_sort_order
  )
  returning * into v_option;

  return v_option;
end;
$$;

revoke all on function public.create_catalog_product_option(uuid, text, text)
  from public, anon;
grant execute on function public.create_catalog_product_option(uuid, text, text)
  to authenticated;

create function public.update_catalog_product_option(
  p_option_id uuid,
  p_name text,
  p_price_delta text
)
returns public.catalog_product_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option public.catalog_product_options;
  v_group public.catalog_product_option_groups;
  v_name text := nullif(btrim(p_name), '');
  v_price_delta numeric;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_option
  from public.catalog_product_options o
  where o.id = p_option_id;
  if v_option is null then
    raise exception 'OPTION_NOT_FOUND' using errcode = 'PED74';
  end if;
  if not public.can_manage_unit(v_option.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select * into v_group
  from public.catalog_product_option_groups g
  where g.id = v_option.group_id
    and g.organization_id = v_option.organization_id
    and g.unit_id = v_option.unit_id;
  if v_group is null then
    raise exception 'INVALID_OPTION_GROUP' using errcode = 'PED72';
  end if;
  if v_name is null then
    raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'PED25';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'PRODUCT_NAME_TOO_LONG' using errcode = 'PED26';
  end if;
  v_price_delta := public._validate_option_delta(p_price_delta, v_group.kind);

  update public.catalog_product_options
  set name = v_name,
      price_delta = v_price_delta
  where id = p_option_id
    and organization_id = v_option.organization_id
    and unit_id = v_option.unit_id
  returning * into v_option;

  return v_option;
end;
$$;

revoke all on function public.update_catalog_product_option(uuid, text, text)
  from public, anon;
grant execute on function public.update_catalog_product_option(uuid, text, text)
  to authenticated;

create function public.set_catalog_product_option_active(
  p_option_id uuid,
  p_is_active boolean
)
returns public.catalog_product_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option public.catalog_product_options;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_option
  from public.catalog_product_options o
  where o.id = p_option_id;
  if v_option is null then
    raise exception 'OPTION_NOT_FOUND' using errcode = 'PED74';
  end if;
  if not public.can_manage_unit(v_option.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if p_is_active is null then
    raise exception 'INVALID_CATALOG_FLAG' using errcode = 'PED30';
  end if;

  update public.catalog_product_options
  set is_active = p_is_active
  where id = p_option_id
    and organization_id = v_option.organization_id
    and unit_id = v_option.unit_id
  returning * into v_option;

  return v_option;
end;
$$;

revoke all on function public.set_catalog_product_option_active(uuid, boolean)
  from public, anon;
grant execute on function public.set_catalog_product_option_active(uuid, boolean)
  to authenticated;

create function public.set_catalog_product_option_available(
  p_option_id uuid,
  p_is_available boolean
)
returns public.catalog_product_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option public.catalog_product_options;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_option
  from public.catalog_product_options o
  where o.id = p_option_id;
  if v_option is null then
    raise exception 'OPTION_NOT_FOUND' using errcode = 'PED74';
  end if;
  if not public.can_access_unit(v_option.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if p_is_available is null then
    raise exception 'INVALID_CATALOG_FLAG' using errcode = 'PED30';
  end if;

  update public.catalog_product_options
  set is_available = p_is_available
  where id = p_option_id
    and organization_id = v_option.organization_id
    and unit_id = v_option.unit_id
  returning * into v_option;

  return v_option;
end;
$$;

revoke all on function public.set_catalog_product_option_available(uuid, boolean)
  from public, anon;
grant execute on function public.set_catalog_product_option_available(uuid, boolean)
  to authenticated;

-- 9) Snapshot imutavel de grupos no momento da publicacao.
--    source_group_id e somente metadado interno de rastreabilidade;
--    nunca e retornado publicamente.
create table public.menu_version_option_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  menu_version_id uuid not null,
  menu_product_id uuid not null,
  source_group_id uuid,
  name text not null,
  kind text not null,
  selection_mode text not null,
  min_select integer not null,
  max_select integer not null,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  constraint menu_version_option_groups_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint menu_version_option_groups_kind_check
    check (kind in ('variation', 'addon', 'removal')),
  constraint menu_version_option_groups_selection_mode_check
    check (selection_mode in ('single', 'multiple')),
  constraint menu_version_option_groups_min_max_check
    check (min_select >= 0 and max_select <= 50 and min_select <= max_select),
  constraint menu_version_option_groups_variation_check
    check (kind <> 'variation' or (selection_mode = 'single' and max_select = 1)),
  constraint menu_version_option_groups_removal_check
    check (kind <> 'removal' or (selection_mode = 'multiple' and min_select = 0)),
  constraint menu_version_option_groups_product_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_product_id)
    references public.menu_version_products (organization_id, unit_id, menu_version_id, id)
    on delete cascade,
  constraint menu_version_option_groups_organization_version_product_id_key
    unique (organization_id, unit_id, menu_version_id, menu_product_id, id)
);

create index menu_version_option_groups_order_idx
  on public.menu_version_option_groups (menu_version_id, menu_product_id, sort_order, id);

alter table public.menu_version_option_groups enable row level security;

-- 10) Opcao em snapshot. source_option_id e o overlay de
--     disponibilidade operacional (padrao source_product_id).
create table public.menu_version_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  menu_version_id uuid not null,
  menu_product_id uuid not null,
  menu_group_id uuid not null,
  source_option_id uuid,
  name text not null,
  price_delta numeric(12, 2) not null,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  constraint menu_version_options_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint menu_version_options_price_delta_check
    check (price_delta >= -9999999999.99 and price_delta <= 9999999999.99),
  constraint menu_version_options_group_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_product_id, menu_group_id)
    references public.menu_version_option_groups (organization_id, unit_id, menu_version_id, menu_product_id, id)
    on delete cascade,
  constraint menu_version_options_organization_version_product_group_id_key
    unique (organization_id, unit_id, menu_version_id, menu_product_id, menu_group_id, id)
);

create index menu_version_options_order_idx
  on public.menu_version_options (menu_version_id, menu_product_id, menu_group_id, sort_order, id);

alter table public.menu_version_options enable row level security;

-- RLS/ACL do snapshot: leitura administrativa autenticada; nenhuma
-- escrita por papel de navegador.
create policy "menu_version_option_groups_select_unit_access" on public.menu_version_option_groups
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "menu_version_options_select_unit_access" on public.menu_version_options
  for select to authenticated
  using (public.can_access_unit(unit_id));

revoke all on table public.menu_version_option_groups from public, anon, authenticated;
revoke all on table public.menu_version_options from public, anon, authenticated;
grant select on public.menu_version_option_groups to authenticated;
grant select on public.menu_version_options to authenticated;

-- 11) Publicacao ampliada: congela grupos/opcoes ativos no snapshot e
--     valida o piso de preco final (base + menor combinacao de deltas
--     possivel entre grupos de variation) usando o estado ativo, sem
--     relaxar por disponibilidade atual das opcoes.
create or replace function public.publish_unit_menu(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_version public.menu_versions;
  v_pub public.menu_publications;
  v_slug text;
  v_slug_try text;
  v_slug_created boolean := false;
  v_category_count integer := 0;
  v_product_count integer := 0;
  v_group_count integer := 0;
  v_option_count integer := 0;
  v_categories record;
  v_category_id uuid;
  v_pub_product record;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_unit from public.units u where u.id = p_unit_id;
  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;
  if not public.can_manage_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('pedon:catalog:categories:unit:' || p_unit_id::text)
  );
  perform pg_advisory_xact_lock(hashtext('pedon:menu:publish:' || p_unit_id::text));

  for v_categories in
    select c.id, c.organization_id, c.unit_id
    from public.catalog_categories c
    where c.organization_id = v_unit.organization_id
      and c.unit_id = p_unit_id
      and c.is_active = true
    order by c.sort_order, c.id
  loop
    perform pg_advisory_xact_lock(
      hashtext('pedon:catalog:products:category:' || v_categories.id::text)
    );
  end loop;

  -- Menu vazio (nenhuma categoria com ao menos um produto ativo) não
  -- pode ser publicado; nenhuma versão parcial é criada.
  select count(*) into v_product_count
  from public.catalog_products p
  join public.catalog_categories c
    on c.id = p.category_id
   and c.organization_id = p.organization_id
   and c.unit_id = p.unit_id
  where p.organization_id = v_unit.organization_id
    and p.unit_id = p_unit_id
    and p.is_active = true
    and c.is_active = true;

  if v_product_count = 0 then
    raise exception 'MENU_EMPTY' using errcode = 'PED31';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.menu_versions
  where unit_id = p_unit_id;

  insert into public.menu_versions (organization_id, unit_id, version_number, created_by)
  values (v_unit.organization_id, p_unit_id, v_next, auth.uid())
  returning * into v_version;

  for v_categories in
    select c.id, c.organization_id, c.unit_id, c.name, c.sort_order
    from public.catalog_categories c
    where c.organization_id = v_unit.organization_id
      and c.unit_id = p_unit_id
      and c.is_active = true
    order by c.sort_order, c.id
  loop
    if exists (
      select 1
      from public.catalog_products p
      where p.organization_id = v_categories.organization_id
        and p.unit_id = v_categories.unit_id
        and p.category_id = v_categories.id
        and p.is_active = true
    ) then
      insert into public.menu_version_categories (
        organization_id, unit_id, menu_version_id, source_category_id, name, sort_order
      ) values (
        v_categories.organization_id, v_categories.unit_id,
        v_version.id, v_categories.id, v_categories.name, v_categories.sort_order
      )
      returning id into v_category_id;
      v_category_count := v_category_count + 1;

      insert into public.menu_version_products (
        organization_id, unit_id, menu_version_id, menu_category_id,
        source_product_id, name, description, price, sort_order
      )
      select
        p.organization_id, p.unit_id, v_version.id, v_category_id,
        p.id, p.name, p.description, p.price, p.sort_order
      from public.catalog_products p
      where p.organization_id = v_categories.organization_id
        and p.unit_id = v_categories.unit_id
        and p.category_id = v_categories.id
        and p.is_active = true
      order by p.sort_order, p.id;
    end if;
  end loop;

  -- Locks de grupos/opcoes por produto antes de copiar o snapshot.
  for v_pub_product in
    select id, source_product_id
    from public.menu_version_products
    where menu_version_id = v_version.id
    order by id
  loop
    if v_pub_product.source_product_id is not null then
      perform pg_advisory_xact_lock(
        hashtext(
          'pedon:catalog:option-groups:product:' || v_pub_product.source_product_id::text
        )
      );
    end if;
  end loop;

  -- Grupos ativos com ao menos uma opcao ativa. A disponibilidade
  -- operacional das opcoes nao exclui linhas do snapshot.
  insert into public.menu_version_option_groups (
    organization_id, unit_id, menu_version_id, menu_product_id,
    source_group_id, name, kind, selection_mode, min_select, max_select, sort_order
  )
  select
    mp.organization_id, mp.unit_id, v_version.id, mp.id,
    g.id, g.name, g.kind, g.selection_mode, g.min_select, g.max_select, g.sort_order
  from public.catalog_product_option_groups as g
  join public.menu_version_products as mp
    on mp.organization_id = g.organization_id
   and mp.unit_id = g.unit_id
   and mp.menu_version_id = v_version.id
   and mp.source_product_id = g.product_id
  where g.is_active = true
    and exists (
      select 1
      from public.catalog_product_options as o
      where o.organization_id = g.organization_id
        and o.unit_id = g.unit_id
        and o.group_id = g.id
        and o.is_active = true
    )
  order by g.sort_order, g.id;

  get diagnostics v_group_count = row_count;

  insert into public.menu_version_options (
    organization_id, unit_id, menu_version_id, menu_product_id, menu_group_id,
    source_option_id, name, price_delta, sort_order
  )
  select
    o.organization_id, o.unit_id, v_version.id, g.menu_product_id, g.id,
    o.id, o.name, o.price_delta, o.sort_order
  from public.catalog_product_options as o
  join public.menu_version_option_groups as g
    on g.organization_id = o.organization_id
   and g.unit_id = o.unit_id
   and g.menu_version_id = v_version.id
   and g.source_group_id = o.group_id
  where o.is_active = true
  order by o.sort_order, o.id;

  get diagnostics v_option_count = row_count;

  -- Piso de preco: base + menor combinacao possivel de deltas entre
  -- grupos de variation (obrigatorio: menor delta; opcional:
  -- min(0, menor delta)). A disponibilidade atual nao relaxa a
  -- validacao porque uma opcao indisponivel pode voltar a ficar
  -- disponivel.
  if exists (
    select 1
    from (
      select
        mp.id,
        mp.price
          + coalesce((
            select sum(t.contrib)
            from (
              select
                case
                  when g.min_select > 0 then (
                    select min(o.price_delta)
                    from public.menu_version_options as o
                    where o.organization_id = g.organization_id
                      and o.unit_id = g.unit_id
                      and o.menu_version_id = g.menu_version_id
                      and o.menu_product_id = g.menu_product_id
                      and o.menu_group_id = g.id
                  )
                  else least(
                    0,
                    (
                      select min(o.price_delta)
                      from public.menu_version_options as o
                      where o.organization_id = g.organization_id
                        and o.unit_id = g.unit_id
                        and o.menu_version_id = g.menu_version_id
                        and o.menu_product_id = g.menu_product_id
                        and o.menu_group_id = g.id
                    )
                  )
                end as contrib
              from public.menu_version_option_groups as g
              where g.organization_id = mp.organization_id
                and g.unit_id = mp.unit_id
                and g.menu_version_id = mp.menu_version_id
                and g.menu_product_id = mp.id
                and g.kind = 'variation'
            ) as t
          ), 0)
        as final_price
      from public.menu_version_products as mp
      where mp.menu_version_id = v_version.id
    ) as x
    where x.final_price < 0.01
  ) then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;

  -- Slug público: reutiliza o existente ou gera 24 caracteres hex
  -- criptograficamente aleatórios, repetindo em eventual colisão.
  -- Usa gen_random_uuid (pg_catalog) para não depender do schema
  -- `extensions` (ausente no search_path vazio da função).
  select public_slug into v_slug
  from public.menu_publications
  where unit_id = p_unit_id;

  if v_slug is null then
    for i in 1..10 loop
      v_slug_try := left(replace(gen_random_uuid()::text, '-', ''), 24);
      begin
        insert into public.menu_publications (
          organization_id, unit_id, public_slug, current_menu_version_id, published_at
        ) values (
          v_unit.organization_id, p_unit_id, v_slug_try, v_version.id, now()
        )
        returning * into v_pub;
        v_slug_created := true;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
    if not v_slug_created then
      raise exception 'PUBLICATION_CONFLICT' using errcode = 'PED32';
    end if;
  else
    update public.menu_publications
    set current_menu_version_id = v_version.id,
        published_at = now()
    where unit_id = p_unit_id
    returning * into v_pub;
  end if;

  return jsonb_build_object(
    'version_id', v_version.id,
    'version_number', v_version.version_number,
    'published_at', v_pub.published_at,
    'public_slug', v_pub.public_slug,
    'public_path', '/menu/' || v_pub.public_slug,
    'category_count', v_category_count,
    'product_count', v_product_count,
    'option_group_count', v_group_count,
    'option_count', v_option_count
  );
end;
$$;

revoke all on function public.publish_unit_menu(uuid) from public, anon;
grant execute on function public.publish_unit_menu(uuid) to authenticated;

-- 12) Cardapio publico: produtos ganham option_groups e is_configurable.
--     Somente IDs de snapshot sao retornados; source_* nunca exposto.
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
                    ),
                    'is_configurable', not exists (
                      select 1
                      from public.menu_version_option_groups as g
                      where g.organization_id = p.organization_id
                        and g.unit_id = p.unit_id
                        and g.menu_version_id = p.menu_version_id
                        and g.menu_product_id = p.id
                        and g.min_select > 0
                        and (
                          select count(*)
                          from public.menu_version_options as o
                          where o.organization_id = g.organization_id
                            and o.unit_id = g.unit_id
                            and o.menu_version_id = g.menu_version_id
                            and o.menu_product_id = g.menu_product_id
                            and o.menu_group_id = g.id
                            and coalesce((
                              select co.is_available
                              from public.catalog_product_options as co
                              where co.id = o.source_option_id
                                and co.organization_id = o.organization_id
                                and co.unit_id = o.unit_id
                            ), false)
                        ) < g.min_select
                    ),
                    'option_groups', (
                      select coalesce(
                        jsonb_agg(
                          jsonb_build_object(
                            'id', g.id,
                            'name', g.name,
                            'kind', g.kind,
                            'selection_mode', g.selection_mode,
                            'min_select', g.min_select,
                            'max_select', g.max_select,
                            'options', (
                              select coalesce(
                                jsonb_agg(
                                  jsonb_build_object(
                                    'id', o.id,
                                    'name', o.name,
                                    'price_delta', o.price_delta::text,
                                    'is_available', coalesce((
                                      select co.is_available
                                      from public.catalog_product_options as co
                                      where co.id = o.source_option_id
                                        and co.organization_id = o.organization_id
                                        and co.unit_id = o.unit_id
                                    ), false)
                                  )
                                  order by o.sort_order, o.id
                                ),
                                '[]'::jsonb
                              )
                              from public.menu_version_options as o
                              where o.organization_id = g.organization_id
                                and o.unit_id = g.unit_id
                                and o.menu_version_id = g.menu_version_id
                                and o.menu_product_id = g.menu_product_id
                                and o.menu_group_id = g.id
                            )
                          )
                          order by g.sort_order, g.id
                        ),
                        '[]'::jsonb
                      )
                      from public.menu_version_option_groups as g
                      where g.organization_id = p.organization_id
                        and g.unit_id = p.unit_id
                        and g.menu_version_id = p.menu_version_id
                        and g.menu_product_id = p.id
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

-- 13) order_items: fingerprint de opcoes calculado pelo servidor.
--     Linhas distintas do mesmo produto sao permitidas por
--     (order_id, menu_item_id, options_fingerprint); a unicidade de
--     linhas identicas e preservada.
alter table public.order_items
  add column options_fingerprint text;

update public.order_items
set options_fingerprint = public._options_fingerprint(array[]::uuid[]);

alter table public.order_items
  alter column options_fingerprint set not null;

alter table public.order_items
  drop constraint order_items_order_menu_item_key;

alter table public.order_items
  add constraint order_items_order_menu_item_options_key
  unique (order_id, menu_item_id, options_fingerprint);

alter table public.order_items
  add constraint order_items_organization_unit_order_id_key
  unique (organization_id, unit_id, order_id, id);

create index order_items_unit_order_options_idx
  on public.order_items (unit_id, order_id, options_fingerprint);

-- 14) Snapshot append-only das opcoes selecionadas em cada linha.
--     Nomes e deltas sao congelados no momento da criacao; o
--     historico nao depende do catalogo mutavel.
create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null,
  menu_version_id uuid not null,
  menu_item_id uuid not null,
  menu_group_id uuid not null,
  group_name text not null,
  group_kind text not null,
  menu_option_id uuid not null,
  option_name text not null,
  price_delta numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  constraint order_item_options_group_name_check
    check (group_name = btrim(group_name) and char_length(group_name) between 1 and 80),
  constraint order_item_options_group_kind_check
    check (group_kind in ('variation', 'addon', 'removal')),
  constraint order_item_options_option_name_check
    check (option_name = btrim(option_name) and char_length(option_name) between 1 and 80),
  constraint order_item_options_price_delta_check
    check (price_delta >= -9999999999.99 and price_delta <= 9999999999.99),
  constraint order_item_options_order_fk
    foreign key (organization_id, unit_id, order_id)
    references public.orders (organization_id, unit_id, id)
    on delete cascade,
  constraint order_item_options_item_fk
    foreign key (organization_id, unit_id, order_id, order_item_id)
    references public.order_items (organization_id, unit_id, order_id, id)
    on delete cascade,
  constraint order_item_options_menu_item_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_item_id)
    references public.menu_version_products (organization_id, unit_id, menu_version_id, id)
    on delete restrict,
  constraint order_item_options_menu_group_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_item_id, menu_group_id)
    references public.menu_version_option_groups (organization_id, unit_id, menu_version_id, menu_product_id, id)
    on delete restrict,
  constraint order_item_options_menu_option_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_item_id, menu_group_id, menu_option_id)
    references public.menu_version_options (organization_id, unit_id, menu_version_id, menu_product_id, menu_group_id, id)
    on delete restrict
);

create index order_item_options_order_created_idx
  on public.order_item_options (order_id, created_at, id);

create index order_item_options_item_idx
  on public.order_item_options (order_item_id);

create index order_item_options_unit_order_idx
  on public.order_item_options (unit_id, order_id);

alter table public.order_item_options enable row level security;

create policy "order_item_options_select_unit_access" on public.order_item_options
  for select to authenticated
  using (public.can_access_unit(unit_id));

revoke all on table public.order_item_options from public, anon, authenticated;
grant select on public.order_item_options to authenticated;

-- 15) Tracking publico: itens exibem opcoes com nome e delta; sem
--     identificadores tecnicos.
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
              'line_total', oi.line_total::text,
              'note', oi.note,
              'options', (
                select coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'group_name', oo.group_name,
                      'group_kind', oo.group_kind,
                      'option_name', oo.option_name,
                      'price_delta', oo.price_delta::text
                    )
                    order by oo.created_at, oo.id
                  ),
                  '[]'::jsonb
                )
                from public.order_item_options as oo
                where oo.order_item_id = oi.id
              )
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

-- 16) Detalhe administrativo: itens exibem opcoes com identificadores
--     de snapshot para uso interno.
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
            'options', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', oo.id,
                    'group_id', oo.menu_group_id,
                    'group_name', oo.group_name,
                    'group_kind', oo.group_kind,
                    'option_id', oo.menu_option_id,
                    'option_name', oo.option_name,
                    'price_delta', oo.price_delta::text
                  )
                  order by oo.created_at, oo.id
                ),
                '[]'::jsonb
              )
              from public.order_item_options as oo
              where oo.order_item_id = oi.id
            )
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

-- 17) Checkout: itens aceitam options (somente IDs de snapshot).
--     O servidor valida pertinencia produto/grupo/versao, regras
--     min/max/single/multiple, disponibilidade, duplicidade e calcula
--     final_unit_price. O navegador nunca envia preco autoritativo.
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
  v_selected_ids uuid[] := array[]::uuid[];
  v_opt jsonb;
  v_option_id uuid;
  v_sel_options jsonb := '[]'::jsonb;
  v_available boolean;
  v_missing integer;
  v_wrong_product integer;
  v_unavailable_flag uuid;
  v_sel_count integer;
  v_delta_sum numeric := 0;
  v_final_unit_price numeric := 0;
  v_fingerprint text;
  v_item_key text;
  v_seen_keys text[] := array[]::text[];
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
  v_attempt integer;
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
      'notes', 'cash_change_for'
    )
  ) then
    raise exception 'INVALID_CART' using errcode = 'PED37';
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

  -- Itens estritos: menu_item_id, quantity inteiro JSON, note opcional
  -- e options (somente IDs de snapshot de opcoes).
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
      where k.key not in ('menu_item_id', 'quantity', 'note', 'options')
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

    -- Options: array de strings (IDs de snapshot), maximo 50, cada
    -- opcao no maximo uma vez.
    v_selected_ids := array[]::uuid[];
    if v_item ? 'options' and jsonb_typeof(v_item -> 'options') <> 'null' then
      if jsonb_typeof(v_item -> 'options') <> 'array' then
        raise exception 'INVALID_CART' using errcode = 'PED37';
      end if;
      if jsonb_array_length(v_item -> 'options') > 50 then
        raise exception 'SELECTION_LIMIT_EXCEEDED' using errcode = 'PED77';
      end if;
      for v_opt in
        select entry2.value
        from jsonb_array_elements(v_item -> 'options') as entry2(value)
      loop
        if jsonb_typeof(v_opt) is distinct from 'string' then
          raise exception 'INVALID_CART' using errcode = 'PED37';
        end if;
        begin
          v_option_id := (v_opt #>> '{}')::uuid;
        exception when others then
          raise exception 'INVALID_CART' using errcode = 'PED37';
        end;
        if v_option_id is null then
          raise exception 'INVALID_CART' using errcode = 'PED37';
        end if;
        if v_option_id = any(v_selected_ids) then
          raise exception 'SELECTION_LIMIT_EXCEEDED' using errcode = 'PED77';
        end if;
        v_selected_ids := array_append(v_selected_ids, v_option_id);
      end loop;
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

    -- Validacao das opcoes selecionadas.
    if coalesce(array_length(v_selected_ids, 1), 0) > 0 then
      select count(*) into v_missing
      from unnest(v_selected_ids) as s(id)
      where not exists (
        select 1
        from public.menu_version_options as o
        where o.id = s.id
          and o.organization_id = v_publication.organization_id
          and o.unit_id = v_publication.unit_id
          and o.menu_version_id = v_menu_version_id
      );

      if v_missing > 0 then
        raise exception 'OPTION_NOT_FOUND' using errcode = 'PED74';
      end if;

      select count(*) into v_wrong_product
      from unnest(v_selected_ids) as s(id)
      join public.menu_version_options as o
        on o.id = s.id
       and o.organization_id = v_publication.organization_id
       and o.unit_id = v_publication.unit_id
       and o.menu_version_id = v_menu_version_id
      where o.menu_product_id is distinct from v_menu_item_id;

      if v_wrong_product > 0 then
        raise exception 'SELECTION_MENU_MISMATCH' using errcode = 'PED78';
      end if;

      -- Fonte ausente ou removida do catalogo e indisponivel.
      select 1 into v_unavailable_flag
      from unnest(v_selected_ids) as s(id)
      join public.menu_version_options as o
        on o.id = s.id
       and o.organization_id = v_publication.organization_id
       and o.unit_id = v_publication.unit_id
       and o.menu_version_id = v_menu_version_id
       and o.menu_product_id = v_menu_item_id
      where o.source_option_id is null
         or not exists (
           select 1
           from public.catalog_product_options as co2
           where co2.id = o.source_option_id
             and co2.organization_id = o.organization_id
             and co2.unit_id = o.unit_id
         )
      limit 1;

      if v_unavailable_flag is not null then
        raise exception 'OPTION_UNAVAILABLE' using errcode = 'PED75';
      end if;

      -- Disponibilidade overlay serializada por FOR SHARE no catalogo.
      select 1 into v_unavailable_flag
      from unnest(v_selected_ids) as s(id)
      join public.menu_version_options as o
        on o.id = s.id
       and o.organization_id = v_publication.organization_id
       and o.unit_id = v_publication.unit_id
       and o.menu_version_id = v_menu_version_id
       and o.menu_product_id = v_menu_item_id
      join public.catalog_product_options as co
        on co.id = o.source_option_id
       and co.organization_id = o.organization_id
       and co.unit_id = o.unit_id
      where co.is_available = false
      limit 1
      for share of co;

      if v_unavailable_flag is not null then
        raise exception 'OPTION_UNAVAILABLE' using errcode = 'PED75';
      end if;

      -- Carrega regras e deltas das opcoes selecionadas.
      v_sel_options := '[]'::jsonb;
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'menu_group_id', g.id,
            'group_min', g.min_select,
            'group_max', g.max_select,
            'price_delta', o.price_delta
          )
        ),
        '[]'::jsonb
      ) into v_sel_options
      from unnest(v_selected_ids) as s(id)
      join public.menu_version_options as o
        on o.id = s.id
       and o.organization_id = v_publication.organization_id
       and o.unit_id = v_publication.unit_id
       and o.menu_version_id = v_menu_version_id
       and o.menu_product_id = v_menu_item_id
      join public.menu_version_option_groups as g
        on g.id = o.menu_group_id
       and g.organization_id = o.organization_id
       and g.unit_id = o.unit_id
       and g.menu_version_id = o.menu_version_id
       and g.menu_product_id = o.menu_product_id;

      if jsonb_array_length(v_sel_options) <> coalesce(array_length(v_selected_ids, 1), 0) then
        raise exception 'OPTION_NOT_FOUND' using errcode = 'PED74';
      end if;

      -- Regras min/max por grupo.
      select count(*) into v_sel_count
      from (
        select (entry.value ->> 'menu_group_id')::uuid as menu_group_id, count(*) as c
        from jsonb_array_elements(v_sel_options) as entry(value)
        group by (entry.value ->> 'menu_group_id')::uuid
      ) as x
      join (
        select distinct
          (entry.value ->> 'menu_group_id')::uuid as menu_group_id,
          (entry.value ->> 'group_min')::integer as group_min
        from jsonb_array_elements(v_sel_options) as entry(value)
      ) as g on g.menu_group_id = x.menu_group_id
      where x.c < g.group_min;

      if v_sel_count > 0 then
        raise exception 'SELECTION_REQUIRED' using errcode = 'PED76';
      end if;

      select count(*) into v_sel_count
      from (
        select (entry.value ->> 'menu_group_id')::uuid as menu_group_id, count(*) as c
        from jsonb_array_elements(v_sel_options) as entry(value)
        group by (entry.value ->> 'menu_group_id')::uuid
      ) as x
      join (
        select distinct
          (entry.value ->> 'menu_group_id')::uuid as menu_group_id,
          (entry.value ->> 'group_max')::integer as group_max
        from jsonb_array_elements(v_sel_options) as entry(value)
      ) as g on g.menu_group_id = x.menu_group_id
      where x.c > g.group_max;

      if v_sel_count > 0 then
        raise exception 'SELECTION_LIMIT_EXCEEDED' using errcode = 'PED77';
      end if;

      select coalesce(sum((entry.value ->> 'price_delta')::numeric), 0) into v_delta_sum
      from jsonb_array_elements(v_sel_options) as entry(value);
    else
      v_delta_sum := 0;
    end if;

    v_final_unit_price := v_menu_item.price + v_delta_sum;
    if v_final_unit_price < 0.01 then
      raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
    end if;
    if v_final_unit_price > 9999999999.99 then
      raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
    end if;

    v_line_total := v_final_unit_price * v_quantity;
    if v_line_total > 9999999999.99 then
      raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
    end if;
    v_subtotal := v_subtotal + v_line_total;
    if v_subtotal > 9999999999.99 then
      raise exception 'ORDER_AMOUNT_OVERFLOW' using errcode = 'PED50';
    end if;

    -- Fingerprint calculado somente no servidor; linha identica nao
    -- pode repetir; produto com configuracoes distintas pode.
    v_fingerprint := public._options_fingerprint(v_selected_ids);
    v_item_key := v_menu_item_id::text || ':' || v_fingerprint;
    if v_item_key = any(v_seen_keys) then
      raise exception 'INVALID_CART' using errcode = 'PED37';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_item_key);

    v_cart := v_cart || jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'quantity', v_quantity,
      'note', v_item_note,
      'unit_price', v_final_unit_price,
      'options_fingerprint', v_fingerprint,
      'options', to_jsonb(v_selected_ids)
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
        customer_name, customer_phone,
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
        v_customer_name, v_customer_phone,
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
    menu_item_id, product_name, unit_price, quantity, line_total, note,
    options_fingerprint
  )
  select
    v_order.organization_id,
    v_order.unit_id,
    v_order.id,
    v_order.menu_version_id,
    mp.id,
    mp.name,
    (entry.value ->> 'unit_price')::numeric,
    (entry.value ->> 'quantity')::integer,
    (entry.value ->> 'unit_price')::numeric * (entry.value ->> 'quantity')::integer,
    entry.value ->> 'note',
    entry.value ->> 'options_fingerprint'
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

  -- Snapshot das opcoes por linha (append-only).
  insert into public.order_item_options (
    organization_id, unit_id, order_id, order_item_id, menu_version_id,
    menu_item_id, menu_group_id, group_name, group_kind,
    menu_option_id, option_name, price_delta
  )
  select
    o.organization_id, o.unit_id, v_order.id, oi.id,
    o.menu_version_id, o.menu_product_id, o.menu_group_id,
    g.name, g.kind, o.id, o.name, o.price_delta
  from jsonb_array_elements(v_cart) as entry(value)
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(entry.value -> 'options') = 'array'
        then entry.value -> 'options'
      else '[]'::jsonb
    end
  ) as opt(id)
  join public.menu_version_options as o
    on o.id = (opt.id #>> '{}')::uuid
   and o.organization_id = v_order.organization_id
   and o.unit_id = v_order.unit_id
   and o.menu_version_id = v_order.menu_version_id
   and o.menu_product_id = (entry.value ->> 'menu_item_id')::uuid
  join public.menu_version_option_groups as g
    on g.id = o.menu_group_id
  join public.order_items as oi
    on oi.order_id = v_order.id
   and oi.menu_item_id = o.menu_product_id
   and oi.options_fingerprint = (entry.value ->> 'options_fingerprint');

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

revoke all on function public.create_public_order(text, uuid, jsonb)
  from public;
grant execute on function public.create_public_order(text, uuid, jsonb)
  to anon, authenticated;
