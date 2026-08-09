import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './auth-context';

function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
      <p className="text-pedon-text/60">Carregando…</p>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { authStatus } = useAuth();
  if (authStatus === 'loading') {
    return <LoadingScreen />;
  }
  if (authStatus === 'signed-out') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { authStatus } = useAuth();
  if (authStatus === 'loading') {
    return <LoadingScreen />;
  }
  if (authStatus === 'signed-in') {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { authStatus, profile, profileLoading } = useAuth();
  if (authStatus === 'loading' || (authStatus === 'signed-in' && profileLoading)) {
    return <LoadingScreen />;
  }
  if (authStatus === 'signed-out') {
    return <Navigate to="/login" replace />;
  }
  if (profile?.onboarding_status === 'completed') {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function AppGate({ children }: { children: ReactNode }) {
  const { authStatus, profile, profileLoading } = useAuth();
  if (authStatus === 'loading' || (authStatus === 'signed-in' && profileLoading)) {
    return <LoadingScreen />;
  }
  if (authStatus === 'signed-out') {
    return <Navigate to="/login" replace />;
  }
  if (profile?.onboarding_status === 'pending') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}
