import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { AppShell } from '../components/AppShell';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PublicOrderLayout } from '../components/PublicOrderLayout';
import { AdminProvider } from '../lib/admin/AdminProvider';
import { RequireManageUnit, RequireOwner } from '../lib/admin/guards';
import { AppGate, GuestOnly, OnboardingGate } from '../lib/auth/guards';
import { FoundationPage } from '../pages/FoundationPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { SignupPage } from '../pages/SignupPage';
import { App } from './App';

function lazyPage(getComponent: () => Promise<{ default: ComponentType }>) {
  const Component = lazy(getComponent);
  return function LazyPage() {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-svh items-center justify-center" role="status">
            <p className="text-pedon-text/60">Carregando…</p>
          </div>
        }
      >
        <Component />
      </Suspense>
    );
  };
}

const AppPage = lazyPage(() => import('../pages/AppPage').then((m) => ({ default: m.AppPage })));
const PedidosPage = lazyPage(() =>
  import('../pages/PedidosPage').then((m) => ({ default: m.PedidosPage })),
);
const KdsPage = lazyPage(() => import('../pages/KdsPage').then((m) => ({ default: m.KdsPage })));
const KdsPrintPage = lazyPage(() =>
  import('../pages/KdsPrintPage').then((m) => ({ default: m.KdsPrintPage })),
);
const CatalogoPage = lazyPage(() =>
  import('../pages/CatalogoPage').then((m) => ({ default: m.CatalogoPage })),
);
const VouchersPage = lazyPage(() =>
  import('../pages/VouchersPage').then((m) => ({ default: m.VouchersPage })),
);
const CardapioPage = lazyPage(() =>
  import('../pages/CardapioPage').then((m) => ({ default: m.CardapioPage })),
);
const ConfiguracoesPage = lazyPage(() =>
  import('../pages/ConfiguracoesPage').then((m) => ({ default: m.ConfiguracoesPage })),
);
const ClubeAdminPage = lazyPage(() =>
  import('../pages/ClubeAdminPage').then((m) => ({ default: m.ClubeAdminPage })),
);
const EquipePage = lazyPage(() =>
  import('../pages/EquipePage').then((m) => ({ default: m.EquipePage })),
);
const DiagnosticoPage = lazyPage(() =>
  import('../pages/DiagnosticoPage').then((m) => ({ default: m.DiagnosticoPage })),
);
const PublicMenuPage = lazyPage(() =>
  import('../pages/PublicMenuPage').then((m) => ({ default: m.PublicMenuPage })),
);
const CartPage = lazyPage(() => import('../pages/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazyPage(() =>
  import('../pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })),
);
const TrackingPage = lazyPage(() =>
  import('../pages/TrackingPage').then((m) => ({ default: m.TrackingPage })),
);
const ClubePage = lazyPage(() =>
  import('../pages/ClubePage').then((m) => ({ default: m.ClubePage })),
);

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <ErrorBoundary>
            <FoundationPage />
          </ErrorBoundary>
        ),
      },
      {
        path: 'login',
        element: (
          <GuestOnly>
            <ErrorBoundary>
              <LoginPage />
            </ErrorBoundary>
          </GuestOnly>
        ),
      },
      {
        path: 'cadastro',
        element: (
          <GuestOnly>
            <ErrorBoundary>
              <SignupPage />
            </ErrorBoundary>
          </GuestOnly>
        ),
      },
      {
        path: 'onboarding',
        element: (
          <OnboardingGate>
            <ErrorBoundary>
              <OnboardingPage />
            </ErrorBoundary>
          </OnboardingGate>
        ),
      },
      {
        path: 'menu/:publicSlug',
        element: <PublicOrderLayout />,
        children: [
          { index: true, element: <PublicMenuPage /> },
          { path: 'carrinho', element: <CartPage /> },
          { path: 'checkout', element: <CheckoutPage /> },
        ],
      },
      { path: 'pedido/:trackingToken', element: <TrackingPage /> },
      { path: 'clube/:publicSlug', element: <ClubePage /> },
      {
        path: 'app',
        element: (
          <AppGate>
            <AdminProvider>
              <AppShell />
            </AdminProvider>
          </AppGate>
        ),
        children: [
          {
            index: true,
            element: (
              <ErrorBoundary>
                <AppPage />
              </ErrorBoundary>
            ),
          },
          {
            path: 'pedidos',
            element: (
              <ErrorBoundary>
                <PedidosPage />
              </ErrorBoundary>
            ),
          },
          {
            path: 'cozinha',
            element: (
              <ErrorBoundary>
                <KdsPage />
              </ErrorBoundary>
            ),
          },
          {
            path: 'cozinha/imprimir/:orderId',
            element: (
              <ErrorBoundary>
                <KdsPrintPage />
              </ErrorBoundary>
            ),
          },
          {
            path: 'catalogo',
            element: (
              <ErrorBoundary>
                <CatalogoPage />
              </ErrorBoundary>
            ),
          },
          {
            path: 'vouchers',
            element: (
              <ErrorBoundary>
                <VouchersPage />
              </ErrorBoundary>
            ),
          },
          {
            path: 'cardapio',
            element: (
              <RequireManageUnit>
                <ErrorBoundary>
                  <CardapioPage />
                </ErrorBoundary>
              </RequireManageUnit>
            ),
          },
          {
            path: 'configuracoes',
            element: (
              <RequireManageUnit>
                <ErrorBoundary>
                  <ConfiguracoesPage />
                </ErrorBoundary>
              </RequireManageUnit>
            ),
          },
          {
            path: 'clube',
            element: (
              <RequireOwner>
                <ErrorBoundary>
                  <ClubeAdminPage />
                </ErrorBoundary>
              </RequireOwner>
            ),
          },
          {
            path: 'equipe',
            element: (
              <RequireOwner>
                <ErrorBoundary>
                  <EquipePage />
                </ErrorBoundary>
              </RequireOwner>
            ),
          },
          {
            path: 'diagnostico',
            element: (
              <RequireOwner>
                <ErrorBoundary>
                  <DiagnosticoPage />
                </ErrorBoundary>
              </RequireOwner>
            ),
          },
        ],
      },
      {
        path: '*',
        element: (
          <ErrorBoundary>
            <NotFoundPage />
          </ErrorBoundary>
        ),
      },
    ],
  },
];

export const appRouter = createBrowserRouter(appRoutes);
