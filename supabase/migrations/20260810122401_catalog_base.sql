-- =============================================================
-- PED-ON — Catálogo base por unidade.
-- Categorias e produtos são ordenados e escritos exclusivamente
-- por RPCs server-authoritative; leitura respeita o acesso à unidade.
-- =============================================================

-- 1) Categorias do catálogo. A chave composta preserva tenant e
--    unidade nas referências feitas pelos produtos.
create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  name text not null,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_categories_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint catalog_categories_unit_fk
    foreign key (organization_id, unit_id)
    references public.units (organization_id, id)
    on delete cascade,
  constraint catalog_categories_organization_unit_id_key
    unique (organization_id, unit_id, id)
);

create unique index catalog_categories_unit_name_key
  on public.catalog_categories (organization_id, unit_id, lower(btrim(name)));

create index catalog_categories_unit_order_idx
  on public.catalog_categories (organization_id, unit_id, sort_order, id);

alter table public.catalog_categories enable row level security;

create trigger set_catalog_categories_updated_at
before update on public.catalog_categories
for each row execute function public.set_updated_at();

-- 2) Produtos pertencem obrigatoriamente a uma categoria da mesma
--    organização e unidade. Preço usa decimal exato, nunca float.
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  category_id uuid not null,
  name text not null,
  description text,
  price numeric(12, 2) not null,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_products_name_check
    check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint catalog_products_description_check
    check (
      description is null
      or (description = btrim(description) and char_length(description) between 1 and 500)
    ),
  constraint catalog_products_price_check
    check (price > 0 and price <= 9999999999.99),
  constraint catalog_products_unit_fk
    foreign key (organization_id, unit_id)
    references public.units (organization_id, id)
    on delete cascade,
  constraint catalog_products_category_fk
    foreign key (organization_id, unit_id, category_id)
    references public.catalog_categories (organization_id, unit_id, id)
    on delete cascade,
  constraint catalog_products_organization_unit_id_key
    unique (organization_id, unit_id, id)
);

create index catalog_products_category_order_idx
  on public.catalog_products (organization_id, unit_id, category_id, sort_order, id);

alter table public.catalog_products enable row level security;

create trigger set_catalog_products_updated_at
before update on public.catalog_products
for each row execute function public.set_updated_at();

-- 3) RLS: somente identidades autenticadas com acesso efetivo à
--    unidade veem linhas. anon recebe conjunto vazio.
create policy "catalog_categories_select_unit_access" on public.catalog_categories
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "catalog_products_select_unit_access" on public.catalog_products
  for select to authenticated
  using (public.can_access_unit(unit_id));

revoke all on table public.catalog_categories from public, anon, authenticated;
revoke all on table public.catalog_products from public, anon, authenticated;
grant select on public.catalog_categories to authenticated, anon;
grant select on public.catalog_products to authenticated, anon;

-- 4) Helper interno para preço textual. O formato deliberadamente
--    rejeita expoente, sinais, NaN, Infinity e separador por vírgula.
create function public._validate_catalog_price(p_price text)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_text text := btrim(p_price);
  v_price numeric;
begin
  if v_text is null or v_text !~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' then
    raise exception 'INVALID_PRICE' using errcode = 'PED28';
  end if;

  begin
    v_price := v_text::numeric;
  exception when others then
    raise exception 'INVALID_PRICE' using errcode = 'PED28';
  end;

  if v_price <= 0 or v_price > 9999999999.99 then
    raise exception 'INVALID_PRICE' using errcode = 'PED28';
  end if;

  return v_price;
end;
$$;

revoke all on function public._validate_catalog_price(text) from public, anon, authenticated;

-- 5) Leitura administrativa completa. Inclui categorias e produtos
--    inativos; unidade inativa continua acessível conforme o RBAC atual.
create function public.get_unit_catalog_admin(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_role text;
  v_can_manage boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_unit
  from public.units u
  where u.id = p_unit_id;

  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;

  if not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select om.role into v_role
  from public.organization_members om
  where om.organization_id = v_unit.organization_id
    and om.user_id = auth.uid();

  v_can_manage := public.can_manage_unit(p_unit_id);

  return jsonb_build_object(
    'unit', jsonb_build_object('id', v_unit.id, 'name', v_unit.name),
    'can_manage', v_can_manage,
    'role', v_role,
    'categories', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'sort_order', c.sort_order,
            'is_active', c.is_active,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'products', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', p.id,
                    'category_id', p.category_id,
                    'name', p.name,
                    'description', p.description,
                    'price', p.price::text,
                    'sort_order', p.sort_order,
                    'is_active', p.is_active,
                    'is_available', p.is_available,
                    'created_at', p.created_at,
                    'updated_at', p.updated_at
                  )
                  order by p.sort_order, p.id
                ),
                '[]'::jsonb
              )
              from public.catalog_products p
              where p.organization_id = c.organization_id
                and p.unit_id = c.unit_id
                and p.category_id = c.id
            )
          )
          order by c.sort_order, c.id
        ),
        '[]'::jsonb
      )
      from public.catalog_categories c
      where c.organization_id = v_unit.organization_id
        and c.unit_id = v_unit.id
    )
  );
