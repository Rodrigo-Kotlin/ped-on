-- =============================================================
-- PED-ON - Prompt 13 - Etapa 2/6 - Backend Operational Core +
-- NEW-MEDIUM-1 hardening.
--
-- Conteudo:
--   1) NEW-MEDIUM-1 fix (Alternative B): os dois CREATE de
--      product options passam a adquirir _lock_unit_structure
--      ANTES do lock de produto, preservando a serializacao
--      necessaria ao calculo de sort_order.
--   2) get_unit_orders_admin_v2: filtros server-side multi-status
--      (service_mode, payment_status, payment_method, order_number,
--      date_from, date_to), ordenacao active urgency com
--      snapshot_at congelado na primeira pagina, cursor keyset
--      (created_at|id desc para history, status_updated_at|created_at|id
--      asc para active). v1 permanece intocada.
--   3) get_kds_orders_minimal: RPC dedicada e minimizada para o
--      KDS (statuses new/confirmed/preparing/ready, sem PII, ordem
--      deterministica, truncated>200).
--   4) Indice parcial active urgency. Demais indices nao criados
--      por utilidade nao demonstrada sem EXPLAIN isolado.
--   5) Grants/revokes correspondentes.
--
-- Estado: backend pre-remote. NAO aplicar migration remota sem
-- autorizacao explicita.
-- =============================================================

-- Contrato de erros:
-- PED79 INVALID_ORDER_FILTER   - novo. Cobertura: filtro/cursor/limit
--                                invalido, key desconhecida, timestamp
--                                malformado, combinacao estruturalmente
--                                invalida na v2.

-- =============================================================
-- 1) NEW-MEDIUM-1 fix (Alternative B).
-- =============================================================

