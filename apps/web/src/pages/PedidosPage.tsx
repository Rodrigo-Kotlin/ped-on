import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAdmin } from '../lib/admin/admin-context';
import { formatBRL } from '../lib/money';
import { assertOnline } from '../lib/offline/useOnline';
import { orderOptionLabel } from '../lib/orders/order-option-label';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import {
  fetchOrderAdmin,
  fetchUnitOrdersAdmin,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_MODE_LABELS,
  setOrderPaymentStatus,
  setOrderStatus,
  unitOrderDetailKey,
  unitOrdersListKey,
  unitOrdersListPrefix,
} from '../lib/orders/orders';
import type {
  AdminOrderDetail,
  AdminOrderEvent,
  OrderStatus,
  PaymentStatus,
  ServiceMode,
} from '../lib/orders/orders';
import { useOrdersRealtime } from '../lib/orders/useOrdersRealtime';

const FILTERS: Array<{ value: OrderStatus | null; label: string }> = [
  { value: null, label: 'Todos' },
  { value: 'new', label: 'Novos' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'preparing', label: 'Em preparo' },
  { value: 'ready', label: 'Prontos' },
  { value: 'out_for_delivery', label: 'Saiu para entrega' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'cancelled', label: 'Cancelados' },
];

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirmar',
  preparing: 'Iniciar preparo',
  ready: 'Marcar pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluir',
  cancelled: 'Cancelar',
};

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

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

function possibleStatuses(status: OrderStatus, serviceMode: ServiceMode): OrderStatus[] {
  if (status === 'new') return ['confirmed', 'cancelled'];
  if (status === 'confirmed') return ['preparing', 'cancelled'];
  if (status === 'preparing') return ['ready', 'cancelled'];
  if (status === 'ready') {
    return serviceMode === 'delivery'
      ? ['out_for_delivery', 'cancelled']
      : ['completed', 'cancelled'];
  }
  if (status === 'out_for_delivery') return ['completed', 'cancelled'];
  return [];
}

function eventDescription(event: AdminOrderEvent): string {
  if (event.event_type === 'created') return 'Pedido recebido';
  if (event.event_type === 'payment_changed') {
    return `Pagamento: ${PAYMENT_STATUS_LABELS[event.to_value as PaymentStatus]}`;
  }
  return `Status: ${ORDER_STATUS_LABELS[event.to_value as OrderStatus]}`;
}

