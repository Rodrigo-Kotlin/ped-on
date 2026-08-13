import { useQuery } from '@tanstack/react-query';
import { StateBlock } from '../components/StateBlock';
import { useAdmin } from '../lib/admin/admin-context';
import { buildMetadata, formatBuildTimestamp } from '../lib/build-info/buildMetadata';
import { fetchPilotReadiness } from '../lib/pilot/pilot-readiness';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  operator: 'Operador',
};

export function DiagnosticoPage() {
  const { profile, organization, role, units, selectedUnit } = useAdmin();
  const organizationId = organization?.id ?? null;

  const readinessQuery = useQuery({
    queryKey: ['pilot-readiness', organizationId],
    queryFn: () => fetchPilotReadiness(organizationId as string),
    enabled: organizationId !== null,
  });

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          Diagnóstico
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Saúde técnica da aplicação</h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          Informações de execução, contexto e conectividade. Esta página não exibe nenhuma
          credencial, chave ou dado sensível.
        </p>
      </section>

      <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-pedon-navy">Versão da aplicação</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Versão</dt>
            <dd className="font-medium">{buildMetadata.version}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Revisão (commit)</dt>
            <dd className="font-mono">{buildMetadata.sha}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Build gerado em</dt>
            <dd>{formatBuildTimestamp(buildMetadata.timestamp)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-pedon-navy">Sessão e contexto</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Usuário</dt>
            <dd className="break-words font-medium">{profile?.full_name ?? profile?.email}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Papel</dt>
            <dd className="font-medium">{role !== null ? ROLE_LABELS[role] : '—'}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Organização</dt>
            <dd className="break-words font-medium">{organization?.name ?? '—'}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Unidades</dt>
            <dd>{units.length}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-pedon-text/70">Unidade selecionada</dt>
            <dd>{selectedUnit?.name ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-pedon-navy">Conectividade com a API</h3>
            <p className="mt-1 text-sm text-pedon-text/70">
              Verificação de ida e volta (round-trip) usando o contexto administrativo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void readinessQuery.refetch()}
            disabled={readinessQuery.isFetching}
            className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
          >
            {readinessQuery.isFetching ? 'Verificando…' : 'Executar verificação'}
          </button>
        </div>
        <p
          role={readinessQuery.isError ? 'alert' : 'status'}
          className={
            readinessQuery.isError
              ? 'mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800'
              : readinessQuery.data === undefined
                ? 'mt-3 text-sm text-pedon-text/60'
                : 'mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800'
          }
        >
          {readinessQuery.isError
            ? `Falha ao conectar: ${(readinessQuery.error as Error | null)?.message ?? 'erro desconhecido'}`
            : readinessQuery.data === undefined
              ? 'Aguardando verificação…'
              : `Conexão OK. Última verificação às ${formatBuildTimestamp(readinessQuery.data.checked_at)}.`}
        </p>
      </section>

      <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-pedon-navy">Prontidão derivada por unidade</h3>
        {organizationId === null ? (
          <StateBlock kind="empty" title="Nenhuma organização." />
        ) : readinessQuery.isLoading ? (
          <StateBlock kind="loading" />
        ) : readinessQuery.isError || readinessQuery.data === undefined ? (
          <StateBlock
            kind="error"
            title="Não foi possível consultar a prontidão."
            message={(readinessQuery.error as Error | null)?.message}
          />
        ) : (
          <>
            <p className="mt-2 text-sm text-pedon-text/70">
              {readinessQuery.data.ready
                ? 'Pronto para piloto.'
                : `Em preparação (${readinessQuery.data.blocking_ok} de ${readinessQuery.data.blocking_total} verificações concluídas).`}
            </p>
            <ul className="mt-4 space-y-2">
              {readinessQuery.data.units_summary.map((unit) => (
                <li
                  key={unit.unit_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-pedon-navy/15 p-3 text-sm"
                >
                  <span className="font-medium text-pedon-navy">
                    {unit.name}
                    {!unit.is_active && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        inativa
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-pedon-text/70">
                    {[
                      unit.op_configured ? 'configuração' : null,
                      unit.hours_ok ? 'horários' : null,
                      unit.payment_ok ? 'pagamento' : null,
                      unit.catalog_ok ? 'catálogo' : null,
                      unit.menu_published ? 'cardápio publicado' : null,
                    ]
                      .filter((item) => item !== null)
                      .join(' · ') || 'sem pré-requisitos concluídos'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