create or replace function public.create_catalog_product_option_group(
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

  -- NEW-MEDIUM-1 fix: disciplina unit-first. O trigger estrutural
  -- (_lock_product_option_structure, migration 22) tambem adquire
  -- unit→product; reaquisicao pela mesma transacao e aceitavel e
  -- nao introduz deadlock. A funcao agora adquire unit primeiro,
  -- eliminando a inversao BA-BA contra publish_unit_menu.
  perform public._lock_unit_structure(p_unit_id);

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

create or replace function public.create_catalog_product_option(
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

  -- NEW-MEDIUM-1 fix: mesma disciplina unit-first aplicada aqui.
  perform public._lock_unit_structure(v_group.unit_id);

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

-- =============================================================
-- 2) get_unit_orders_admin_v2.
-- =============================================================

create or replace function public.get_unit_orders_admin_v2(
  p_unit_id uuid,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_view text;
  v_statuses text[];
  v_view_bucket text[];
  v_service_mode text;
  v_payment_status text;
  v_payment_method text;
  v_order_number bigint;
  v_date_from timestamptz;
  v_date_to timestamptz;
  v_cursor_text text;
  v_limit integer;
  v_cursor jsonb;
  v_cursor_view text;
  v_cursor_snapshot_at timestamptz;
  v_cursor_status_updated_at timestamptz;
  v_cursor_created_at timestamptz;
  v_cursor_overdue_rank smallint;
  v_cursor_status_bucket smallint;
  v_cursor_id uuid;
  v_snapshot_at timestamptz;
  v_snapshot_used timestamptz;
  v_total_count bigint;
  v_orders jsonb;
  v_page_info jsonb;
  v_key text;
  v_filter_keys constant text[] := array[
    'view', 'statuses', 'service_mode', 'payment_status',
    'payment_method', 'order_number', 'date_from', 'date_to',
    'cursor', 'limit'
  ];
  v_cursor_base64 text;
  v_last jsonb;
  v_last_id uuid;
  v_last_created_at timestamptz;
  v_last_status_updated_at timestamptz;
  v_last_estimated integer;
  v_last_status text;
  v_last_overdue smallint;
  v_last_bucket smallint;
  v_last_cursor text;
  v_has_more boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select u.* into v_unit
  from public.units as u
  where u.id = p_unit_id;
  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;
  if not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  -- Whitelist estrita: qualquer key desconhecida e rejeitada.
  foreach v_key in array array(select jsonb_object_keys(v_filters)) loop
    if not (v_key = any(v_filter_keys)) then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
  end loop;

  v_view := coalesce(v_filters ->> 'view', 'active');
  if v_view not in ('active', 'history') then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  v_statuses := array[]::text[];
  if v_filters ? 'statuses' then
    if jsonb_typeof(v_filters -> 'statuses') <> 'array' then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
    select array_agg(distinct value::text)
      into v_statuses
      from jsonb_array_elements_text(v_filters -> 'statuses') as value;
    if v_statuses is null then
      v_statuses := array[]::text[];
    end if;
    if cardinality(v_statuses) > 7 then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
  end if;

  if v_view = 'active' then
    v_view_bucket := array['new','confirmed','preparing','ready','out_for_delivery'];
  else
    v_view_bucket := array['completed','cancelled'];
  end if;

  if cardinality(v_statuses) = 0 then
    v_statuses := v_view_bucket;
  else
    if not (v_statuses <@ v_view_bucket) then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
  end if;

  v_service_mode := nullif(v_filters ->> 'service_mode', '');
  if v_service_mode is not null and v_service_mode not in ('pickup', 'delivery') then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  v_payment_status := nullif(v_filters ->> 'payment_status', '');
  if v_payment_status is not null
     and v_payment_status not in ('pending', 'paid', 'refunded')
  then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  v_payment_method := nullif(v_filters ->> 'payment_method', '');
  if v_payment_method is not null
     and v_payment_method not in ('cash', 'pix', 'credit_card', 'debit_card')
  then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  if v_filters ? 'order_number' then
    begin
      v_order_number := (v_filters ->> 'order_number')::bigint;
      if v_order_number is null or v_order_number <= 0 then
        raise exception 'invalid';
      end if;
    exception when others then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end;
  end if;

  if v_filters ? 'date_from' then
    begin
      v_date_from := (v_filters ->> 'date_from')::timestamptz;
    exception when others then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end;
  end if;
  if v_filters ? 'date_to' then
    begin
      v_date_to := (v_filters ->> 'date_to')::timestamptz;
    exception when others then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end;
  end if;
  if v_date_from is not null and v_date_to is not null and v_date_from > v_date_to then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  v_limit := coalesce((v_filters ->> 'limit')::integer, 50);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
  end if;

  v_cursor_text := nullif(v_filters ->> 'cursor', '');
  if v_cursor_text is not null then
    begin
      v_cursor_base64 := translate(v_cursor_text, '-_', '+/');
      v_cursor_base64 := rpad(v_cursor_base64, (length(v_cursor_base64) + 3) / 4 * 4, '=');
      v_cursor := convert_from(decode(v_cursor_base64, 'base64'), 'UTF8')::jsonb;
    exception when others then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end;
    if jsonb_typeof(v_cursor) <> 'object' then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
    v_cursor_view := v_cursor ->> 'v';
    if v_cursor_view is null or v_cursor_view <> v_view then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
    begin
      v_cursor_id := (v_cursor ->> 'id')::uuid;
      v_cursor_created_at := (v_cursor ->> 'c')::timestamptz;
    exception when others then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end;
    if v_cursor_id is null or v_cursor_created_at is null then
      raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
    end if;
    if v_view = 'active' then
      begin
        v_cursor_snapshot_at := (v_cursor ->> 'snap')::timestamptz;
        v_cursor_status_updated_at := (v_cursor ->> 'su')::timestamptz;
        v_cursor_overdue_rank := (v_cursor ->> 'or')::smallint;
        v_cursor_status_bucket := (v_cursor ->> 'sb')::smallint;
      exception when others then
        raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
      end;
      if v_cursor_snapshot_at is null
         or v_cursor_status_updated_at is null
         or v_cursor_overdue_rank is null
         or v_cursor_status_bucket is null
      then
        raise exception 'INVALID_ORDER_FILTER' using errcode = 'PED79';
      end if;
    end if;
  end if;

  if v_view = 'active' then
    v_snapshot_at := clock_timestamp();
    v_snapshot_used := coalesce(v_cursor_snapshot_at, v_snapshot_at);
  else
    v_snapshot_at := null;
    v_snapshot_used := null;
  end if;

  select count(*) into v_total_count
  from public.orders as o
  where o.unit_id = p_unit_id
    and o.status = any(v_statuses)
    and (v_service_mode is null or o.service_mode = v_service_mode)
    and (v_payment_status is null or o.payment_status = v_payment_status)
    and (v_payment_method is null or o.payment_method = v_payment_method)
    and (v_order_number is null or o.order_number = v_order_number)
    and (v_date_from is null or o.created_at >= v_date_from)
    and (v_date_to is null or o.created_at <= v_date_to);

  if v_view = 'history' then
    -- History: created_at desc, id desc.
    if v_cursor_id is null then
      select coalesce(
        jsonb_agg(t.payload order by t.created_at desc, t.id desc),
        '[]'::jsonb
      )
        into v_orders
      from (
        select
          o.id,
          o.created_at,
          jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'status', o.status,
            'payment_status', o.payment_status,
            'service_mode', o.service_mode,
            'payment_method', o.payment_method,
            'item_count', (
              select count(*)::integer
              from public.order_items as oi
              where oi.order_id = o.id
            ),
            'subtotal', o.subtotal::text,
            'delivery_fee', o.delivery_fee::text,
            'total', o.total::text,
            'estimated_minutes', o.estimated_minutes,
            'expected_at', (
              case when o.estimated_minutes is null then null
                   else (o.created_at + (o.estimated_minutes * interval '1 minute'))
              end
            ),
            'customer_name', o.customer_name,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'status_updated_at', o.status_updated_at,
            'payment_status_updated_at', o.payment_status_updated_at,
            'completed_at', o.completed_at,
            'cancelled_at', o.cancelled_at,
            'paid_at', o.paid_at,
            'refunded_at', o.refunded_at
          ) as payload
        from public.orders as o
        where o.unit_id = p_unit_id
          and o.status = any(v_statuses)
          and (v_service_mode is null or o.service_mode = v_service_mode)
          and (v_payment_status is null or o.payment_status = v_payment_status)
          and (v_payment_method is null or o.payment_method = v_payment_method)
          and (v_order_number is null or o.order_number = v_order_number)
          and (v_date_from is null or o.created_at >= v_date_from)
          and (v_date_to is null or o.created_at <= v_date_to)
        order by o.created_at desc, o.id desc
        limit v_limit + 1
      ) as t;
    else
      select coalesce(
        jsonb_agg(t.payload order by t.created_at desc, t.id desc),
        '[]'::jsonb
      )
        into v_orders
      from (
        select
          o.id,
          o.created_at,
          jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'status', o.status,
            'payment_status', o.payment_status,
            'service_mode', o.service_mode,
            'payment_method', o.payment_method,
            'item_count', (
              select count(*)::integer
              from public.order_items as oi
              where oi.order_id = o.id
            ),
            'subtotal', o.subtotal::text,
            'delivery_fee', o.delivery_fee::text,
            'total', o.total::text,
            'estimated_minutes', o.estimated_minutes,
            'expected_at', (
              case when o.estimated_minutes is null then null
                   else (o.created_at + (o.estimated_minutes * interval '1 minute'))
              end
            ),
            'customer_name', o.customer_name,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'status_updated_at', o.status_updated_at,
            'payment_status_updated_at', o.payment_status_updated_at,
            'completed_at', o.completed_at,
            'cancelled_at', o.cancelled_at,
            'paid_at', o.paid_at,
            'refunded_at', o.refunded_at
          ) as payload
        from public.orders as o
        where o.unit_id = p_unit_id
          and o.status = any(v_statuses)
          and (v_service_mode is null or o.service_mode = v_service_mode)
          and (v_payment_status is null or o.payment_status = v_payment_status)
          and (v_payment_method is null or o.payment_method = v_payment_method)
          and (v_order_number is null or o.order_number = v_order_number)
          and (v_date_from is null or o.created_at >= v_date_from)
          and (v_date_to is null or o.created_at <= v_date_to)
          and (o.created_at, o.id) < (v_cursor_created_at, v_cursor_id)
        order by o.created_at desc, o.id desc
        limit v_limit + 1
      ) as t;
    end if;
  else
    -- Active urgency: ordenacao (overdue_rank, status_bucket,
    -- status_updated_at, created_at, id). snapshot_used congelado
    -- na primeira pagina (ou carregado pelo cursor). Limit +1
    -- para detectar has_more.
    if v_cursor_id is null then
      select coalesce(
        jsonb_agg(t.payload order by t.overdue_rank, t.status_bucket, t.status_updated_at, t.created_at, t.id),
        '[]'::jsonb
      )
        into v_orders
      from (
        select
          o.id,
          o.created_at,
          o.status_updated_at,
          case
            when o.estimated_minutes is null then 1
            when (o.created_at + (o.estimated_minutes * interval '1 minute')) < v_snapshot_used then 0
            else 1
          end as overdue_rank,
          case
            when o.status in ('new','confirmed','preparing') then 0
            else 1
          end as status_bucket,
          jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'status', o.status,
            'payment_status', o.payment_status,
            'service_mode', o.service_mode,
            'payment_method', o.payment_method,
            'item_count', (
              select count(*)::integer
              from public.order_items as oi
              where oi.order_id = o.id
            ),
            'subtotal', o.subtotal::text,
            'delivery_fee', o.delivery_fee::text,
            'total', o.total::text,
            'estimated_minutes', o.estimated_minutes,
            'expected_at', (
              case when o.estimated_minutes is null then null
                   else (o.created_at + (o.estimated_minutes * interval '1 minute'))
              end
            ),
            'customer_name', o.customer_name,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'status_updated_at', o.status_updated_at,
            'payment_status_updated_at', o.payment_status_updated_at,
            'completed_at', o.completed_at,
            'cancelled_at', o.cancelled_at,
            'paid_at', o.paid_at,
            'refunded_at', o.refunded_at
          ) as payload
        from public.orders as o
        where o.unit_id = p_unit_id
          and o.status = any(v_statuses)
          and (v_service_mode is null or o.service_mode = v_service_mode)
          and (v_payment_status is null or o.payment_status = v_payment_status)
          and (v_payment_method is null or o.payment_method = v_payment_method)
          and (v_order_number is null or o.order_number = v_order_number)
          and (v_date_from is null or o.created_at >= v_date_from)
          and (v_date_to is null or o.created_at <= v_date_to)
        order by overdue_rank, status_bucket, o.status_updated_at, o.created_at, o.id
        limit v_limit + 1
      ) as t;
    else
      select coalesce(
        jsonb_agg(t.payload order by t.overdue_rank, t.status_bucket, t.status_updated_at, t.created_at, t.id),
        '[]'::jsonb
      )
        into v_orders
      from (
        select
          o.id,
          o.created_at,
          o.status_updated_at,
          case
            when o.estimated_minutes is null then 1
            when (o.created_at + (o.estimated_minutes * interval '1 minute')) < v_snapshot_used then 0
            else 1
          end as overdue_rank,
          case
            when o.status in ('new','confirmed','preparing') then 0
            else 1
          end as status_bucket,
          jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'status', o.status,
            'payment_status', o.payment_status,
            'service_mode', o.service_mode,
            'payment_method', o.payment_method,
            'item_count', (
              select count(*)::integer
              from public.order_items as oi
              where oi.order_id = o.id
            ),
            'subtotal', o.subtotal::text,
            'delivery_fee', o.delivery_fee::text,
            'total', o.total::text,
            'estimated_minutes', o.estimated_minutes,
            'expected_at', (
              case when o.estimated_minutes is null then null
                   else (o.created_at + (o.estimated_minutes * interval '1 minute'))
              end
            ),
            'customer_name', o.customer_name,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'status_updated_at', o.status_updated_at,
            'payment_status_updated_at', o.payment_status_updated_at,
            'completed_at', o.completed_at,
            'cancelled_at', o.cancelled_at,
            'paid_at', o.paid_at,
            'refunded_at', o.refunded_at
          ) as payload
        from public.orders as o
        where o.unit_id = p_unit_id
          and o.status = any(v_statuses)
          and (v_service_mode is null or o.service_mode = v_service_mode)
          and (v_payment_status is null or o.payment_status = v_payment_status)
          and (v_payment_method is null or o.payment_method = v_payment_method)
          and (v_order_number is null or o.order_number = v_order_number)
          and (v_date_from is null or o.created_at >= v_date_from)
          and (v_date_to is null or o.created_at <= v_date_to)
          and (
            case when o.estimated_minutes is null then 1
                 when (o.created_at + (o.estimated_minutes * interval '1 minute')) < v_snapshot_used then 0
                 else 1
            end,
            case when o.status in ('new','confirmed','preparing') then 0 else 1 end,
            o.status_updated_at,
            o.created_at,
            o.id
          ) > (
            v_cursor_overdue_rank,
            v_cursor_status_bucket,
            v_cursor_status_updated_at,
            v_cursor_created_at,
            v_cursor_id
          )
        order by overdue_rank, status_bucket, o.status_updated_at, o.created_at, o.id
        limit v_limit + 1
      ) as t;
    end if;
  end if;

  -- Detecta has_more e fatia em v_limit rows.
  v_has_more := jsonb_array_length(v_orders) > v_limit;
  if v_has_more then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into v_orders
    from (
      select value
      from jsonb_array_elements(v_orders) with ordinality as t(value, ord)
      where ord <= v_limit
    ) sliced;
  end if;

  -- Constroi next_cursor a partir da ultima linha retornada.
  if v_has_more and jsonb_array_length(v_orders) > 0 then
    v_last := v_orders -> -1;
    v_last_id := (v_last ->> 'id')::uuid;
    v_last_created_at := (v_last ->> 'created_at')::timestamptz;
    if v_view = 'history' then
      v_last_cursor := encode(
        convert_to(
          jsonb_build_object(
            'v', 'history',
            'c', v_last_created_at,
            'id', v_last_id
          )::text,
          'UTF8'
        ),
        'base64'
      );
      v_last_cursor := replace(translate(v_last_cursor, '+/', '-_'), '=', '');
      v_page_info := jsonb_build_object(
        'has_more', true,
        'next_cursor', v_last_cursor
      );
    else
      v_last_status_updated_at := (v_last ->> 'status_updated_at')::timestamptz;
      begin
        v_last_estimated := (v_last ->> 'estimated_minutes')::integer;
      exception when others then
        v_last_estimated := null;
      end;
      v_last_status := v_last ->> 'status';
      v_last_overdue := case
        when v_last_estimated is null then 1
        when (v_last_created_at + (v_last_estimated * interval '1 minute')) < v_snapshot_used then 0
        else 1
      end;
      v_last_bucket := case
        when v_last_status in ('new','confirmed','preparing') then 0
        else 1
      end;
      v_last_cursor := encode(
        convert_to(
          jsonb_build_object(
            'v', 'active',
            'snap', v_snapshot_used,
            'or', v_last_overdue,
            'sb', v_last_bucket,
            'su', v_last_status_updated_at,
            'c', v_last_created_at,
            'id', v_last_id
          )::text,
          'UTF8'
        ),
        'base64'
      );
      v_last_cursor := replace(translate(v_last_cursor, '+/', '-_'), '=', '');
      v_page_info := jsonb_build_object(
        'has_more', true,
        'next_cursor', v_last_cursor
      );
    end if;
  else
    v_page_info := jsonb_build_object('has_more', false, 'next_cursor', null);
  end if;

  return jsonb_build_object(
    'unit', jsonb_build_object('id', v_unit.id, 'name', v_unit.name),
    'view', v_view,
    'filters', (
      v_filters
      - 'cursor'
      || jsonb_build_object(
        'view', v_view,
        'statuses', to_jsonb(v_statuses),
        'service_mode', v_service_mode,
        'payment_status', v_payment_status,
        'payment_method', v_payment_method,
        'order_number', v_order_number,
        'date_from', v_date_from,
        'date_to', v_date_to,
        'limit', v_limit
      )
    ),
    'snapshot_at', v_snapshot_at,
    'total_count', v_total_count,
    'orders', v_orders,
    'page_info', v_page_info
  );
