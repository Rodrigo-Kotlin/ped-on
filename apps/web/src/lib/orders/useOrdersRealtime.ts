import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../supabase';
import { unitKdsPrefix, unitOrderDetailKey, unitOrdersListPrefix } from './orders';
import { resetUnitOrdersSequence } from './useOrderMutations';

interface OrderRealtimePayload {
  new?: { id?: unknown };
}

export function subscribeToUnitOrders(unitId: string, queryClient: QueryClient): () => void {
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
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function useOrdersRealtime(unitId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => subscribeToUnitOrders(unitId, queryClient), [queryClient, unitId]);
}
