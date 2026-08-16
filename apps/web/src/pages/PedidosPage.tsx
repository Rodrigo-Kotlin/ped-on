import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAdmin } from '../lib/admin/admin-context';
import { formatBRL } from '../lib/money';
import { orderOptionLabel } from '../lib/orders/order-option-label';
import {
  ACTIVE_ORDER_STATUSES,
  canCancelOrder,
  deriveOrderOperationalDurations,
  deriveOrderOperationalTimeline,
  fetchOrderAdmin,
  fetchUnitOrdersAdminV2,
  getPrimaryOrderAction,
  getPrimaryPaymentAction,
  HISTORY_ORDER_STATUSES,
  isTerminalOrderStatus,
  normalizeAdminOrderDateRange,
  normalizeAdminOrderFilters,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_MODE_LABELS,
  unitOrderDetailKey,
  unitOrdersV2ListKey,
} from '../lib/orders/orders';
import type {
  AdminOrderDetail,
  AdminOrderEvent,
  AdminOrderSummaryV2,
  NormalizedAdminOrderFilters,
  OrderAdminView,
  OrderStatus,
  PaymentMethodCode,
  PaymentStatus,
  ServiceMode,
} from '../lib/orders/orders';
import { useOrderPaymentMutation, useOrderStatusMutation } from '../lib/orders/useOrderMutations';
import {
  elapsedMinutes,
  remainingMinutes,
  useOperationalNow,
} from '../lib/orders/useOperationalNow';

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function time(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

interface OrderFiltersDraft {
  statuses: OrderStatus[];
  service_mode: ServiceMode | '';
  payment_status: PaymentStatus | '';
  payment_method: PaymentMethodCode | '';
  order_number: string;
  date_from: string;
  date_to: string;
}

function emptyFiltersDraft(): OrderFiltersDraft {
  return {
    statuses: [],
    service_mode: '',
    payment_status: '',
    payment_method: '',
    order_number: '',
    date_from: '',
    date_to: '',
  };
}

function minutesText(value: number): string {
  return `${value} min`;
}

function isOrderOverdue(order: AdminOrderSummaryV2, now: number): boolean {
  return order.expected_at !== null && Date.parse(order.expected_at) < now;
}

function OrderOperationalTime({
  order,
  view,
  now,
}: {
  order: AdminOrderSummaryV2;
  view: OrderAdminView;
  now: number;
}) {
  if (view === 'history') {
    const finalTimestamp = order.status === 'completed' ? order.completed_at : order.cancelled_at;
    return (
      <span className="mt-2 block space-y-0.5 text-xs text-pedon-text/70">
        <span className="block">
          Recebido há {minutesText(elapsedMinutes(order.created_at, now))}
        </span>
        {finalTimestamp !== null && (
          <span className="block">
            {order.status === 'completed' ? 'Concluído' : 'Cancelado'} às {time(finalTimestamp)}
          </span>
        )}
      </span>
    );
  }

  const overdue = isOrderOverdue(order, now);
  return (
    <span className="mt-2 block space-y-0.5 text-xs text-pedon-text/70">
      <span className="block">
        Recebido há {minutesText(elapsedMinutes(order.created_at, now))}
      </span>
      <span className="block">
        No status há {minutesText(elapsedMinutes(order.status_updated_at, now))}
      </span>
      {order.expected_at !== null &&
        (overdue ? (
          <span className="block font-bold text-red-800">
            Atrasado há {minutesText(elapsedMinutes(order.expected_at, now))}
          </span>
        ) : (
          <span className="block">
            Previsto {time(order.expected_at)} · Restam{' '}
            {minutesText(remainingMinutes(order.expected_at, now))}
          </span>
        ))}
    </span>
  );
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

function eventDescription(event: AdminOrderEvent): string {
  if (event.event_type === 'created') return 'Pedido recebido';
  if (event.event_type === 'payment_changed') {
    return `Pagamento: ${PAYMENT_STATUS_LABELS[event.to_value as PaymentStatus]}`;
  }
  const from =
    event.from_value !== null ? ORDER_STATUS_LABELS[event.from_value as OrderStatus] : null;
  const to = ORDER_STATUS_LABELS[event.to_value as OrderStatus];
  return from === null ? `Status: ${to}` : `Status: ${from} → ${to}`;
}

function OrderOperationSection({ order }: { order: AdminOrderDetail }) {
  const timeline = deriveOrderOperationalTimeline(order.events, order);
  const durations = deriveOrderOperationalDurations(timeline);
  const milestones: Array<{ key: keyof typeof timeline; label: string }> = [
    { key: 'created_at', label: 'Recebido' },
    { key: 'confirmed_at', label: 'Confirmado' },
    { key: 'preparing_at', label: 'Em preparo' },
    { key: 'ready_at', label: 'Pronto' },
    { key: 'out_for_delivery_at', label: 'Saiu para entrega' },
    timeline.cancelled_at !== null
      ? { key: 'cancelled_at', label: 'Cancelado' }
      : { key: 'completed_at', label: 'Concluído' },
  ];
  const durationRows = [
    { label: 'Aceitação', value: durations.acceptance_minutes },
    { label: 'Preparo', value: durations.preparation_minutes },
    { label: 'Entrega', value: durations.delivery_minutes },
    { label: 'Ciclo total', value: durations.total_cycle_minutes },
  ];

  return (
    <section aria-labelledby="operacao-heading" className="mt-5 border-t border-pedon-navy/10 pt-5">
      <h3 id="operacao-heading" className="font-bold text-pedon-navy">
        Operação
      </h3>
      <ul className="mt-3 space-y-1 text-sm">
        {milestones.map((milestone) => {
          const at = timeline[milestone.key];
          if (at === null) return null;
          return (
            <li key={milestone.key} className="flex justify-between gap-3">
              <span>{milestone.label}</span>
              <time dateTime={at}>{dateTime(at)}</time>
            </li>
          );
        })}
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-pedon-navy/10 pt-3 text-sm">
        {durationRows.map((row) =>
          row.value === null ? null : (
            <div key={row.label} className="rounded-md bg-pedon-surface px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-pedon-text/60">
                {row.label}
              </dt>
              <dd className="font-bold text-pedon-navy">{row.value} min</dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}

function OrderCard({
  unitId,
  order,
  view,
  now,
  isSelected,
  onOpen,
  onOrderRemoved,
  openButtonRef,
}: {
  unitId: string;
  order: AdminOrderSummaryV2;
  view: OrderAdminView;
  now: number;
  isSelected: boolean;
  onOpen: (orderId: string) => void;
  onOrderRemoved: (orderId: string) => void;
  openButtonRef: (node: HTMLButtonElement | null) => void;
}) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const paymentActionRef = useRef<HTMLButtonElement>(null);
  const statusMutation = useOrderStatusMutation(unitId, order.id);
  const paymentMutation = useOrderPaymentMutation(unitId, order.id);
  const busy = statusMutation.isPending || paymentMutation.isPending;
  const displayedStatus = statusMutation.data?.status ?? order.status;
  const displayedPaymentStatus = paymentMutation.data?.payment_status ?? order.payment_status;
  const statusTarget = statusMutation.variables;
  const primaryAction = getPrimaryOrderAction({
    status: displayedStatus,
    service_mode: order.service_mode,
  });
  const paymentAction = getPrimaryPaymentAction(displayedPaymentStatus);
  const canCancel = canCancelOrder(displayedStatus);
  const primaryBusy = statusMutation.isPending && statusTarget === primaryAction?.nextStatus;
  const cancelBusy = statusMutation.isPending && statusTarget === 'cancelled';
  const actionError = statusMutation.error?.message ?? paymentMutation.error?.message ?? null;
  const overdue = view === 'active' && isOrderOverdue(order, now);
  const isSuccess = statusMutation.isSuccess || paymentMutation.isSuccess;
  const wasSuccessRef = useRef(false);

  useEffect(() => {
    if (isSuccess && !wasSuccessRef.current) {
      const appliedStatus = statusMutation.data?.status ?? statusTarget ?? order.status;
      if (view === 'active' && isTerminalOrderStatus(appliedStatus)) {
        onOrderRemoved(order.id);
      } else {
        const raf = requestAnimationFrame(() => {
          if (primaryActionRef.current !== null) primaryActionRef.current.focus();
          else if (paymentActionRef.current !== null) paymentActionRef.current.focus();
        });
        return () => cancelAnimationFrame(raf);
      }
    }
    wasSuccessRef.current = isSuccess;
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, statusTarget, order.status, order.id, view, onOrderRemoved]);

  function cancelOrder() {
    if (
      !window.confirm(`Cancelar o pedido #${order.order_number}? Esta ação não pode ser desfeita.`)
    ) {
      return;
    }
    statusMutation.mutate('cancelled');
  }

  return (
    <article
      aria-busy={busy}
      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition hover:border-pedon-orange ${
        isSelected ? 'ring-2 ring-pedon-orange/70 ring-offset-2 ' : ''
      }${
        overdue
          ? 'border-l-4 border-l-red-700 border-y-red-300 border-r-red-300'
          : order.status === 'new'
            ? 'border-l-4 border-l-pedon-orange border-y-pedon-orange/40 border-r-pedon-orange/40'
            : order.status === 'ready'
              ? 'border-l-4 border-l-pedon-navy border-y-pedon-navy/25 border-r-pedon-navy/25'
              : 'border-pedon-navy/15'
      }`}
    >
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => onOpen(order.id)}
        aria-label={`Abrir pedido ${order.order_number} de ${order.customer_name}`}
        aria-current={isSelected ? 'true' : undefined}
        className="w-full p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pedon-orange"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-bold text-pedon-navy">
              #{order.order_number} · {time(order.created_at)}
            </span>
            <span className="mt-1 block truncate font-medium">{order.customer_name}</span>
          </span>
          <span className="shrink-0 rounded-full bg-pedon-surface px-2.5 py-1 text-xs font-bold text-pedon-navy">
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </span>
        <span className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
          {order.status === 'new' && (
            <span className="rounded-full bg-orange-50 px-2 py-1 text-pedon-orange">
              Novo pedido
            </span>
          )}
          {overdue && (
            <span className="rounded-full bg-red-50 px-2 py-1 text-red-800">Atrasado</span>
          )}
          {order.status === 'ready' && (
            <span className="rounded-full bg-pedon-surface px-2 py-1 text-pedon-navy">
              Pronto para {order.service_mode === 'pickup' ? 'retirada' : 'entrega'}
            </span>
          )}
          {order.status === 'out_for_delivery' && (
            <span className="rounded-full bg-pedon-surface px-2 py-1 text-pedon-navy">Em rota</span>
          )}
        </span>
        <OrderOperationalTime order={order} view={view} now={now} />
        <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-3">
          <span>{SERVICE_MODE_LABELS[order.service_mode]}</span>
          <span>
            {order.item_count} {order.item_count === 1 ? 'item' : 'itens'}
          </span>
          <span className="font-bold">{formatBRL(order.total)}</span>
          <span className="col-span-2 break-words sm:col-span-2">
            {PAYMENT_METHOD_LABELS[order.payment_method]} ·{' '}
            {PAYMENT_STATUS_LABELS[order.payment_status]}
          </span>
        </span>
      </button>
      <footer className="flex flex-wrap gap-2 border-t border-pedon-navy/10 bg-pedon-surface/60 p-3">
        {primaryAction !== null && (
          <button
            ref={primaryActionRef}
            type="button"
            disabled={busy}
            onClick={() => statusMutation.mutate(primaryAction.nextStatus)}
            className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
          >
            {primaryBusy ? 'Atualizando…' : primaryAction.label}
          </button>
        )}
        {paymentAction !== null && (
          <button
            ref={paymentActionRef}
            type="button"
            disabled={busy}
            onClick={() => paymentMutation.mutate(paymentAction.nextStatus)}
            className="min-h-11 rounded-md bg-pedon-navy px-4 font-semibold text-white disabled:opacity-50"
          >
            {paymentMutation.isPending ? 'Atualizando…' : paymentAction.label}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={cancelOrder}
            className="min-h-11 rounded-md border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-50"
          >
            {cancelBusy ? 'Atualizando…' : 'Cancelar'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen(order.id)}
          className="ml-auto min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy"
        >
          Detalhes
        </button>
      </footer>
      {actionError !== null && (
        <p role="alert" className="bg-red-50 px-3 py-2 text-sm text-red-800">
          {actionError}
        </p>
      )}
    </article>
  );
}

function OrderDetail({
  unitId,
  orderId,
  now,
  canManageUnit,
  onClose,
}: {
  unitId: string;
  orderId: string;
  now: number;
  canManageUnit: boolean;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasFocusedRef = useRef(false);
  const statusMutation = useOrderStatusMutation(unitId, orderId);
  const paymentMutation = useOrderPaymentMutation(unitId, orderId);
  const detailQuery = useQuery({
    queryKey: unitOrderDetailKey(unitId, orderId),
    queryFn: () => fetchOrderAdmin(orderId),
  });

  useEffect(() => {
    if (detailQuery.data !== undefined && !hasFocusedRef.current) {
      headingRef.current?.focus();
      hasFocusedRef.current = true;
    }
  }, [detailQuery.data]);

  if (detailQuery.isLoading) {
    return <p role="status">Carregando detalhes do pedido…</p>;
  }
  if (detailQuery.isError || detailQuery.data === undefined) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
        <p>{(detailQuery.error as Error | null)?.message ?? 'Não foi possível abrir o pedido.'}</p>
        <button type="button" onClick={onClose} className="mt-3 min-h-11 font-semibold underline">
          Fechar detalhe
        </button>
      </div>
    );
  }

  const order = detailQuery.data;
  const busy = statusMutation.isPending || paymentMutation.isPending;
  const statusTarget = statusMutation.variables;
  const primaryAction = getPrimaryOrderAction(order);
  const canCancel = canCancelOrder(order.status);
  const statusBusyPrimary =
    statusMutation.isPending && primaryAction !== null && statusTarget === primaryAction.nextStatus;
  const statusBusyCancel = statusMutation.isPending && statusTarget === 'cancelled';
  const actionError = statusMutation.error?.message ?? paymentMutation.error?.message ?? null;

  function changeStatus(nextStatus: OrderStatus) {
    if (
      nextStatus === 'cancelled' &&
      !window.confirm(`Cancelar o pedido #${order.order_number}? Esta ação não pode ser desfeita.`)
    ) {
      return;
    }
    statusMutation.mutate(nextStatus);
  }

  function refund() {
    if (
      window.confirm(
        'Esta ação apenas registra o reembolso no Ped-On. A devolução do valor deve ser realizada externamente. Deseja continuar?',
      )
    ) {
      paymentMutation.mutate('refunded');
    }
  }

  const address = order.delivery_address;

  return (
    <section
      aria-labelledby="order-detail-title"
      className="min-w-0 rounded-xl border border-pedon-navy/15 bg-white p-4 shadow-sm sm:p-5 lg:sticky lg:top-4 lg:max-h-[calc(100svh-2rem)] lg:self-start lg:overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-pedon-orange">Detalhe</p>
          <h2
            id="order-detail-title"
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 text-xl font-bold text-pedon-navy outline-none"
          >
            Pedido #{order.order_number}
          </h2>
          <p className="mt-1 text-sm">Recebido em {dateTime(order.created_at)}</p>
          {!isTerminalOrderStatus(order.status) && (
            <p className="text-sm text-pedon-text/70">
              No status há {minutesText(elapsedMinutes(order.status_updated_at, now))}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-pedon-surface px-2.5 py-1 text-pedon-navy">
              {ORDER_STATUS_LABELS[order.status]}
            </span>
            <span className="rounded-full bg-pedon-surface px-2.5 py-1 text-pedon-navy">
              {SERVICE_MODE_LABELS[order.service_mode]}
            </span>
            <span className="rounded-full bg-pedon-surface px-2.5 py-1 text-pedon-navy">
              {PAYMENT_STATUS_LABELS[order.payment_status]}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Fechar pedido ${order.order_number}`}
          className="min-h-11 shrink-0 rounded-md border border-pedon-navy/20 px-3 font-semibold"
        >
          Fechar
        </button>
      </div>

      {actionError !== null && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </p>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <section aria-labelledby="customer-heading">
          <h3 id="customer-heading" className="font-bold text-pedon-navy">
            Cliente e entrega
          </h3>
          <dl className="mt-2 space-y-2 text-sm">
            <div>
              <dt className="font-medium">Nome</dt>
              <dd className="break-words">{order.customer_name}</dd>
            </div>
            <div>
              <dt className="font-medium">Telefone</dt>
              <dd>
                <a className="underline" href={`tel:${order.customer_phone}`}>
                  {formatPhone(order.customer_phone)}
                </a>
              </dd>
            </div>
            <div>
              <dt className="font-medium">Atendimento</dt>
              <dd>{SERVICE_MODE_LABELS[order.service_mode]}</dd>
            </div>
            {address !== null && (
              <div>
                <dt className="font-medium">Endereço completo</dt>
                <dd className="break-words">
                  {address.street}, {address.number}
                  {address.complement ? `, ${address.complement}` : ''}
                  <br />
                  {address.neighborhood}, {address.city} - {address.state}
                  {address.postal_code ? `, CEP ${address.postal_code}` : ''}
                  {address.reference && (
                    <>
                      <br />
                      Referência: {address.reference}
                    </>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section aria-labelledby="payment-heading">
          <h3 id="payment-heading" className="font-bold text-pedon-navy">
            Pagamento
          </h3>
          <dl className="mt-2 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt>Método</dt>
              <dd className="text-right font-medium">
                {PAYMENT_METHOD_LABELS[order.payment_method]}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Status</dt>
              <dd className="text-right font-bold">
                {PAYMENT_STATUS_LABELS[order.payment_status]}
              </dd>
            </div>
            {order.cash_change_for !== null && (
              <div className="flex justify-between gap-3">
                <dt>Troco para</dt>
                <dd>{formatBRL(order.cash_change_for)}</dd>
              </div>
            )}
          </dl>
          <div className="mt-3">
            {order.payment_status === 'pending' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => paymentMutation.mutate('paid')}
                className="min-h-11 w-full rounded-md bg-pedon-navy px-4 font-semibold text-white disabled:opacity-50"
              >
                {paymentMutation.isPending ? 'Atualizando…' : 'Marcar como pago'}
              </button>
            )}
            {order.payment_status === 'paid' && canManageUnit && (
              <button
                type="button"
                disabled={busy}
                onClick={refund}
                className="min-h-11 w-full rounded-md border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-50"
              >
                Registrar reembolso
              </button>
            )}
          </div>
        </section>
      </div>

      <OrderOperationSection order={order} />

      <section aria-labelledby="items-heading" className="mt-5 border-t border-pedon-navy/10 pt-5">
        <h3 id="items-heading" className="font-bold text-pedon-navy">
          Itens ({order.item_count})
        </h3>
        <ul className="mt-2 divide-y divide-pedon-navy/10">
          {order.items.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="min-w-0 break-words font-medium">
                  {item.quantity}x {item.product_name}
                </span>
                <span className="shrink-0">{formatBRL(item.line_total)}</span>
              </div>
              {(item.options ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5 text-pedon-text/70">
                  {(item.options ?? []).map((option) => (
                    <li key={option.id}>{orderOptionLabel(option)}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-pedon-text/60">{formatBRL(item.unit_price)} cada</p>
              {item.note && (
                <p className="mt-1 break-words text-pedon-text/70">Obs.: {item.note}</p>
              )}
            </li>
          ))}
        </ul>
        {order.notes && <p className="mt-3 break-words text-sm">Observação: {order.notes}</p>}
        <dl className="mt-4 space-y-1 border-t border-pedon-navy/10 pt-3 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatBRL(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Taxa de entrega</dt>
            <dd>{formatBRL(order.delivery_fee)}</dd>
          </div>
          <div className="flex justify-between text-base font-bold">
            <dt>Total</dt>
            <dd>{formatBRL(order.total)}</dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="actions-heading"
        className="mt-5 border-t border-pedon-navy/10 pt-5"
      >
        <h3 id="actions-heading" className="font-bold text-pedon-navy">
          Status: {ORDER_STATUS_LABELS[order.status]}
        </h3>
        {(primaryAction !== null || canCancel) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {primaryAction !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => statusMutation.mutate(primaryAction.nextStatus)}
                className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
              >
                {statusBusyPrimary ? 'Atualizando…' : primaryAction.label}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={() => changeStatus('cancelled')}
                className="min-h-11 rounded-md border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-50"
              >
                {statusBusyCancel ? 'Atualizando…' : 'Cancelar'}
              </button>
            )}
          </div>
        )}
      </section>

      <section
        aria-labelledby="timeline-heading"
        className="mt-5 border-t border-pedon-navy/10 pt-5"
      >
        <h3 id="timeline-heading" className="font-bold text-pedon-navy">
          Linha do tempo
        </h3>
        <ol className="mt-3 space-y-3">
          {order.events.map((event) => (
            <li key={event.id} className="border-l-2 border-pedon-orange pl-3 text-sm">
              <p className="font-medium">{eventDescription(event)}</p>
              <time dateTime={event.created_at} className="text-pedon-text/65">
                {dateTime(event.created_at)}
              </time>
              {event.note && <p className="mt-1 break-words">{event.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function OrdersForUnit({ unitId, unitName }: { unitId: string; unitName: string }) {
  const { canManageUnit } = useAdmin();
  const orderButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draftFilters, setDraftFilters] = useState<OrderFiltersDraft>(emptyFiltersDraft);
  const [appliedFilters, setAppliedFilters] = useState<NormalizedAdminOrderFilters>(() =>
    normalizeAdminOrderFilters({ view: 'active' }),
  );
  const [filterError, setFilterError] = useState<string | null>(null);
  const [hasChangedQuery, setHasChangedQuery] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const now = useOperationalNow();
  const ordersQuery = useInfiniteQuery({
    queryKey: unitOrdersV2ListKey(unitId, appliedFilters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchUnitOrdersAdminV2(unitId, appliedFilters, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page_info.has_more && lastPage.page_info.next_cursor !== null
        ? lastPage.page_info.next_cursor
        : undefined,
  });
  const pages = ordersQuery.data?.pages ?? [];
  const orders = pages.flatMap((page) => page.orders);
  const totalCount = pages[0]?.total_count ?? 0;
  const view = appliedFilters.view;
  const statusOptions = view === 'active' ? ACTIVE_ORDER_STATUSES : HISTORY_ORDER_STATUSES;

  function rejectOfflineQueryChange(): boolean {
    if (navigator.onLine) return false;
    setFilterError(
      'Você está offline. Os pedidos carregados continuam visíveis; reconecte para atualizar os filtros.',
    );
    return true;
  }

  function closeDetail() {
    const orderId = selectedOrderId;
    setSelectedOrderId(null);
    if (orderId !== null) {
      window.requestAnimationFrame(() => orderButtonRefs.current.get(orderId)?.focus());
    }
  }

  function handleOrderRemoved(orderId: string) {
    orderButtonRefs.current.delete(orderId);
    window.requestAnimationFrame(() => {
      for (const node of orderButtonRefs.current.values()) {
        if (node.isConnected) {
          node.focus();
          return;
        }
      }
      headingRef.current?.focus();
    });
  }

  function changeView(nextView: OrderAdminView) {
    if (nextView === view) return;
    if (rejectOfflineQueryChange()) return;
    const nextDraftStatuses = normalizeAdminOrderFilters({
      view: nextView,
      statuses: draftFilters.statuses,
    }).statuses;
    setDraftFilters((current) => ({
      ...current,
      statuses: nextDraftStatuses === undefined ? [] : [...nextDraftStatuses],
    }));
    setAppliedFilters((current) => normalizeAdminOrderFilters({ ...current, view: nextView }));
    setSelectedOrderId(null);
    setFilterError(null);
    setHasChangedQuery(true);
  }

  function toggleDraftStatus(status: OrderStatus) {
    setDraftFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status],
    }));
  }

  function applyFilters() {
    const orderNumberText = draftFilters.order_number.trim();
    const orderNumber = Number(orderNumberText);
    if (
      orderNumberText !== '' &&
      (!/^\d+$/.test(orderNumberText) || !Number.isSafeInteger(orderNumber) || orderNumber <= 0)
    ) {
      setFilterError('Informe um número de pedido maior que zero.');
      return;
    }
    const dates = normalizeAdminOrderDateRange(draftFilters.date_from, draftFilters.date_to);
    if (dates.error !== null) {
      setFilterError(dates.error);
      return;
    }
    if (rejectOfflineQueryChange()) return;

    setAppliedFilters(
      normalizeAdminOrderFilters({
        view,
        statuses: draftFilters.statuses,
        ...(draftFilters.service_mode === '' ? {} : { service_mode: draftFilters.service_mode }),
        ...(draftFilters.payment_status === ''
          ? {}
          : { payment_status: draftFilters.payment_status }),
        ...(draftFilters.payment_method === ''
          ? {}
          : { payment_method: draftFilters.payment_method }),
        ...(orderNumberText === '' ? {} : { order_number: orderNumber }),
        ...(dates.date_from === undefined ? {} : { date_from: dates.date_from }),
        ...(dates.date_to === undefined ? {} : { date_to: dates.date_to }),
      }),
    );
    setSelectedOrderId(null);
    setFilterError(null);
    setHasChangedQuery(true);
  }

  function clearFilters() {
    if (rejectOfflineQueryChange()) return;
    setDraftFilters(emptyFiltersDraft());
    setAppliedFilters(normalizeAdminOrderFilters({ view }));
    setSelectedOrderId(null);
    setFilterError(null);
    setHasChangedQuery(true);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
            Central 2.0
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 text-2xl font-bold text-pedon-navy outline-none"
          >
            Pedidos
          </h2>
          <p className="mt-1 text-sm text-pedon-text/70">{unitName}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!rejectOfflineQueryChange()) void ordersQuery.refetch();
          }}
          disabled={ordersQuery.isFetching}
          className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
        >
          {ordersQuery.isFetching ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <div className="mt-5 flex gap-2 border-b border-pedon-navy/15" aria-label="Visão dos pedidos">
        {(
          [
            { value: 'active', label: 'Ativos' },
            { value: 'history', label: 'Histórico' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={view === tab.value}
            onClick={() => changeView(tab.value)}
            className={
              view === tab.value
                ? 'min-h-11 border-b-2 border-pedon-orange px-4 font-bold text-pedon-navy'
                : 'min-h-11 px-4 font-semibold text-pedon-text/65'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        aria-labelledby="filters-heading"
        className="mt-5 rounded-xl border border-pedon-navy/15 bg-white p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="filters-heading" className="font-bold text-pedon-navy">
            Filtros
          </h3>
          <p className="text-xs text-pedon-text/60">Aplicados somente ao confirmar</p>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Status</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {statusOptions.map((status) => (
              <label
                key={status}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-pedon-navy/20 px-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={draftFilters.statuses.includes(status)}
                  onChange={() => toggleDraftStatus(status)}
                  className="size-4 accent-pedon-orange"
                />
                {ORDER_STATUS_LABELS[status]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-sm font-medium">
            Modalidade
            <select
              value={draftFilters.service_mode}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  service_mode: event.target.value as ServiceMode | '',
                }))
              }
              className="mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3"
            >
              <option value="">Todas</option>
              <option value="pickup">Retirada</option>
              <option value="delivery">Entrega</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Pagamento
            <select
              value={draftFilters.payment_status}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  payment_status: event.target.value as PaymentStatus | '',
                }))
              }
              className="mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3"
            >
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="paid">Pago</option>
              <option value="refunded">Reembolsado</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Forma de pagamento
            <select
              value={draftFilters.payment_method}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  payment_method: event.target.value as PaymentMethodCode | '',
                }))
              }
              className="mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3"
            >
              <option value="">Todas</option>
              <option value="cash">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="credit_card">Cartão de crédito</option>
              <option value="debit_card">Cartão de débito</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Número do pedido
            <input
              type="text"
              inputMode="numeric"
              value={draftFilters.order_number}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  order_number: event.target.value,
                }))
              }
              className="mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 px-3"
              placeholder="Ex.: 83"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-1 lg:col-span-2 xl:col-span-1">
            Data inicial
            <input
              type="datetime-local"
              value={draftFilters.date_from}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, date_from: event.target.value }))
              }
              className="mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 px-3"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-1 lg:col-span-2 xl:col-span-1">
            Data final
            <input
              type="datetime-local"
              value={draftFilters.date_to}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, date_to: event.target.value }))
              }
              className="mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 px-3"
            />
          </label>
        </div>

        {filterError !== null && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
            {filterError}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="min-h-11 rounded-md bg-pedon-navy px-5 font-semibold text-white"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="min-h-11 rounded-md border border-pedon-navy/25 px-5 font-semibold text-pedon-navy"
          >
            Limpar
          </button>
        </div>
      </section>

      {ordersQuery.isLoading && (
        <p role="status" className="mt-6">
          {hasChangedQuery ? 'Aplicando filtros…' : 'Carregando pedidos…'}
        </p>
      )}
      {ordersQuery.isError && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-red-800">
          {(ordersQuery.error as Error).message}
        </p>
      )}
      {ordersQuery.data !== undefined && (
        <div
          id="orders-tabpanel"
          aria-label={view === 'active' ? 'Pedidos ativos' : 'Histórico de pedidos'}
          className={
            selectedOrderId === null
              ? 'mt-5'
              : 'mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(22rem,0.9fr)_minmax(28rem,1.1fr)] xl:grid-cols-[minmax(26rem,0.85fr)_minmax(36rem,1.15fr)]'
          }
        >
          <section aria-label="Lista de pedidos" className="min-w-0">
            <p className="mb-3 text-sm text-pedon-text/70" aria-live="polite">
              {totalCount} {totalCount === 1 ? 'pedido encontrado' : 'pedidos encontrados'} ·{' '}
              {orders.length} {orders.length === 1 ? 'exibido' : 'exibidos'}
              {ordersQuery.isFetching && !ordersQuery.isFetchingNextPage ? ' · Atualizando…' : ''}
            </p>
            {orders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
                <p>
                  {view === 'active'
                    ? 'Nenhum pedido ativo.'
                    : 'Nenhum pedido no histórico para estes filtros.'}
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 min-h-11 font-semibold underline"
                >
                  Limpar filtros
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {orders.map((order) => (
                  <li key={order.id}>
                    <OrderCard
                      unitId={unitId}
                      order={order}
                      view={view}
                      now={now}
                      isSelected={selectedOrderId === order.id}
                      onOpen={(orderId) => setSelectedOrderId(orderId)}
                      onOrderRemoved={handleOrderRemoved}
                      openButtonRef={(node) => {
                        if (node === null) orderButtonRefs.current.delete(order.id);
                        else orderButtonRefs.current.set(order.id, node);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            {ordersQuery.hasNextPage && (
              <button
                type="button"
                onClick={() => void ordersQuery.fetchNextPage()}
                disabled={ordersQuery.isFetching}
                className="mt-4 min-h-11 w-full rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
              >
                {ordersQuery.isFetchingNextPage ? 'Carregando mais…' : 'Carregar mais'}
              </button>
            )}
          </section>

          {selectedOrderId !== null && (
            <OrderDetail
              key={selectedOrderId}
              unitId={unitId}
              orderId={selectedOrderId}
              now={now}
              canManageUnit={canManageUnit}
              onClose={closeDetail}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function PedidosPage() {
  const { selectedUnit } = useAdmin();

  if (selectedUnit === null) {
    return (
      <p className="rounded-lg border border-dashed border-pedon-navy/25 p-6 text-center">
        Nenhuma unidade disponível.
      </p>
    );
  }

  return (
    <OrdersForUnit key={selectedUnit.id} unitId={selectedUnit.id} unitName={selectedUnit.name} />
  );
}
