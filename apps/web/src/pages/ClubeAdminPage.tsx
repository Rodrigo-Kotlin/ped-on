import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext, useState } from 'react';
import type { FormEvent } from 'react';
import { useAdmin } from '../lib/admin/admin-context';
import { AuthContext } from '../lib/auth/auth-context';
import { assertOnline } from '../lib/offline/useOnline';
import {
  createLoyaltyReward,
  createLoyaltyRewardSchema,
  fetchLoyaltyRewardsAdmin,
  loyaltyRewardsAdminKey,
  setLoyaltyRewardActive,
  setLoyaltyRewardStock,
  updateLoyaltyReward,
  updateLoyaltyRewardSchema,
} from '../lib/loyalty/admin-rewards';
import type {
  CreateLoyaltyRewardInput,
  LoyaltyReward,
  UpdateLoyaltyRewardInput,
} from '../lib/loyalty/admin-rewards';
import {
  fetchLoyaltyMembersAdmin,
  fetchLoyaltyProgramAdmin,
  loyaltyMembersPrefix,
  loyaltyProgramKey,
  maskCpf,
  setLoyaltyProgramEnabled,
} from '../lib/loyalty/loyalty';
import type { LoyaltyMember } from '../lib/loyalty/loyalty';

function formatPoints(value: number | bigint): string {
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
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-pedon-text/60">Resgatados</dt>
          <dd className="font-medium">{formatPoints(member.total_redeemed)}</dd>
        </div>
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

const fieldClassName =
  'mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text';
const secondaryButtonClassName =
  'min-h-11 rounded-md border border-pedon-navy/25 px-3 font-semibold text-pedon-navy disabled:opacity-50';

interface RewardCardProps {
  reward: LoyaltyReward;
  pending: boolean;
  onUpdate: (rewardId: string, input: UpdateLoyaltyRewardInput) => Promise<void>;
  onStock: (rewardId: string, stock: string) => Promise<void>;
  onActive: (rewardId: string, active: boolean) => Promise<void>;
}

function RewardCard({ reward, pending, onUpdate, onStock, onActive }: RewardCardProps) {
  const [editing, setEditing] = useState(false);
  const [stockEditing, setStockEditing] = useState(false);
  const [name, setName] = useState(reward.name);
  const [description, setDescription] = useState(reward.description ?? '');
  const [pointsCost, setPointsCost] = useState(reward.points_cost);
  const [newStock, setNewStock] = useState(reward.stock_quantity);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateLoyaltyRewardSchema.safeParse({
      name,
      description: description.trim() === '' ? null : description,
      points_cost: pointsCost,
    });
    if (!parsed.success) {
      setValidationError('Revise o nome, a descrição e o custo em pontos.');
      return;
    }
    setValidationError(null);
    try {
      await onUpdate(reward.id, parsed.data);
      setEditing(false);
    } catch {
      // The parent mutation renders the friendly inline error.
    }
  }

  async function submitStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[0-9]+$/.test(newStock)) {
      setValidationError('O novo estoque deve ser um número inteiro igual ou maior que zero.');
      return;
    }
    const confirmed = window.confirm(
      `Confirmar ajuste do estoque de “${reward.name}”? Estoque atual: ${reward.stock_quantity}. Novo estoque: ${newStock}.`,
    );
    if (!confirmed) return;
    setValidationError(null);
    try {
      await onStock(reward.id, newStock);
      setStockEditing(false);
    } catch {
      // The parent mutation renders the friendly inline error.
    }
  }

  function toggleActive() {
    const action = reward.is_active ? 'desativar' : 'ativar';
    if (
      window.confirm(
        `Confirmar ${action} a recompensa “${reward.name}”? ${
          reward.is_active
            ? 'Ela continuará listada e poderá ser reativada.'
            : 'Ela voltará a ficar disponível para resgate.'
        }`,
      )
    ) {
      void onActive(reward.id, !reward.is_active).catch(() => undefined);
    }
  }

  return (
    <li className="rounded-lg border border-pedon-navy/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-bold text-pedon-navy">{reward.name}</h4>
          {reward.description !== null && (
            <p className="mt-1 break-words text-sm text-pedon-text/70">{reward.description}</p>
          )}
        </div>
        <span
          className={
            reward.is_active
              ? 'rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800'
              : 'rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700'
          }
        >
          {reward.is_active ? 'Ativa' : 'Inativa'}
        </span>
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-pedon-text/60">Custo em pontos</dt>
          <dd className="font-bold text-pedon-navy">{reward.points_cost} pontos</dd>
        </div>
        <div>
          <dt className="text-pedon-text/60">Estoque disponível</dt>
          <dd className="font-bold text-pedon-navy">{reward.stock_quantity} unidades</dd>
        </div>
      </dl>

      {validationError !== null && (
        <p
          id={`reward-${reward.id}-validation-error`}
          role="alert"
          className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {validationError}
        </p>
      )}

      {editing && (
        <form onSubmit={(event) => void submitEdit(event)} className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-pedon-navy">
            Nome
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              aria-invalid={validationError !== null}
              aria-describedby={
                validationError === null ? undefined : `reward-${reward.id}-validation-error`
              }
              className={fieldClassName}
            />
          </label>
          <label className="block text-sm font-medium text-pedon-navy">
            Descrição
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={3}
              aria-invalid={validationError !== null}
              aria-describedby={
                validationError === null ? undefined : `reward-${reward.id}-validation-error`
              }
              className={fieldClassName}
            />
          </label>
          <label className="block text-sm font-medium text-pedon-navy">
            Custo em pontos
            <input
              value={pointsCost}
              onChange={(event) => setPointsCost(event.target.value)}
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              required
              aria-invalid={validationError !== null}
              aria-describedby={
                validationError === null ? undefined : `reward-${reward.id}-validation-error`
              }
              className={fieldClassName}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={secondaryButtonClassName}
            >
              Cancelar edição
            </button>
          </div>
        </form>
      )}

      {stockEditing && (
        <form
          onSubmit={(event) => void submitStock(event)}
          className="mt-4 rounded-md bg-slate-50 p-3"
        >
          <p className="text-sm text-pedon-text/70">
            Estoque atual: <strong>{reward.stock_quantity}</strong>
          </p>
          <label className="mt-2 block text-sm font-medium text-pedon-navy">
            Novo estoque
            <input
              value={newStock}
              onChange={(event) => setNewStock(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]+"
              required
              aria-invalid={validationError !== null}
              aria-describedby={
                validationError === null ? undefined : `reward-${reward.id}-validation-error`
              }
              className={fieldClassName}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Salvando…' : 'Confirmar novo estoque'}
            </button>
            <button
              type="button"
              onClick={() => setStockEditing(false)}
              className={secondaryButtonClassName}
            >
              Cancelar estoque
            </button>
          </div>
        </form>
      )}

      {!editing && !stockEditing && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={secondaryButtonClassName}
          >
            Editar recompensa
          </button>
          <button
            type="button"
            onClick={() => {
              setNewStock(reward.stock_quantity);
              setStockEditing(true);
            }}
            className={secondaryButtonClassName}
          >
            Ajustar estoque
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={toggleActive}
            className={
              reward.is_active
                ? 'min-h-11 rounded-md border border-red-300 px-3 font-semibold text-red-800 disabled:opacity-50'
                : 'min-h-11 rounded-md border border-green-300 px-3 font-semibold text-green-800 disabled:opacity-50'
            }
          >
            {pending
              ? 'Salvando…'
              : reward.is_active
                ? 'Desativar recompensa'
                : 'Ativar recompensa'}
          </button>
        </div>
      )}
    </li>
  );
}

