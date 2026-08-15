import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { emitSupabaseRealtime, resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import type { AdminOrdersV2Result } from './orders';
import {
  unitOrderDetailKey,
  unitOrdersListKey,
  unitOrdersListPrefix,
  unitOrdersV2ListKey,
} from './orders';
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

  it('reinicia a sequência v2 na primeira página sem alterar cache v1 ou aplicar payload', () => {
    const queryClient = new QueryClient();
    const v2Key = unitOrdersV2ListKey('unit-1', { view: 'active' });
    const v1Key = unitOrdersListKey('unit-1', null);
    const firstPage = {
      orders: [{ id: 'order-1', status: 'new' }],
      page_info: { has_more: true, next_cursor: 'abc' },
    } as unknown as AdminOrdersV2Result;
    const secondPage = {
      orders: [{ id: 'order-2', status: 'confirmed' }],
      page_info: { has_more: false, next_cursor: null },
    } as unknown as AdminOrdersV2Result;
    const v1Cache = { orders: [{ id: 'legacy-order' }] };
    queryClient.setQueryData(v2Key, {
      pages: [firstPage, secondPage],
      pageParams: [null, 'abc'],
    });
    queryClient.setQueryData(v1Key, v1Cache);
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    subscribeToUnitOrders('unit-1', queryClient);
    emitSupabaseRealtime('UPDATE', {
      new: { id: 'order-1', status: 'cancelled', customer_phone: '11999999999' },
    });

    expect(queryClient.getQueryData(v2Key)).toEqual({
      pages: [firstPage],
      pageParams: [null],
    });
    expect(queryClient.getQueryData(v1Key)).toBe(v1Cache);
    expect((queryClient.getQueryData(v2Key) as { pages: AdminOrdersV2Result[] }).pages[0]).toBe(
      firstPage,
    );
  });
});
