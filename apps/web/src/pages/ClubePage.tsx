import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import type { SubmitHandler, UseFormRegisterReturn } from 'react-hook-form';
import { publicMenuQueryOptions } from '../lib/menu/public-menu-query';
import type { PublicMenuData } from '../lib/menu/menu';
import { formatBRL } from '../lib/money';
import { assertOnline } from '../lib/offline/useOnline';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import {
  clubEnrollSchema,
  clubLookupSchema,
  fetchPublicLoyaltyAccount,
  isLoyaltyToken,
  LOYALTY_STATEMENT_MAX_ITEMS,
  LoyaltyError,
  maskCpf,
  resolveLoyaltyIdentity,
} from '../lib/loyalty/loyalty';
import type {
  LoyaltyResolveFound,
  LoyaltyStatementEntry,
  LoyaltyVoucher,
} from '../lib/loyalty/loyalty';
import {
  createRecoverySecret,
  parseRewardPoints,
  publicLoyaltyRewardsKey,
  publicLoyaltyRewardsQueryOptions,
  PublicRewardError,
  recoverPublicRedemption,
  redeemPublicLoyaltyReward,
} from '../lib/loyalty/public-rewards';
import type { PublicRedemption, PublicReward } from '../lib/loyalty/public-rewards';
import {
  clearPendingRedemption,
  loadPendingRedemption,
  savePendingRedemption,
} from '../lib/loyalty/pending-redemption';

type LookupValues = { cpf: string; phone: string };
type EnrollValues = { cpf: string; phone: string; name: string; consent: boolean };

const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-base text-pedon-text';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {message}
    </p>
  );
}

