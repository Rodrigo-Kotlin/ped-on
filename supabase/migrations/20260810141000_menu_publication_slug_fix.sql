-- Correção da geração do slug público da publicação.
-- A primeira versão da migration usava encode(gen_random_bytes(12), 'hex'),
-- que resolve apenas no schema `extensions` (pgcrypto), fora do
-- search_path vazio das funções security definer. A função passava a
-- falhar em PED32 em tempo de execução (erro de resolução de função).
-- Corrige usando gen_random_uuid() (pg_catalog, sempre disponível) e
-- re-cria somente a função publish_unit_menu; o restante do contrato
-- permanece idêntico.
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
  v_categories record;
  v_category_id uuid;
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
    'product_count', v_product_count
  );
end;
$$;

revoke all on function public.publish_unit_menu(uuid) from public, anon;
grant execute on function public.publish_unit_menu(uuid) to authenticated;
