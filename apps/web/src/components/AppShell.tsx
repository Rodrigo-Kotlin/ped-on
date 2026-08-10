import { NavLink, Outlet } from 'react-router';
import { useAdmin } from '../lib/admin/admin-context';
import { useAuth } from '../lib/auth/auth-context';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'rounded-md bg-pedon-navy px-3 py-1.5 text-sm font-medium text-white transition hover:bg-pedon-navy/90'
    : 'rounded-md border border-pedon-navy/20 px-3 py-1.5 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5';
}

export function AppShell() {
  const { profile, organization, role, units, selectedUnit, selectUnit } = useAdmin();
  const { user, signOut } = useAuth();

  const unitLabel = units.length === 0 ? 'Nenhuma unidade' : 'Unidade';

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-pedon-navy/10 pb-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Painel</p>
          <h1 className="mt-1 text-2xl font-bold text-pedon-navy">
            {organization?.name ?? profile?.full_name ?? user?.email ?? 'Ped-On'}
          </h1>
          <p className="mt-0.5 text-sm text-pedon-text/70">
            {profile?.full_name ?? ''}
            {role !== null && (
              <>
                {profile?.full_name ? ' · ' : ''}
                <span className="font-medium text-pedon-text">
                  {role === 'owner' ? 'Proprietário' : role === 'manager' ? 'Gerente' : 'Operador'}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-pedon-text/80">
            <span className="font-medium">{unitLabel}:</span>
            <select
              value={selectedUnit?.id ?? ''}
              onChange={(event) => selectUnit(event.target.value)}
              disabled={units.length === 0}
              aria-label="Selecionar unidade"
              className="rounded-md border border-pedon-navy/20 bg-white px-3 py-1.5 text-sm text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                  {!unit.is_active ? ' (inativa)' : ''}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-pedon-navy/30 px-3 py-1.5 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
          >
            Sair
          </button>
        </div>
      </header>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Navegação do painel">
        <NavLink to="/app" end className={navLinkClass}>
          Visão geral
        </NavLink>
        {role !== null && (
          <NavLink to="/app/catalogo" className={navLinkClass}>
            Catálogo
          </NavLink>
        )}
        {(role === 'owner' || role === 'manager') && (
          <NavLink to="/app/configuracoes" className={navLinkClass}>
            Configurações
          </NavLink>
        )}
      </nav>

      <main className="flex-1 py-6">
        <Outlet />
      </main>
    </div>
  );
}
