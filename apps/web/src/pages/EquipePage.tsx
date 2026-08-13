import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StateBlock } from '../components/StateBlock';
import { useAdmin } from '../lib/admin/admin-context';
import type { AdminRole } from '../lib/admin/admin-context';
import { assertOnline } from '../lib/offline/useOnline';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import { assignUnitToMember, fetchOrgMembers, removeUnitFromMember } from '../lib/team/team';
import type { OrgMember } from '../lib/team/team';

const ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  operator: 'Operador',
};

export function EquipePage() {
  const { runCriticalOperation } = useCriticalOperation();
  const { organization, units } = useAdmin();
  const organizationId = organization?.id ?? null;
  const [actionError, setActionError] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ['org-members', organizationId],
    queryFn: () => fetchOrgMembers(organizationId as string),
    enabled: organizationId !== null,
  });

  const queryClient = useQueryClient();

  const assignment = useMutation({
    mutationFn: async ({
      userId,
      unitId,
      assign,
    }: {
      userId: string;
      unitId: string;
      assign: boolean;
    }) => {
      assertOnline();
      const target = organizationId as string;
      await runCriticalOperation(async () => {
        if (assign) {
          await assignUnitToMember(target, userId, unitId);
        } else {
          await removeUnitFromMember(target, userId, unitId);
        }
      });
    },
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['org-members', organizationId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-context'] });
    },
    onError: (error: Error) => setActionError(error.message),
  });

  function toggleUnit(member: OrgMember, unitId: string, assign: boolean) {
    if (
      !assign &&
      !window.confirm(
        `Remover o acesso de ${member.full_name ?? member.email} a esta unidade? Esta ação pode ser desfeita a qualquer momento.`,
      )
    ) {
      return;
    }
    assignment.mutate({ userId: member.id, unitId, assign });
  }

  if (organization === null || organizationId === null) {
    return (
      <StateBlock
        kind="empty"
        title="Nenhuma organização."
        message="Conclua a criação da organização para gerenciar a equipe."
      />
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Equipe</p>
        <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Membros de {organization.name}</h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          Vincule gerentes e operadores às unidades que poderão acessar. Proprietários já possuem
          acesso a todas as unidades da organização.
        </p>
      </section>

      {actionError !== null && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </p>
      )}

      {membersQuery.isLoading && <StateBlock kind="loading" />}
      {membersQuery.isError && (
        <StateBlock
          kind="error"
          title="Não foi possível carregar os membros."
          message={(membersQuery.error as Error | null)?.message}
          onRetry={() => void membersQuery.refetch()}
        />
      )}
      {membersQuery.data !== undefined &&
        (membersQuery.data.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Nenhum membro."
            message="Não há membros nesta organização."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {membersQuery.data.map((member) => (
              <li
                key={member.id}
                className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-pedon-navy">
                      {member.full_name ?? member.email}
                    </p>
                    <p className="mt-0.5 break-words text-sm text-pedon-text/70">{member.email}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-pedon-surface px-2.5 py-1 text-xs font-bold text-pedon-navy">
                    {ROLE_LABELS[member.role]}
                  </span>
                </div>

                {member.role === 'owner' ? (
                  <p className="mt-3 text-sm text-pedon-text/60">
                    Acesso completo a todas as unidades.
                  </p>
                ) : (
                  <fieldset className="mt-3">
                    <legend className="text-sm font-medium text-pedon-navy">Unidades</legend>
                    {units.length === 0 ? (
                      <p className="mt-1 text-sm text-pedon-text/60">
                        Nenhuma unidade disponível para vínculo.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {units.map((unit) => {
                          const assigned = member.unit_ids.includes(unit.id);
                          return (
                            <li key={unit.id}>
                              <label className="flex items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={assigned}
                                  disabled={assignment.isPending || (!unit.is_active && !assigned)}
                                  onChange={(event) =>
                                    toggleUnit(member, unit.id, event.target.checked)
                                  }
                                  aria-label={`${assigned ? 'Remover acesso de' : 'Vincular'} ${member.full_name ?? member.email} à unidade ${unit.name}`}
                                  className="mt-1 h-4 w-4 accent-pedon-navy"
                                />
                                <span>
                                  <span className="font-medium text-pedon-navy">{unit.name}</span>
                                  {!unit.is_active && (
                                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                      inativa
                                    </span>
                                  )}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
