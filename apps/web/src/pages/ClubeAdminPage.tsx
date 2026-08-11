import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext } from 'react';
import { useAdmin } from '../lib/admin/admin-context';
import { AuthContext } from '../lib/auth/auth-context';
import {
  fetchLoyaltyMembersAdmin,
  fetchLoyaltyProgramAdmin,
  loyaltyMembersPrefix,
  loyaltyProgramKey,
  maskCpf,
  setLoyaltyProgramEnabled,
} from '../lib/loyalty/loyalty';
import type { LoyaltyMember } from '../lib/loyalty/loyalty';

function formatPoints(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-pedon-navy/10 bg-white p-4 shadow-sm">
      <p className="text-sm text-pedon-text/70">{label}</p>
      <p className="mt-1 text-2xl font-bold text-pedon-navy">{value}</p>
    </div>
  );
}

function MemberCard({ member }: { member: LoyaltyMember }) {
  return (
    <li className="rounded-lg border border-pedon-navy/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-pedon-navy">{member.name ?? 'Cliente anônimo'}</p>
          <p className="text-sm text-pedon-text/70">
            {maskCpf(member.cpf_last2)} · desde {formatDate(member.member_since)}
          </p>
        </div>
        <p className="text-xl font-bold text-pedon-navy">
          {formatPoints(member.points_balance)} pts
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-pedon-text/60">Acumulados</dt>
          <dd className="font-medium">{formatPoints(member.total_earned)}</dd>
        </div>
        <div>
          <dt className="text-pedon-text/60">Estornados</dt>
          <dd className="font-medium">{formatPoints(member.total_reversed)}</dd>
        </div>
        <div>
          <dt className="text-pedon-text/60">Em recuperação</dt>
          <dd className="font-medium">{formatPoints(member.recovery_points)}</dd>
        </div>
      </dl>
    </li>
  );
}

export function ClubeAdminPage() {
  const { organization, profile } = useAdmin();
  const auth = useContext(AuthContext);
  const organizationId = organization?.id ?? '';
  const userId = auth?.user?.id ?? profile?.id ?? '';
  const queryClient = useQueryClient();

  const programQuery = useQuery({
    queryKey: loyaltyProgramKey(userId, organizationId),
    queryFn: () => fetchLoyaltyProgramAdmin(organizationId),
    enabled: userId !== '' && organizationId !== '',
  });

  const membersQuery = useInfiniteQuery({
    queryKey: loyaltyMembersPrefix(userId, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchLoyaltyMembersAdmin(organizationId, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.has_more && lastPage.next_cursor !== null ? lastPage.next_cursor : undefined,
    enabled: userId !== '' && organizationId !== '',
  });

  const memberPages = membersQuery.data?.pages ?? [];
  const members = Array.from(
    new Map(
      memberPages.flatMap((page) => page.members).map((member) => [member.id, member]),
    ).values(),
  );
  const hasMore = membersQuery.hasNextPage;
  const membersLoading = membersQuery.isLoading || membersQuery.isFetchingNextPage;
  const membersError = membersQuery.isError
    ? membersQuery.error instanceof Error
      ? membersQuery.error.message
      : 'Não foi possível carregar os membros.'
    : null;

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setLoyaltyProgramEnabled(organizationId, enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: loyaltyProgramKey(userId, organizationId),
      });
    },
  });

  function toggleProgram() {
    const enabled = programQuery.data?.program?.enabled ?? false;
    const message = enabled
      ? 'Desativar o Clube Ped-On? Clientes deixam de acumular pontos em novas compras. Os saldos atuais são preservados.'
      : 'Ativar o Clube Ped-On? A partir de agora, clientes acumulam pontos nas compras concluídas.';
    if (window.confirm(message)) {
      toggleMutation.mutate(!enabled);
    }
  }

  if (organizationId === '') {
    return <p className="text-pedon-text/70">Nenhuma organização disponível.</p>;
  }

  if (programQuery.isLoading) {
    return (
      <p role="status" className="text-pedon-text/70">
        Carregando o Clube Ped-On…
      </p>
    );
  }

  if (programQuery.isError || programQuery.data === undefined) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {(programQuery.error as Error | null)?.message ??
          'Não foi possível carregar o Clube Ped-On.'}
      </p>
    );
  }

  const program = programQuery.data.program;
  const enabled = program?.enabled ?? false;
  const pointsPerReal = program?.points_per_real ?? '1.00';

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Fidelidade</p>
      <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Clube Ped-On</h2>
      <p className="mt-1 text-sm text-pedon-text/70">
        Clientes acumulam pontos nas compras concluídas. A identidade é protegida: o CPF nunca é
        armazenado.
      </p>

      {!enabled && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          O Clube está desativado. Nenhum cliente acumula pontos no momento.
        </p>
      )}

      {toggleMutation.isError && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {toggleMutation.error instanceof Error
            ? toggleMutation.error.message
            : 'Não foi possível alterar o Clube.'}
        </p>
      )}

      <section
        aria-label="Status do programa"
        className="mt-5 rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-pedon-navy">
              {enabled ? 'Programa ativo' : 'Programa desativado'}
            </p>
            <p className="mt-1 text-sm text-pedon-text/70">
              Regra: {pointsPerReal} ponto(s) por R$ 1,00 em compras concluídas.
            </p>
          </div>
          <button
            type="button"
            disabled={toggleMutation.isPending}
            onClick={toggleProgram}
            className={
              enabled
                ? 'min-h-11 rounded-md border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-50'
                : 'min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50'
            }
          >
            {toggleMutation.isPending ? 'Salvando…' : enabled ? 'Desativar Clube' : 'Ativar Clube'}
          </button>
        </div>
      </section>

      <section aria-label="Métricas do programa" className="mt-5">
        <h3 className="font-bold text-pedon-navy">Resumo</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatCard label="Membros" value={formatPoints(programQuery.data.stats.members_count)} />
          <StatCard
            label="Pontos acumulados"
            value={formatPoints(programQuery.data.stats.total_earned)}
          />
          <StatCard
            label="Pontos estornados"
            value={formatPoints(programQuery.data.stats.total_reversed)}
          />
        </div>
      </section>

      <section aria-label="Membros do Clube" className="mt-7">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-bold text-pedon-navy">Membros</h3>
          <p className="text-sm text-pedon-text/70" aria-live="polite">
            {members.length} {members.length === 1 ? 'membro exibido' : 'membros exibidos'}
          </p>
        </div>

        {membersError !== null && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {membersError}
          </p>
        )}

        {members.length === 0 && !membersLoading ? (
          <p className="mt-3 rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
            Nenhum cliente entrou no Clube ainda.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {members.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => void membersQuery.fetchNextPage()}
            disabled={membersQuery.isFetchingNextPage}
            className="mt-4 min-h-11 w-full rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
          >
            {membersQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </section>
    </div>
  );
}
