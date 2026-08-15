import { useQuery } from '@tanstack/react-query';
import { useOnline } from '../offline/useOnline';
import { fetchKdsOrders, unitKdsKey } from './orders';

export const KDS_POLLING_INTERVAL_MS = 15_000;

export function isKdsPollingActive(online: boolean): boolean {
  return online && typeof document !== 'undefined' && document.visibilityState === 'visible';
}

export function useKdsOrders(unitId: string) {
  const online = useOnline();

  return useQuery({
    queryKey: unitKdsKey(unitId),
    queryFn: () => fetchKdsOrders(unitId),
    refetchInterval: () => (isKdsPollingActive(online) ? KDS_POLLING_INTERVAL_MS : false),
  });
}
