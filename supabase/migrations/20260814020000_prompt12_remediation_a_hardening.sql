-- =============================================================
-- PED-ON — Prompt 12 Remediation A - integridade do backend e
-- serializacao da publicacao.
-- Corrige HIGH-1 (grupo obrigatorio insatisfazivel na publicacao) e
-- HIGH-2 (publicacao nao serializada com writers estruturais do
-- catalogo), adota uma disciplina unica de locks estruturais por
-- unidade e fecha a lacuna relacional de order_item_options.
-- =============================================================

-- 1) Lock estrutural unit-scoped compartilhado por todos os writers
--    estruturais do catalogo e por publish_unit_menu. Adquirido
--    SEMPRE em primeiro lugar, antes de qualquer lock por categoria,
--    produto ou grupo/opcao, garantindo ordem canonica e sem deadlock.
create function public._lock_unit_structure(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext('pedon:catalog:structure:' || p_unit_id::text)
  );
end;
$$;

revoke all on function public._lock_unit_structure(uuid) from public, anon, authenticated;

-- 2) Writers de categoria entram na disciplina de locks: unit
--    structure lock primeiro, depois os demais locks.
create or replace function public.create_catalog_category(p_unit_id uuid, p_name text)
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

  perform public._lock_unit_structure(p_unit_id);
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

create or replace function public.update_catalog_category(p_category_id uuid, p_name text)
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

  perform public._lock_unit_structure(v_category.unit_id);

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

create or replace function public.set_catalog_category_active(p_category_id uuid, p_is_active boolean)
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

  perform public._lock_unit_structure(v_category.unit_id);

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

-- 3) Writers de produto entram na disciplina de locks.
create or replace function public.create_catalog_product(
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

  perform public._lock_unit_structure(p_unit_id);

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

create or replace function public.update_catalog_product(
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

  perform public._lock_unit_structure(v_product.unit_id);

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

create or replace function public.set_catalog_product_active(p_product_id uuid, p_is_active boolean)
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

  perform public._lock_unit_structure(v_product.unit_id);

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

-- 4) Trigger de mutacoes estruturais de grupos/opcoes: adquire o lock
--    estrutural da(s) unidade(s) afetada(s) ANTES dos locks por
--    produto, na mesma disciplina de publish_unit_menu. O prefixo
--    `a_` mantem o lock anterior a qualquer outro trigger BEFORE.
create or replace function public._lock_product_option_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_old_product_id uuid;
  v_new_product_id uuid;
  v_destination_product_id uuid;
  v_unit_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_product_id := old.product_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_product_id := new.product_id;
  end if;

  if tg_table_name = 'catalog_product_options' and tg_op <> 'DELETE' then
    select g.product_id into v_destination_product_id
    from public.catalog_product_option_groups as g
    where g.id = ((to_jsonb(new) ->> 'group_id')::uuid);
  end if;

  for v_unit_id in
    select distinct p.unit_id
    from public.catalog_products as p
    join unnest(array[
      v_old_product_id,
      v_new_product_id,
      v_destination_product_id
    ]) as affected(product_id)
      on affected.product_id = p.id
    where affected.product_id is not null
    order by p.unit_id
  loop
    perform public._lock_unit_structure(v_unit_id);
  end loop;

  for v_product_id in
    select distinct affected.product_id
    from unnest(array[
      v_old_product_id,
      v_new_product_id,
      v_destination_product_id
    ]) as affected(product_id)
    where affected.product_id is not null
    order by affected.product_id
  loop
    perform pg_advisory_xact_lock(
      hashtext('pedon:catalog:option-groups:product:' || v_product_id::text)
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public._lock_product_option_structure()
  from public, anon, authenticated;

-- 5) Publish: entra na disciplina de locks e passa a exigir regras
--    de selecao satisfaziveis (HIGH-1). Um grupo obrigatorio ativo
--    (min_select > 0) de produto ativo em categoria ativa precisa de
--    opcoes estruturais ativas suficientes; regra insatisfazivel
--    aborta a publicacao por completo, sem versao parcial, e a
--    versao anterior permanece vigente.
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
  v_required_violations integer := 0;
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

  -- Disciplina unica de locks: estrutura da unidade PRIMEIRO, depois
  -- categorias e publicacao. Checkout continua no lock de publicacao
  -- em modo compartilhado.
  perform public._lock_unit_structure(p_unit_id);
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

  -- HIGH-1: grupo obrigatorio ativo (min_select > 0) de produto ativo
  -- em categoria ativa deve ter opcoes estruturais ativas suficientes.
  -- Grupos opcionais (min_select = 0) podem ser omitidos do snapshot.
  select count(*) into v_required_violations
  from public.catalog_product_option_groups as g
  join public.catalog_products as p
    on p.id = g.product_id
   and p.organization_id = g.organization_id
   and p.unit_id = g.unit_id
  join public.catalog_categories as c
    on c.id = p.category_id
   and c.organization_id = p.organization_id
   and c.unit_id = p.unit_id
  where p.organization_id = v_unit.organization_id
    and p.unit_id = p_unit_id
    and p.is_active = true
    and c.is_active = true
    and g.is_active = true
    and g.min_select > 0
    and (
      select count(*)
      from public.catalog_product_options as o
      where o.organization_id = g.organization_id
        and o.unit_id = g.unit_id
        and o.group_id = g.id
        and o.is_active = true
    ) < g.min_select;

  if v_required_violations > 0 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
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

  -- Locks de grupos/opcoes por produto em ordem canonica ascendente,
  -- identica ao trigger _lock_product_option_structure (evita
  -- deadlock entre publish e mutacoes estruturais).
  for v_pub_product in
    select id, source_product_id
    from public.menu_version_products
    where menu_version_id = v_version.id
    order by source_product_id, id
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

-- 6) Vinculo relacional de order_item_options: cada opcao de snapshot
--    deve pertencer a MESMA linha de order_items (id, menu_version_id,
--    menu_item_id). Validacao read-only antes das DDLs: se qualquer
--    linha legada for inconsistente, a migration aborta sem alterar
--    nada e exige correcao previa.
do $$
declare
  v_violations integer;
begin
  select count(*) into v_violations
  from public.order_item_options as oio
  where not exists (
    select 1
    from public.order_items as oi
    where oi.id = oio.order_item_id
      and oi.organization_id = oio.organization_id
      and oi.unit_id = oio.unit_id
      and oi.order_id = oio.order_id
      and oi.menu_version_id = oio.menu_version_id
      and oi.menu_item_id = oio.menu_item_id
  );

  if v_violations > 0 then
    raise exception 'ORDER_ITEM_OPTIONS_BIND_VIOLATION'
      using message =
        'order_item_options inconsistente com order_items (' || v_violations || ' linha(s))';
  end if;
end;
$$;

alter table public.order_items
  add constraint order_items_id_menu_item_bind_key
  unique (id, menu_version_id, menu_item_id);

alter table public.order_item_options
  add constraint order_item_options_item_menu_bind_fk
  foreign key (order_item_id, menu_version_id, menu_item_id)
  references public.order_items (id, menu_version_id, menu_item_id)
  on delete cascade;
