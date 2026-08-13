import { NavLink } from 'react-router';
import { PilotChecklist } from '../components/pilot/PilotChecklist';
import { PilotReadinessPanel } from '../components/pilot/PilotReadinessPanel';
import { useAdmin } from '../lib/admin/admin-context';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  operator: 'Operador',
};

export function AppPage() {
  const { profile, organization, role, units, selectedUnit, canManageUnit } = useAdmin();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          Visão geral
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pedon-navy">
          {organization?.name ?? 'Sua organização'}
        </h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          {profile?.full_name ?? profile?.email ?? ''}
          {role !== null && (
            <>
              {profile?.full_name ? ' · ' : ''}
              <span className="font-medium text-pedon-text">{ROLE_LABELS[role]}</span>
            </>
          )}
        </p>
      </section>

      <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-pedon-navy">Unidade selecionada</h3>
        {selectedUnit !== null ? (
          <p className="mt-1 text-sm text-pedon-text">
            <span className="font-medium">{selectedUnit.name}</span>
            {!selectedUnit.is_active && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                inativa
              </span>
            )}
            <span className="ml-2 text-pedon-text/60">
              · {units.length} {units.length === 1 ? 'unidade' : 'unidades'}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-pedon-text/70">Nenhuma unidade disponível.</p>
        )}
      </section>

      {canManageUnit && organization !== null && (
        <PilotReadinessPanel organizationId={organization.id} ownerActions={role === 'owner'} />
      )}

      {role === 'owner' && <PilotChecklist />}

      {role === 'owner' && (
        <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-pedon-navy">Preparação técnica</h3>
          <p className="mt-1 text-sm text-pedon-text/70">
            Gerencie o acesso da equipe às unidades e verifique a saúde técnica da aplicação.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <NavLink
              to="/app/equipe"
              className="min-h-11 rounded-md bg-pedon-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-pedon-navy/90"
            >
              Abrir equipe
            </NavLink>
            <NavLink
              to="/app/diagnostico"
              className="min-h-11 rounded-md border border-pedon-navy/25 px-4 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
            >
              Abrir diagnóstico
            </NavLink>
          </div>
        </section>
      )}

      {canManageUnit && (
        <section className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-pedon-navy">Configuração da unidade</h3>
          <p className="mt-1 text-sm text-pedon-text/70">
            Defina modalidades de atendimento, valores, horários, tempo de preparo, fuso horário e
            formas de pagamento.
          </p>
          <NavLink
            to="/app/configuracoes"
            className="mt-3 inline-block rounded-md bg-pedon-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-pedon-navy/90"
          >
            Abrir configurações
          </NavLink>
        </section>
      )}
    </div>
  );
}
