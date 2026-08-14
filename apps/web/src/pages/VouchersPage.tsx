import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useAdmin } from '../lib/admin/admin-context';
import { assertOnline } from '../lib/offline/useOnline';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import {
  consumeLoyaltyVoucher,
  formatVoucherCodeInput,
  getLoyaltyVoucherStaff,
  StaffVoucherError,
} from '../lib/loyalty/staff-vouchers';
import type { StaffVoucher } from '../lib/loyalty/staff-vouchers';

const ALREADY_CONSUMED_MESSAGE = 'Este voucher já foi utilizado.';
const CONSUMED_SUCCESS_MESSAGE = 'Voucher utilizado com sucesso.';
const RECOVERY_PENDING_MESSAGE =
  'Não foi possível confirmar se o voucher foi utilizado. Verifique novamente antes de continuar.';
const RECOVERY_ISSUED_MESSAGE = 'O consumo não foi confirmado. Tente novamente.';

function formatPoints(value: string): string {
  try {
    return new Intl.NumberFormat('pt-BR').format(BigInt(value));
  } catch {
    return value;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function ConfirmationDialog({
  rewardName,
  busy,
  onCancel,
  onConfirm,
}: {
  rewardName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pedon-navy/55 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voucher-confirmation-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 id="voucher-confirmation-title" className="text-lg font-bold text-pedon-navy">
          Confirmar entrega da recompensa {rewardName}?
        </h3>
        <p className="mt-2 text-sm text-pedon-text/70">
          Esta ação utiliza o voucher e não pode ser desfeita.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Confirmando…' : 'Confirmar entrega'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VoucherForUnit({ unitId, unitName }: { unitId: string; unitName: string }) {
  const { beginCriticalOperation } = useCriticalOperation();
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState<StaffVoucher | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const deliveryButtonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const recoveryLeaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (message !== null) statusRef.current?.focus();
  }, [message]);

  const lookupMutation = useMutation({
    mutationFn: (voucherCode: string) => getLoyaltyVoucherStaff(unitId, voucherCode),
  });
  const consumeMutation = useMutation({
    mutationFn: (voucherCode: string) => {
      assertOnline();
      return consumeLoyaltyVoucher(unitId, voucherCode);
    },
  });

  function closeConfirmation(returnFocus = true) {
    setConfirmationOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => deliveryButtonRef.current?.focus());
    }
  }

  function releaseRecoveryLease() {
    if (recoveryLeaseRef.current !== null) {
      recoveryLeaseRef.current();
      recoveryLeaseRef.current = null;
    }
  }

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryPending) return;
    setVoucher(null);
    setMessage(null);
    setError(null);
    try {
      const result = await lookupMutation.mutateAsync(code);
      if (!result.found) {
        setError('Voucher não encontrado.');
        return;
      }
      setVoucher(result);
      if (result.status === 'consumed') setMessage(ALREADY_CONSUMED_MESSAGE);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível consultar o voucher. Verifique sua conexão e tente novamente.',
      );
    }
  }

  async function resolveAmbiguousConsumption(voucherCode: string) {
    closeConfirmation(false);
    try {
      const recovered = await getLoyaltyVoucherStaff(unitId, voucherCode);
      if (recovered.found && recovered.status === 'consumed') {
        setVoucher(recovered);
        setMessage(CONSUMED_SUCCESS_MESSAGE);
        releaseRecoveryLease();
        setRecoveryPending(false);
        return;
      }
      if (recovered.found && recovered.status === 'issued') {
        setMessage(RECOVERY_ISSUED_MESSAGE);
        releaseRecoveryLease();
        setRecoveryPending(false);
        return;
      }
    } catch {
      // Inconclusive: keep the critical-operation lease until a conclusive result.
    }
    setRecoveryPending(true);
  }

  async function retryRecovery() {
    if (voucher === null || recoveryLeaseRef.current === null || recovering) return;
    setRecovering(true);
    try {
      await resolveAmbiguousConsumption(voucher.code);
    } finally {
      setRecovering(false);
    }
  }

  async function confirmConsumption() {
    if (voucher === null || voucher.status !== 'issued' || recoveryPending) return;
    setError(null);
    setMessage(null);
    recoveryLeaseRef.current = beginCriticalOperation();
    try {
      const consumed = await consumeMutation.mutateAsync(voucher.code);
      setVoucher(consumed);
      setMessage(CONSUMED_SUCCESS_MESSAGE);
      closeConfirmation(false);
      releaseRecoveryLease();
    } catch (caught) {
      if (caught instanceof StaffVoucherError && caught.code === 'PED61') {
        setVoucher({ ...voucher, status: 'consumed' });
        setMessage(ALREADY_CONSUMED_MESSAGE);
        closeConfirmation(false);
        releaseRecoveryLease();
        return;
      }

      if (caught instanceof StaffVoucherError && caught.ambiguous) {
        await resolveAmbiguousConsumption(voucher.code);
        return;
      }

      setError(caught instanceof Error ? caught.message : 'Não foi possível utilizar o voucher.');
      closeConfirmation();
      releaseRecoveryLease();
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Fidelidade</p>
      <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Vouchers</h2>
      <p className="mt-1 text-sm text-pedon-text/70">Validação e entrega em {unitName}.</p>

      <form
        onSubmit={(event) => void handleLookup(event)}
        className="mt-5 rounded-xl border border-pedon-navy/15 bg-white p-4 shadow-sm sm:p-5"
      >
        <label htmlFor="voucher-code" className="block text-sm font-semibold text-pedon-navy">
          Código do voucher
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="voucher-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            disabled={
              lookupMutation.isPending || consumeMutation.isPending || recoveryPending || recovering
            }
            value={code}
            onChange={(event) => {
              setCode(formatVoucherCodeInput(event.target.value));
              setVoucher(null);
              setMessage(null);
              setError(null);
            }}
            placeholder="ABCD-EF12-3456-7890"
            aria-invalid={error !== null}
            aria-describedby={
              error === null ? 'voucher-code-help' : 'voucher-code-help voucher-error'
            }
            className="min-h-11 min-w-0 flex-1 rounded-md border border-pedon-navy/25 px-3 font-mono uppercase tracking-wider text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
          />
          <button
            type="submit"
            disabled={
              lookupMutation.isPending || consumeMutation.isPending || recoveryPending || recovering
            }
            className="min-h-11 rounded-md bg-pedon-navy px-5 font-semibold text-white transition hover:bg-pedon-navy/90 disabled:opacity-50"
          >
            {lookupMutation.isPending ? 'Validando…' : 'Validar'}
          </button>
        </div>
        <p id="voucher-code-help" className="mt-2 text-xs text-pedon-text/60">
          Digite os 16 caracteres exibidos no voucher.
        </p>
      </form>

      {error !== null && (
        <p
          id="voucher-error"
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {message !== null && (
        <p
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 focus:outline-none"
        >
          {message}
        </p>
      )}

      {voucher !== null && (
        <section
          aria-labelledby="voucher-reward-name"
          className="mt-5 rounded-xl border border-pedon-navy/15 bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-pedon-text/60">
                Recompensa
              </p>
              <h3 id="voucher-reward-name" className="mt-1 text-xl font-bold text-pedon-navy">
                {voucher.reward_name}
              </h3>
            </div>
            <span
              className={
                voucher.status === 'issued'
                  ? 'rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900'
                  : 'rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700'
              }
            >
              {voucher.status === 'issued' ? 'Disponível' : 'Utilizado'}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-pedon-text/60">Pontos</dt>
              <dd className="mt-0.5 font-semibold text-pedon-text">
                {formatPoints(voucher.points_cost)}
              </dd>
            </div>
            <div>
              <dt className="text-pedon-text/60">Código</dt>
              <dd className="mt-0.5 break-all font-mono font-semibold text-pedon-text">
                {voucher.code}
              </dd>
            </div>
            <div>
              <dt className="text-pedon-text/60">Emitido em</dt>
              <dd className="mt-0.5 font-semibold text-pedon-text">
                <time dateTime={voucher.issued_at}>{formatDateTime(voucher.issued_at)}</time>
              </dd>
            </div>
          </dl>
          {voucher.status === 'consumed' && voucher.consumed_at !== null && (
            <p className="mt-3 text-sm text-pedon-text/70">
              Utilizado em{' '}
              <time dateTime={voucher.consumed_at}>{formatDateTime(voucher.consumed_at)}</time>.
            </p>
          )}
          {voucher.status === 'issued' && (
            <button
              ref={deliveryButtonRef}
              type="button"
              onClick={() => setConfirmationOpen(true)}
              disabled={consumeMutation.isPending || recoveryPending || recovering}
              className="mt-5 min-h-11 w-full rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
            >
              Confirmar entrega
            </button>
          )}
        </section>
      )}

      {confirmationOpen && voucher !== null && voucher.status === 'issued' && (
        <ConfirmationDialog
          rewardName={voucher.reward_name}
          busy={consumeMutation.isPending}
          onCancel={() => closeConfirmation()}
          onConfirm={() => void confirmConsumption()}
        />
      )}

      {recoveryPending && voucher !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-pedon-navy/55 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="voucher-recovery-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="voucher-recovery-title" className="text-lg font-bold text-pedon-navy">
              Verificação pendente
            </h3>
            <p className="mt-2 text-sm text-pedon-text/70">{RECOVERY_PENDING_MESSAGE}</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => void retryRecovery()}
                disabled={recovering}
                className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-50"
              >
                {recovering ? 'Verificando…' : 'Verificar novamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function VouchersPage() {
  const { role, selectedUnit } = useAdmin();

  if (role === null || selectedUnit === null) {
    return (
      <section className="mx-auto max-w-2xl rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Vouchers</p>
        <h2 className="mt-1 text-xl font-bold text-pedon-navy">Nenhuma unidade disponível</h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          Você precisa ter acesso a uma unidade ativa para validar vouchers.
        </p>
      </section>
    );
  }

  return (
    <VoucherForUnit key={selectedUnit.id} unitId={selectedUnit.id} unitName={selectedUnit.name} />
  );
}
