import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppGate, GuestOnly, OnboardingGate } from '../lib/auth/guards';
import { AppPage } from '../pages/AppPage';
import { FoundationPage } from '../pages/FoundationPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OnboardingPage } from '../pages/OnboardingPage';
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
        path: 'app',
        element: (
          <AppGate>
            <AppPage />
          </AppGate>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const appRouter = createBrowserRouter(appRoutes);
