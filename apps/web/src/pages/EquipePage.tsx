import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StateBlock } from '../components/StateBlock';
import { useAdmin } from '../lib/admin/admin-context';
import type { AdminRole } from '../lib/admin/admin-context';
import { assertOnline } from '../lib/offline/useOnline';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import {
  assignUnitToMember,
  fetchOrgMemberInvites,
  fetchOrgMembers,
  inviteOrgMember,
  removeUnitFromMember,
  revokeOrgMemberInvite,
  teamErrorMessage,
} from '../lib/team/team';
import type { InviteRole, OrgMember } from '../lib/team/team';

const ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  operator: 'Operador',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function EquipePage() {
  const { runCriticalOperation } = useCriticalOperation();
  const { organization, units } = useAdmin();
  const organizationId = organization?.id ?? null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('manager');
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const membersQuery = useQuery({
    queryKey: ['org-members', organizationId],
    queryFn: () => fetchOrgMembers(organizationId as string),
    enabled: organizationId !== null,
  });

  const invitesQuery = useQuery({
    queryKey: ['org-member-invites', organizationId],
    queryFn: () => fetchOrgMemberInvites(organizationId as string),
    enabled: organizationId !== null,
  });

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

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: InviteRole }) => {
      assertOnline();
      await runCriticalOperation(async () => {
        await inviteOrgMember(email, role);
      });
    },
    onSuccess: async (_result, variables) => {
      setActionError(null);
      setInviteFormError(null);
      setInviteEmail('');
      setInviteRole('manager');
      await queryClient.invalidateQueries({ queryKey: ['org-member-invites', organizationId] });
      void queryClient.invalidateQueries({ queryKey: ['org-members', organizationId] });
      setNotice(`Convite criado para ${variables.email}.`);
    },
    onError: (error: Error) => {
      setNotice(null);
      setActionError(teamErrorMessage(error));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      assertOnline();
      await runCriticalOperation(async () => {
        await revokeOrgMemberInvite(inviteId);
      });
    },
    onSuccess: async () => {
      setActionError(null);
      setNotice('Convite revogado.');
      await queryClient.invalidateQueries({ queryKey: ['org-member-invites', organizationId] });
    },
    onError: (error: Error) => {
      setNotice(null);
      setActionError(teamErrorMessage(error));
    },
  });

  function submitInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const email = inviteEmail.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setInviteFormError('Informe um e-mail válido.');
      return;
    }
    setInviteFormError(null);
    inviteMutation.mutate({ email, role: inviteRole });
  }

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

  function revokeInvite(inviteId: string) {
    if (!window.confirm('Revogar este convite? O convidado não poderá mais aceitá-lo.')) {
      return;
    }
    revokeMutation.mutate(inviteId);
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

  const pendingInvites = (invitesQuery.data ?? []).filter((invite) => invite.status === 'pending');

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
      {notice !== null && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      )}

      <section className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold text-pedon-navy">Convidar membro</h3>
        <p className="mt-1 text-sm text-pedon-text/70">
          O convite fica pendente por 7 dias. A pessoa precisa criar a conta com o mesmo e-mail e
          aceitar o convite. Você poderá atribuir a unidade depois que ela aceitar.
        </p>

        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={submitInvite}
          noValidate
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="inviteEmail" className="block text-sm font-medium text-pedon-text">
              E-mail
            </label>
            <input
              id="inviteEmail"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              disabled={inviteMutation.isPending}
              className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:opacity-60"
              placeholder="membro@exemplo.com"
              aria-invalid={inviteFormError !== null}
            />
          </div>
          <div>
            <label htmlFor="inviteRole" className="block text-sm font-medium text-pedon-text">
              Função
            </label>
            <select
              id="inviteRole"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as InviteRole)}
              disabled={inviteMutation.isPending}
              className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:opacity-60"
            >
              <option value="manager">Gerente</option>
              <option value="operator">Operador</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviteMutation.isPending}
            className="rounded-md bg-pedon-navy px-4 py-2 font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {inviteMutation.isPending ? 'Enviando…' : 'Convidar membro'}
          </button>
        </form>
        {inviteFormError !== null && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {inviteFormError}
          </p>
        )}
      </section>

      {invitesQuery.isLoading && <StateBlock kind="loading" />}
      {invitesQuery.isError && (
        <StateBlock
          kind="error"
          title="Não foi possível carregar os convites."
          message={(invitesQuery.error as Error | null)?.message}
          onRetry={() => void invitesQuery.refetch()}
        />
      )}
      {pendingInvites.length > 0 && (
        <section>
          <h3 className="text-lg font-bold text-pedon-navy">Convites pendentes</h3>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {pendingInvites.map((invite) => {
              return (
                <li
                  key={invite.id}
                  className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
                >
                  <p className="break-words font-semibold text-pedon-navy">{invite.email}</p>
                  <p className="mt-0.5 text-sm text-pedon-text/70">
                    {ROLE_LABELS[invite.role]} · válido até {formatDateTime(invite.expires_at)}
                  </p>
                  <button
                    type="button"
                    onClick={() => revokeInvite(invite.id)}
                    disabled={revokeMutation.isPending}
                    className="mt-3 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Revogar
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
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
