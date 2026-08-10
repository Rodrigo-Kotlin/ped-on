-- =============================================================
-- PED-ON - Prompt 08 - Checkout publico idempotente e Central de
-- Pedidos. Pedidos preservam snapshots comerciais, PII minima,
-- maquina de estados serializada, auditoria e Realtime apenas para
-- invalidacao/refetch.
-- =============================================================

-- Texto livre vindo do cliente deve ser texto simples. Limites de
-- tamanho permanecem especificos de cada campo.
create function public._is_safe_plain_text(p_value text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_value !~ '[<>[:cntrl:]]';
$$;

revoke all on function public._is_safe_plain_text(text)
  from public, anon, authenticated;

-- Chaves compostas usadas para garantir que pedido, versao e item
-- publicado sempre pertencam ao mesmo tenant e unidade.
alter table public.menu_versions
  add constraint menu_versions_organization_version_number_key
  unique (organization_id, unit_id, id, version_number);

alter table public.menu_version_products
  add constraint menu_version_products_organization_product_id_key
  unique (organization_id, unit_id, menu_version_id, id);

-- 1) Pedidos. Valores comerciais e operacionais sao snapshots do
-- momento da criacao e nao sao aceitos do navegador.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  menu_version_id uuid not null,
  menu_version_number integer not null check (menu_version_number > 0),
  order_number bigint not null check (order_number > 0),
  idempotency_key uuid not null,
  request_hash text not null,
  tracking_token text not null,
  status text not null default 'new',
  payment_status text not null default 'pending',
  service_mode text not null,
  payment_method text not null,
  customer_name text not null,
  customer_phone text not null,
  delivery_street text,
  delivery_number text,
  delivery_complement text,
  delivery_neighborhood text,
  delivery_city text,
  delivery_state text,
  delivery_postal_code text,
  delivery_reference text,
  delivery_fee numeric(12, 2) not null default 0,
  subtotal numeric(12, 2) not null,
  total numeric(12, 2) not null,
  cash_change_for numeric(12, 2),
  estimated_minutes integer,
  operation_revision timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now(),
  payment_status_updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  constraint orders_unit_fk
    foreign key (organization_id, unit_id)
    references public.units (organization_id, id)
    on delete restrict,
  constraint orders_menu_version_fk
    foreign key (
      organization_id, unit_id, menu_version_id, menu_version_number
    )
    references public.menu_versions (
      organization_id, unit_id, id, version_number
    )
    on delete restrict,
  constraint orders_organization_unit_id_menu_version_key
    unique (organization_id, unit_id, id, menu_version_id),
  constraint orders_organization_unit_id_key
    unique (organization_id, unit_id, id),
  constraint orders_unit_number_key unique (unit_id, order_number),
  constraint orders_unit_idempotency_key unique (unit_id, idempotency_key),
  constraint orders_tracking_token_key unique (tracking_token),
  constraint orders_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint orders_tracking_token_format_check
    check (tracking_token ~ '^[a-f0-9]{32}$'),
  constraint orders_status_check
    check (
      status in (
        'new', 'confirmed', 'preparing', 'ready',
        'out_for_delivery', 'completed', 'cancelled'
      )
    ),
  constraint orders_payment_status_check
    check (payment_status in ('pending', 'paid', 'refunded')),
  constraint orders_service_mode_check
    check (service_mode in ('pickup', 'delivery')),
  constraint orders_service_status_check
    check (status <> 'out_for_delivery' or service_mode = 'delivery'),
  constraint orders_payment_method_check
    check (payment_method in ('cash', 'pix', 'credit_card', 'debit_card')),
  constraint orders_customer_name_check
    check (
      customer_name = btrim(customer_name)
      and char_length(customer_name) between 2 and 120
      and public._is_safe_plain_text(customer_name)
    ),
  constraint orders_customer_phone_check
    check (customer_phone ~ '^[0-9]{10,11}$'),
  constraint orders_delivery_address_check
    check (
      (
        service_mode = 'pickup'
        and delivery_street is null
        and delivery_number is null
        and delivery_complement is null
        and delivery_neighborhood is null
        and delivery_city is null
        and delivery_state is null
        and delivery_postal_code is null
        and delivery_reference is null
        and delivery_fee = 0
      )
      or
      (
        service_mode = 'delivery'
        and delivery_street is not null
        and delivery_number is not null
        and delivery_neighborhood is not null
        and delivery_city is not null
        and delivery_state is not null
        and delivery_street = btrim(delivery_street)
        and char_length(delivery_street) between 2 and 120
        and public._is_safe_plain_text(delivery_street)
        and delivery_number = btrim(delivery_number)
        and char_length(delivery_number) between 1 and 20
        and public._is_safe_plain_text(delivery_number)
        and delivery_neighborhood = btrim(delivery_neighborhood)
        and char_length(delivery_neighborhood) between 2 and 80
        and public._is_safe_plain_text(delivery_neighborhood)
        and delivery_city = btrim(delivery_city)
        and char_length(delivery_city) between 2 and 80
        and public._is_safe_plain_text(delivery_city)
        and delivery_state ~ '^[A-Z]{2}$'
        and (
          delivery_postal_code is null
          or delivery_postal_code ~ '^[0-9]{8}$'
        )
      )
    ),
  constraint orders_delivery_complement_check
    check (
      delivery_complement is null
      or (
        delivery_complement = btrim(delivery_complement)
        and char_length(delivery_complement) between 1 and 120
        and public._is_safe_plain_text(delivery_complement)
      )
    ),
  constraint orders_delivery_reference_check
    check (
      delivery_reference is null
      or (
        delivery_reference = btrim(delivery_reference)
        and char_length(delivery_reference) between 1 and 160
        and public._is_safe_plain_text(delivery_reference)
      )
    ),
  constraint orders_money_check
    check (
      delivery_fee between 0 and 9999999999.99
      and subtotal > 0 and subtotal <= 9999999999.99
      and total > 0 and total <= 9999999999.99
      and total = subtotal + delivery_fee
    ),
  constraint orders_cash_change_check
    check (
      cash_change_for is null
      or (
        payment_method = 'cash'
        and cash_change_for >= total
        and cash_change_for <= 9999999999.99
      )
    ),
  constraint orders_estimated_minutes_check
    check (estimated_minutes is null or estimated_minutes between 0 and 1440),
  constraint orders_notes_check
    check (
      notes is null
      or (
        notes = btrim(notes)
        and char_length(notes) between 1 and 500
        and public._is_safe_plain_text(notes)
      )
    ),
  constraint orders_status_timestamps_check
    check (
      (
        status = 'completed'
        and completed_at is not null
        and cancelled_at is null
      )
      or (
        status = 'cancelled'
        and cancelled_at is not null
        and completed_at is null
      )
      or (
        status not in ('completed', 'cancelled')
        and completed_at is null
        and cancelled_at is null
      )
    ),
  constraint orders_payment_timestamps_check
    check (
      (
        payment_status = 'pending'
        and paid_at is null
        and refunded_at is null
      )
      or (
        payment_status = 'paid'
        and paid_at is not null
        and refunded_at is null
      )
      or (
        payment_status = 'refunded'
        and paid_at is not null
        and refunded_at is not null
      )
    ),
  constraint orders_timestamp_order_check
    check (
      updated_at >= created_at
      and status_updated_at >= created_at
      and payment_status_updated_at >= created_at
      and (completed_at is null or completed_at >= created_at)
      and (cancelled_at is null or cancelled_at >= created_at)
      and (paid_at is null or paid_at >= created_at)
      and (refunded_at is null or refunded_at >= paid_at)
    )
);

