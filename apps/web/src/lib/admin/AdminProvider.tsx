import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../supabase';
import { AdminContext } from './admin-context';
import type {
  AdminContextValue,
  AdminOrganization,
  AdminProfile,
  AdminRole,
  AdminUnit,
} from './admin-context';

const SELECTED_UNIT_KEY = 'pedon:selectedUnitId';

interface AdminContextPayload {
  profile: AdminProfile | null;
  organization: AdminOrganization | null;
  role: AdminRole | null;
  units: AdminUnit[];
}

async function fetchAdminContext(): Promise<AdminContextPayload> {
  const { data, error } = await supabase.rpc('get_my_admin_context');
  if (error) {
    throw new Error(error.message);
  }
  return (
    (data as AdminContextPayload | null) ?? {
      profile: null,
      organization: null,
      role: null,
      units: [],
    }
  );
}

function defaultUnit(units: AdminUnit[]): AdminUnit | null {
  const active = units.filter((unit) => unit.is_active);
  return active[0] ?? units[0] ?? null;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [preferredUnitId, setPreferredUnitId] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage.getItem(SELECTED_UNIT_KEY);
  });

  const {
    data: admin,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin-context'],
    queryFn: fetchAdminContext,
  });

  const units = useMemo(() => admin?.units ?? [], [admin]);

  const selectedUnit = useMemo(() => {
    const preferred = units.find((unit) => unit.id === preferredUnitId && unit.is_active);
    return preferred ?? defaultUnit(units);
  }, [units, preferredUnitId]);

  const selectUnit = useCallback((unitId: string) => {
    setPreferredUnitId(unitId);
    window.localStorage.setItem(SELECTED_UNIT_KEY, unitId);
  }, []);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const role = admin?.role ?? null;
  const canManageUnit = role === 'owner' || role === 'manager';

  const value = useMemo<AdminContextValue>(
    () => ({
      adminStatus: isLoading ? 'loading' : isError ? 'error' : 'ready',
      error: isError ? (error as Error).message : null,
      profile: admin?.profile ?? null,
      organization: admin?.organization ?? null,
      role,
      units,
      selectedUnit,
      canManageUnit,
      selectUnit,
      refresh,
    }),
    [
      isLoading,
      isError,
      error,
      admin,
      role,
      units,
      selectedUnit,
      canManageUnit,
      selectUnit,
      refresh,
    ],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
