-- =============================================================
-- PED-ON — Versionamento, publicação imutável e cardápio público.
-- O catálogo administrativo mutável (catalog_categories /
-- catalog_products) continua sendo a fonte; cada publicação cria
-- um snapshot comercial imutável (menu_versions + categorias +
-- produtos) e uma ponte menu_publications aponta a versão CURRENT.
-- Leitura pública anônima ocorre exclusivamente via get_public_menu
-- (security definer); anon não lê nenhuma tabela diretamente.
-- =============================================================

-- 1) Versões imutáveis do cardápio por unidade. version_number é
--    sempre derivado no servidor; a versão nunca é editada pela
--    aplicação depois de criada.
create table public.menu_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  version_number integer not null check (version_number > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint menu_versions_unit_fk
    foreign key (organization_id, unit_id)
    references public.units (organization_id, id)
    on delete cascade,
  constraint menu_versions_created_by_fk
    foreign key (created_by)
    references auth.users (id)
    on delete set null,
  constraint menu_versions_unit_number_key
    unique (unit_id, version_number),
  constraint menu_versions_organization_unit_id_key
    unique (organization_id, unit_id, id)
);

create index menu_versions_unit_number_idx
  on public.menu_versions (unit_id, version_number desc);

alter table public.menu_versions enable row level security;

-- 2) Categorias em snapshot. source_category_id é somente metadado
--    interno de rastreabilidade; nunca é retornado publicamente.
create table public.menu_version_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  menu_version_id uuid not null,
  source_category_id uuid,
  name text not null,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  constraint menu_version_categories_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint menu_version_categories_version_fk
    foreign key (organization_id, unit_id, menu_version_id)
    references public.menu_versions (organization_id, unit_id, id)
    on delete cascade,
  constraint menu_version_categories_organization_version_id_key
    unique (organization_id, unit_id, menu_version_id, id)
);

create index menu_version_categories_order_idx
  on public.menu_version_categories (menu_version_id, sort_order, id);

alter table public.menu_version_categories enable row level security;

-- 3) Produtos em snapshot. source_product_id é somente vínculo
--    interno para o overlay dinâmico de disponibilidade; não é
--    retornado publicamente.
create table public.menu_version_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  menu_version_id uuid not null,
  menu_category_id uuid not null,
  source_product_id uuid,
  name text not null,
  description text,
  price numeric(12, 2) not null,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  constraint menu_version_products_name_check
    check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint menu_version_products_description_check
    check (
      description is null
      or (description = btrim(description) and char_length(description) between 1 and 500)
    ),
  constraint menu_version_products_price_check
    check (price > 0 and price <= 9999999999.99),
  constraint menu_version_products_version_fk
    foreign key (organization_id, unit_id, menu_version_id)
    references public.menu_versions (organization_id, unit_id, id)
    on delete cascade,
  constraint menu_version_products_category_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_category_id)
    references public.menu_version_categories (organization_id, unit_id, menu_version_id, id)
    on delete cascade
);

create index menu_version_products_order_idx
  on public.menu_version_products (menu_version_id, menu_category_id, sort_order, id);

alter table public.menu_version_products enable row level security;

-- 4) Ponte de publicação: no máximo uma linha por unidade apontando
--    para a versão CURRENT. O slug público é opaco, estável e
--    persistido na primeira publicação.
create table public.menu_publications (
  organization_id uuid not null,
  unit_id uuid primary key,
  public_slug text not null,
  current_menu_version_id uuid not null,
  published_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint menu_publications_slug_key unique (public_slug),
  constraint menu_publications_unit_fk
    foreign key (organization_id, unit_id)
    references public.units (organization_id, id)
    on delete cascade,
  constraint menu_publications_version_fk
    foreign key (organization_id, unit_id, current_menu_version_id)
    references public.menu_versions (organization_id, unit_id, id)
);

alter table public.menu_publications enable row level security;

