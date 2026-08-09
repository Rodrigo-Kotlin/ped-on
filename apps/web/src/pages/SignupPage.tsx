import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../lib/auth/auth-context';

const signupSchema = z
  .object({
    email: z.string().email('Informe um e-mail válido'),
    password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres'),
    confirmPassword: z.string().min(1, 'Confirme a senha'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmPassword'],
  });

type SignupValues = z.infer<typeof signupSchema>;

export function SignupPage() {
  const { signUp } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({ resolver: zodResolver(signupSchema) });

  async function onSubmit(values: SignupValues) {
    setServerError(null);
    const result = await signUp(values.email, values.password);
    if (result.error !== null) {
      setServerError(result.error);
      return;
    }
    if (result.needsEmailConfirmation) {
      setEmailSent(true);
    }
  }

  if (emailSent) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Cadastro</p>
        <h1 className="mt-2 text-3xl font-bold text-pedon-navy">Confirme seu e-mail</h1>
        <p className="mt-4 leading-relaxed text-pedon-text/80">
          Enviamos um link de confirmação para o seu e-mail. Confirme para ativar sua conta e depois
          entre no Ped-On.
        </p>
        <Link
          to="/login"
          className="mt-8 inline-flex items-center justify-center rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white transition hover:bg-pedon-navy/90"
        >
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Cadastro</p>
      <h1 className="mt-2 text-3xl font-bold text-pedon-navy">Criar conta</h1>
      <p className="mt-2 text-pedon-text/80">Comece a gerir os pedidos do seu estabelecimento.</p>

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
            autoComplete="new-password"
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

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-pedon-text">
            Confirme a senha
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
            aria-invalid={errors.confirmPassword !== undefined}
            aria-describedby={
              errors.confirmPassword !== undefined ? 'confirmPassword-error' : undefined
            }
            {...register('confirmPassword')}
          />
          {errors.confirmPassword !== undefined && (
            <p id="confirmPassword-error" className="mt-1 text-sm text-red-700">
              {errors.confirmPassword.message}
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
          {isSubmitting ? 'Criando conta…' : 'Criar conta'}
        </button>
      </form>

      <p className="mt-6 text-sm text-pedon-text/70">
        Já tem conta?{' '}
        <Link to="/login" className="font-medium text-pedon-orange underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </div>
  );
}
