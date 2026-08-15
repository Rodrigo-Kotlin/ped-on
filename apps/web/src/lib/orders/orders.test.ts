import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import {
  extractAdminOrderError,
  extractPublicOrderError,
  fetchUnitOrdersAdmin,
  fetchUnitOrdersAdminV2,
  normalizeAdminOrderDateRange,
  normalizeAdminOrderFilters,
  ORDER_NETWORK_ERROR_MESSAGE,
  publicOrderPollingInterval,
  unitOrdersV2ListKey,
} from './orders';
import type { PublicOrderTrackingResult } from './orders';

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
