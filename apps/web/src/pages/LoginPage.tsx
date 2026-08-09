import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../lib/auth/auth-context';

const loginSchema = z.object({
  email: z.string().email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { signIn } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setServerError(null);
    const result = await signIn(values.email, values.password);
    if (result.error !== null) {
      setServerError(result.error);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Acesso</p>
      <h1 className="mt-2 text-3xl font-bold text-pedon-navy">Entrar no Ped-On</h1>
      <p className="mt-2 text-pedon-text/80">Acesse o painel do seu estabelecimento.</p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-pedon-text">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
            aria-invalid={errors.email !== undefined}
            aria-describedby={errors.email !== undefined ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email !== undefined && (
            <p id="email-error" className="mt-1 text-sm text-red-700">
              {errors.email.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-pedon-text">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
            aria-invalid={errors.password !== undefined}
            aria-describedby={errors.password !== undefined ? 'password-error' : undefined}
            {...register('password')}
          />
          {errors.password !== undefined && (
            <p id="password-error" className="mt-1 text-sm text-red-700">
              {errors.password.message}
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
          {isSubmitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="mt-6 text-sm text-pedon-text/70">
        Ainda não tem conta?{' '}
        <Link to="/cadastro" className="font-medium text-pedon-orange underline underline-offset-2">
          Criar conta
        </Link>
      </p>
    </div>
  );
}
