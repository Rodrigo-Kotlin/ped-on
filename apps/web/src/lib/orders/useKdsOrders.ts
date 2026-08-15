import { useQuery } from '@tanstack/react-query';
import { useOnline } from '../offline/useOnline';
import { fetchKdsOrders, unitKdsKey } from './orders';

export const KDS_POLLING_INTERVAL_MS = 15_000;

export function isKdsPollingActive(online: boolean): boolean {
  return online && typeof document !== 'undefined' && document.visibilityState === 'visible';
}

export function useKdsOrders(unitId: string, options: { enabled?: boolean } = {}) {
  const online = useOnline();
  const enabled = options.enabled ?? true;

  return useQuery({
    queryKey: unitKdsKey(unitId),
    queryFn: () => fetchKdsOrders(unitId),
    enabled,
    refetchInterval: () =>
      enabled && isKdsPollingActive(online) ? KDS_POLLING_INTERVAL_MS : false,
  });
}
