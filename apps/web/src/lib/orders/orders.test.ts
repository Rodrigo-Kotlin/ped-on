import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import {
  ADMIN_ORDER_ERROR_MESSAGES,
  canCancelOrder,
  deriveOrderOperationalDurations,
  deriveOrderOperationalTimeline,
  extractAdminOrderError,
  extractPublicOrderError,
  fetchKdsOrders,
  fetchUnitOrdersAdmin,
  fetchUnitOrdersAdminV2,
  getKdsOrderAction,
  getPrimaryOrderAction,
  getPrimaryPaymentAction,
  groupKdsItemOptions,
  normalizeAdminOrderDateRange,
  normalizeAdminOrderFilters,
  ORDER_NETWORK_ERROR_MESSAGE,
  publicOrderPollingInterval,
  unitKdsKey,
  unitKdsPrefix,
  unitOrdersV2ListKey,
} from './orders';
import type { AdminOrderEvent, KdsOrder, PublicOrderTrackingResult } from './orders';

function event(
  event_type: AdminOrderEvent['event_type'],
  from_value: AdminOrderEvent['from_value'],
  to_value: AdminOrderEvent['to_value'],
  created_at: string,
): AdminOrderEvent {
  return {
    id: `event-${created_at}`,
    event_type,
    from_value,
    to_value,
    note: null,
    actor_type: 'customer',
    actor_user_id: null,
    created_at,
  };
}

function tracking(status: 'new' | 'completed' | 'cancelled'): PublicOrderTrackingResult {
  return {
    found: true,
    organization: { name: 'Cantina' },
    unit: { name: 'Centro' },
    order: {
      order_number: 1,
      status,
      payment_status: 'pending',
      service_mode: 'pickup',
      payment_method: 'pix',
      subtotal: '10.00',
      delivery_fee: '0.00',
      total: '10.00',
      estimated_minutes: 20,
      created_at: '2026-08-10T12:00:00Z',
      status_updated_at: '2026-08-10T12:00:00Z',
      completed_at: status === 'completed' ? '2026-08-10T12:20:00Z' : null,
      cancelled_at: status === 'cancelled' ? '2026-08-10T12:20:00Z' : null,
      items: [],
    },
  };
}

