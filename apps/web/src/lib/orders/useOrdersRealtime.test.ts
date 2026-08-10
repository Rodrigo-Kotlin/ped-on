import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { emitSupabaseRealtime, resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import { unitOrderDetailKey, unitOrdersListPrefix } from './orders';
import { subscribeToUnitOrders } from './useOrdersRealtime';

describe('orders realtime', () => {
  beforeEach(resetSupabaseMock);

  it('invalida lista e detalhe sem aplicar o payload e remove o canal no cleanup', () => {
    const queryClient = new QueryClient();
    const detailKey = unitOrderDetailKey('unit-1', 'order-1');
    const cached = { id: 'order-1', status: 'new', customer_name: 'Cliente autorizado' };
    queryClient.setQueryData(detailKey, cached);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    const cleanup = subscribeToUnitOrders('unit-1', queryClient);
    emitSupabaseRealtime('UPDATE', {
      new: { id: 'order-1', status: 'cancelled', customer_phone: '11999999999' },
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: unitOrdersListPrefix('unit-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey });
    expect(queryClient.getQueryData(detailKey)).toBe(cached);
    expect(supabaseMock.channel).toHaveBeenCalledWith('unit-orders:unit-1');

    cleanup();
    expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('invalida somente a lista quando o evento não contém id', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    subscribeToUnitOrders('unit-2', queryClient);

    emitSupabaseRealtime('INSERT', { new: { status: 'new' } });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: unitOrdersListPrefix('unit-2') });
  });
});
