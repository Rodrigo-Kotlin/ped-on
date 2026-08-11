import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import type { SubmitHandler, UseFormRegisterReturn } from 'react-hook-form';
import { publicMenuQueryOptions } from '../lib/menu/public-menu-query';
import type { PublicMenuData } from '../lib/menu/menu';
import { formatBRL } from '../lib/money';
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
import type { LoyaltyResolveFound, LoyaltyStatementEntry } from '../lib/loyalty/loyalty';

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

function formatPoints(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function formatSignedPoints(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatPoints(Math.abs(value))}`;
}

function StatementEntry({ entry }: { entry: LoyaltyStatementEntry }) {
  const reversal = entry.entry_type === 'reversal';
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-pedon-navy">
            {reversal ? 'Estorno de pontos' : 'Pontos recebidos'}
          </p>
          <p className="mt-1 text-xs text-pedon-text/65">
            Pedido #{entry.order_number} ·{' '}
            {new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(entry.created_at))}
          </p>
        </div>
        <p className={`shrink-0 font-bold ${reversal ? 'text-red-700' : 'text-green-700'}`}>
          {reversal ? '-' : '+'}
          {formatPoints(Math.abs(entry.gross_points))} pontos
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
      {entry.recovery_delta !== 0 && (
        <p className="mt-1 text-sm font-medium text-amber-900">
          {entry.recovery_delta > 0
            ? `Em recuperação: +${formatPoints(entry.recovery_delta)} pontos`
            : `Recuperação compensada: ${formatPoints(Math.abs(entry.recovery_delta))} pontos`}
        </p>
      )}
    </li>
  );
}

function LoyaltyAccountView({
  publicSlug,
  account,
  onReset,
}: {
  publicSlug: string;
  account: LoyaltyResolveFound;
  onReset: () => void;
}) {
  const [balance, setBalance] = useState(account.account.points_balance);
  const [recovery, setRecovery] = useState(account.account.recovery_points);
  const [statement, setStatement] = useState(
    (account.statement ?? []).slice(0, LOYALTY_STATEMENT_MAX_ITEMS),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const customerName = account.customer.name?.trim();
  const greeting = customerName ? customerName : null;

  async function refresh() {
    if (!isLoyaltyToken(account.token.access_token)) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await fetchPublicLoyaltyAccount(account.token.access_token);
      if (result.found === true) {
        setBalance(result.account.points_balance);
        setRecovery(result.account.recovery_points);
        setStatement(result.statement.slice(0, LOYALTY_STATEMENT_MAX_ITEMS));
      } else {
        setExpired(true);
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
          <div className="flex items-baseline justify-between gap-3 rounded-md bg-pedon-surface p-4">
            <dt className="font-medium text-pedon-text/80">Pontos disponíveis</dt>
            <dd className="text-3xl font-bold text-pedon-navy">{formatPoints(balance)}</dd>
          </div>
          {recovery > 0 && (
            <div className="flex items-baseline justify-between gap-3 rounded-md bg-amber-50 p-4">
              <dt className="font-medium text-amber-900">Em recuperação</dt>
              <dd className="text-xl font-bold text-amber-900">{formatPoints(recovery)}</dd>
            </div>
          )}
        </dl>

        <p className="mt-3 text-xs text-pedon-text/65">
          Seus pontos aparecem aqui assim que seus pedidos forem concluídos.
        </p>

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
            disabled={refreshing}
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
  const [action, setAction] = useState<'idle' | 'lookup' | 'enroll'>('idle');
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
          onClick={() => setAction(action === 'lookup' ? 'idle' : 'lookup')}
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
          onClick={() => setAction(action === 'enroll' ? 'idle' : 'enroll')}
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
  const [account, setAccount] = useState<LoyaltyResolveFound | null>(null);

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

      {account === null ? (
        <ClubActions publicSlug={publicSlug} onIdentified={setAccount} />
      ) : (
        <LoyaltyAccountView
          publicSlug={publicSlug}
          account={account}
          onReset={() => setAccount(null)}
        />
      )}
    </div>
  );
}