export function ClubeAdminPage() {
  const { organization, profile } = useAdmin();
  const auth = useContext(AuthContext);
  const organizationId = organization?.id ?? '';
  const userId = auth?.user?.id ?? profile?.id ?? '';
  const queryClient = useQueryClient();
  const [createError, setCreateError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointsCost, setPointsCost] = useState('');
  const [initialStock, setInitialStock] = useState('0');

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

  const rewardsQuery = useInfiniteQuery({
    queryKey: loyaltyRewardsAdminKey(userId, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchLoyaltyRewardsAdmin(organizationId, pageParam),
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
  const rewards = Array.from(
    new Map(
      (rewardsQuery.data?.pages ?? [])
        .flatMap((page) => page.rewards)
        .map((reward) => [reward.id, reward]),
    ).values(),
  );
  const rewardsError = rewardsQuery.isError
    ? rewardsQuery.error instanceof Error
      ? rewardsQuery.error.message
      : 'Não foi possível carregar as recompensas.'
    : null;

  async function refreshRewards() {
    await queryClient.invalidateQueries({
      queryKey: loyaltyRewardsAdminKey(userId, organizationId),
    });
  }

  const createRewardMutation = useMutation({
    mutationFn: (input: CreateLoyaltyRewardInput) => {
      assertOnline();
      return createLoyaltyReward(organizationId, input);
    },
    onSuccess: async () => {
      setName('');
      setDescription('');
      setPointsCost('');
      setInitialStock('0');
      await refreshRewards();
    },
  });

  const updateRewardMutation = useMutation({
    mutationFn: ({ rewardId, input }: { rewardId: string; input: UpdateLoyaltyRewardInput }) => {
      assertOnline();
      return updateLoyaltyReward(rewardId, input);
    },
    onSuccess: refreshRewards,
  });

  const stockRewardMutation = useMutation({
    mutationFn: ({ rewardId, stock }: { rewardId: string; stock: string }) => {
      assertOnline();
      return setLoyaltyRewardStock(rewardId, stock);
    },
    onSuccess: refreshRewards,
  });

  const activeRewardMutation = useMutation({
    mutationFn: ({ rewardId, active }: { rewardId: string; active: boolean }) => {
      assertOnline();
      return setLoyaltyRewardActive(rewardId, active);
    },
    onSuccess: refreshRewards,
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => {
      assertOnline();
      return setLoyaltyProgramEnabled(organizationId, enabled);
    },
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

  function submitReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createLoyaltyRewardSchema.safeParse({
      name,
      description: description.trim() === '' ? null : description,
      points_cost: pointsCost,
      initial_stock: initialStock,
    });
    if (!parsed.success) {
      setCreateError(
        'Revise o nome, a descrição, o custo positivo e o estoque inicial igual ou maior que zero.',
      );
      return;
    }
    setCreateError(null);
    createRewardMutation.mutate(parsed.data);
  }

  const rewardMutationError =
    createRewardMutation.error ??
    updateRewardMutation.error ??
    stockRewardMutation.error ??
    activeRewardMutation.error;
  const rewardMutationPending =
    createRewardMutation.isPending ||
    updateRewardMutation.isPending ||
    stockRewardMutation.isPending ||
    activeRewardMutation.isPending;

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
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <StatCard label="Membros" value={formatPoints(programQuery.data.stats.members_count)} />
          <StatCard
            label="Pontos resgatados"
            value={formatPoints(programQuery.data.stats.total_redeemed)}
          />
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

      <section aria-labelledby="rewards-heading" className="mt-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 id="rewards-heading" className="font-bold text-pedon-navy">
            Recompensas
          </h3>
          <p className="text-sm text-pedon-text/70" aria-live="polite">
            {rewards.length} {rewards.length === 1 ? 'recompensa exibida' : 'recompensas exibidas'}
          </p>
        </div>

        <form
          aria-label="Criar recompensa"
          onSubmit={submitReward}
          className="mt-3 rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h4 className="font-semibold text-pedon-navy">Nova recompensa</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-pedon-navy">
              Nome
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                aria-invalid={createError !== null}
                aria-describedby={createError === null ? undefined : 'create-reward-error'}
                className={fieldClassName}
              />
            </label>
            <label className="block text-sm font-medium text-pedon-navy">
              Custo em pontos
              <input
                value={pointsCost}
                onChange={(event) => setPointsCost(event.target.value)}
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                required
                aria-invalid={createError !== null}
                aria-describedby={createError === null ? undefined : 'create-reward-error'}
                className={fieldClassName}
              />
            </label>
            <label className="block text-sm font-medium text-pedon-navy sm:col-span-2">
              Descrição
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                rows={3}
                aria-invalid={createError !== null}
                aria-describedby={createError === null ? undefined : 'create-reward-error'}
                className={fieldClassName}
              />
            </label>
            <label className="block text-sm font-medium text-pedon-navy">
              Estoque inicial
              <input
                value={initialStock}
                onChange={(event) => setInitialStock(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]+"
                required
                aria-invalid={createError !== null}
                aria-describedby={createError === null ? undefined : 'create-reward-error'}
                className={fieldClassName}
              />
            </label>
          </div>
          {createError !== null && (
            <p
              id="create-reward-error"
              role="alert"
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {createError}
            </p>
          )}
          <button
            type="submit"
            disabled={createRewardMutation.isPending}
            className="mt-3 min-h-11 w-full rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
          >
            {createRewardMutation.isPending ? 'Criando…' : 'Criar recompensa'}
          </button>
        </form>

        {rewardMutationError !== null && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {rewardMutationError instanceof Error
              ? rewardMutationError.message
              : 'Não foi possível salvar a recompensa.'}
          </p>
        )}

        {rewardsError !== null && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {rewardsError}
          </p>
        )}

        {rewardsQuery.isLoading ? (
          <p role="status" className="mt-3 text-sm text-pedon-text/70">
            Carregando recompensas…
          </p>
        ) : rewards.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
            Nenhuma recompensa cadastrada ainda.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rewards.map((reward) => (
              <RewardCard
                key={reward.id}
                reward={reward}
                pending={rewardMutationPending}
                onUpdate={async (rewardId, input) => {
                  await updateRewardMutation.mutateAsync({ rewardId, input });
                }}
                onStock={async (rewardId, stock) => {
                  await stockRewardMutation.mutateAsync({ rewardId, stock });
                }}
                onActive={async (rewardId, active) => {
                  await activeRewardMutation.mutateAsync({ rewardId, active });
                }}
              />
            ))}
          </ul>
        )}

        {rewardsQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => void rewardsQuery.fetchNextPage()}
            disabled={rewardsQuery.isFetchingNextPage}
            className="mt-4 min-h-11 w-full rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
          >
            {rewardsQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais recompensas'}
          </button>
        )}
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
