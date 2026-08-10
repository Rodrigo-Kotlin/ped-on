-- =============================================================
-- PED-ON — Prompt 05 — Acceptance hardening da configuração
-- operacional da unidade.
-- Ajustes versionados (não altera migrations já aplicadas):
--   1) unit_operational_settings.accepting_orders passa a ter
--      DEFAULT false: nenhuma unidade nasce aceitando pedidos.
--      Nenhum registro legítimo existente é alterado.
--   2) get_unit_operational_config expõe "configured" (false
--      enquanto não houver settings persistida). Unidade nunca
--      configurada retorna SEMPRE accepting_orders = false.
--   3) save_unit_operational_config torna-se server-authoritative
--      para aceite de pedidos: accepting_orders=true exige
--      unidade ativa (PED13), modalidade ativa (PED15), ao menos
--      um dia aberto (PED18) e ao menos um método de pagamento
--      habilitado (PED17). accepting_orders ausente = false.
-- Migration versionada aplicada pelo mecanismo oficial do projeto.
-- =============================================================

-- 1) Default seguro: nunca aceitar pedidos automaticamente.
alter table public.unit_operational_settings
  alter column accepting_orders set default false;

-- 2) Leitura: expõe configured; unidade nunca configurada nunca
--    é reportada como aceitando pedidos.
create or replace function public.get_unit_operational_config(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_active boolean;
  v_configured boolean;
  v_settings public.unit_operational_settings;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select is_active into v_is_active
  from public.units
  where id = p_unit_id;

  if v_is_active is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;

  if not public.can_manage_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  select * into v_settings
  from public.unit_operational_settings
  where unit_id = p_unit_id;

  v_configured := v_settings is not null;

  if not v_configured then
    v_settings.unit_id := p_unit_id;
    v_settings.timezone := 'America/Sao_Paulo';
    v_settings.pickup_enabled := true;
    v_settings.delivery_enabled := false;
    v_settings.delivery_fee := 0;
    v_settings.min_order_value := 0;
    v_settings.estimated_pickup_minutes := null;
    v_settings.estimated_delivery_minutes := null;
    v_settings.accepting_orders := false;
  end if;

  return jsonb_build_object(
    'configured', v_configured,
    'unit_id', v_settings.unit_id,
    'timezone', v_settings.timezone,
    'pickup_enabled', v_settings.pickup_enabled,
    'delivery_enabled', v_settings.delivery_enabled,
    'delivery_fee', v_settings.delivery_fee::text,
    'min_order_value', v_settings.min_order_value::text,
    'estimated_pickup_minutes', v_settings.estimated_pickup_minutes,
    'estimated_delivery_minutes', v_settings.estimated_delivery_minutes,
    'accepting_orders', v_settings.accepting_orders,
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
        on h.unit_id = p_unit_id
       and h.weekday = w.day
    ),
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
        on pm.unit_id = p_unit_id
       and pm.method = m.method
    )
  );
end;
$$;

revoke all on function public.get_unit_operational_config(uuid) from public;
grant execute on function public.get_unit_operational_config(uuid) to authenticated;

