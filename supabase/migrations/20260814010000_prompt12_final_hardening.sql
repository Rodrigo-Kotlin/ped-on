-- =============================================================
-- PED-ON — Prompt 12 Etapa 5 - hardening final.
-- Corrige serializacao de mutacoes estruturais com publicacao,
-- torna single => max_select = 1 uma regra autoritativa e fecha a
-- corrida entre disponibilidade da opcao e snapshot do pedido.
-- =============================================================

-- 1) Single sempre representa exatamente uma escolha maxima, para
--    qualquer kind que permita esse modo. O remoto foi verificado sem
--    linhas legadas incompatíveis antes desta migration.
alter table public.catalog_product_option_groups
  add constraint catalog_product_option_groups_single_check
  check (selection_mode <> 'single' or max_select = 1);

alter table public.menu_version_option_groups
  add constraint menu_version_option_groups_single_check
  check (selection_mode <> 'single' or max_select = 1);

create function public._guard_option_group_single_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.selection_mode = 'single' and new.max_select <> 1 then
    raise exception 'INVALID_SELECTION_RULE' using errcode = 'PED73';
  end if;
  return new;
end;
$$;

revoke all on function public._guard_option_group_single_rule()
  from public, anon, authenticated;

create trigger b_catalog_product_option_groups_single_guard
before insert or update on public.catalog_product_option_groups
for each row execute function public._guard_option_group_single_rule();

-- 2) Toda mutacao estrutural participa do mesmo lock por produto usado
--    por publish_unit_menu. O prefixo `a_` garante que o lock ocorre
--    antes dos demais triggers BEFORE de validacao.
create function public._lock_product_option_structure()
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

create trigger a_catalog_product_option_groups_product_lock
before insert or update or delete on public.catalog_product_option_groups
for each row execute function public._lock_product_option_structure();

create trigger a_catalog_product_options_product_lock
before insert or update or delete on public.catalog_product_options
for each row execute function public._lock_product_option_structure();

-- 3) Defesa final no snapshot do pedido. A row lock da opcao mutavel
--    lineariza checkout versus toggle/delete; uma falha aborta toda a
--    transacao, portanto nunca deixa pedido parcial. A regra single
--    também protege versões publicadas antes deste hardening.
create function public._guard_order_item_option_live_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available boolean;
  v_selection_mode text;
begin
  select co.is_available into v_available
  from public.menu_version_options as o
  join public.menu_version_products as mp
    on mp.id = o.menu_product_id
   and mp.organization_id = o.organization_id
   and mp.unit_id = o.unit_id
   and mp.menu_version_id = o.menu_version_id
  join public.catalog_product_options as co
    on co.id = o.source_option_id
   and co.organization_id = o.organization_id
   and co.unit_id = o.unit_id
   and co.product_id = mp.source_product_id
  where o.id = new.menu_option_id
    and o.organization_id = new.organization_id
    and o.unit_id = new.unit_id
    and o.menu_version_id = new.menu_version_id
    and o.menu_product_id = new.menu_item_id
    and o.menu_group_id = new.menu_group_id
  for share of co;

  if not found or not v_available then
    raise exception 'OPTION_UNAVAILABLE' using errcode = 'PED75';
  end if;

  select g.selection_mode into v_selection_mode
  from public.menu_version_option_groups as g
  where g.id = new.menu_group_id
    and g.organization_id = new.organization_id
    and g.unit_id = new.unit_id
    and g.menu_version_id = new.menu_version_id
    and g.menu_product_id = new.menu_item_id;

  if v_selection_mode is null then
    raise exception 'OPTION_NOT_FOUND' using errcode = 'PED74';
  end if;

  if v_selection_mode = 'single' then
    perform 1
    from public.order_items as item
    where item.id = new.order_item_id
    for update of item;

    if exists (
      select 1
      from public.order_item_options as existing
      where existing.order_item_id = new.order_item_id
        and existing.menu_group_id = new.menu_group_id
    ) then
      raise exception 'SELECTION_LIMIT_EXCEEDED' using errcode = 'PED77';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public._guard_order_item_option_live_selection()
  from public, anon, authenticated;

create trigger order_item_options_live_selection_guard
before insert on public.order_item_options
for each row execute function public._guard_order_item_option_live_selection();