end;
$$;

revoke all on function public.get_unit_catalog_admin(uuid) from public, anon;
grant execute on function public.get_unit_catalog_admin(uuid) to authenticated;

-- Contrato de erros do catálogo:
-- PED20 CATEGORY_NOT_FOUND       | PED21 CATEGORY_NAME_REQUIRED
-- PED22 CATEGORY_NAME_TOO_LONG   | PED23 CATEGORY_NAME_CONFLICT
-- PED24 PRODUCT_NOT_FOUND        | PED25 PRODUCT_NAME_REQUIRED
-- PED26 PRODUCT_NAME_TOO_LONG    | PED27 DESCRIPTION_TOO_LONG
-- PED28 INVALID_PRICE            | PED29 CATEGORY_UNIT_MISMATCH
-- PED30 INVALID_CATALOG_FLAG

-- 6) Categorias: owner ou manager da unidade.
create function public.create_catalog_category(p_unit_id uuid, p_name text)
returns public.catalog_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_name text := nullif(btrim(p_name), '');
  v_sort_order integer;
  v_category public.catalog_categories;
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
  if v_name is null then
    raise exception 'CATEGORY_NAME_REQUIRED' using errcode = 'PED21';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'CATEGORY_NAME_TOO_LONG' using errcode = 'PED22';
  end if;

  perform pg_advisory_xact_lock(hashtext('pedon:catalog:categories:unit:' || p_unit_id::text));
  select coalesce(max(c.sort_order), 0) + 100 into v_sort_order
  from public.catalog_categories c
  where c.organization_id = v_unit.organization_id
    and c.unit_id = p_unit_id;

  begin
    insert into public.catalog_categories (
      organization_id, unit_id, name, sort_order
    ) values (
      v_unit.organization_id, p_unit_id, v_name, v_sort_order
    )
    returning * into v_category;
  exception when unique_violation then
    raise exception 'CATEGORY_NAME_CONFLICT' using errcode = 'PED23';
  end;

  return v_category;
end;
$$;

revoke all on function public.create_catalog_category(uuid, text) from public, anon;
grant execute on function public.create_catalog_category(uuid, text) to authenticated;

