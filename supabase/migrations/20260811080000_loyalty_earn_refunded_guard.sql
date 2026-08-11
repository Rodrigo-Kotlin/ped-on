-- =============================================================
-- PED-ON - Prompt 09 (follow-up) - DEC-091: pedido estornado nao
-- acumula pontos. _loyalty_earn_order ganha guarda de payment_status;
-- o reverso de um earn ja concedido segue a cargo de
-- _loyalty_reverse_order quando o pagamento transita para refunded.
-- Backward-compatible: apenas redefine a funcao interna.
-- =============================================================

create or replace function public._loyalty_earn_order(p_order public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.loyalty_programs;
  v_account public.loyalty_accounts;
  v_points bigint;
  v_repayment bigint;
begin
  if p_order.loyalty_membership_id is null then
    return;
  end if;

  -- DEC-091: pedido estornado nunca acumula; o reverso de um earn ja
  -- concedido e responsabilidade de _loyalty_reverse_order no refund.
  if p_order.payment_status = 'refunded' then
    return;
  end if;

  if exists (
    select 1
    from public.loyalty_ledger as l
    where l.order_id = p_order.id
      and l.entry_type in ('earn', 'reversal')
  ) then
    return;
  end if;

  select lp.* into v_program
  from public.loyalty_programs as lp
  where lp.organization_id = p_order.organization_id;

  if v_program.organization_id is null or not v_program.enabled then
    return;
  end if;

  v_points := floor(p_order.subtotal * v_program.points_per_real)::bigint;
  if v_points <= 0 then
    return;
  end if;

  select ac.* into v_account
  from public.loyalty_accounts as ac
  where ac.membership_id = p_order.loyalty_membership_id
  for update of ac;

  if v_account.membership_id is null then
    raise exception 'LOYALTY_INTEGRITY' using errcode = 'PED53';
  end if;

  insert into public.loyalty_ledger (
    organization_id, membership_id, order_id, entry_type, amount
  ) values (
    p_order.organization_id, p_order.loyalty_membership_id,
    p_order.id, 'earn', v_points
  );

  v_repayment := least(v_points, v_account.recovery_points);
  update public.loyalty_accounts
  set points_balance = v_account.points_balance + v_points - v_repayment,
      recovery_points = v_account.recovery_points - v_repayment,
      updated_at = clock_timestamp()
  where membership_id = v_account.membership_id;
end;
$$;

revoke all on function public._loyalty_earn_order(public.orders)
  from public, anon, authenticated;