create index orders_unit_created_idx
  on public.orders (unit_id, created_at desc, id desc);

create index orders_unit_status_created_idx
  on public.orders (unit_id, status, created_at desc, id desc);

alter table public.orders enable row level security;

create function public._set_orders_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public._set_orders_updated_at()
  from public, anon, authenticated;

create trigger set_orders_updated_at
before update on public.orders
for each row execute function public._set_orders_updated_at();

-- 2) Itens de pedido sao snapshots do item publicado. Nome e preco
-- nunca sao lidos do catalogo mutavel depois da criacao.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  order_id uuid not null,
  menu_version_id uuid not null,
  menu_item_id uuid not null,
  product_name text not null,
  unit_price numeric(12, 2) not null,
  quantity integer not null,
  line_total numeric(12, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint order_items_order_version_fk
    foreign key (organization_id, unit_id, order_id, menu_version_id)
    references public.orders (
      organization_id, unit_id, id, menu_version_id
    )
    on delete cascade,
  constraint order_items_menu_item_fk
    foreign key (organization_id, unit_id, menu_version_id, menu_item_id)
    references public.menu_version_products (
      organization_id, unit_id, menu_version_id, id
    )
    on delete restrict,
  constraint order_items_order_menu_item_key
    unique (order_id, menu_item_id),
  constraint order_items_product_name_check
    check (
      product_name = btrim(product_name)
      and char_length(product_name) between 1 and 120
    ),
  constraint order_items_unit_price_check
    check (unit_price > 0 and unit_price <= 9999999999.99),
  constraint order_items_quantity_check
    check (quantity between 1 and 99),
  constraint order_items_line_total_check
    check (
      line_total > 0
      and line_total <= 9999999999.99
      and line_total = unit_price * quantity
    ),
  constraint order_items_note_check
    check (
      note is null
      or (
        note = btrim(note)
        and char_length(note) between 1 and 300
        and public._is_safe_plain_text(note)
      )
    )
);

