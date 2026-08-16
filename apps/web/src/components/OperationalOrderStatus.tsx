import { orderAlertMessage } from '../lib/orders/orderAlerts';
import type { OrderAlertPayload } from '../lib/orders/orderAlerts';
import type { OperationalRealtimeStatus } from '../lib/orders/useOrdersRealtime';

interface OperationalOrderStatusProps {
  realtimeStatus: OperationalRealtimeStatus;
  alert: OrderAlertPayload | null;
  dismissAlert: () => void;
  soundEnabled: boolean;
  soundUnavailable: boolean;
  onToggleSound: () => void;
  onViewKitchen: () => void;
  onViewOrders: () => void;
}

export function OperationalOrderStatus({
  realtimeStatus,
  alert,
  dismissAlert,
  soundEnabled,
  soundUnavailable,
  onToggleSound,
  onViewKitchen,
  onViewOrders,
}: OperationalOrderStatusProps) {
  return (
    <div className="mt-3 space-y-2 print:hidden">
      {realtimeStatus === 'degraded' && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
        >
          Tempo real indisponível. Atualização periódica continua ativa.
        </div>
      )}

      {alert !== null && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-md border border-pedon-orange/50 bg-orange-50 px-4 py-3"
        >
          <p className="min-w-0 font-semibold text-pedon-navy">{orderAlertMessage(alert)}</p>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onViewKitchen}
              className="min-h-11 rounded-md bg-pedon-navy px-4 text-sm font-semibold text-white transition hover:bg-pedon-navy/90"
            >
              Ver cozinha
            </button>

            <button
              type="button"
              onClick={onViewOrders}
              className="min-h-11 rounded-md border border-pedon-navy/25 px-4 text-sm font-semibold text-pedon-navy transition hover:bg-pedon-navy/5"
            >
              Ver pedidos
            </button>

            <button
              type="button"
              onClick={dismissAlert}
              aria-label="Fechar alerta"
              className="min-h-11 rounded-md px-3 text-sm font-semibold text-pedon-text/70 underline-offset-2 transition hover:text-pedon-navy"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-pedon-navy/10 bg-white px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-pedon-text/55">
            Alertas operacionais
          </p>

          {soundUnavailable ? (
            <p role="status" className="text-sm text-pedon-text/70">
              Som indisponível neste navegador.
            </p>
          ) : (
            <p className="text-sm text-pedon-text/70">
              {soundEnabled ? 'Aviso sonoro ativado.' : 'Aviso sonoro desativado.'}
            </p>
          )}
        </div>

        {!soundUnavailable && (
          <button
            type="button"
            onClick={onToggleSound}
            aria-pressed={soundEnabled}
            className="min-h-11 shrink-0 rounded-md border border-pedon-navy/25 px-4 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
          >
            {soundEnabled ? 'Silenciar som' : 'Ativar som'}
          </button>
        )}
      </div>
    </div>
  );
}
