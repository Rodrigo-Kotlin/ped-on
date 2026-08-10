import { createContext, useContext } from 'react';

export type AdminRole = 'owner' | 'manager' | 'operator';

export interface AdminProfile {
  id: string;
  full_name: string | null;
  email: string;
}

export interface AdminOrganization {
  id: string;
  name: string;
}

export interface AdminUnit {
  id: string;
  name: string;
  is_active: boolean;
}

export interface AdminContextValue {
  adminStatus: 'loading' | 'ready' | 'error';
  error: string | null;
  profile: AdminProfile | null;
  organization: AdminOrganization | null;
  role: AdminRole | null;
  units: AdminUnit[];
  selectedUnit: AdminUnit | null;
  canManageUnit: boolean;
  selectUnit: (unitId: string) => void;
  refresh: () => Promise<void>;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (context === null) {
    throw new Error('useAdmin deve ser usado dentro de <AdminProvider>');
  }
  return context;
}
