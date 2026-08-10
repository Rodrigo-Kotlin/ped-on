import { describe, expect, it } from 'vitest';
import {
  extractAdminOrderError,
  extractPublicOrderError,
  ORDER_NETWORK_ERROR_MESSAGE,
  publicOrderPollingInterval,
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

  it('faz polling só para pedidos não terminais', () => {
    expect(publicOrderPollingInterval(tracking('new'))).toBe(15_000);
    expect(publicOrderPollingInterval(tracking('completed'))).toBe(false);
    expect(publicOrderPollingInterval(tracking('cancelled'))).toBe(false);
    expect(publicOrderPollingInterval({ found: false })).toBe(false);
  });
});