create index order_items_order_created_idx
  on public.order_items (order_id, created_at, id);

create index order_items_unit_order_idx
  on public.order_items (unit_id, order_id);

create index order_items_menu_item_idx
  on public.order_items (menu_version_id, menu_item_id);

alter table public.order_items enable row level security;

-- 3) Eventos append-only. O ator e registrado no evento; a FK usa
-- SET NULL para nao impedir remocao futura de usuario.
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id uuid not null,
  order_id uuid not null,
  event_type text not null,
  from_value text,
  to_value text not null,
  note text,
  actor_type text not null,
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_events_order_fk
    foreign key (organization_id, unit_id, order_id)
    references public.orders (organization_id, unit_id, id)
    on delete cascade,
  constraint order_events_actor_user_fk
    foreign key (actor_user_id)
    references auth.users (id)
    on delete set null,
  constraint order_events_type_check
    check (
      event_type in ('created', 'status_changed', 'payment_changed')
    ),
  constraint order_events_actor_type_check
    check (actor_type in ('customer', 'staff', 'system')),
  constraint order_events_shape_check
    check (
      (
        event_type = 'created'
        and from_value is null
        and to_value = 'new'
        and actor_type = 'customer'
        and actor_user_id is null
      )
      or (
        event_type = 'status_changed'
        and from_value is not null
        and from_value in (
          'new', 'confirmed', 'preparing', 'ready',
          'out_for_delivery', 'completed', 'cancelled'
        )
        and to_value in (
          'new', 'confirmed', 'preparing', 'ready',
          'out_for_delivery', 'completed', 'cancelled'
        )
        and from_value <> to_value
        and actor_type = 'staff'
      )
      or (
        event_type = 'payment_changed'
        and from_value is not null
        and from_value in ('pending', 'paid', 'refunded')
        and to_value in ('pending', 'paid', 'refunded')
        and from_value <> to_value
        and actor_type = 'staff'
      )
    ),
  constraint order_events_note_check
    check (
      note is null
      or (
        note = btrim(note)
        and char_length(note) between 1 and 500
        and public._is_safe_plain_text(note)
      )
    )
);

create index order_events_order_created_idx
  on public.order_events (order_id, created_at, id);

create index order_events_unit_order_idx
  on public.order_events (unit_id, order_id);

alter table public.order_events enable row level security;

