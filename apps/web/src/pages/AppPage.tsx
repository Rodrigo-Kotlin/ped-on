import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth/auth-context';
import { supabase } from '../lib/supabase';

interface Organization {
  id: string;
  name: string;
  created_at: string;
}

async function fetchOrganizations() {
  const { data, error } = await supabase.from('organizations').select('id, name, created_at');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Organization[];
}

export function AppPage() {
  const { user, profile, signOut } = useAuth();

  const {
    data: organizations,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Painel</p>
          <h1 className="mt-1 text-3xl font-bold text-pedon-navy">Seu Ped-On</h1>
          <p className="mt-2 text-pedon-text/80">{profile?.full_name ?? user?.email ?? 'Conta'}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md border border-pedon-navy/30 px-3 py-1.5 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
        >
          Sair
        </button>
      </header>

      <section className="mt-8" aria-label="Organizações">
        <h2 className="text-xl font-semibold text-pedon-navy">Organizações</h2>

        {isLoading && <p className="mt-4 text-pedon-text/70">Carregando…</p>}

        {isError && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Não foi possível carregar suas organizações: {error.message}
          </p>
        )}

        {!isLoading && !isError && organizations?.length === 0 && (
          <p className="mt-4 text-pedon-text/70">Nenhuma organização ainda.</p>
        )}

        {!isLoading && !isError && organizations !== undefined && organizations.length > 0 && (
          <ul className="mt-4 space-y-3">
            {organizations.map((organization) => (
              <li
                key={organization.id}
                className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
              >
                <p className="font-medium text-pedon-navy">{organization.name}</p>
                <p className="mt-0.5 text-sm text-pedon-text/60">
                  Criada em {new Date(organization.created_at).toLocaleDateString('pt-BR')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
