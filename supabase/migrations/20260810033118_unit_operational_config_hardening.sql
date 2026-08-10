-- =============================================================
-- PED-ON — Prompt 05 — Evolução da configuração operacional.
-- Endurece a validação de ETAs (minutos): aceita apenas número
-- inteiro ou string numérica inteira no intervalo 0–1440, sempre
-- com contrato de erro PED16 (nunca cast error do PostgreSQL).
-- Migration versionada aplicada pelo mecanismo oficial do projeto.
-- =============================================================

-- 1) Helper interno de minutos: null é aceito; valor presente deve
--    ser inteiro entre 0 e 1440.
create or replace function public._validate_minutes(p_value jsonb)
returns integer
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_value numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;

  if jsonb_typeof(p_value) not in ('number', 'string') then
    raise exception 'INVALID_MONEY' using errcode = 'PED16';
  end if;

  begin
    if jsonb_typeof(p_value) = 'number' then
      v_value := p_value::text::numeric;
    else
      v_value := btrim(p_value #>> '{}')::numeric;
    end if;
  exception when others then
    raise exception 'INVALID_MONEY' using errcode = 'PED16';
  end;

  if v_value < 0 or v_value > 1440 or v_value <> trunc(v_value) then
    raise exception 'INVALID_MONEY' using errcode = 'PED16';
  end if;

  return v_value::integer;
end;
$$;

revoke all on function public._validate_minutes(jsonb) from public;

-- 2) Re-aplica save_unit_operational_config usando o helper.
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

  v_accepting := coalesce((p_config ->> 'accepting_orders')::boolean, true);

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