-- 3) Persistência server-authoritative: aceite de pedidos só é
--    permitido com estrutura pronta (unidade ativa, modalidade,
--    dia aberto e pagamento habilitado).
create or replace function public.save_unit_operational_config(
  p_unit_id uuid,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_timezone text;
  v_pickup boolean;
  v_delivery boolean;
  v_fee numeric;
  v_min numeric;
  v_pickup_min integer;
  v_delivery_min integer;
  v_accepting boolean;
  v_hours jsonb;
  v_payments jsonb;
  v_hour jsonb;
  v_payment jsonb;
  v_weekday smallint;
  v_is_open boolean;
  v_is_24h boolean;
  v_open_time time;
  v_close_time time;
  v_methods text[] := '{}'::text[];
  v_days integer[] := '{}'::integer[];
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED10';
  end if;

  select * into v_unit
  from public.units
  where id = p_unit_id;

  if v_unit is null then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'PED12';
  end if;

  if not v_unit.is_active then
    raise exception 'UNIT_INACTIVE' using errcode = 'PED13';
  end if;

  if not public.can_manage_unit(p_unit_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED11';
  end if;

  -- Serializa saves concorrentes da mesma unidade.
  perform pg_advisory_xact_lock(hashtext('pedon:unit:' || p_unit_id::text));

  v_timezone := p_config ->> 'timezone';
  if v_timezone is null or v_timezone = '' then
    raise exception 'TIMEZONE_INVALID' using errcode = 'PED14';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'TIMEZONE_INVALID' using errcode = 'PED14';
  end if;

  v_pickup := coalesce((p_config ->> 'pickup_enabled')::boolean, false);
  v_delivery := coalesce((p_config ->> 'delivery_enabled')::boolean, false);
  if not v_pickup and not v_delivery then
    raise exception 'NO_SERVICE_MODE' using errcode = 'PED15';
  end if;

  v_fee := public._validate_money(p_config -> 'delivery_fee');
  v_min := public._validate_money(p_config -> 'min_order_value');

  v_pickup_min := public._validate_minutes(p_config -> 'estimated_pickup_minutes');
  v_delivery_min := public._validate_minutes(p_config -> 'estimated_delivery_minutes');

  -- Aceite nunca é implícito: ausente = false.
  v_accepting := coalesce((p_config ->> 'accepting_orders')::boolean, false);

  v_hours := coalesce(p_config -> 'business_hours', '[]'::jsonb);
  if jsonb_typeof(v_hours) <> 'array' or jsonb_array_length(v_hours) <> 7 then
    raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
  end if;

  for v_hour in select * from jsonb_array_elements(v_hours)
  loop
    v_weekday := (v_hour ->> 'weekday')::smallint;
    if v_weekday is null or v_weekday not between 0 and 6 then
      raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
    end if;
    if v_weekday = any (v_days) then
      raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
    end if;
    v_days := array_append(v_days, v_weekday);

    v_is_open := coalesce((v_hour ->> 'is_open')::boolean, false);
    v_is_24h := coalesce((v_hour ->> 'is_24h')::boolean, false);

    if not v_is_open then
      if (v_hour ->> 'open_time') is not null or (v_hour ->> 'close_time') is not null then
        raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
      end if;
      continue;
    end if;

    if v_is_24h then
      if (v_hour ->> 'open_time') is not null or (v_hour ->> 'close_time') is not null then
        raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
      end if;
      continue;
    end if;

    begin
      v_open_time := (v_hour ->> 'open_time')::time;
      v_close_time := (v_hour ->> 'close_time')::time;
    exception when others then
      raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
    end;

    if v_open_time is null or v_close_time is null then
      raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
    end if;
  end loop;

  v_payments := coalesce(p_config -> 'payment_methods', '[]'::jsonb);
  if jsonb_typeof(v_payments) <> 'array' then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'PED17';
  end if;

  for v_payment in select * from jsonb_array_elements(v_payments)
  loop
    if (v_payment ->> 'method') = any (v_methods) then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'PED17';
    end if;
    if (v_payment ->> 'method') not in ('cash', 'pix', 'credit_card', 'debit_card') then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'PED17';
    end if;
    v_methods := array_append(v_methods, v_payment ->> 'method');
  end loop;

  -- Regras de aceite (server-authoritative): ligar pedidos exige
  -- ao menos um dia aberto e ao menos um pagamento habilitado.
  if v_accepting then
    if not exists (
      select 1
      from jsonb_array_elements(v_hours) as h
      where coalesce((h.value ->> 'is_open')::boolean, false)
    ) then
      raise exception 'INVALID_BUSINESS_HOURS' using errcode = 'PED18';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements(v_payments) as p
      where coalesce((p.value ->> 'is_enabled')::boolean, false)
    ) then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'PED17';
    end if;
  end if;

  insert into public.unit_operational_settings (
    unit_id, timezone, pickup_enabled, delivery_enabled, delivery_fee,
    min_order_value, estimated_pickup_minutes, estimated_delivery_minutes,
    accepting_orders, updated_at
  )
  values (
    p_unit_id, v_timezone, v_pickup, v_delivery, v_fee,
    v_min, v_pickup_min, v_delivery_min,
    v_accepting, now()
  )
  on conflict (unit_id) do update set
    timezone = excluded.timezone,
    pickup_enabled = excluded.pickup_enabled,
    delivery_enabled = excluded.delivery_enabled,
    delivery_fee = excluded.delivery_fee,
    min_order_value = excluded.min_order_value,
    estimated_pickup_minutes = excluded.estimated_pickup_minutes,
    estimated_delivery_minutes = excluded.estimated_delivery_minutes,
    accepting_orders = excluded.accepting_orders,
    updated_at = excluded.updated_at;

  delete from public.unit_business_hours where unit_id = p_unit_id;
  insert into public.unit_business_hours (unit_id, weekday, is_open, is_24h, open_time, close_time)
  select
    p_unit_id,
    (h ->> 'weekday')::smallint,
    coalesce((h ->> 'is_open')::boolean, false),
    coalesce((h ->> 'is_24h')::boolean, false),
    case
      when coalesce((h ->> 'is_open')::boolean, false)
       and not coalesce((h ->> 'is_24h')::boolean, false)
      then (h ->> 'open_time')::time
      else null
    end,
    case
      when coalesce((h ->> 'is_open')::boolean, false)
       and not coalesce((h ->> 'is_24h')::boolean, false)
      then (h ->> 'close_time')::time
      else null
    end
  from jsonb_array_elements(v_hours) as h
  order by (h ->> 'weekday')::smallint;

  delete from public.unit_payment_methods where unit_id = p_unit_id;
  insert into public.unit_payment_methods (unit_id, method, is_enabled)
  select
    p_unit_id,
    p ->> 'method',
    coalesce((p ->> 'is_enabled')::boolean, false)
  from jsonb_array_elements(v_payments) as p;

  return public.get_unit_operational_config(p_unit_id);
end;
$$;

revoke all on function public.save_unit_operational_config(uuid, jsonb) from public;
grant execute on function public.save_unit_operational_config(uuid, jsonb) to authenticated;
