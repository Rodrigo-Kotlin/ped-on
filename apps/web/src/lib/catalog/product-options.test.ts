import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import {
  createCatalogProductOption,
  createCatalogProductOptionGroup,
  extractProductOptionsError,
  fetchProductOptionGroups,
  formatOptionDelta,
  normalizeOptionDelta,
  productOptionsQueryKey,
  selectionSummary,
  setCatalogProductOptionActive,
  setCatalogProductOptionAvailable,
  setCatalogProductOptionGroupActive,
  updateCatalogProductOption,
  updateCatalogProductOptionGroup,
} from './product-options';
import { mockFromQuery, resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import type { CatalogProductOption, CatalogProductOptionGroup } from './product-options';

function group(overrides: Partial<CatalogProductOptionGroup>): CatalogProductOptionGroup {
  return {
    id: 'group-1',
    organization_id: 'org-1',
    unit_id: 'unit-1',
    product_id: 'product-1',
    name: 'Tamanho',
    kind: 'variation',
    selection_mode: 'single',
    min_select: 1,
    max_select: 1,
    is_active: true,
    sort_order: 1,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

function option(overrides: Partial<CatalogProductOption>): CatalogProductOption {
  return {
    id: 'option-1',
    organization_id: 'org-1',
    unit_id: 'unit-1',
    product_id: 'product-1',
    group_id: 'group-1',
    name: 'Médio',
    price_delta: '0.00',
    is_active: true,
    is_available: true,
    sort_order: 1,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

describe('productOptionsQueryKey', () => {
  it('inclui unidade e produto e isola de outras chaves', () => {
    expect(productOptionsQueryKey('unit-1', 'product-1')).toEqual([
      'admin-catalog-options',
      'unit-1',
      'product-1',
    ]);
  });
});

describe('normalizeOptionDelta', () => {
  it('normaliza valores válidos de variação (positivo, negativo e zero)', () => {
    expect(normalizeOptionDelta('4', 'variation')).toBe('4.00');
    expect(normalizeOptionDelta('7,50', 'variation')).toBe('7.50');
    expect(normalizeOptionDelta('12.5', 'variation')).toBe('12.50');
    expect(normalizeOptionDelta('-3,00', 'variation')).toBe('-3.00');
    expect(normalizeOptionDelta('-0,50', 'variation')).toBe('-0.50');
    expect(normalizeOptionDelta('0', 'variation')).toBe('0.00');
    expect(normalizeOptionDelta('-0,00', 'variation')).toBe('0.00');
    expect(normalizeOptionDelta(' 5,00 ', 'variation')).toBe('5.00');
  });

  it('aceita adicionais com preço igual ou maior que zero', () => {
    expect(normalizeOptionDelta('0,00', 'addon')).toBe('0.00');
    expect(normalizeOptionDelta('4.00', 'addon')).toBe('4.00');
  });

  it('rejeita adicionais com preço negativo', () => {
    expect(() => normalizeOptionDelta('-1,00', 'addon')).toThrow(
      'Adicionais não podem ter preço negativo.',
    );
  });

  it('mantém remoções sempre sem acréscimo', () => {
    expect(normalizeOptionDelta('0', 'removal')).toBe('0.00');
    expect(normalizeOptionDelta('0,00', 'removal')).toBe('0.00');
    expect(() => normalizeOptionDelta('1,00', 'removal')).toThrow(
      'Remoções não podem alterar o preço.',
    );
    expect(() => normalizeOptionDelta('-1,00', 'removal')).toThrow(
      'Remoções não podem alterar o preço.',
    );
  });

  it('rejeita valores vazios, exponenciais, inválidos e acima do limite', () => {
    expect(() => normalizeOptionDelta('', 'addon')).toThrow('Informe o preço adicional.');
    expect(() => normalizeOptionDelta('   ', 'addon')).toThrow('Informe o preço adicional.');
    expect(() => normalizeOptionDelta('1e3', 'addon')).toThrow(
      'Não use notação exponencial no preço.',
    );
    expect(() => normalizeOptionDelta('1,999', 'addon')).toThrow(
      'Use um valor com no máximo 2 casas decimais.',
    );
    expect(() => normalizeOptionDelta('abc', 'addon')).toThrow(
      'Use um valor com no máximo 2 casas decimais.',
    );
    expect(normalizeOptionDelta('9999999999.99', 'variation')).toBe('9999999999.99');
    expect(() => normalizeOptionDelta('10000000000,00', 'variation')).toThrow(
      'O valor máximo é 9999999999,99.',
    );
  });
});

describe('formatOptionDelta', () => {
  it('exibe "Sem acréscimo" para zero', () => {
    expect(formatOptionDelta('0.00')).toBe('Sem acréscimo');
    expect(formatOptionDelta('0')).toBe('Sem acréscimo');
  });

  it('formata acréscimos e descontos em reais', () => {
    expect(formatOptionDelta('4.00')).toBe('+ R$ 4,00');
    expect(formatOptionDelta('7.50')).toBe('+ R$ 7,50');
    expect(formatOptionDelta('-3.00')).toBe('- R$ 3,00');
    expect(formatOptionDelta('1234.50')).toBe('+ R$ 1.234,50');
  });
});

describe('selectionSummary', () => {
  it('resume cada contrato de seleção', () => {
    expect(selectionSummary(group({ kind: 'variation', min_select: 1, max_select: 1 }))).toBe(
      'Obrigatório — escolha 1',
    );
    expect(selectionSummary(group({ kind: 'addon', min_select: 0, max_select: 3 }))).toBe(
      'Opcional — escolha até 3',
    );
    expect(selectionSummary(group({ kind: 'addon', min_select: 1, max_select: 3 }))).toBe(
      'Escolha de 1 a 3',
    );
    expect(selectionSummary(group({ kind: 'removal', min_select: 0, max_select: 0 }))).toBe(
      'Opcional',
    );
  });
});

describe('extractProductOptionsError', () => {
  it('mapeia códigos PED de opções para mensagens amigáveis', () => {
    expect(
      extractProductOptionsError({ code: 'P0001', message: 'PED72: group missing' }).code,
    ).toBe('PED72');
    expect(
      extractProductOptionsError({ code: 'P0001', message: 'PED72: group missing' }).message,
    ).toBe('O grupo de opções não foi encontrado. Atualize a página e tente novamente.');
    expect(extractProductOptionsError({ code: 'PED73' }).message).toBe(
      'A regra de seleção é inválida para este tipo de grupo.',
    );
    expect(extractProductOptionsError({ code: 'PED74' }).message).toBe(
      'A opção não foi encontrada. Atualize a página e tente novamente.',
    );
    expect(extractProductOptionsError({ code: 'PED75' }).message).toBe(
      'A opção não está disponível no momento.',
    );
    expect(extractProductOptionsError({ code: 'PED76' }).message).toBe(
      'A quantidade obrigatória de opções não foi selecionada.',
    );
    expect(extractProductOptionsError({ code: 'PED77' }).message).toBe(
      'A seleção excede o limite de opções do grupo.',
    );
    expect(extractProductOptionsError({ code: 'PED78' }).message).toBe(
      'A seleção pertence a outro cardápio publicado.',
    );
  });

  it('mantém a mensagem original quando não há código conhecido e aplica fallback', () => {
    expect(extractProductOptionsError({ message: 'boom' })).toEqual({
      code: null,
      message: 'boom',
    });
    expect(extractProductOptionsError({})).toEqual({
      code: null,
      message: 'Não foi possível atualizar as opções do produto.',
    });
  });
});

describe('fetchProductOptionGroups', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('lê grupos e opções das tabelas, normaliza preços e preserva a ordem', async () => {
    const rows: Record<string, unknown[]> = {
      catalog_product_option_groups: [
        group({ id: 'g-2', name: 'Adicionais', kind: 'addon', sort_order: 2 }),
        group({ id: 'g-1', name: 'Tamanho', sort_order: 1 }),
      ],
      catalog_product_options: [
        option({
          id: 'o-2',
          group_id: 'g-1',
          name: 'Pequeno',
          price_delta: '2.5',
          sort_order: 1,
        }),
        option({
          id: 'o-1',
          group_id: 'g-1',
          name: 'Médio',
          price_delta: 4 as unknown as string,
          sort_order: 2,
        }),
      ],
    };
    supabaseMock.from.mockImplementation((table: string) =>
      mockFromQuery({ data: rows[table] ?? null, error: null }),
    );

    const data = await fetchProductOptionGroups('unit-1', 'product-1');

    expect(data.groups.map((g) => g.id)).toEqual(['g-1', 'g-2']);
    expect(data.options.map((o) => o.id)).toEqual(['o-2', 'o-1']);
    const [first, second] = data.options;
    expect(first?.price_delta).toBe('2.50');
    expect(second?.price_delta).toBe('4.00');
    expect(supabaseMock.from).toHaveBeenCalledWith('catalog_product_option_groups');
    expect(supabaseMock.from).toHaveBeenCalledWith('catalog_product_options');
  });

  it('lança erro amigável quando a leitura falha', async () => {
    supabaseMock.from.mockImplementation(() =>
      mockFromQuery({ data: null, error: { code: 'PED11', message: 'PED11 denied' } }),
    );
    await expect(fetchProductOptionGroups('unit-1', 'product-1')).rejects.toThrow(
      'Você não tem permissão para gerenciar opções desta unidade.',
    );
  });
});

describe('mutations de grupos e opções', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('chama create_catalog_product_option_group com os parâmetros corretos', async () => {
    await createCatalogProductOptionGroup(
      'unit-1',
      'product-1',
      'Tamanho',
      'variation',
      'single',
      1,
      1,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith('create_catalog_product_option_group', {
      p_unit_id: 'unit-1',
      p_product_id: 'product-1',
      p_name: 'Tamanho',
      p_kind: 'variation',
      p_selection_mode: 'single',
      p_min_select: 1,
      p_max_select: 1,
    });
  });

  it('chama update_catalog_product_option_group com o grupo correto', async () => {
    await updateCatalogProductOptionGroup('g-1', 'Nova regra', 'addon', 'multiple', 0, 5);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('update_catalog_product_option_group', {
      p_group_id: 'g-1',
      p_name: 'Nova regra',
      p_kind: 'addon',
      p_selection_mode: 'multiple',
      p_min_select: 0,
      p_max_select: 5,
    });
  });

  it('chama set_catalog_product_option_group_active', async () => {
    await setCatalogProductOptionGroupActive('g-1', false);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_product_option_group_active', {
      p_group_id: 'g-1',
      p_is_active: false,
    });
  });

  it('chama create e update de opção com preço já normalizado', async () => {
    await createCatalogProductOption('g-1', 'Grande', '4.00');
    await updateCatalogProductOption('o-1', 'Grande', '-3.00');
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(1, 'create_catalog_product_option', {
      p_group_id: 'g-1',
      p_name: 'Grande',
      p_price_delta: '4.00',
    });
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'update_catalog_product_option', {
      p_option_id: 'o-1',
      p_name: 'Grande',
      p_price_delta: '-3.00',
    });
  });

  it('chama os toggles de ativação e disponibilidade', async () => {
    await setCatalogProductOptionActive('o-1', false);
    await setCatalogProductOptionAvailable('o-1', true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_product_option_active', {
      p_option_id: 'o-1',
      p_is_active: false,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_product_option_available', {
      p_option_id: 'o-1',
      p_is_available: true,
    });
  });

  it('expõe mensagem amigável quando a mutação falha com erro PED', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED73', message: 'PED73: invalid rule for group' },
    });
    await expect(
      createCatalogProductOptionGroup('unit-1', 'product-1', 'X', 'variation', 'multiple', 1, 2),
    ).rejects.toThrow('A regra de seleção é inválida para este tipo de grupo.');
  });
});