-- 4) RLS/ACL: authenticated le apenas unidades autorizadas. Nenhum
-- papel de navegador recebe INSERT, UPDATE ou DELETE.
create policy "orders_select_unit_access" on public.orders
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "order_items_select_unit_access" on public.order_items
  for select to authenticated
  using (public.can_access_unit(unit_id));

create policy "order_events_select_unit_access" on public.order_events
  for select to authenticated
  using (public.can_access_unit(unit_id));

revoke all on table public.orders from public, anon, authenticated;
revoke all on table public.order_items from public, anon, authenticated;
revoke all on table public.order_events from public, anon, authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.order_events to authenticated;

-- 5) Horario local da unidade. Intervalos sao semiabertos: abre no
-- open_time e fecha no close_time. open_time = close_time e fechado.
create function public._is_unit_open_at(p_unit_id uuid, p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.unit_operational_settings;
  v_local timestamp;
  v_dow integer;
  v_time time;
  v_today public.unit_business_hours;
  v_previous public.unit_business_hours;
begin
  select s.* into v_settings
  from public.unit_operational_settings as s
  where s.unit_id = p_unit_id;

  if v_settings.unit_id is null then
    return false;
  end if;

  v_local := p_at at time zone v_settings.timezone;
  v_dow := extract(dow from v_local)::integer;
  v_time := v_local::time;

  select h.* into v_today
  from public.unit_business_hours as h
  where h.unit_id = p_unit_id
    and h.weekday = v_dow;

  if v_today.unit_id is not null and v_today.is_open then
    if v_today.is_24h then
      return true;
    end if;

    if v_today.open_time <> v_today.close_time then
      if v_today.close_time > v_today.open_time then
        if v_time >= v_today.open_time and v_time < v_today.close_time then
          return true;
        end if;
      elsif v_time >= v_today.open_time then
        return true;
      end if;
    end if;
  end if;

  select h.* into v_previous
  from public.unit_business_hours as h
  where h.unit_id = p_unit_id
    and h.weekday = ((v_dow + 6) % 7);

  if v_previous.unit_id is not null
     and v_previous.is_open
     and not v_previous.is_24h
     and v_previous.close_time < v_previous.open_time
     and v_previous.open_time <> v_previous.close_time
  then
    return v_time < v_previous.close_time;
  end if;

  return false;
end;
$$;

revoke all on function public._is_unit_open_at(uuid, timestamptz)
  from public, anon, authenticated;

-- 6) Resposta imutavel da criacao/replay. Nao contem wrapper,
-- order.id, estado mutavel, PII ou itens.
create function public._order_creation_json(p_order_id uuid)
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
    'order_number', v_order.order_number,
    'tracking_token', v_order.tracking_token,
    'tracking_path', '/pedido/' || v_order.tracking_token,
    'service_mode', v_order.service_mode,
    'payment_method', v_order.payment_method,
    'subtotal', v_order.subtotal::text,
    'delivery_fee', v_order.delivery_fee::text,
    'total', v_order.total::text,
    'estimated_minutes', v_order.estimated_minutes,
    'created_at', v_order.created_at
  );
end;
$$;

revoke all on function public._order_creation_json(uuid)
  from public, anon, authenticated;

-- 7) Resposta publica de tracking. Nao retorna identificadores
-- tecnicos, token, idempotencia, hash ou PII.
create function public._order_tracking_json(p_order_id uuid)
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
              'note', oi.note
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

-- 8) Resposta administrativa completa, sem request_hash nem
-- idempotency_key.
create function public._order_admin_json(p_order_id uuid)
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

