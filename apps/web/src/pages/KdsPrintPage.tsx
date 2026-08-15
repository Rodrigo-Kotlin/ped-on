import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAdmin } from '../lib/admin/admin-context';
import type { AdminUnit } from '../lib/admin/admin-context';
import { buildKitchenTicket } from '../lib/orders/orders';
import { useKdsOrders } from '../lib/orders/useKdsOrders';
import '../styles/kds-print.css';

function KdsPrintTicket({ unit }: { unit: AdminUnit }) {
  const { orderId } = useParams<{ orderId: string }>();
  const kdsQuery = useKdsOrders(unit.id);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedRef = useRef(false);
  const [now] = useState<number>(() => Date.now());

  const order =
    orderId === undefined
      ? null
      : (kdsQuery.data?.orders.find((candidate) => candidate.id === orderId) ?? null);

  const ticket = order === null ? null : buildKitchenTicket(unit.name, order, now, new Date(now));

  useEffect(() => {
    if (ticket !== null && !focusedRef.current) {
      headingRef.current?.focus();
      focusedRef.current = true;
    }
  }, [ticket]);

  if (kdsQuery.isLoading) {
    return (
      <p role="status" className="text-pedon-text/70">
        Carregando comanda…
      </p>
    );
  }

  if (kdsQuery.isError && kdsQuery.error instanceof Error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-md bg-red-50 p-4 text-sm font-medium text-red-800">
          {kdsQuery.error.message}
        </p>
        <Link
          to="/app/cozinha"
          className="inline-flex min-h-11 items-center rounded-md border border-pedon-navy/30 px-4 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
        >
          Voltar para cozinha
        </Link>
      </div>
    );
  }

  if (ticket === null) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="status" className="rounded-md bg-amber-50 p-4 text-sm font-medium text-amber-900">
          Este pedido não está mais disponível na fila da cozinha.
        </p>
        <Link
          to="/app/cozinha"
          className="inline-flex min-h-11 items-center rounded-md border border-pedon-navy/30 px-4 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
        >
          Voltar para cozinha
        </Link>
      </div>
    );
  }

  return (
    <div className="kds-print-page">
      <div className="kds-print-screen mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-bold text-pedon-navy outline-none"
        >
          Comanda do pedido #{ticket.order_number}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/cozinha"
            className="inline-flex min-h-11 items-center rounded-md border border-pedon-navy/30 px-4 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
          >
            Voltar para cozinha
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-11 items-center rounded-md bg-pedon-navy px-4 text-sm font-semibold text-white transition hover:bg-pedon-navy/90"
          >
            Imprimir comanda
          </button>
        </div>
      </div>

      <article
        className="kds-print-ticket"
        aria-label={`Comanda do pedido #${ticket.order_number}`}
      >
        <header>
          <p className="kds-ticket-unit">{ticket.unit_name}</p>
          <p className="kds-ticket-title">Comanda da cozinha</p>
          <p className="kds-ticket-order">Pedido #{ticket.order_number}</p>
          <p className="kds-ticket-mode">{ticket.service_mode_label}</p>
        </header>

        <dl>
          <div>
            <dt>Recebido</dt>
            <dd>{ticket.received_at_label}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{ticket.status_label}</dd>
          </div>
          {ticket.eta_label !== null && (
            <div>
              <dt>{ticket.is_late ? 'Atrasado' : 'Previsto'}</dt>
              <dd>{ticket.is_late ? `Previsto: ${ticket.eta_label}` : ticket.eta_label}</dd>
            </div>
          )}
        </dl>

        <ul>
          {ticket.items.map((item, index) => (
            <li key={index}>
              <p className="kds-ticket-item-line">
                <span className="kds-ticket-qty">{item.quantity}x</span>
                <span>{item.product_name}</span>
              </p>
              {item.option_lines.length > 0 && (
                <ul>
                  {item.option_lines.map((line, lineIndex) => (
                    <li
                      key={lineIndex}
                      className={line.startsWith('RETIRAR:') ? 'kds-ticket-removal' : undefined}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              {item.note_line !== null && <p className="kds-ticket-note">{item.note_line}</p>}
            </li>
          ))}
        </ul>

        <footer>
          <p>Impresso em: {ticket.printed_at_label}</p>
        </footer>
      </article>
    </div>
  );
}

export function KdsPrintPage() {
  const { selectedUnit } = useAdmin();

  if (selectedUnit === null) {
    return (
      <p role="status" className="text-pedon-text/70">
        Carregando comanda…
      </p>
    );
  }

  return <KdsPrintTicket key={selectedUnit.id} unit={selectedUnit} />;
}
