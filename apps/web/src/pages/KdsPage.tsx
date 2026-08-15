import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useAdmin } from '../lib/admin/admin-context';
import {
  getKdsOrderAction,
  groupKdsItemOptions,
  KDS_ORDER_STATUSES,
  KDS_STATUS_LABELS,
  kdsPrintPath,
  SERVICE_MODE_LABELS,
} from '../lib/orders/orders';
import type { KdsOrder, KdsOrderStatus } from '../lib/orders/orders';
import { elapsedMinutes, useOperationalNow } from '../lib/orders/useOperationalNow';
import { useKdsOrders } from '../lib/orders/useKdsOrders';
import { useOrderStatusMutation } from '../lib/orders/useOrderMutations';
import { useOrdersRealtime } from '../lib/orders/useOrdersRealtime';

function formatClock(value: string | number): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
    typeof value === 'number' ? new Date(value) : new Date(value),
  );
}

function pluralMinutes(value: number): string {
  return value === 1 ? '1 min' : `${value} min`;
}

function KdsOrderCard({
  unitId,
  order,
  now,
  onStatusChanged,
  registerRef,
}: {
  unitId: string;
  order: KdsOrder;
  now: number;
  onStatusChanged: (orderId: string, nextStatus: KdsOrderStatus) => void;
  registerRef: (orderId: string, node: HTMLElement | null) => void;
}) {
  const action = getKdsOrderAction(order.status);
  const mutation = useOrderStatusMutation(unitId, order.id);
  const startedRef = useRef(false);

  const isNew = order.status === 'new';
  const isReady = order.status === 'ready';
  const overdue = order.expected_at !== null && Date.parse(order.expected_at) < now;
  const overdueMinutes = order.expected_at === null ? null : elapsedMinutes(order.expected_at, now);

  function runAction() {
    if (startedRef.current || mutation.isPending || action === null) return;
    startedRef.current = true;
    onStatusChanged(order.id, action.nextStatus);
    mutation.mutate(action.nextStatus, {
      onSettled: () => {
        startedRef.current = false;
      },
    });
  }

  return (
    <article
      ref={(node) => registerRef(order.id, node)}
      tabIndex={-1}
      aria-label={`Pedido #${order.order_number}`}
      data-status={order.status}
      className="min-w-0 rounded-lg border border-pedon-navy/15 bg-white p-3 shadow-sm outline-none focus:ring-2 focus:ring-pedon-orange"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-base font-bold text-pedon-navy">Pedido #{order.order_number}</h4>
          <p className="mt-0.5 text-sm text-pedon-text/70">
            {SERVICE_MODE_LABELS[order.service_mode]}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {isNew && (
            <span className="rounded bg-pedon-orange px-2 py-0.5 text-xs font-bold uppercase text-white">
              Novo
            </span>
          )}
          {overdue && (
            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
              Atrasado
            </span>
          )}
          {isReady && (
            <span className="rounded bg-green-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
              Pronto
            </span>
          )}
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-sm text-pedon-text/80">
        <div className="flex justify-between gap-2">
          <dt>Recebido há</dt>
          <dd>{pluralMinutes(elapsedMinutes(order.created_at, now))}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>No status há</dt>
          <dd>{pluralMinutes(elapsedMinutes(order.status_updated_at, now))}</dd>
        </div>
        {order.expected_at !== null && (
          <div className="flex justify-between gap-2">
            <dt>{overdue ? 'Atrasado há' : 'Previsto'}</dt>
            <dd>{overdue ? pluralMinutes(overdueMinutes ?? 0) : formatClock(order.expected_at)}</dd>
          </div>
        )}
      </dl>

      <ul className="mt-3 space-y-2 border-t border-pedon-navy/10 pt-3">
        {order.items.map((item, index) => (
          <li key={index} className="text-sm">
            <p className="font-medium text-pedon-navy">
              {item.quantity}x {item.product_name}
            </p>
            {item.options.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-pedon-text/80">
                {groupKdsItemOptions(item.options).map((group, groupIndex) => (
                  <li key={groupIndex}>
                    {group.group_kind === 'removal'
                      ? `Retirar: ${group.option_names.join(', ')}`
                      : group.group_kind === 'addon'
                        ? `Adicionais: ${group.option_names.join(', ')}`
                        : `${group.group_name}: ${group.option_names.join(', ')}`}
                  </li>
                ))}
              </ul>
            )}
            {item.note !== null && item.note !== '' && (
              <p className="mt-0.5 text-amber-800">Obs.: {item.note}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-col gap-2">
        {action !== null && (
          <button
            type="button"
            onClick={runAction}
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
            className="min-h-11 w-full rounded-md bg-pedon-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? 'Atualizando…' : action.label}
          </button>
        )}
        <Link
          to={kdsPrintPath(order.id)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-pedon-navy/30 px-4 py-2 text-sm font-semibold text-pedon-navy transition hover:bg-pedon-navy/5"
        >
          Imprimir
        </Link>
      </div>

      {mutation.isError && mutation.error instanceof Error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {mutation.error.message}
        </p>
      )}
    </article>
  );
}

function KdsBoard({ unitId, unitName }: { unitId: string; unitName: string }) {
  const now = useOperationalNow();
  useOrdersRealtime(unitId);
  const kdsQuery = useKdsOrders(unitId);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const columnRefs = useRef(new Map<KdsOrderStatus, HTMLHeadingElement>());
  const boardHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<{ orderId: string; column: KdsOrderStatus } | null>(null);
  const data = kdsQuery.data;

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const node = cardRefs.current.get(target.orderId);
    if (node !== undefined && node.isConnected && node.dataset.status === target.column) {
      node.focus();
      pendingFocus.current = null;
      return;
    }
    if (kdsQuery.isFetching) return;
    const orderVisible =
      data?.orders.some(
        (candidate) =>
          candidate.id === target.orderId && KDS_ORDER_STATUSES.includes(candidate.status),
      ) === true;
    if (orderVisible) return;
    const heading = columnRefs.current.get(target.column);
    if (heading !== undefined && heading.isConnected) {
      heading.focus();
    } else if (boardHeadingRef.current !== null && boardHeadingRef.current.isConnected) {
      boardHeadingRef.current.focus();
    }
    pendingFocus.current = null;
  }, [data, kdsQuery.isFetching]);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">KDS</p>
          <h2
            ref={boardHeadingRef}
            tabIndex={-1}
            className="mt-1 text-2xl font-bold text-pedon-navy outline-none"
          >
            Cozinha
          </h2>
          <p className="mt-0.5 text-sm text-pedon-text/70">{unitName}</p>
          {kdsQuery.data !== undefined && (
            <p className="mt-0.5 text-sm text-pedon-text/60">
              {kdsQuery.isFetching
                ? 'Atualizando…'
                : `Atualizado às ${formatClock(kdsQuery.dataUpdatedAt)}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void kdsQuery.refetch()}
          disabled={kdsQuery.isFetching}
          className="min-h-11 rounded-md border border-pedon-navy/30 px-4 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5 disabled:opacity-60"
        >
          Atualizar
        </button>
      </div>

      {kdsQuery.data?.truncated === true && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-amber-50 p-3 text-sm font-medium text-amber-900"
        >
          Há mais de 200 pedidos ativos na cozinha. A tela mostra somente os 200 pedidos
          priorizados.
        </p>
      )}

      {kdsQuery.isLoading && (
        <p role="status" className="mt-8 text-pedon-text/70">
          Carregando cozinha…
        </p>
      )}

      {kdsQuery.isError && kdsQuery.error instanceof Error && (
        <p role="alert" className="mt-8 rounded-md bg-red-50 p-4 text-sm font-medium text-red-800">
          {kdsQuery.error.message}
        </p>
      )}

      {data !== undefined &&
        (data.orders.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-pedon-navy/20 p-6 text-center text-sm text-pedon-text/60">
            Nenhum pedido ativo na cozinha.
          </div>
        ) : (
          <section
            aria-label="Quadro da cozinha"
            className="mt-5 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {KDS_ORDER_STATUSES.map((status) => {
              const columnOrders = data.orders.filter((order) => order.status === status);
              return (
                <section
                  key={status}
                  aria-labelledby={`kds-column-${status}`}
                  className="min-w-0 rounded-xl border border-pedon-navy/15 bg-pedon-surface p-3"
                >
                  <h3
                    id={`kds-column-${status}`}
                    ref={(node) => {
                      if (node === null) columnRefs.current.delete(status);
                      else columnRefs.current.set(status, node);
                    }}
                    tabIndex={-1}
                    className="flex items-center justify-between gap-2 text-sm font-bold uppercase tracking-wide text-pedon-navy outline-none"
                  >
                    <span>{KDS_STATUS_LABELS[status]}</span>
                    <span className="rounded bg-pedon-navy/10 px-2 py-0.5 text-xs font-semibold text-pedon-navy/80">
                      ({columnOrders.length})
                    </span>
                  </h3>
                  {columnOrders.length === 0 ? (
                    <p className="mt-2 text-sm text-pedon-text/60">Nenhum pedido</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {columnOrders.map((order) => (
                        <li key={order.id}>
                          <KdsOrderCard
                            unitId={unitId}
                            order={order}
                            now={now}
                            onStatusChanged={(orderId, nextStatus) => {
                              pendingFocus.current = { orderId, column: nextStatus };
                            }}
                            registerRef={(orderId, node) => {
                              if (node === null) cardRefs.current.delete(orderId);
                              else cardRefs.current.set(orderId, node);
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </section>
        ))}
    </div>
  );
}

export function KdsPage() {
  const { selectedUnit } = useAdmin();

  if (selectedUnit === null) {
    return (
      <p role="status" className="text-pedon-text/70">
        Carregando cozinha…
      </p>
    );
  }

  return <KdsBoard key={selectedUnit.id} unitId={selectedUnit.id} unitName={selectedUnit.name} />;
}
