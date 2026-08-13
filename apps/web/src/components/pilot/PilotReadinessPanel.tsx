import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { fetchPilotReadiness } from '../../lib/pilot/pilot-readiness';
import type { PilotReadiness } from '../../lib/pilot/pilot-readiness';
import { StateBlock } from '../StateBlock';

export function PilotReadinessPanel({
  organizationId,
  ownerActions = false,
}: {
  organizationId: string;
  ownerActions?: boolean;
}) {
  const readinessQuery = useQuery({
    queryKey: ['pilot-readiness', organizationId],
    queryFn: () => fetchPilotReadiness(organizationId),
  });

  if (readinessQuery.isLoading) {
    return <StateBlock kind="loading" />;
  }
  if (readinessQuery.isError || readinessQuery.data === undefined) {
    return (
      <StateBlock
        kind="error"
        title="Não foi possível verificar a prontidão para piloto."
        message={(readinessQuery.error as Error | null)?.message}
        onRetry={() => void readinessQuery.refetch()}
      />
    );
  }

  const readiness = readinessQuery.data as PilotReadiness;
  const checks = readiness.checks ?? [];

  if (checks.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="Sem informações de prontidão."
        message="Nenhuma verificação derivada foi retornada para esta organização."
      />
    );
  }

  return (
    <section
      aria-labelledby="pilot-readiness-title"
      className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="pilot-readiness-title" className="font-semibold text-pedon-navy">
            Prontidão para piloto
          </h3>
          <p className="mt-1 text-sm text-pedon-text/70">
            Status derivado automaticamente do estado atual das configurações.
          </p>
        </div>
        {readiness.ready ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
            Pronto para piloto
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
            Em preparação ({readiness.blocking_ok} de {readiness.blocking_total})
          </span>
        )}
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <li
            key={check.code}
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              check.ok
                ? 'border-emerald-200 bg-emerald-50/60'
                : check.blocking
                  ? 'border-red-200 bg-red-50/60'
                  : 'border-pedon-navy/15 bg-pedon-surface/60'
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                check.ok ? 'bg-emerald-500' : check.blocking ? 'bg-red-500' : 'bg-pedon-text/30'
              }`}
            />
            <div className="min-w-0">
              <p className="font-medium text-pedon-navy">{check.label}</p>
              <p className="mt-0.5 text-xs text-pedon-text/70">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <NavLink
          to="/app/configuracoes"
          className="min-h-11 rounded-md border border-pedon-navy/25 px-4 py-2 text-sm font-semibold text-pedon-navy transition hover:bg-pedon-navy/5"
        >
          Configurações
        </NavLink>
        {ownerActions && (
          <>
            <NavLink
              to="/app/equipe"
              className="min-h-11 rounded-md border border-pedon-navy/25 px-4 py-2 text-sm font-semibold text-pedon-navy transition hover:bg-pedon-navy/5"
            >
              Equipe
            </NavLink>
            <NavLink
              to="/app/diagnostico"
              className="min-h-11 rounded-md border border-pedon-navy/25 px-4 py-2 text-sm font-semibold text-pedon-navy transition hover:bg-pedon-navy/5"
            >
              Diagnóstico
            </NavLink>
          </>
        )}
      </div>
    </section>
  );
}
