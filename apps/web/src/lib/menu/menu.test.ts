import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import {
  extractMenuError,
  fetchPublicMenu,
  fetchUnitMenuPublication,
  formatBRL,
  publishUnitMenu,
} from './menu';
import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';

describe('extractMenuError', () => {
  it('mapeia os códigos do contrato de publicação para mensagens amigáveis', () => {
    expect(extractMenuError({ code: 'PED31', message: 'MENU_EMPTY' }).message).toContain(
      'cardápio está vazio',
    );
    expect(extractMenuError({ code: 'PED32', message: 'PUBLICATION_CONFLICT' }).message).toContain(
      'link público',
    );
    expect(extractMenuError({ code: 'PED11', message: 'FORBIDDEN' }).message).toContain(
      'permissão',
    );
    expect(extractMenuError({ code: 'PED10', message: 'NOT_AUTHENTICATED' }).message).toContain(
      'sessão expirou',
    );
    expect(extractMenuError({ code: 'PED12', message: 'UNIT_NOT_FOUND' }).message).toContain(
      'não encontrada',
    );
  });

  it('extrai o código PED do corpo da mensagem quando o campo code não vem preenchido', () => {
    const parsed = extractMenuError({ code: 'P0001', message: 'PED31: MENU_EMPTY' });
    expect(parsed.code).toBe('PED31');
    expect(parsed.message).toContain('cardápio está vazio');
  });

  it('mapeia PED73 como erro explícito de grupo sem opções ativas suficientes', () => {
    const parsed = extractMenuError({
      code: 'P0001',
      message: 'PED73: INVALID_SELECTION_RULE: must have at least one active option',
    });
    expect(parsed.code).toBe('PED73');
    expect(parsed.message).toContain('grupo obrigatório não possui opções ativas suficientes');
    expect(parsed.message).not.toContain('INVALID_SELECTION_RULE');
    expect(parsed.message).not.toContain('P0001');
  });

  it('cai na mensagem bruta quando não há código conhecido', () => {
    const parsed = extractMenuError({ code: 'P9999', message: 'Falha inesperada' });
    expect(parsed.code).toBe('P9999');
    expect(parsed.message).toBe('Falha inesperada');
  });
});

describe('formatBRL', () => {
  it('formata preços com duas casas decimais no padrão BR', () => {
    expect(formatBRL('29.9')).toBe('R$ 29,90');
    expect(formatBRL('29.90')).toBe('R$ 29,90');
    expect(formatBRL('0.50')).toBe('R$ 0,50');
    expect(formatBRL('8')).toBe('R$ 8,00');
  });
});

describe('fetchUnitMenuPublication', () => {
  beforeEach(() => {
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('retorna a publicação administrativa da unidade', async () => {
    const payload = {
      unit: { id: 'unit-1', name: 'Loja Centro', is_active: true },
      publication: {
        exists: true,
        public_slug: 'abc',
        public_path: '/menu/abc',
        published_at: 'x',
        updated_at: 'y',
      },
      current_version: {
        version_id: 'v-1',
        version_number: 2,
        created_at: 'x',
        category_count: 3,
        product_count: 10,
        is_current: true,
      },
      history: [],
    };
    supabaseMock.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(fetchUnitMenuPublication('unit-1')).resolves.toEqual(payload);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_menu_publication_admin', {
      p_unit_id: 'unit-1',
    });
  });

  it('propaga erro de permissão como Error amigável', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED11', message: 'FORBIDDEN' },
    });

    await expect(fetchUnitMenuPublication('unit-1')).rejects.toThrow(/permissão/);
  });
});

describe('publishUnitMenu', () => {
  beforeEach(() => {
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('publica e devolve a nova versão e o caminho público', async () => {
    const result = {
      version_id: 'v-3',
      version_number: 3,
      published_at: 'x',
      public_slug: 'slug-1',
      public_path: '/menu/slug-1',
      category_count: 2,
      product_count: 4,
    };
    supabaseMock.rpc.mockResolvedValue({ data: result, error: null });

    await expect(publishUnitMenu('unit-1')).resolves.toEqual(result);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('publish_unit_menu', { p_unit_id: 'unit-1' });
  });

  it('propaga MENU_EMPTY como Error amigável', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED31', message: 'MENU_EMPTY' },
    });

    await expect(publishUnitMenu('unit-1')).rejects.toThrow(/cardápio está vazio/);
  });
});

describe('fetchPublicMenu', () => {
  beforeEach(() => {
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('retorna o cardápio público encontrado', async () => {
    const payload = {
      found: true,
      organization: { name: 'Cantina da Praça' },
      unit: { name: 'Loja Centro', is_active: true },
      menu: { version_id: 'v-1', version_number: 1, published_at: 'x' },
      operation: {
        configured: true,
        accepting_orders: true,
        revision: '2026-08-10T12:00:00.000000Z',
        open_now: true,
        can_order_now: true,
        pickup_enabled: true,
        delivery_enabled: false,
        delivery_fee: '0.00',
        minimum_order_amount: '0.00',
        estimated_pickup_minutes: 20,
        estimated_delivery_minutes: null,
        payment_methods: [],
        business_hours: [],
      },
      categories: [],
    };
    supabaseMock.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(fetchPublicMenu('abc')).resolves.toEqual(payload);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_menu', { p_public_slug: 'abc' });
  });

  it('trata ausência de payload como cardápio não encontrado', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    await expect(fetchPublicMenu('nada')).resolves.toEqual({ found: false });
  });
});
