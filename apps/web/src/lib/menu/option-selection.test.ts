import { describe, expect, it } from 'vitest';
import type { PublicMenuOptionGroup } from './menu';
import {
  buildCartItemOptions,
  clearGroupSelection,
  configuredPriceCents,
  firstSelectionError,
  selectionError,
  toggleSelection,
} from './option-selection';

const variation: PublicMenuOptionGroup = {
  id: 'grp-1',
  name: 'Tamanho',
  kind: 'variation',
  selection_mode: 'single',
  min_select: 1,
  max_select: 1,
  options: [
    { id: 'opt-1', name: 'Duplo', price_delta: '5.00', is_available: true },
    { id: 'opt-4', name: 'Triplo', price_delta: '10.00', is_available: true },
  ],
};

const addons: PublicMenuOptionGroup = {
  id: 'grp-2',
  name: 'Adicionais',
  kind: 'addon',
  selection_mode: 'multiple',
  min_select: 0,
  max_select: 2,
  options: [
    { id: 'opt-2', name: 'Bacon', price_delta: '4.00', is_available: true },
    { id: 'opt-5', name: 'Chipa', price_delta: '2.00', is_available: true },
  ],
};

const optionalSingle: PublicMenuOptionGroup = {
  id: 'grp-3',
  name: 'Tempero',
  kind: 'variation',
  selection_mode: 'single',
  min_select: 0,
  max_select: 1,
  options: [{ id: 'opt-6', name: 'Pimenta', price_delta: '0.00', is_available: true }],
};

const maxOne: PublicMenuOptionGroup = {
  id: 'grp-4',
  name: 'Molhos',
  kind: 'addon',
  selection_mode: 'multiple',
  min_select: 0,
  max_select: 1,
  options: [
    { id: 'opt-7', name: 'Maionese', price_delta: '1.00', is_available: true },
    { id: 'opt-8', name: 'Ketchup', price_delta: '1.00', is_available: true },
  ],
};

describe('option-selection', () => {
  it('exige a seleção mínima de grupos obrigatórios', () => {
    expect(selectionError(variation, new Map())).toBe('Escolha 1 opção de Tamanho.');
    const selected = new Map([['grp-1', new Set(['opt-1'])] as const]);
    expect(selectionError(variation, selected)).toBeNull();
  });

  it('limita a seleção múltipla pelo máximo e gera mensagem específica', () => {
    const atMax = new Map([['grp-2', new Set(['opt-2', 'opt-5'])] as const]);
    expect(selectionError(addons, atMax)).toBeNull();
    const overMax = new Map([['grp-4', new Set(['opt-7', 'opt-8'])] as const]);
    expect(selectionError(maxOne, overMax)).toBe('Escolha no máximo 1 adicional.');
  });

  it('alterna rádio único e permite limpar grupo opcional', () => {
    let selection = toggleSelection(new Map(), variation, 'opt-1');
    expect(selection.get('grp-1')).toEqual(new Set(['opt-1']));
    selection = toggleSelection(selection, variation, 'opt-1');
    expect(selection.get('grp-1')).toEqual(new Set([]));
    selection = toggleSelection(selection, variation, 'opt-4');
    expect(selection.get('grp-1')).toEqual(new Set(['opt-4']));
    selection = toggleSelection(selection, variation, 'opt-1');
    expect(selection.get('grp-1')).toEqual(new Set(['opt-1']));

    const cleared = clearGroupSelection(selection, 'grp-1');
    expect(cleared.has('grp-1')).toBe(false);
  });

  it('não exige opção em grupo único opcional', () => {
    expect(selectionError(optionalSingle, new Map())).toBeNull();
  });

  it('calcula o preço configurado somando os deltas selecionados', () => {
    const selection = new Map([
      ['grp-1', new Set(['opt-1'])],
      ['grp-2', new Set(['opt-2'])],
    ]);
    expect(configuredPriceCents('29.90', [variation, addons], selection)).toBe(3890n);
  });

  it('aplica descontos fracionários negativos sem perder o sinal', () => {
    const discount: PublicMenuOptionGroup = {
      id: 'grp-9',
      name: 'Desconto',
      kind: 'variation',
      selection_mode: 'single',
      min_select: 0,
      max_select: 1,
      options: [
        { id: 'opt-9', name: 'Leve -0.50', price_delta: '-0.50', is_available: true },
        { id: 'opt-10', name: 'Leve -1.50', price_delta: '-1.50', is_available: true },
        { id: 'opt-11', name: 'Acréscimo +2.50', price_delta: '2.50', is_available: true },
      ],
    };
    expect(
      configuredPriceCents('10.00', [discount], new Map([['grp-9', new Set(['opt-9'])]] as const)),
    ).toBe(950n);
    expect(
      configuredPriceCents('10.00', [discount], new Map([['grp-9', new Set(['opt-10'])]] as const)),
    ).toBe(850n);
    expect(
      configuredPriceCents('10.00', [discount], new Map([['grp-9', new Set(['opt-11'])]] as const)),
    ).toBe(1250n);
  });

  it('reporta o primeiro erro de validação entre grupos', () => {
    expect(firstSelectionError([variation, addons], new Map())).toBe('Escolha 1 opção de Tamanho.');
    const onlyVariation = new Map([['grp-1', new Set(['opt-4'])] as const]);
    expect(firstSelectionError([variation, addons], onlyVariation)).toBeNull();
  });

  it('monta as opções do carrinho na ordem definida no grupo', () => {
    const selection = new Map([
      ['grp-1', new Set(['opt-4'])],
      ['grp-2', new Set(['opt-5'])],
    ]);
    expect(buildCartItemOptions([variation, addons], selection)).toEqual([
      { menu_group_id: 'grp-1', menu_option_id: 'opt-4', name: 'Triplo', price_delta: '10.00' },
      { menu_group_id: 'grp-2', menu_option_id: 'opt-5', name: 'Chipa', price_delta: '2.00' },
    ]);
  });

  it('ignora seleções que não existem no grupo ao montar preço e opções', () => {
    const selection = new Map([
      ['grp-1', new Set(['opt-1', 'opt-999'])],
      ['grp-2', new Set(['opt-2'])],
    ]);
    expect(configuredPriceCents('29.90', [variation, addons], selection)).toBe(3890n);
    expect(buildCartItemOptions([variation, addons], selection)).toEqual([
      { menu_group_id: 'grp-1', menu_option_id: 'opt-1', name: 'Duplo', price_delta: '5.00' },
      { menu_group_id: 'grp-2', menu_option_id: 'opt-2', name: 'Bacon', price_delta: '4.00' },
    ]);
  });
});