function ClubCpfInput({
  id,
  register,
  error,
}: {
  id: string;
  register: UseFormRegisterReturn;
  error: string | undefined;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-pedon-text">
        CPF
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder="000.000.000-00"
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        className={inputClass}
        {...register}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function ClubPhoneInput({
  id,
  register,
  error,
}: {
  id: string;
  register: UseFormRegisterReturn;
  error: string | undefined;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-pedon-text">
        Telefone com DDD
      </label>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        className={inputClass}
        {...register}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function formatPoints(value: number | bigint): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function absolutePoints(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function formatSignedPoints(value: bigint): string {
  const sign = value > 0n ? '+' : value < 0n ? '-' : '';
  return `${sign}${formatPoints(absolutePoints(value))}`;
}

function StatementEntry({ entry }: { entry: LoyaltyStatementEntry }) {
  const reversal = entry.entry_type === 'reversal';
  const redemption = entry.entry_type === 'redeem';
  const negative = reversal || redemption;
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-pedon-navy">
            {redemption
              ? 'Resgate de recompensa'
              : reversal
                ? 'Estorno de pontos'
                : 'Pontos recebidos'}
          </p>
          <p className="mt-1 text-xs text-pedon-text/65">
            {entry.order_number !== null ? `Pedido #${entry.order_number} · ` : ''}
            {new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(entry.created_at))}
          </p>
        </div>
        <p className={`shrink-0 font-bold ${negative ? 'text-red-700' : 'text-green-700'}`}>
          {negative ? '-' : '+'}
          {formatPoints(absolutePoints(entry.gross_points))} pontos
        </p>
      </div>
      {entry.eligible_amount !== null && (
        <p className="mt-2 text-sm text-pedon-text/70">
          Valor elegível: {formatBRL(entry.eligible_amount)}
        </p>
      )}
      <p className="mt-1 text-sm text-pedon-text/70">
        Saldo disponível: {formatSignedPoints(entry.points_delta)} pontos
      </p>
      {entry.recovery_delta !== 0n && (
        <p className="mt-1 text-sm font-medium text-amber-900">
          {entry.recovery_delta > 0n
            ? `Em recuperação: +${formatPoints(entry.recovery_delta)} pontos`
            : `Recuperação compensada: ${formatPoints(absolutePoints(entry.recovery_delta))} pontos`}
        </p>
      )}
    </li>
  );
}

function VoucherView({
  voucher,
  rewardName,
  message,
}: {
  voucher: { code: string; issued_at: string };
  rewardName: string;
  message?: string;
}) {
  return (
    <div
      role={message === undefined ? undefined : 'status'}
      className="rounded-lg border-2 border-dashed border-pedon-orange/60 bg-orange-50 p-4"
    >
      {message !== undefined && <p className="font-semibold text-green-800">{message}</p>}
      <p className="mt-2 text-sm font-medium text-pedon-text/70">{rewardName}</p>
      <p className="mt-1 break-all font-mono text-xl font-bold tracking-wider text-pedon-navy">
        {voucher.code}
      </p>
      <p className="mt-2 text-xs text-pedon-text/65">
        Apresente este código à equipe do estabelecimento para receber sua recompensa.
      </p>
    </div>
  );
}

function ConfirmationDialog({
  reward,
  balance,
  busy,
  onCancel,
  onConfirm,
}: {
  reward: PublicReward;
  balance: bigint;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    if (busy) dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable === undefined || focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const cost = parseRewardPoints(reward.points_cost);
  const remaining = balance - cost;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-pedon-navy/55 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-confirm-title"
        aria-describedby="reward-confirm-description"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 id="reward-confirm-title" className="text-xl font-bold text-pedon-navy">
          Confirmar troca
        </h2>
        <p id="reward-confirm-description" className="mt-3 text-pedon-text">
          Trocar {formatPoints(cost)} pontos por <strong>{reward.name}</strong>?
        </p>
        <dl className="mt-4 space-y-2 rounded-md bg-pedon-surface p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt>Saldo atual</dt>
            <dd className="font-semibold">{formatPoints(balance)} pontos</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Custo</dt>
            <dd className="font-semibold">{formatPoints(cost)} pontos</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Saldo após troca</dt>
            <dd className="font-semibold">{formatPoints(remaining)} pontos</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm font-medium text-amber-900">
          A troca gera um voucher e não pode ser cancelada no Core MVP.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-11 flex-1 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Trocando…' : 'Confirmar troca'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RewardsCatalog({
  rewards,
  balance,
  recovery,
  identified,
  accessAvailable,
  loading,
  error,
  onSelect,
}: {
  rewards: PublicReward[];
  balance: bigint | null;
  recovery: bigint;
  identified: boolean;
  accessAvailable: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (reward: PublicReward, opener: HTMLButtonElement) => void;
}) {
  return (
    <section aria-labelledby="club-rewards-title" className="mt-6">
      <div className="mb-3">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          Recompensas
        </p>
        <h2 id="club-rewards-title" className="text-xl font-bold text-pedon-navy">
          Troque seus pontos
        </h2>
      </div>
      {loading && (
        <p role="status" className="text-sm text-pedon-text/65">
          Carregando recompensas…
        </p>
      )}
      {error !== null && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && error === null && rewards.length === 0 && (
        <p className="rounded-lg border border-pedon-navy/10 bg-white p-4 text-sm text-pedon-text/70">
          Nenhuma recompensa disponível no momento.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {rewards.map((reward) => {
          const cost = parseRewardPoints(reward.points_cost);
          const missing = balance === null ? 0n : cost - balance;
          const sufficient = balance !== null && missing <= 0n;
          const buttonText = !reward.available
            ? 'Indisponível'
            : !identified
              ? `Trocar por ${formatPoints(cost)} pontos`
              : !accessAvailable
                ? 'Consulte novamente para outra troca'
                : recovery > 0n
                  ? 'Troca bloqueada durante a recuperação'
                  : sufficient
                    ? `Trocar por ${formatPoints(cost)} pontos`
                    : `Faltam ${formatPoints(missing)} pontos`;
          return (
            <li
              key={reward.id}
              className="flex flex-col rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
            >
              <h3 className="font-bold text-pedon-navy">{reward.name}</h3>
              {reward.description !== null && (
                <p className="mt-1 grow text-sm text-pedon-text/70">{reward.description}</p>
              )}
              <p className="mt-3 font-semibold text-pedon-orange">{formatPoints(cost)} pontos</p>
              <button
                type="button"
                disabled={
                  !reward.available ||
                  (identified && (!accessAvailable || recovery > 0n || !sufficient))
                }
                onClick={(event) => onSelect(reward, event.currentTarget)}
                className="mt-3 min-h-11 rounded-md bg-pedon-navy px-3 font-semibold text-white disabled:bg-pedon-navy/35"
              >
                {buttonText}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LoyaltyAccountView({
  publicSlug,
  account,
  onReset,
  rewards,
  rewardsLoading,
  rewardsError,
  onRefetchRewards,
  onConsumeAccessToken,
  onUpdateAccount,
}: {
  publicSlug: string;
  account: LoyaltyResolveFound;
  onReset: () => void;
  rewards: PublicReward[];
  rewardsLoading: boolean;
  rewardsError: string | null;
  onRefetchRewards: () => Promise<unknown>;
  onConsumeAccessToken: () => void;
  onUpdateAccount: (account: LoyaltyResolveFound) => void;
}) {
  const { runCriticalOperation } = useCriticalOperation();
  const [balance, setBalance] = useState(account.account.points_balance);
  const [recovery, setRecovery] = useState(account.account.recovery_points);
  const [statement, setStatement] = useState(
    (account.statement ?? []).slice(0, LOYALTY_STATEMENT_MAX_ITEMS),
  );
  const [vouchers, setVouchers] = useState<LoyaltyVoucher[]>(account.vouchers ?? []);
  const [accessToken, setAccessToken] = useState<string | null>(account.token.access_token);
  const [selectedReward, setSelectedReward] = useState<PublicReward | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redemptionError, setRedemptionError] = useState<string | null>(null);
  const [redemption, setRedemption] = useState<PublicRedemption | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const customerName = account.customer.name?.trim();
  const greeting = customerName ? customerName : null;

  async function refresh() {
    if (!isLoyaltyToken(accessToken)) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await fetchPublicLoyaltyAccount(accessToken);
      if (result.found === true) {
        setBalance(result.account.points_balance);
        setRecovery(result.account.recovery_points);
        setStatement(result.statement.slice(0, LOYALTY_STATEMENT_MAX_ITEMS));
        setVouchers(result.vouchers ?? []);
        onUpdateAccount({
          ...account,
          customer: result.customer,
          account: result.account,
          statement: result.statement,
          vouchers: result.vouchers,
        });
      } else {
        setExpired(true);
        setAccessToken(null);
      }
    } catch (error) {
      setRefreshError(
        error instanceof LoyaltyError
          ? error.message
          : 'Não foi possível atualizar o saldo. Tente novamente.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  function closeDialog() {
    openerRef.current?.focus();
    setSelectedReward(null);
  }

  async function redeem() {
    if (selectedReward === null || !isLoyaltyToken(accessToken)) return;
    const reward = selectedReward;
    const idempotencyKey = crypto.randomUUID();
    const recoverySecret = createRecoverySecret();
    savePendingRedemption({
      public_slug: publicSlug,
      idempotency_key: idempotencyKey,
      recovery_secret: recoverySecret,
      reward_id: reward.id,
      created_at: new Date().toISOString(),
    });
    setRedeeming(true);
    setRedemptionError(null);
    try {
      assertOnline();
      const result = await runCriticalOperation(() =>
        redeemPublicLoyaltyReward({
          publicSlug,
          idempotencyKey,
          recoverySecret,
          rewardId: reward.id,
          rewardRevision: reward.revision,
          accessToken,
        }),
      );
      setAccessToken(null);
      onConsumeAccessToken();
      clearPendingRedemption(publicSlug);
      const redeemedPoints = parseRewardPoints(result.redemption.points_cost);
      setBalance((current) => current - redeemedPoints);
      setStatement((current) =>
        [
          {
            entry_type: 'redeem',
            gross_points: redeemedPoints,
            points_delta: -redeemedPoints,
            recovery_delta: 0n,
            eligible_amount: null,
            order_number: null,
            created_at: result.redemption.created_at,
          } satisfies LoyaltyStatementEntry,
          ...current,
        ].slice(0, LOYALTY_STATEMENT_MAX_ITEMS),
      );
      setRedemption(result);
      closeDialog();
      void onRefetchRewards();
    } catch (error) {
      const rewardError = error instanceof PublicRewardError ? error : null;
      if (rewardError !== null && rewardError.code !== null) clearPendingRedemption(publicSlug);
      if (rewardError === null || rewardError.code === null) {
        setAccessToken(null);
        onConsumeAccessToken();
      }
      if (rewardError?.code === 'PED52') {
        setAccessToken(null);
        onConsumeAccessToken();
      }
      setRedemptionError(
        rewardError?.message ?? 'Não foi possível concluir a troca. Verifique sua conexão.',
      );
      if (rewardError?.code === 'PED56' || rewardError?.code === 'PED57') {
        await onRefetchRewards();
      }
      if (rewardError?.code === 'PED58' && isLoyaltyToken(accessToken)) await refresh();
      closeDialog();
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <section
        aria-labelledby="club-account-title"
        className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm"
      >
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          Seu saldo
        </p>
        <h2 id="club-account-title" className="mt-1 text-xl font-bold text-pedon-navy">
          {greeting !== null ? `Olá, ${greeting}` : 'Bem-vindo de volta ao Clube Ped-On'}
        </h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          Cadastro {maskCpf(account.customer.cpf_last2)}
        </p>

        <dl className="mt-5 space-y-3">
          <div className="flex flex-col gap-2 rounded-md bg-pedon-surface p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <dt className="font-medium text-pedon-text/80">Pontos disponíveis</dt>
            <dd className="min-w-0 break-all text-right text-3xl font-bold text-pedon-navy">
              {formatPoints(balance)}
            </dd>
          </div>
          {recovery > 0n && (
            <div className="flex items-baseline justify-between gap-3 rounded-md bg-amber-50 p-4">
              <dt className="font-medium text-amber-900">Em recuperação</dt>
              <dd className="text-xl font-bold text-amber-900">{formatPoints(recovery)}</dd>
            </div>
          )}
        </dl>

        <p className="mt-3 text-xs text-pedon-text/65">
          Seus pontos aparecem aqui assim que seus pedidos forem concluídos.
        </p>

        {redemptionError !== null && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {redemptionError}
          </p>
        )}
        {redemption !== null && (
          <div className="mt-5">
            <VoucherView
              voucher={redemption.voucher}
              rewardName={redemption.redemption.reward_name}
              message="Recompensa resgatada!"
            />
          </div>
        )}

        <RewardsCatalog
          rewards={rewards}
          balance={balance}
          recovery={recovery}
          identified
          accessAvailable={isLoyaltyToken(accessToken)}
          loading={rewardsLoading}
          error={rewardsError}
          onSelect={(reward, opener) => {
            openerRef.current = opener;
            setRedemptionError(null);
            setSelectedReward(reward);
          }}
        />

        <section
          aria-labelledby="active-vouchers-title"
          className="mt-6 border-t border-pedon-navy/10 pt-5"
        >
          <h3 id="active-vouchers-title" className="font-bold text-pedon-navy">
            Meus vouchers
          </h3>
          {vouchers.length === 0 ? (
            <p className="mt-3 text-sm text-pedon-text/70">Nenhum voucher ativo no momento.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {vouchers.map((voucher) => (
                <li key={`${voucher.code}-${voucher.issued_at}`}>
                  <VoucherView voucher={voucher} rewardName={voucher.reward_name} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="club-statement-title"
          className="mt-6 border-t border-pedon-navy/10 pt-5"
        >
          <h3 id="club-statement-title" className="font-bold text-pedon-navy">
            Extrato de pontos
          </h3>
          {statement.length === 0 ? (
            <p className="mt-3 text-sm text-pedon-text/70">Nenhuma movimentação de pontos ainda.</p>
          ) : (
            <ul className="mt-3 divide-y divide-pedon-navy/10">
              {statement.map((entry, index) => (
                <StatementEntry
                  key={`${entry.order_number}-${entry.entry_type}-${entry.created_at}-${index}`}
                  entry={entry}
                />
              ))}
            </ul>
          )}
        </section>

        {expired && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            Sua consulta expirou. Consulte novamente para ver o saldo atualizado.
          </p>
        )}
        {refreshError !== null && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {refreshError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || !isLoyaltyToken(accessToken)}
            className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
          >
            {refreshing ? 'Atualizando…' : 'Atualizar saldo'}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy"
          >
            Consultar outro CPF
          </button>
          <Link
            to={`/menu/${publicSlug}`}
            className="min-h-11 rounded-md bg-pedon-orange px-4 py-2.5 font-semibold text-white"
          >
            Ver cardápio
          </Link>
        </div>
      </section>
      {selectedReward !== null && (
        <ConfirmationDialog
          reward={selectedReward}
          balance={balance}
          busy={redeeming}
          onCancel={closeDialog}
          onConfirm={() => void redeem()}
        />
      )}
    </div>
  );
}

function ClubActions({
  publicSlug,
  onIdentified,
}: {
  publicSlug: string;
  onIdentified: (result: LoyaltyResolveFound) => void;
}) {
  const [action, setAction] = useState<'lookup' | 'enroll'>('lookup');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const lookupForm = useForm<LookupValues>({
    resolver: zodResolver(clubLookupSchema),
    defaultValues: { cpf: '', phone: '' },
  });
  const enrollForm = useForm<EnrollValues>({
    resolver: zodResolver(clubEnrollSchema),
    defaultValues: { cpf: '', phone: '', name: '', consent: false },
  });

  const submitting = lookupForm.formState.isSubmitting || enrollForm.formState.isSubmitting;

  const doLookup: SubmitHandler<LookupValues> = async (values) => {
    setSubmitError(null);
    setNotFound(false);
    try {
      const result = await resolveLoyaltyIdentity({
        publicSlug,
        mode: 'lookup',
        cpf: values.cpf,
        phone: values.phone,
      });
      if (result.found === true) {
        onIdentified(result);
      } else {
        setNotFound(true);
      }
    } catch (error) {
      if (error instanceof LoyaltyError && error.code === 'IDENTITY_NOT_CONFIRMED') {
        setNotFound(true);
      }
      setSubmitError(
        error instanceof LoyaltyError ? error.message : 'Não foi possível processar a solicitação.',
      );
    }
  };

  const doEnroll: SubmitHandler<EnrollValues> = async (values) => {
    setSubmitError(null);
    setNotFound(false);
    try {
      const result = await resolveLoyaltyIdentity({
        publicSlug,
        mode: 'enroll',
        cpf: values.cpf,
        phone: values.phone,
        name: values.name,
        consent: true,
      });
      if (result.found === true) {
        onIdentified(result);
      }
    } catch (error) {
      setSubmitError(
        error instanceof LoyaltyError ? error.message : 'Não foi possível processar a solicitação.',
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      {submitError !== null && (
        <p
          role="alert"
          aria-live="assertive"
          className="mb-5 rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {submitError}
        </p>
      )}

      {notFound && action === 'lookup' && (
        <p role="status" className="mb-5 rounded-md bg-pedon-surface p-4 text-sm text-pedon-text">
          Não foi possível confirmar um cadastro com os dados informados.{' '}
          <button
            type="button"
            onClick={() => {
              setAction('enroll');
              setNotFound(false);
            }}
            className="font-semibold text-pedon-orange underline"
          >
            Entrar no Clube agora
          </button>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setAction('lookup')}
          aria-expanded={action === 'lookup'}
          aria-controls="club-lookup-panel"
          className="rounded-lg border border-pedon-navy/15 bg-white p-5 text-left shadow-sm transition hover:border-pedon-orange"
        >
          <p className="font-bold text-pedon-navy">Consultar meus pontos</p>
          <p className="mt-1 text-sm text-pedon-text/70">
            Veja seu saldo usando o CPF do seu cadastro.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setAction('enroll')}
          aria-expanded={action === 'enroll'}
          aria-controls="club-enroll-panel"
          className="rounded-lg border border-pedon-navy/15 bg-white p-5 text-left shadow-sm transition hover:border-pedon-orange"
        >
          <p className="font-bold text-pedon-navy">Entrar no Clube</p>
          <p className="mt-1 text-sm text-pedon-text/70">
            Comece a acumular pontos nas suas próximas compras.
          </p>
        </button>
      </div>

      {action === 'lookup' && (
        <section
          id="club-lookup-panel"
          aria-labelledby="club-lookup-title"
          className="mt-5 rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm"
        >
          <h2 id="club-lookup-title" className="font-bold text-pedon-navy">
            Consultar meus pontos
          </h2>
          <p className="mt-1 text-sm text-pedon-text/70">
            Informe o CPF usado no seu cadastro. Nenhum dado é armazenado no navegador.
          </p>
          <form className="mt-4 space-y-4" onSubmit={lookupForm.handleSubmit(doLookup)} noValidate>
            <ClubCpfInput
              id="club-lookup-cpf"
              register={lookupForm.register('cpf')}
              error={lookupForm.formState.errors.cpf?.message}
            />
            <ClubPhoneInput
              id="club-lookup-phone"
              register={lookupForm.register('phone')}
              error={lookupForm.formState.errors.phone?.message}
            />
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-pedon-orange px-4 py-2.5 font-semibold text-white disabled:opacity-45"
            >
              {lookupForm.formState.isSubmitting ? 'Consultando…' : 'Consultar'}
            </button>
          </form>
        </section>
      )}

      {action === 'enroll' && (
        <section
          id="club-enroll-panel"
          aria-labelledby="club-enroll-title"
          className="mt-5 rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm"
        >
          <h2 id="club-enroll-title" className="font-bold text-pedon-navy">
            Entrar no Clube
          </h2>
          <p className="mt-1 text-sm text-pedon-text/70">
            Cadastre-se e acumule pontos a partir da próxima compra.
          </p>
          <form className="mt-4 space-y-4" onSubmit={enrollForm.handleSubmit(doEnroll)} noValidate>
            <ClubCpfInput
              id="club-enroll-cpf"
              register={enrollForm.register('cpf')}
              error={enrollForm.formState.errors.cpf?.message}
            />
            <ClubPhoneInput
              id="club-enroll-phone"
              register={enrollForm.register('phone')}
              error={enrollForm.formState.errors.phone?.message}
            />
            <div>
              <label htmlFor="club-enroll-name" className="block text-sm font-medium">
                Nome
              </label>
              <input
                id="club-enroll-name"
                autoComplete="name"
                aria-invalid={enrollForm.formState.errors.name !== undefined}
                aria-describedby={
                  enrollForm.formState.errors.name !== undefined
                    ? 'club-enroll-name-error'
                    : undefined
                }
                className={inputClass}
                {...enrollForm.register('name')}
              />
              <FieldError
                id="club-enroll-name-error"
                message={enrollForm.formState.errors.name?.message}
              />
            </div>
            <div>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  aria-invalid={enrollForm.formState.errors.consent !== undefined}
                  aria-describedby={
                    enrollForm.formState.errors.consent !== undefined
                      ? 'club-enroll-consent-error'
                      : undefined
                  }
                  {...enrollForm.register('consent')}
                />
                <span className="text-sm text-pedon-text">
                  Aceito participar do Clube Ped-On e concordo com o uso dos meus dados para o
                  programa de fidelidade. O Ped-On não armazena o CPF: guarda apenas uma
                  identificação segura para a pontuação.
                </span>
              </label>
              <FieldError
                id="club-enroll-consent-error"
                message={enrollForm.formState.errors.consent?.message}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-pedon-orange px-4 py-2.5 font-semibold text-white disabled:opacity-45"
            >
              {enrollForm.formState.isSubmitting ? 'Cadastrando…' : 'Entrar no Clube'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function ClubUnavailable({ publicSlug }: { publicSlug: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-pedon-surface px-4 text-center">
      <h1 className="text-2xl font-bold text-pedon-navy">Clube Ped-On</h1>
      <p role="status" className="mt-3 max-w-sm text-sm text-pedon-text/70">
        O Clube Ped-On está indisponível para este estabelecimento no momento.
      </p>
      <Link
        to={`/menu/${publicSlug}`}
        className="mt-6 min-h-11 rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white"
      >
        Voltar ao cardápio
      </Link>
    </div>
  );
}

function ClubMissing() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-pedon-surface px-4 text-center">
      <h1 className="text-2xl font-bold text-pedon-navy">Cardápio não encontrado</h1>
      <p className="mt-2 max-w-sm text-sm text-pedon-text/70">
        O link que você acessou não existe ou a publicação foi removida.
      </p>
      <Link
        to="/"
        className="mt-6 min-h-11 rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white"
      >
        Voltar ao início
      </Link>
    </div>
  );
}

export function ClubePage() {
  const { publicSlug = '' } = useParams<{ publicSlug: string }>();
  const menuQuery = useQuery(publicMenuQueryOptions(publicSlug));
  const rewardsQuery = useQuery(publicLoyaltyRewardsQueryOptions(publicSlug));
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<LoyaltyResolveFound | null>(null);
  const [identificationMessage, setIdentificationMessage] = useState<string | null>(null);
  const [recoveredRedemption, setRecoveredRedemption] = useState<PublicRedemption | null>(null);

  useEffect(() => {
    if (publicSlug === '') return;
    const pending = loadPendingRedemption(publicSlug);
    if (pending === null) return;
    let active = true;
    void (async () => {
      try {
        const result = await recoverPublicRedemption({
          publicSlug,
          idempotencyKey: pending.idempotency_key,
          recoverySecret: pending.recovery_secret,
        });
        if (!active) return;
        if (result.found) {
          clearPendingRedemption(publicSlug);
          setRecoveredRedemption(result);
        }
      } catch {
        // Keep the attempt for another load until its 24-hour expiry.
      }
    })();
    return () => {
      active = false;
    };
  }, [publicSlug]);

  const menu: PublicMenuData | null = menuQuery.data?.found === true ? menuQuery.data : null;

  if (menuQuery.isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
        <p className="text-pedon-text/60">Carregando Clube Ped-On…</p>
      </div>
    );
  }
  if (menuQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center px-4 text-center">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível carregar o Clube: {menuQuery.error.message}
        </p>
      </div>
    );
  }
  if (menuQuery.data === undefined || menu === null) return <ClubMissing />;
  if (!menu.loyalty.enabled) return <ClubUnavailable publicSlug={publicSlug} />;

  return (
    <div className="min-h-svh bg-pedon-surface text-pedon-text">
      <header className="border-b border-pedon-navy/10 bg-white px-4 py-5">
        <div className="mx-auto w-full max-w-lg">
          <Link
            to={`/menu/${publicSlug}`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-pedon-navy"
          >
            ← Voltar ao cardápio
          </Link>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wider text-pedon-orange">
            {menu.organization.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-pedon-navy">Clube Ped-On</h1>
          <p className="mt-2 text-sm text-pedon-text/70">
            Ganhe pontos nas suas compras e acompanhe seu saldo.
          </p>
        </div>
      </header>

      {recoveredRedemption !== null && (
        <div className="mx-auto w-full max-w-lg px-4 pt-6">
          <VoucherView
            voucher={recoveredRedemption.voucher}
            rewardName={recoveredRedemption.redemption.reward_name}
            message="Troca recuperada com sucesso. Seu voucher está pronto."
          />
        </div>
      )}

      {account === null ? (
        <div className="mx-auto w-full max-w-lg px-4 py-6">
          {identificationMessage !== null && (
            <p role="status" className="mb-4 rounded-md bg-orange-50 p-3 text-sm text-pedon-text">
              {identificationMessage}
            </p>
          )}
          <RewardsCatalog
            rewards={rewardsQuery.data?.found === true ? rewardsQuery.data.rewards : []}
            balance={null}
            recovery={0n}
            identified={false}
            accessAvailable={false}
            loading={rewardsQuery.isLoading}
            error={rewardsQuery.isError ? rewardsQuery.error.message : null}
            onSelect={() => {
              setIdentificationMessage('Consulte seus pontos para realizar a troca.');
            }}
          />
          <ClubActions publicSlug={publicSlug} onIdentified={setAccount} />
        </div>
      ) : (
        <LoyaltyAccountView
          publicSlug={publicSlug}
          account={account}
          onReset={() => setAccount(null)}
          rewards={rewardsQuery.data?.found === true ? rewardsQuery.data.rewards : []}
          rewardsLoading={rewardsQuery.isLoading}
          rewardsError={rewardsQuery.isError ? rewardsQuery.error.message : null}
          onRefetchRewards={() =>
            queryClient.refetchQueries({
              queryKey: publicLoyaltyRewardsKey(publicSlug),
              exact: true,
            })
          }
          onConsumeAccessToken={() =>
            setAccount((current) =>
              current === null
                ? null
                : { ...current, token: { ...current.token, access_token: '' } },
            )
          }
          onUpdateAccount={setAccount}
        />
      )}
    </div>
  );
}