end;
$$;

revoke all on function public.get_unit_orders_admin_v2(uuid, jsonb)
  from public, anon;
grant execute on function public.get_unit_orders_admin_v2(uuid, jsonb)
  to authenticated;

-- =============================================================
-- 3) get_kds_orders_minimal.
-- =============================================================

create or replace function public.get_kds_orders_minimal(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_kds_statuses constant text[] := array['new','confirmed','preparing','ready'];
  v_orders jsonb;
  v_count bigint;
  v_limit constant integer := 200;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select u.* into v_unit
  from public.units as u
  where u.id = p_unit_id;
  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;
  if not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select count(*) into v_count
  from public.orders as o
  where o.unit_id = p_unit_id
    and o.status = any(v_kds_statuses);

  select coalesce(
    jsonb_agg(t.payload order by
      case
        when t.status = 'new' then 0
        when t.status = 'confirmed' then 1
        when t.status = 'preparing' then 2
        else 3
      end,
      t.status_updated_at asc,
      t.created_at asc,
      t.id asc
    ),
    '[]'::jsonb
  )
    into v_orders
  from (
    select
      o.id,
      o.created_at,
      o.status_updated_at,
      o.status,
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'service_mode', o.service_mode,
        'created_at', o.created_at,
        'status_updated_at', o.status_updated_at,
        'estimated_minutes', o.estimated_minutes,
        'expected_at', (
          case when o.estimated_minutes is null then null
               else (o.created_at + (o.estimated_minutes * interval '1 minute'))
          end
        ),
        'items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'product_name', oi.product_name,
                'quantity', oi.quantity,
                'note', oi.note,
                'options', (
                  select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'group_name', oio.group_name,
                        'group_kind', oio.group_kind,
                        'option_name', oio.option_name
                      )
                      order by oio.created_at, oio.id
                    ),
                    '[]'::jsonb
                  )
                  from public.order_item_options as oio
                  where oio.order_item_id = oi.id
                )
              )
              order by oi.created_at, oi.id
            ),
            '[]'::jsonb
          )
          from public.order_items as oi
          where oi.order_id = o.id
        )
      ) as payload
    from public.orders as o
    where o.unit_id = p_unit_id
      and o.status = any(v_kds_statuses)
    order by
      case
        when o.status = 'new' then 0
        when o.status = 'confirmed' then 1
        when o.status = 'preparing' then 2
        else 3
      end,
      o.status_updated_at asc,
      o.created_at asc,
      o.id asc
    limit v_limit
  ) as t;

  return jsonb_build_object(
    'unit', jsonb_build_object('id', v_unit.id, 'name', v_unit.name),
    'truncated', v_count > v_limit,
    'orders', v_orders
  );
