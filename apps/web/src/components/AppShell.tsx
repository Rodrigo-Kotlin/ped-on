import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAdmin } from '../lib/admin/admin-context';
import { useAuth } from '../lib/auth/auth-context';
import { useOperationalOrdersBridge } from '../lib/orders/useOperationalOrdersBridge';
import { OfflineBanner } from './OfflineBanner';
import { OperationalOrderStatus } from './OperationalOrderStatus';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'inline-flex min-h-11 items-center rounded-md bg-pedon-navy px-3 py-1.5 text-sm font-medium text-white transition hover:bg-pedon-navy/90'
    : 'inline-flex min-h-11 items-center rounded-md border border-pedon-navy/20 px-3 py-1.5 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5';
}

function OrderCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      aria-label={`${count} ${count === 1 ? 'pedido novo' : 'pedidos novos'}`}
      className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-pedon-orange px-1.5 py-0.5 text-xs font-bold text-white"
    >
      {count}
    </span>
  );
}

export function AppShell() {
  const { profile, organization, role, units, selectedUnit, selectUnit } = useAdmin();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isOperationalRoute =
    location.pathname === '/app/pedidos' || location.pathname === '/app/cozinha';

  const bridge = useOperationalOrdersBridge(selectedUnit?.id ?? null);

  const unitLabel = units.length === 0 ? 'Nenhuma unidade' : 'Unidade';

  return (
    <div
      className={`mx-auto flex min-h-svh w-full flex-col px-4 py-6 sm:px-6 ${
        isOperationalRoute ? 'max-w-[1600px]' : 'max-w-5xl'
      } print:m-0 print:max-w-none print:min-h-0 print:px-0 print:py-0`}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-pedon-navy/10 pb-4 print:hidden">
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
              className="min-h-11 rounded-md border border-pedon-navy/20 bg-white px-3 py-1.5 text-sm text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="min-h-11 rounded-md border border-pedon-navy/30 px-3 py-1.5 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
          >
            Sair
          </button>
        </div>
      </header>

      <nav className="mt-4 flex flex-wrap gap-2 print:hidden" aria-label="Navegação do painel">
        <NavLink to="/app" end className={navLinkClass}>
          Visão geral
        </NavLink>

        {role !== null && (
          <>
            <NavLink to="/app/pedidos" className={navLinkClass}>
              Pedidos
              <OrderCountBadge count={bridge.newCount} />
            </NavLink>

            <NavLink to="/app/cozinha" className={navLinkClass}>
              Cozinha
              <OrderCountBadge count={bridge.newCount} />
            </NavLink>

            <NavLink to="/app/catalogo" className={navLinkClass}>
              Catálogo
            </NavLink>

            <NavLink to="/app/vouchers" className={navLinkClass}>
              Vouchers
            </NavLink>
          </>
        )}

        {(role === 'owner' || role === 'manager') && (
          <>
            <NavLink to="/app/cardapio" className={navLinkClass}>
              Cardápio
            </NavLink>

            <NavLink to="/app/configuracoes" className={navLinkClass}>
              Configurações
            </NavLink>
          </>
        )}

        {role === 'owner' && (
          <>
            <NavLink to="/app/clube" className={navLinkClass}>
              Clube Ped-On
            </NavLink>

            <NavLink to="/app/equipe" className={navLinkClass}>
              Equipe
            </NavLink>

            <NavLink to="/app/diagnostico" className={navLinkClass}>
              Diagnóstico
            </NavLink>
          </>
        )}
      </nav>

      {isOperationalRoute && (
        <OperationalOrderStatus
          realtimeStatus={bridge.realtimeStatus}
          alert={bridge.alert}
          dismissAlert={bridge.dismissAlert}
          soundEnabled={bridge.soundEnabled}
          soundUnavailable={bridge.soundUnavailable}
          onToggleSound={bridge.toggleSound}
          onViewKitchen={() => navigate('/app/cozinha')}
          onViewOrders={() => navigate('/app/pedidos')}
        />
      )}

      <div className="print:hidden">
        <OfflineBanner />
      </div>

      <div className="flex-1 py-6 print:py-0">
        <Outlet />
      </div>
    </div>
  );
}
