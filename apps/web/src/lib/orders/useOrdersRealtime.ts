import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { unitKdsPrefix, unitOrderDetailKey, unitOrdersListPrefix } from './orders';
import { resetUnitOrdersSequence } from './useOrderMutations';

export type OperationalRealtimeStatus = 'connecting' | 'connected' | 'degraded';

export type RealtimeSubscriptionStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

interface OrderRealtimePayload {
  new?: { id?: unknown };
}

export function mapRealtimeStatus(status: RealtimeSubscriptionStatus): OperationalRealtimeStatus {
  if (status === 'SUBSCRIBED') return 'connected';
  return 'degraded';
}

export function subscribeToUnitOrders(
  unitId: string,
  queryClient: QueryClient,
  onStatusChange?: (status: OperationalRealtimeStatus) => void,
): () => void {
  const handleChange = (payload: OrderRealtimePayload) => {
    resetUnitOrdersSequence(queryClient, unitId);
    void queryClient.invalidateQueries({ queryKey: unitOrdersListPrefix(unitId) });
    void queryClient.invalidateQueries({ queryKey: unitKdsPrefix(unitId) });
    const orderId = typeof payload.new?.id === 'string' ? payload.new.id : null;
    if (orderId !== null) {
      void queryClient.invalidateQueries({ queryKey: unitOrderDetailKey(unitId, orderId) });
    }
  };

  const channel = supabase
    .channel(`unit-orders:${unitId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders', filter: `unit_id=eq.${unitId}` },
      handleChange,
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `unit_id=eq.${unitId}` },
      handleChange,
    )
    .subscribe((status) => {
      if (onStatusChange !== undefined) {
        onStatusChange(mapRealtimeStatus(status));
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
