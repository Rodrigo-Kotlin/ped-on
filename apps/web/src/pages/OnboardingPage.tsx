import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../lib/auth/auth-context';
import { assertOnline } from '../lib/offline/useOnline';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import { acceptOrgMemberInvite, fetchMyPendingInvites, teamErrorMessage } from '../lib/team/team';

const onboardingSchema = z.object({
  organizationName: z.string().trim().min(1, 'Informe o nome da organização'),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

const ROLE_LABELS = {
  manager: 'Gerente',
  operator: 'Operador',
} as const;

export function OnboardingPage() {
  const { completeOnboarding, refreshProfile, user } = useAuth();
  const { runCriticalOperation } = useCriticalOperation();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const pendingInvitesQuery = useQuery({
    queryKey: ['my-pending-invites'],
    queryFn: fetchMyPendingInvites,
  });

  const acceptInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      assertOnline();
      await runCriticalOperation(async () => {
        await acceptOrgMemberInvite(inviteId);
      });
    },
    onSuccess: async () => {
      setAcceptError(null);
      await queryClient.invalidateQueries({ queryKey: ['my-pending-invites'] });
      await refreshProfile();
    },
    onError: (error: Error) => setAcceptError(teamErrorMessage(error)),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({ resolver: zodResolver(onboardingSchema) });

  async function onSubmit(values: OnboardingValues) {
    setServerError(null);
    const result = await completeOnboarding(values.organizationName);
    if (result.error !== null) {
      setServerError(result.error);
    }
  }

  const pendingInvites = pendingInvitesQuery.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
        Bem-vindo ao Ped-On
      </p>
      <h1 className="mt-2 text-3xl font-bold text-pedon-navy">Configure sua conta</h1>
      <p className="mt-2 text-pedon-text/80">
        {user !== null && (
          <>
            Conta <span className="font-medium text-pedon-text">{user.email}</span> confirmada.
          </>
        )}{' '}
        Aceite um convite da sua organização ou crie uma nova.
      </p>

      {pendingInvitesQuery.isLoading && (
        <p className="mt-6 text-sm text-pedon-text/70">Carregando convites…</p>
      )}
      {pendingInvitesQuery.isError && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível carregar os convites. Tente novamente.
        </p>
      )}

      {pendingInvites.length > 0 && (
        <section className="mt-8 space-y-4" aria-label="Convites para organizações">
          <h2 className="text-lg font-bold text-pedon-navy">Você foi convidado(a)</h2>
          {pendingInvites.map((invite) => (
            <div
              key={invite.id}
              className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
            >
              <p className="font-semibold text-pedon-navy">{invite.organization_name}</p>
              <p className="mt-1 text-sm text-pedon-text/70">Função: {ROLE_LABELS[invite.role]}</p>
              <button
                type="button"
                onClick={() => acceptInvite.mutate(invite.id)}
                disabled={acceptInvite.isPending}
                className="mt-3 rounded-md bg-pedon-navy px-4 py-2 font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {acceptInvite.isPending ? 'Aceitando…' : 'Aceitar convite'}
              </button>
            </div>
          ))}
          {acceptError !== null && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {acceptError}
            </p>
          )}
        </section>
      )}

      {pendingInvites.length > 0 && (
        <div className="mt-8 flex items-center gap-3">
          <span className="h-px flex-1 bg-pedon-navy/15" />
          <span className="text-xs font-medium uppercase tracking-wider text-pedon-text/50">
            ou
          </span>
          <span className="h-px flex-1 bg-pedon-navy/15" />
        </div>
      )}

      <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div>
          <h2 className="text-lg font-bold text-pedon-navy">Criar organização</h2>
          <p className="mt-1 text-sm text-pedon-text/70">
            Cada conta pode pertencer a uma única organização. Prefira aceitar um convite quando já
            fizer parte de um estabelecimento.
          </p>
        </div>
        <div>
          <label htmlFor="organizationName" className="block text-sm font-medium text-pedon-text">
            Nome da organização
          </label>
          <input
            id="organizationName"
            type="text"
            autoComplete="organization"
            className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
            aria-invalid={errors.organizationName !== undefined}
            aria-describedby={
              errors.organizationName !== undefined ? 'organizationName-error' : undefined
            }
            placeholder="Ex.: Cantina da Praça"
            {...register('organizationName')}
          />
          {errors.organizationName !== undefined && (
            <p id="organizationName-error" className="mt-1 text-sm text-red-700">
              {errors.organizationName.message}
            </p>
          )}
        </div>

        {serverError !== null && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Criando…' : 'Criar organização'}
        </button>
      </form>
    </div>
  );
}
