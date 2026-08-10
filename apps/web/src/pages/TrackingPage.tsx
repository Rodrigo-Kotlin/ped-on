import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { formatBRL } from '../lib/money';
import {
  fetchPublicOrder,
  isTerminalOrderStatus,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  publicOrderPollingInterval,
  SERVICE_MODE_LABELS,
} from '../lib/orders/orders';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function TrackingPage() {
  const { trackingToken = '' } = useParams<{ trackingToken: string }>();
  const orderQuery = useQuery({
    queryKey: ['public-order', trackingToken],
    queryFn: () => fetchPublicOrder(trackingToken),
    enabled: trackingToken !== '',
    refetchInterval: (query) => publicOrderPollingInterval(query.state.data),
  });

  if (orderQuery.isLoading)
    return (
      <p role="status" className="p-6 text-center">
        Carregando pedido…
      </p>
    );
  if (orderQuery.isError)
    return (
      <p role="alert" className="p-6 text-center text-red-700">
        Não foi possível atualizar o pedido.
      </p>
    );
  if (orderQuery.data?.found !== true) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <h1 className="text-2xl font-bold text-pedon-navy">Pedido não encontrado</h1>
        <p className="mt-2 text-sm text-pedon-text/70">
          Confira o link de acompanhamento recebido após o pedido.
        </p>
        <Link
          to="/"
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-pedon-navy px-4 font-semibold text-white"
        >
          Voltar ao início
        </Link>
      </div>
    );
  }

  const { organization, unit, order } = orderQuery.data;
  return (
    <div className="min-h-svh bg-pedon-surface px-4 py-6">
      <div className="mx-auto w-full max-w-lg">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          {organization.name} · {unit.name}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-pedon-navy">Pedido #{order.order_number}</h1>
        <section
          aria-labelledby="tracking-status"
          className="mt-5 rounded-lg bg-pedon-navy p-5 text-white shadow-sm"
        >
          <h2 id="tracking-status" className="text-sm font-medium text-white/70">
            Status do pedido
          </h2>
          <p role="status" aria-live="polite" className="mt-1 text-xl font-bold">
            {ORDER_STATUS_LABELS[order.status]}
          </p>
          {order.estimated_minutes !== null && !isTerminalOrderStatus(order.status) && (
            <p className="mt-2 text-sm text-white/80">
              Previsão informada: cerca de {order.estimated_minutes} min
            </p>
          )}
        </section>

        <section aria-labelledby="order-details" className="mt-4 rounded-lg bg-white p-4 shadow-sm">
          <h2 id="order-details" className="font-bold text-pedon-navy">
            Detalhes
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Modalidade</dt>
              <dd className="text-right font-medium">{SERVICE_MODE_LABELS[order.service_mode]}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Pagamento</dt>
              <dd className="text-right font-medium">
                {PAYMENT_METHOD_LABELS[order.payment_method]}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Status do pagamento</dt>
              <dd className="text-right font-medium">
                {PAYMENT_STATUS_LABELS[order.payment_status]}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Data</dt>
              <dd className="text-right font-medium">{formatDateTime(order.created_at)}</dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="tracking-items"
          className="mt-4 rounded-lg bg-white p-4 shadow-sm"
        >
          <h2 id="tracking-items" className="font-bold text-pedon-navy">
            Itens
          </h2>
          <ul className="mt-3 divide-y divide-pedon-navy/10">
            {order.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="py-3 first:pt-0 last:pb-0">
                <div className="flex justify-between gap-4">
                  <p>
                    <span className="font-semibold">{item.quantity}×</span> {item.name}
                  </p>
                  <p className="shrink-0 font-medium">{formatBRL(item.line_total)}</p>
                </div>
                <p className="mt-1 text-xs text-pedon-text/60">{formatBRL(item.unit_price)} cada</p>
                {item.note !== null && (
                  <p className="mt-1 text-sm text-pedon-text/70">Obs.: {item.note}</p>
                )}
              </li>
            ))}
          </ul>
          <dl className="mt-4 border-t border-pedon-navy/10 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatBRL(order.subtotal)}</dd>
            </div>
            {order.service_mode === 'delivery' && (
              <div className="mt-2 flex justify-between">
                <dt>Entrega</dt>
                <dd>{formatBRL(order.delivery_fee)}</dd>
              </div>
            )}
            <div className="mt-2 flex justify-between text-lg font-bold text-pedon-navy">
              <dt>Total</dt>
              <dd>{formatBRL(order.total)}</dd>
            </div>
          </dl>
        </section>

        <button
          type="button"
          onClick={() => orderQuery.refetch()}
          disabled={orderQuery.isFetching}
          className="mt-5 min-h-11 w-full rounded-md border border-pedon-navy px-4 font-semibold text-pedon-navy disabled:opacity-50"
        >
          {orderQuery.isFetching ? 'Atualizando…' : 'Atualizar'}
        </button>
        <p className="mt-3 text-center text-xs text-pedon-text/60">
          Pedidos em andamento são atualizados automaticamente.
        </p>
      </div>
    </div>
  );
}