function OrderDetail({
  unitId,
  orderId,
  canManageUnit,
  onClose,
}: {
  unitId: string;
  orderId: string;
  canManageUnit: boolean;
  onClose: () => void;
}) {
  const { runCriticalOperation } = useCriticalOperation();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasFocusedRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  function acceptServerOrder(order: AdminOrderDetail) {
    queryClient.setQueryData(unitOrderDetailKey(unitId, order.id), order);
    void queryClient.invalidateQueries({ queryKey: unitOrdersListPrefix(unitId) });
    setActionError(null);
  }

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => {
      assertOnline();
      return runCriticalOperation(() => setOrderStatus(orderId, status));
    },
    onSuccess: acceptServerOrder,
    onError: (error: Error) => setActionError(error.message),
  });
  const paymentMutation = useMutation({
    mutationFn: (status: PaymentStatus) => {
      assertOnline();
      return runCriticalOperation(() => setOrderPaymentStatus(orderId, status));
    },
    onSuccess: acceptServerOrder,
    onError: (error: Error) => setActionError(error.message),
  });

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
  const transitions = possibleStatuses(order.status, order.service_mode);
  const busy = statusMutation.isPending || paymentMutation.isPending;

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
      className="min-w-0 rounded-xl border border-pedon-navy/15 bg-white p-4 shadow-sm sm:p-5"
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
                Marcar como pago
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
        {transitions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {transitions.map((nextStatus) => (
              <button
                key={nextStatus}
                type="button"
                disabled={busy}
                onClick={() => changeStatus(nextStatus)}
                className={
                  nextStatus === 'cancelled'
                    ? 'min-h-11 rounded-md border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-50'
                    : 'min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50'
                }
              >
                {ACTION_LABELS[nextStatus]}
              </button>
            ))}
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
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  useOrdersRealtime(unitId);
  const ordersQuery = useQuery({
    queryKey: unitOrdersListKey(unitId, status),
    queryFn: () => fetchUnitOrdersAdmin(unitId, status),
    refetchInterval: 30_000,
  });

  function closeDetail() {
    const orderId = selectedOrderId;
    setSelectedOrderId(null);
    if (orderId !== null) {
      window.requestAnimationFrame(() => orderButtonRefs.current.get(orderId)?.focus());
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
            Central
          </p>
          <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Pedidos</h2>
          <p className="mt-1 text-sm text-pedon-text/70">{unitName}</p>
        </div>
        <button
          type="button"
          onClick={() => void ordersQuery.refetch()}
          disabled={ordersQuery.isFetching}
          className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
        >
          {ordersQuery.isFetching ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <div className="mt-5 overflow-x-auto pb-1" aria-label="Filtros de pedidos">
        <div className="flex min-w-max gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.value ?? 'all'}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
                setSelectedOrderId(null);
              }}
              className={
                status === filter.value
                  ? 'min-h-11 rounded-full bg-pedon-navy px-4 text-sm font-semibold text-white'
                  : 'min-h-11 rounded-full border border-pedon-navy/20 bg-white px-4 text-sm font-semibold text-pedon-navy'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {ordersQuery.isLoading && (
        <p role="status" className="mt-6">
          Carregando pedidos…
        </p>
      )}
      {ordersQuery.isError && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-red-800">
          {(ordersQuery.error as Error).message}
        </p>
      )}
      {ordersQuery.data !== undefined && (
        <div
          className={
            selectedOrderId === null
              ? 'mt-5'
              : 'mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,3fr)]'
          }
        >
          <section aria-label="Lista de pedidos" className="min-w-0">
            <p className="mb-3 text-sm text-pedon-text/70" aria-live="polite">
              {ordersQuery.data.count} {ordersQuery.data.count === 1 ? 'pedido' : 'pedidos'}
              {ordersQuery.data.count > ordersQuery.data.orders.length
                ? `, exibindo os ${ordersQuery.data.orders.length} mais recentes`
                : ''}
            </p>
            {ordersQuery.data.orders.length === 0 ? (
              <p className="rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
                Nenhum pedido neste filtro.
              </p>
            ) : (
              <ul className="space-y-3">
                {ordersQuery.data.orders.map((order) => (
                  <li key={order.id}>
                    <button
                      ref={(node) => {
                        if (node === null) orderButtonRefs.current.delete(order.id);
                        else orderButtonRefs.current.set(order.id, node);
                      }}
                      type="button"
                      onClick={() => setSelectedOrderId(order.id)}
                      aria-label={`Abrir pedido ${order.order_number} de ${order.customer_name}`}
                      aria-current={selectedOrderId === order.id ? 'true' : undefined}
                      className={`min-h-11 w-full rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange ${
                        order.status === 'new'
                          ? 'border-l-4 border-l-pedon-orange border-y-pedon-orange/40 border-r-pedon-orange/40'
                          : 'border-pedon-navy/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-pedon-navy">
                            #{order.order_number} · {time(order.created_at)}
                          </p>
                          <p className="mt-1 truncate font-medium">{order.customer_name}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-pedon-surface px-2.5 py-1 text-xs font-bold text-pedon-navy">
                          {ORDER_STATUS_LABELS[order.status]}
                        </span>
                      </div>
                      {order.status === 'new' && (
                        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-pedon-orange">
                          Novo pedido
                        </p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-3">
                        <span>{SERVICE_MODE_LABELS[order.service_mode]}</span>
                        <span>
                          {order.item_count} {order.item_count === 1 ? 'item' : 'itens'}
                        </span>
                        <span className="font-bold">{formatBRL(order.total)}</span>
                        <span className="col-span-2 break-words sm:col-span-2">
                          {PAYMENT_METHOD_LABELS[order.payment_method]} ·{' '}
                          {PAYMENT_STATUS_LABELS[order.payment_status]}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedOrderId !== null && (
            <OrderDetail
              key={selectedOrderId}
              unitId={unitId}
              orderId={selectedOrderId}
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