create trigger set_menu_publications_updated_at
before update on public.menu_publications
for each row execute function public.set_updated_at();

-- 5) RLS de leitura administrativa: somente identidades autenticadas
--    com acesso efetivo à unidade. anon não recebe SELECT em nenhuma
--    das quatro tabelas; sem policies de escrita em nenhum caso.
create policy "menu_versions_select_unit_access" on public.menu_versions
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "menu_version_categories_select_unit_access" on public.menu_version_categories
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "menu_version_products_select_unit_access" on public.menu_version_products
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "menu_publications_select_unit_access" on public.menu_publications
  for select to authenticated
  using (public.can_access_unit(unit_id));

revoke all on table public.menu_versions from public, anon, authenticated;
revoke all on table public.menu_version_categories from public, anon, authenticated;
revoke all on table public.menu_version_products from public, anon, authenticated;
revoke all on table public.menu_publications from public, anon, authenticated;
grant select on public.menu_versions to authenticated;
grant select on public.menu_version_categories to authenticated;
grant select on public.menu_version_products to authenticated;
grant select on public.menu_publications to authenticated;

-- Contrato de erros do cardápio publicado:
-- PED10 NOT_AUTHENTICATED | PED11 FORBIDDEN | PED12 UNIT_NOT_FOUND
-- PED31 MENU_EMPTY        | PED32 PUBLICATION_CONFLICT (slug raro)

-- 6) Publicação server-authoritative. Em uma única transação:
--    valida autorização, serializa por unidade, captura um snapshot
--    coerente do catálogo estruturalmente ativo, cria a versão,
--    copia categorias e produtos elegíveis e atualiza a ponte.
--    Estratégia de coerência: a publicação adquire o advisory lock
--    de categorias da unidade (mesmo usado por create_catalog_category)
--    e o lock de produtos de cada categoria elegível (mesmo usado por
--    create/update_catalog_product), garantindo que a lista de
--    categorias e os produtos capturados sejam um estado consistente.
create function public.publish_unit_menu(p_unit_id uuid)
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

-- 7) Leitura administrativa: unidade, ponte atual, versão corrente e
--    histórico (somente leitura; sem rollback nesta fase).
create function public.get_unit_menu_publication_admin(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_pub public.menu_publications;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_unit from public.units u where u.id = p_unit_id;
  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;
  if not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select * into v_pub from public.menu_publications where unit_id = p_unit_id;

  return jsonb_build_object(
    'unit', jsonb_build_object(
      'id', v_unit.id,
      'name', v_unit.name,
      'is_active', v_unit.is_active
    ),
    'publication', jsonb_build_object(
      'exists', v_pub is not null,
      'public_slug', v_pub.public_slug,
      'public_path', case when v_pub is null then null else '/menu/' || v_pub.public_slug end,
      'published_at', v_pub.published_at,
      'updated_at', v_pub.updated_at
    ),
    'current_version', case when v_pub is null then null else jsonb_build_object(
      'version_id', v_pub.current_menu_version_id,
      'version_number', (
        select version_number from public.menu_versions
        where id = v_pub.current_menu_version_id
      ),
      'created_at', (
        select created_at from public.menu_versions
        where id = v_pub.current_menu_version_id
      ),
      'category_count', (
        select count(*) from public.menu_version_categories
        where menu_version_id = v_pub.current_menu_version_id
      ),
      'product_count', (
        select count(*) from public.menu_version_products
        where menu_version_id = v_pub.current_menu_version_id
      ),
      'is_current', true
    ) end,
    'history', (
      select coalesce(
        jsonb_agg(row order by (row ->> 'version_number')::integer desc),
        '[]'::jsonb
      )
      from (
        select jsonb_build_object(
          'version_id', v.id,
          'version_number', v.version_number,
          'created_at', v.created_at,
          'category_count', (
            select count(*) from public.menu_version_categories c
            where c.menu_version_id = v.id
          ),
          'product_count', (
            select count(*) from public.menu_version_products p
            where p.menu_version_id = v.id
          ),
          'is_current', v.id = v_pub.current_menu_version_id
        ) as row
        from public.menu_versions v
        where v.unit_id = p_unit_id
        order by v.version_number desc
        limit 50
      ) t
    )
  );
end;
$$;

revoke all on function public.get_unit_menu_publication_admin(uuid) from public, anon;
grant execute on function public.get_unit_menu_publication_admin(uuid) to authenticated;

-- 8) Leitura pública anônima via slug opaco. Não exige sessão e
--    retorna found=false para slug ausente/inválido em vez de erro.
--    Combina o snapshot comercial imutável com o overlay dinâmico de
--    disponibilidade (somente catalog_products.is_available via
--    source_product_id); preço, nome, descrição, categoria e ordem
--    publicados vêm exclusivamente da versão.
create function public.get_public_menu(p_public_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(p_public_slug), '');
  v_pub public.menu_publications;
  v_unit public.units;
  v_org public.organizations;
  v_settings public.unit_operational_settings;
  v_accepting boolean;
