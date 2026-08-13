-- Prompt 11 reconciliation: readiness requires one coherent pilot unit.
-- Migration 18 is already applied and remains immutable.

alter function public.get_org_pilot_readiness(uuid)
rename to _get_org_pilot_readiness_v18;

revoke all on function public._get_org_pilot_readiness_v18(uuid)
from public, anon, authenticated, service_role;

create function public.get_org_pilot_readiness(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_unit_ready boolean;
  v_check jsonb;
  v_blocking_ok integer;
  v_blocking_total integer;
begin
  v_result := public._get_org_pilot_readiness_v18(p_organization_id);

  select exists (
    select 1
    from public.units u
    where u.organization_id = p_organization_id
      and u.is_active
      and exists (
        select 1
        from public.unit_operational_settings s
        where s.unit_id = u.id
          and (s.pickup_enabled or s.delivery_enabled)
      )
      and exists (
        select 1
        from public.unit_business_hours h
        where h.unit_id = u.id
          and h.is_open
      )
      and exists (
        select 1
        from public.unit_payment_methods pm
        where pm.unit_id = u.id
          and pm.is_enabled
      )
      and exists (
        select 1
        from public.catalog_products p
        join public.catalog_categories c
          on c.id = p.category_id
         and c.organization_id = p.organization_id
         and c.unit_id = p.unit_id
        where p.organization_id = p_organization_id
          and p.unit_id = u.id
          and p.is_active
          and c.is_active
      )
      and exists (
        select 1
        from public.menu_publications mp
        where mp.organization_id = p_organization_id
          and mp.unit_id = u.id
      )
  ) into v_unit_ready;

  v_check := jsonb_build_object(
    'code', 'pilot_unit',
    'label', 'Unidade pronta para o piloto',
    'ok', v_unit_ready,
    'blocking', true,
    'detail', case
      when v_unit_ready then 'Ao menos uma unidade reúne todos os pré-requisitos operacionais'
      else 'Nenhuma unidade reúne configuração, horários, pagamento, catálogo e publicação'
    end
  );

  v_blocking_total := (v_result ->> 'blocking_total')::integer + 1;
  v_blocking_ok := (v_result ->> 'blocking_ok')::integer + case when v_unit_ready then 1 else 0 end;

  return v_result || jsonb_build_object(
    'ready', (v_result ->> 'ready')::boolean and v_unit_ready,
    'blocking_ok', v_blocking_ok,
    'blocking_total', v_blocking_total,
    'checks', (v_result -> 'checks') || jsonb_build_array(v_check)
  );
end;
$$;

revoke all on function public.get_org_pilot_readiness(uuid) from public, anon;
grant execute on function public.get_org_pilot_readiness(uuid) to authenticated;