describe('orders contract', () => {
  beforeEach(resetSupabaseMock);

  it('sanitiza PED33-PED50 sem expor details ou SQLSTATE', () => {
    const error = extractPublicOrderError({
      code: 'P0001',
      message: 'PED38 ITEM_UNAVAILABLE',
      details: 'secret SQL',
    });
    expect(error.code).toBe('PED38');
    expect(error.message).toContain('itens não estão disponíveis');
    expect(error.message).not.toContain('secret SQL');
  });

  it('usa a mensagem de rede pública', () => {
    expect(extractPublicOrderError({ message: 'Failed to fetch' }).message).toBe(
      ORDER_NETWORK_ERROR_MESSAGE,
    );
  });

  it.each([
    ['PED72', 'grupo de opções'],
    ['PED73', 'configuração'],
    ['PED74', 'não foi encontrada'],
    ['PED75', 'indisponível'],
    ['PED76', 'obrigatórias'],
    ['PED77', 'quantidade de opções'],
    ['PED78', 'não pertence'],
  ] as const)('sanitiza %s sem expor SQLSTATE', (code, message) => {
    const error = extractPublicOrderError({
      code: 'P0001',
      message: `${code} INTERNAL_DATABASE_MESSAGE`,
      details: 'sensitive SQL details',
    });
    expect(error.code).toBe(code);
    expect(error.message).toContain(message);
    expect(error.message).not.toMatch(/INTERNAL|SQL|P0001/);
  });

  it('sanitiza erros administrativos sem expor SQLSTATE ou detalhes internos', () => {
    const error = extractAdminOrderError({
      code: 'PED47',
      message: 'INVALID_ORDER_TRANSITION',
      details: 'row id and SQL details',
    });

    expect(error.code).toBe('PED47');
    expect(error.message).toContain('atualizado');
    expect(error.message).not.toMatch(/PED47|SQL|row id/i);
  });

  it('reconhece PED79 explicitamente com mensagem administrativa amigável', () => {
    const error = extractAdminOrderError({
      code: 'P0001',
      message: 'PED79 INVALID_ORDER_FILTER internal cursor payload',
      details: 'select private_column from orders',
    });

    expect(error.code).toBe('PED79');
    expect(error.message).toBe(
      'Os filtros de pedidos não são válidos. Revise os filtros e tente novamente.',
    );
    expect(error.message).not.toMatch(/PED79|cursor|select|private/i);
  });

  it('normaliza filtros com defaults, dedupe e ordem canônica por view', () => {
    expect(
      normalizeAdminOrderFilters({
        statuses: ['ready', 'new', 'ready', 'completed'],
        service_mode: 'delivery',
      }),
    ).toEqual({
      view: 'active',
      limit: 50,
      statuses: ['new', 'ready'],
      service_mode: 'delivery',
    });
    expect(
      normalizeAdminOrderFilters({
        view: 'history',
        statuses: ['new', 'cancelled', 'completed', 'cancelled'],
      }),
    ).toEqual({
      view: 'history',
      limit: 50,
      statuses: ['completed', 'cancelled'],
    });
    expect(() => normalizeAdminOrderFilters({ limit: 500 })).toThrow(
      'Os filtros de pedidos não são válidos.',
    );
    expect(() => normalizeAdminOrderFilters({ order_number: 0 })).toThrow(
      'Os filtros de pedidos não são válidos.',
    );
  });

  it('converte datetime-local estrito para ISO e rejeita intervalo inválido sem ambiguidade', () => {
    const valid = normalizeAdminOrderDateRange('2026-08-15T10:30', '2026-08-15T11:45');
    expect(valid).toEqual({
      date_from: new Date(2026, 7, 15, 10, 30).toISOString(),
      date_to: new Date(2026, 7, 15, 11, 45).toISOString(),
      error: null,
    });
    expect(normalizeAdminOrderDateRange('2026-02-30T10:00', '')).toEqual({
      error: 'Informe datas e horários válidos.',
    });
    expect(normalizeAdminOrderDateRange('2026-08-15T12:00', '2026-08-15T11:00')).toEqual({
      error: 'A data inicial não pode ser posterior à data final.',
    });
  });

  it('mantém query key v2 estável, canônica e sem cursor', () => {
    const first = unitOrdersV2ListKey('unit-1', {
      statuses: ['ready', 'new'],
      payment_status: 'paid',
    });
    const second = unitOrdersV2ListKey('unit-1', {
      payment_status: 'paid',
      statuses: ['new', 'ready', 'new'],
      view: 'active',
      limit: 50,
    });

    expect(first).toEqual(second);
    expect(first).toEqual([
      'unit-orders',
      'unit-1',
      'list',
      'v2',
      { view: 'active', limit: 50, statuses: ['new', 'ready'], payment_status: 'paid' },
    ]);
    expect(JSON.stringify(first)).not.toContain('cursor');
  });

  it('envia somente filtros definidos e inclui cursor apenas na página seguinte', async () => {
    await fetchUnitOrdersAdminV2('unit-1', { view: 'active', service_mode: 'pickup' });
    expect(supabaseMock.rpc).toHaveBeenLastCalledWith('get_unit_orders_admin_v2', {
      p_unit_id: 'unit-1',
      p_filters: { view: 'active', limit: 50, service_mode: 'pickup' },
    });

    await fetchUnitOrdersAdminV2(
      'unit-1',
      { view: 'history', statuses: ['cancelled', 'new'] },
      'opaque-abc',
    );
    expect(supabaseMock.rpc).toHaveBeenLastCalledWith('get_unit_orders_admin_v2', {
      p_unit_id: 'unit-1',
      p_filters: {
        view: 'history',
        limit: 50,
        statuses: ['cancelled'],
        cursor: 'opaque-abc',
      },
    });
  });

  it('preserva o fetch v1 para callers compatíveis', async () => {
    await fetchUnitOrdersAdmin('unit-1', 'confirmed');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_orders_admin', {
      p_unit_id: 'unit-1',
      p_status: 'confirmed',
      p_limit: 100,
    });
  });

  it('faz polling só para pedidos não terminais', () => {
    expect(publicOrderPollingInterval(tracking('new'))).toBe(15_000);
    expect(publicOrderPollingInterval(tracking('completed'))).toBe(false);
    expect(publicOrderPollingInterval(tracking('cancelled'))).toBe(false);
    expect(publicOrderPollingInterval({ found: false })).toBe(false);
  });
});