create function public.update_catalog_category(p_category_id uuid, p_name text)
returns public.catalog_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.catalog_categories;
  v_name text := nullif(btrim(p_name), '');
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_category
  from public.catalog_categories c
  where c.id = p_category_id;
  if v_category is null then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'PED20';
  end if;
  if not public.can_manage_unit(v_category.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if v_name is null then
    raise exception 'CATEGORY_NAME_REQUIRED' using errcode = 'PED21';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'CATEGORY_NAME_TOO_LONG' using errcode = 'PED22';
  end if;

  begin
    update public.catalog_categories
    set name = v_name
    where id = p_category_id
      and organization_id = v_category.organization_id
      and unit_id = v_category.unit_id
    returning * into v_category;
  exception when unique_violation then
    raise exception 'CATEGORY_NAME_CONFLICT' using errcode = 'PED23';
  end;

  return v_category;
end;
$$;

revoke all on function public.update_catalog_category(uuid, text) from public, anon;
grant execute on function public.update_catalog_category(uuid, text) to authenticated;

create function public.set_catalog_category_active(p_category_id uuid, p_is_active boolean)
returns public.catalog_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.catalog_categories;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_category
  from public.catalog_categories c
  where c.id = p_category_id;
  if v_category is null then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'PED20';
  end if;
  if not public.can_manage_unit(v_category.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if p_is_active is null then
    raise exception 'INVALID_CATALOG_FLAG' using errcode = 'PED30';
  end if;

  update public.catalog_categories
  set is_active = p_is_active
  where id = p_category_id
    and organization_id = v_category.organization_id
    and unit_id = v_category.unit_id
  returning * into v_category;

  return v_category;
end;
$$;

revoke all on function public.set_catalog_category_active(uuid, boolean) from public, anon;
grant execute on function public.set_catalog_category_active(uuid, boolean) to authenticated;

-- 7) Produtos: estrutura por owner/manager; ordenação é calculada
--    sob lock da categoria de destino.
create function public.create_catalog_product(
  p_unit_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price text
)
returns public.catalog_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_category public.catalog_categories;
  v_name text := nullif(btrim(p_name), '');
  v_description text := nullif(btrim(p_description), '');
  v_price numeric;
  v_sort_order integer;
  v_product public.catalog_products;
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

  select * into v_category
  from public.catalog_categories c
  where c.id = p_category_id
    and c.organization_id = v_unit.organization_id
    and c.unit_id = p_unit_id;
  if v_category is null then
    raise exception 'CATEGORY_UNIT_MISMATCH' using errcode = 'PED29';
  end if;
  if v_name is null then
    raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'PED25';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'PRODUCT_NAME_TOO_LONG' using errcode = 'PED26';
  end if;
  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'DESCRIPTION_TOO_LONG' using errcode = 'PED27';
  end if;
  v_price := public._validate_catalog_price(p_price);

  perform pg_advisory_xact_lock(hashtext('pedon:catalog:products:category:' || p_category_id::text));
  select coalesce(max(p.sort_order), 0) + 100 into v_sort_order
  from public.catalog_products p
  where p.organization_id = v_unit.organization_id
    and p.unit_id = p_unit_id
    and p.category_id = p_category_id;

  insert into public.catalog_products (
    organization_id, unit_id, category_id, name, description, price, sort_order
  ) values (
    v_unit.organization_id, p_unit_id, p_category_id, v_name, v_description, v_price, v_sort_order
  )
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.create_catalog_product(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.create_catalog_product(uuid, uuid, text, text, text)
  to authenticated;

create function public.update_catalog_product(
  p_product_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price text
)
returns public.catalog_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.catalog_products;
  v_target_category public.catalog_categories;
  v_name text := nullif(btrim(p_name), '');
  v_description text := nullif(btrim(p_description), '');
  v_price numeric;
  v_sort_order integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_product
  from public.catalog_products p
  where p.id = p_product_id;
  if v_product is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'PED24';
  end if;
  if not public.can_manage_unit(v_product.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select * into v_target_category
  from public.catalog_categories c
  where c.id = p_category_id
    and c.organization_id = v_product.organization_id
    and c.unit_id = v_product.unit_id;
  if v_target_category is null then
    raise exception 'CATEGORY_UNIT_MISMATCH' using errcode = 'PED29';
  end if;
  if v_name is null then
    raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'PED25';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'PRODUCT_NAME_TOO_LONG' using errcode = 'PED26';
  end if;
  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'DESCRIPTION_TOO_LONG' using errcode = 'PED27';
  end if;
  v_price := public._validate_catalog_price(p_price);

  if p_category_id = v_product.category_id then
    v_sort_order := v_product.sort_order;
  else
    perform pg_advisory_xact_lock(
      hashtext('pedon:catalog:products:category:' || p_category_id::text)
    );
    select coalesce(max(p.sort_order), 0) + 100 into v_sort_order
    from public.catalog_products p
    where p.organization_id = v_product.organization_id
      and p.unit_id = v_product.unit_id
      and p.category_id = p_category_id;
  end if;

  update public.catalog_products
  set category_id = p_category_id,
      name = v_name,
      description = v_description,
      price = v_price,
      sort_order = v_sort_order
  where id = p_product_id
    and organization_id = v_product.organization_id
    and unit_id = v_product.unit_id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.update_catalog_product(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.update_catalog_product(uuid, uuid, text, text, text)
  to authenticated;

create function public.set_catalog_product_active(p_product_id uuid, p_is_active boolean)
returns public.catalog_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.catalog_products;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_product
  from public.catalog_products p
  where p.id = p_product_id;
  if v_product is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'PED24';
  end if;
  if not public.can_manage_unit(v_product.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if p_is_active is null then
    raise exception 'INVALID_CATALOG_FLAG' using errcode = 'PED30';
  end if;

  update public.catalog_products
  set is_active = p_is_active
  where id = p_product_id
    and organization_id = v_product.organization_id
    and unit_id = v_product.unit_id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.set_catalog_product_active(uuid, boolean) from public, anon;
grant execute on function public.set_catalog_product_active(uuid, boolean) to authenticated;

-- 8) Disponibilidade operacional: owner, manager ou operator com
--    acesso à unidade. Não altera o estado estrutural do produto.
create function public.set_catalog_product_available(p_product_id uuid, p_is_available boolean)
returns public.catalog_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.catalog_products;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_product
  from public.catalog_products p
  where p.id = p_product_id;
  if v_product is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'PED24';
  end if;
  if not public.can_access_unit(v_product.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;
  if p_is_available is null then
    raise exception 'INVALID_CATALOG_FLAG' using errcode = 'PED30';
  end if;

  update public.catalog_products
  set is_available = p_is_available
  where id = p_product_id
    and organization_id = v_product.organization_id
    and unit_id = v_product.unit_id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.set_catalog_product_available(uuid, boolean) from public, anon;
grant execute on function public.set_catalog_product_available(uuid, boolean) to authenticated;
