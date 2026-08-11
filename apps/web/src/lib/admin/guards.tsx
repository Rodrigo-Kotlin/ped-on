import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAdmin } from './admin-context';

function AdminLoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
      <p className="text-pedon-text/60">Carregando…</p>
    </div>
  );
}

export function RequireManageUnit({ children }: { children: ReactNode }) {
  const { adminStatus, canManageUnit } = useAdmin();
  if (adminStatus === 'loading') {
    return <AdminLoadingScreen />;
  }
  if (!canManageUnit) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode }) {
  const { adminStatus, role } = useAdmin();
  if (adminStatus === 'loading') {
    return <AdminLoadingScreen />;
  }
  if (role !== 'owner') {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}