describe('order action resolvers and operational timeline', () => {
  it('resolve a ação primária para cada estado não terminal', () => {
    expect(getPrimaryOrderAction({ status: 'new', service_mode: 'pickup' })).toEqual({
      nextStatus: 'confirmed',
      label: 'Confirmar',
    });
    expect(getPrimaryOrderAction({ status: 'confirmed', service_mode: 'delivery' })).toEqual({
      nextStatus: 'preparing',
      label: 'Iniciar preparo',
    });
    expect(getPrimaryOrderAction({ status: 'preparing', service_mode: 'pickup' })).toEqual({
      nextStatus: 'ready',
      label: 'Marcar pronto',
    });
    expect(getPrimaryOrderAction({ status: 'ready', service_mode: 'pickup' })).toEqual({
      nextStatus: 'completed',
      label: 'Concluir retirada',
    });
    expect(getPrimaryOrderAction({ status: 'ready', service_mode: 'delivery' })).toEqual({
      nextStatus: 'out_for_delivery',
      label: 'Saiu para entrega',
    });
    expect(getPrimaryOrderAction({ status: 'out_for_delivery', service_mode: 'pickup' })).toEqual({
      nextStatus: 'completed',
      label: 'Concluir entrega',
    });
    expect(getPrimaryOrderAction({ status: 'completed', service_mode: 'pickup' })).toBeNull();
    expect(getPrimaryOrderAction({ status: 'cancelled', service_mode: 'delivery' })).toBeNull();
  });

  it('permite cancelar apenas estados não terminais', () => {
    for (const status of ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] as const) {
      expect(canCancelOrder(status)).toBe(true);
    }
    expect(canCancelOrder('completed')).toBe(false);
    expect(canCancelOrder('cancelled')).toBe(false);
  });

  it('resolve a ação de pagamento apenas para pendentes', () => {
    expect(getPrimaryPaymentAction('pending')).toEqual({
      nextStatus: 'paid',
      label: 'Marcar pago',
    });
    expect(getPrimaryPaymentAction('paid')).toBeNull();
    expect(getPrimaryPaymentAction('refunded')).toBeNull();
  });

  it('deriva o timeline operacional dos eventos sem inventar marcos', () => {
    const timeline = deriveOrderOperationalTimeline([
      event('created', null, 'new', '2026-08-10T12:00:00Z'),
      event('status_changed', 'new', 'confirmed', '2026-08-10T12:05:00Z'),
      event('status_changed', 'confirmed', 'preparing', '2026-08-10T12:10:00Z'),
      event('status_changed', 'preparing', 'ready', '2026-08-10T12:20:00Z'),
    ]);

    expect(timeline).toEqual({
      created_at: '2026-08-10T12:00:00Z',
      confirmed_at: '2026-08-10T12:05:00Z',
      preparing_at: '2026-08-10T12:10:00Z',
      ready_at: '2026-08-10T12:20:00Z',
      out_for_delivery_at: null,
      completed_at: null,
      cancelled_at: null,
    });
  });

  it('usa timestamps do pedido como fallback e prefere a ocorrência mais antiga', () => {
    const timeline = deriveOrderOperationalTimeline(
      [
        event('created', null, 'new', '2026-08-10T12:00:00Z'),
        event('status_changed', 'new', 'completed', '2026-08-10T12:30:00Z'),
      ],
      {
        created_at: '2026-08-10T12:00:00Z',
        completed_at: '2026-08-10T12:31:00Z',
        cancelled_at: null,
      },
    );

    expect(timeline).toEqual({
      created_at: '2026-08-10T12:00:00Z',
      confirmed_at: null,
      preparing_at: null,
      ready_at: null,
      out_for_delivery_at: null,
      completed_at: '2026-08-10T12:30:00Z',
      cancelled_at: null,
    });
  });

  it('calcula durações aceitação/preparo/entrega/ciclo a partir do timeline', () => {
    const timeline = deriveOrderOperationalTimeline([
      event('created', null, 'new', '2026-08-10T12:00:00Z'),
      event('status_changed', 'new', 'confirmed', '2026-08-10T12:05:00Z'),
      event('status_changed', 'confirmed', 'preparing', '2026-08-10T12:10:00Z'),
      event('status_changed', 'preparing', 'ready', '2026-08-10T12:20:00Z'),
      event('status_changed', 'ready', 'out_for_delivery', '2026-08-10T12:22:00Z'),
      event('status_changed', 'out_for_delivery', 'completed', '2026-08-10T12:47:00Z'),
    ]);

    expect(deriveOrderOperationalDurations(timeline)).toEqual({
      acceptance_minutes: 5,
      preparation_minutes: 10,
      delivery_minutes: 25,
      total_cycle_minutes: 47,
    });
  });

  it('usa ready→completed como entrega quando não há saída para entrega', () => {
    const timeline = deriveOrderOperationalTimeline([
      event('created', null, 'new', '2026-08-10T12:00:00Z'),
      event('status_changed', 'new', 'ready', '2026-08-10T12:30:00Z'),
      event('status_changed', 'ready', 'completed', '2026-08-10T12:40:00Z'),
    ]);

    expect(deriveOrderOperationalDurations(timeline)).toEqual({
      acceptance_minutes: null,
      preparation_minutes: null,
      delivery_minutes: 10,
      total_cycle_minutes: 40,
    });
  });
});