end;
$$;

revoke all on function public.get_kds_orders_minimal(uuid)
  from public, anon;
grant execute on function public.get_kds_orders_minimal(uuid)
  to authenticated;

-- =============================================================
-- 4) Indice parcial active urgency.
-- =============================================================
--
-- Apenas o indice parcial para active urgency foi criado nesta
-- etapa. Demais candidatos (payment_status, service_mode,
-- payment_method, order_events) foram rejeitados:
--   - (unit_id, payment_status, created_at desc, id desc): o
--     indice existente orders_unit_status_created_idx ja cobre
--     a maioria das queries; para poucas centenas de pedidos por
--     unidade, sequential scan filtrado por service_mode /
--     payment_status / payment_method continua dentro do budget
--     sem demonstracao de regressao via EXPLAIN.
--   - (unit_id, service_mode, created_at desc, id desc): mesma
--     justificativa.
--   - (unit_id, payment_method, created_at desc, id desc): mesma
--     justificativa.
--   - order_events_order_type_created_idx: o indice existente
--     order_events_order_created_idx (order_id, created_at, id)
--     ja atende a leitura por pedido; volume por pedido e baixo.

create index if not exists orders_unit_active_urgency_idx
  on public.orders (unit_id, status_updated_at, created_at, id)
  where status in ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery');
