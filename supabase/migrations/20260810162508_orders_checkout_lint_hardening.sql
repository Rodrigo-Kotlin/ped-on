-- Hardening de lint sem alteracao de comportamento: a variavel de controle
-- do FOR inteiro e declarada automaticamente pelo PL/pgSQL.
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

-- Reaplica explicitamente as ACLs do contrato publico apos o replace.
revoke all on function public.create_public_order(text, uuid, jsonb)
  from public;
grant execute on function public.create_public_order(text, uuid, jsonb)
  to anon, authenticated;