describe('kds client contract', () => {
  beforeEach(resetSupabaseMock);

  const payload = {
    unit: { id: 'unit-1', name: 'Loja Centro' },
    truncated: true,
    orders: [
      {
        id: 'order-1',
        order_number: 1,
        status: 'new' as const,
        service_mode: 'pickup' as const,
        created_at: '2026-08-10T12:00:00Z',
        status_updated_at: '2026-08-10T12:00:00Z',
        estimated_minutes: 20,
        expected_at: '2026-08-10T12:20:00Z',
        items: [
          {
            product_name: 'X-Burger',
            quantity: 2,
            note: 'Sem sal',
            options: [
              { group_name: 'Tamanho', group_kind: 'variation', option_name: 'Grande' },
              { group_name: 'Adicionais', group_kind: 'addon', option_name: 'Bacon' },
              { group_name: 'Ingredientes', group_kind: 'removal', option_name: 'Cebola' },
            ],
          },
        ],
      },
    ] satisfies KdsOrder[],
  };

  it('chama get_kds_orders_minimal com p_unit_id e devolve o shape original sem paginação', async () => {
    supabaseMock.rpc.mockResolvedValueOnce({ data: payload, error: null });

    const result = await fetchKdsOrders('unit-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_kds_orders_minimal', {
      p_unit_id: 'unit-1',
    });
    expect(result).toEqual(payload);
    expect(result).not.toHaveProperty('total_count');
    expect(result).not.toHaveProperty('page_info');
  });

  it('mantém query keys KDS separadas da Central', () => {
    expect(unitKdsPrefix('unit-1')).toEqual(['unit-kds', 'unit-1']);
    expect(unitKdsKey('unit-1')).toEqual(['unit-kds', 'unit-1', 'orders']);
    expect(unitKdsPrefix('unit-1')).not.toEqual(unitOrdersV2ListKey('unit-1', { view: 'active' }));
    expect(unitKdsPrefix('unit-2')).not.toEqual(unitKdsPrefix('unit-1'));
  });

  it('resolver KDS segue a mesma state machine sem progressões de entrega', () => {
    expect(getKdsOrderAction('new')).toEqual({ nextStatus: 'confirmed', label: 'Confirmar' });
    expect(getKdsOrderAction('confirmed')).toEqual({
      nextStatus: 'preparing',
      label: 'Iniciar preparo',
    });
    expect(getKdsOrderAction('preparing')).toEqual({ nextStatus: 'ready', label: 'Marcar pronto' });
    expect(getKdsOrderAction('ready')).toBeNull();
  });

  it('agrupa opções do item por grupo preservando ordem e sem expor preço', () => {
    expect(
      groupKdsItemOptions([
        { group_name: 'Tamanho', group_kind: 'variation', option_name: 'Médio' },
        { group_name: 'Adicionais', group_kind: 'addon', option_name: 'Bacon' },
        { group_name: 'Tamanho', group_kind: 'variation', option_name: 'Grande' },
        { group_name: 'Ingredientes', group_kind: 'removal', option_name: 'Cebola' },
      ]),
    ).toEqual([
      { group_name: 'Tamanho', group_kind: 'variation', option_names: ['Médio', 'Grande'] },
      { group_name: 'Adicionais', group_kind: 'addon', option_names: ['Bacon'] },
      { group_name: 'Ingredientes', group_kind: 'removal', option_names: ['Cebola'] },
    ]);
    expect(groupKdsItemOptions([])).toEqual([]);
  });

  it.each([
    ['PED10', ADMIN_ORDER_ERROR_MESSAGES.PED10],
    ['PED11', ADMIN_ORDER_ERROR_MESSAGES.PED11],
    ['PED12', ADMIN_ORDER_ERROR_MESSAGES.PED12],
    ['PED46', ADMIN_ORDER_ERROR_MESSAGES.PED46],
    ['PED47', ADMIN_ORDER_ERROR_MESSAGES.PED47],
  ] as const)('conflitos KDS usam mensagens administrativas existentes (%s)', (code, message) => {
    expect(extractAdminOrderError({ code: 'P0001', message: `${code} RAW_INTERNAL` }).message).toBe(
      message,
    );
  });

  it('converte falha de rede do fetch KDS em erro administrativo amigável', async () => {
    supabaseMock.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchKdsOrders('unit-1')).rejects.toThrow(
      'Não foi possível atualizar os pedidos. Verifique sua conexão e tente novamente.',
    );
  });
});