-- Contrato de erros:
-- PED33 MENU_NOT_FOUND             | PED34 ORDERS_UNAVAILABLE
-- PED35 MENU_CHANGED               | PED36 CHECKOUT_CHANGED
-- PED37 INVALID_CART               | PED38 ITEM_UNAVAILABLE
-- PED39 INVALID_SERVICE_MODE       | PED40 PAYMENT_METHOD_UNAVAILABLE
-- PED41 MINIMUM_ORDER_NOT_MET      | PED42 IDEMPOTENCY_CONFLICT
-- PED43 INVALID_CUSTOMER           | PED44 INVALID_DELIVERY_ADDRESS
-- PED45 INVALID_CASH_CHANGE        | PED46 ORDER_NOT_FOUND
-- PED47 INVALID_ORDER_TRANSITION   | PED48 INVALID_PAYMENT_TRANSITION
-- PED49 TRACKING_TOKEN_CONFLICT    | PED50 ORDER_AMOUNT_OVERFLOW

-- 9) Checkout publico idempotente.
create function public.create_public_order(
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

revoke all on function public.create_public_order(text, uuid, jsonb)
  from public;
grant execute on function public.create_public_order(text, uuid, jsonb)
  to anon, authenticated;

-- 10) Tracking publico por token opaco.
create function public.get_public_order(p_tracking_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := nullif(btrim(p_tracking_token), '');
  v_order_id uuid;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{32}$' then
    return jsonb_build_object('found', false);
  end if;

  select o.id into v_order_id
  from public.orders as o
  where o.tracking_token = v_token;

  if v_order_id is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object('found', true)
    || public._order_tracking_json(v_order_id);
end;
$$;

revoke all on function public.get_public_order(text) from public;
grant execute on function public.get_public_order(text)
  to anon, authenticated;

-- 11) Lista administrativa por unidade.
create function public.get_unit_orders_admin(
  p_unit_id uuid,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_filter text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select u.* into v_unit
  from public.units as u
  where u.id = p_unit_id;
  if v_unit.id is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;
  if not public.can_access_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  if p_status is not null then
    v_filter := btrim(p_status);
    if v_filter not in (
      'new', 'confirmed', 'preparing', 'ready',
      'out_for_delivery', 'completed', 'cancelled'
    ) then
      raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'PED47';
    end if;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'PED47';
  end if;

  return jsonb_build_object(
    'unit', jsonb_build_object('id', v_unit.id, 'name', v_unit.name),
    'status_filter', v_filter,
    'count', (
      select count(*)
      from public.orders as o
      where o.unit_id = p_unit_id
        and (v_filter is null or o.status = v_filter)
    ),
    'orders', (
      select coalesce(
        jsonb_agg(t.payload order by t.created_at desc, t.id desc),
        '[]'::jsonb
      )
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
          and (v_filter is null or o.status = v_filter)
        order by o.created_at desc, o.id desc
        limit p_limit
      ) as t
    )
  );
end;
$$;

revoke all on function public.get_unit_orders_admin(uuid, text, integer)
  from public, anon;
grant execute on function public.get_unit_orders_admin(uuid, text, integer)
  to authenticated;

-- 12) Detalhe administrativo.
create function public.get_order_admin(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PED46';
  end if;
  if not public.can_access_unit(v_order.unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  return public._order_admin_json(v_order.id);
end;
$$;

revoke all on function public.get_order_admin(uuid) from public, anon;
grant execute on function public.get_order_admin(uuid) to authenticated;

-- 13) State machine estrita e serializada.
create function public.set_order_status(
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

  return public._order_admin_json(v_order.id);
end;
$$;

revoke all on function public.set_order_status(uuid, text, text)
  from public, anon;
grant execute on function public.set_order_status(uuid, text, text)
  to authenticated;

-- 14) Payment state machine independente e serializada.
create function public.set_order_payment_status(
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

  return public._order_admin_json(v_order.id);
end;
$$;

revoke all on function public.set_order_payment_status(uuid, text)
  from public, anon;
grant execute on function public.set_order_payment_status(uuid, text)
  to authenticated;

-- 15) Cardapio publico preserva o contrato do Prompt 07 e adiciona
-- revision, open_now e can_order_now.
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

-- 16) Realtime publica somente colunas necessarias para invalidacao.
-- PostgreSQL 17 aceita column lists na clausula ADD TABLE.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders '
      || '(id, unit_id, updated_at, status, payment_status)';
  end if;
end;
$$;