begin
  if v_slug is null or v_slug !~ '^[a-f0-9]{24}$' then
    return jsonb_build_object('found', false);
  end if;

  select * into v_pub from public.menu_publications where public_slug = v_slug;
  if v_pub is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_unit from public.units u where u.id = v_pub.unit_id;
  select * into v_org from public.organizations o where o.id = v_pub.organization_id;

  if v_unit is null or v_org is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_settings
  from public.unit_operational_settings s
  where s.unit_id = v_pub.unit_id;

  v_accepting := v_unit.is_active and coalesce(v_settings.accepting_orders, false);

  return jsonb_build_object(
    'found', true,
    'organization', jsonb_build_object('name', v_org.name),
    'unit', jsonb_build_object(
      'name', v_unit.name,
      'is_active', v_unit.is_active
    ),
    'menu', jsonb_build_object(
      'version_id', v_pub.current_menu_version_id,
      'version_number', (
        select version_number from public.menu_versions
        where id = v_pub.current_menu_version_id
      ),
      'published_at', v_pub.published_at
    ),
    'operation', jsonb_build_object(
      'configured', v_settings is not null,
      'accepting_orders', v_accepting,
      'pickup_enabled', coalesce(v_settings.pickup_enabled, true),
      'delivery_enabled', coalesce(v_settings.delivery_enabled, false),
      'delivery_fee', coalesce(v_settings.delivery_fee, 0)::text,
      'minimum_order_amount', coalesce(v_settings.min_order_value, 0)::text,
      'estimated_pickup_minutes', v_settings.estimated_pickup_minutes,
      'estimated_delivery_minutes', v_settings.estimated_delivery_minutes,
      'payment_methods', (
        select jsonb_agg(
          jsonb_build_object(
            'method', m.method,
            'is_enabled', coalesce(pm.is_enabled, false)
          )
          order by m.ord
        )
        from (values
          (1, 'cash'),
          (2, 'pix'),
          (3, 'credit_card'),
          (4, 'debit_card')
        ) as m(ord, method)
        left join public.unit_payment_methods pm
          on pm.unit_id = v_pub.unit_id
         and pm.method = m.method
      ),
      'business_hours', (
        select jsonb_agg(
          jsonb_build_object(
            'weekday', w.day,
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
          order by w.day
        )
        from generate_series(0, 6) as w(day)
        left join public.unit_business_hours h
          on h.unit_id = v_pub.unit_id
         and h.weekday = w.day
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
                        from public.catalog_products cp
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
              from public.menu_version_products p
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
      from public.menu_version_categories c
      where c.organization_id = v_pub.organization_id
        and c.unit_id = v_pub.unit_id
        and c.menu_version_id = v_pub.current_menu_version_id
    )
  );
end;
$$;

revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
