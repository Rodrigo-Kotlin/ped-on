import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../lib/auth/auth-context';

const onboardingSchema = z.object({
  organizationName: z.string().trim().min(1, 'Informe o nome da organização'),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export function OnboardingPage() {
  const { completeOnboarding, user } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
        Bem-vindo ao Ped-On
      </p>
      <h1 className="mt-2 text-3xl font-bold text-pedon-navy">Configure sua organização</h1>
      <p className="mt-2 text-pedon-text/80">
        {user !== null && (
          <>
            Conta <span className="font-medium text-pedon-text">{user.email}</span> confirmada.
          </>
        )}{' '}
        Crie a organização do seu estabelecimento para começar.
      </p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
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
