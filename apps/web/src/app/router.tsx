import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '../components/AppShell';
import { PublicOrderLayout } from '../components/PublicOrderLayout';
import { AdminProvider } from '../lib/admin/AdminProvider';
import { RequireManageUnit } from '../lib/admin/guards';
import { AppGate, GuestOnly, OnboardingGate } from '../lib/auth/guards';
import { AppPage } from '../pages/AppPage';
import { CardapioPage } from '../pages/CardapioPage';
import { CartPage } from '../pages/CartPage';
import { CatalogoPage } from '../pages/CatalogoPage';
import { ConfiguracoesPage } from '../pages/ConfiguracoesPage';
import { FoundationPage } from '../pages/FoundationPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PedidosPage } from '../pages/PedidosPage';
import { PublicMenuPage } from '../pages/PublicMenuPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { TrackingPage } from '../pages/TrackingPage';
import { SignupPage } from '../pages/SignupPage';
import { App } from './App';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <FoundationPage /> },
      {
        path: 'login',
        element: (
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        ),
      },
      {
        path: 'cadastro',
        element: (
          <GuestOnly>
            <SignupPage />
          </GuestOnly>
        ),
      },
      {
        path: 'onboarding',
        element: (
          <OnboardingGate>
            <OnboardingPage />
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
          { index: true, element: <AppPage /> },
          { path: 'pedidos', element: <PedidosPage /> },
          { path: 'catalogo', element: <CatalogoPage /> },
          {
            path: 'cardapio',
            element: (
              <RequireManageUnit>
                <CardapioPage />
              </RequireManageUnit>
            ),
          },
          {
            path: 'configuracoes',
            element: (
              <RequireManageUnit>
                <ConfiguracoesPage />
              </RequireManageUnit>
            ),
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const appRouter = createBrowserRouter(appRoutes);
