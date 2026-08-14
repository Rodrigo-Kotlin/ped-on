import { supabase } from '../supabase';

export type OptionGroupKind = 'variation' | 'addon' | 'removal';
export type OptionSelectionMode = 'single' | 'multiple';

export const OPTION_GROUP_KINDS: readonly OptionGroupKind[] = [
  'variation',
  'addon',
  'removal',
] as const;

export const KIND_LABELS: Record<OptionGroupKind, string> = {
  variation: 'Variação',
  addon: 'Adicional',
  removal: 'Remoção',
};

export const SELECTION_MODE_LABELS: Record<OptionSelectionMode, string> = {
  single: 'Escolha única',
  multiple: 'Múltipla escolha',
};

export interface CatalogProductOptionGroup {
  id: string;
  organization_id: string;
  unit_id: string;
  product_id: string;
  name: string;
  kind: OptionGroupKind;
  selection_mode: OptionSelectionMode;
  min_select: number;
  max_select: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CatalogProductOption {
  id: string;
  organization_id: string;
  unit_id: string;
  product_id: string;
  group_id: string;
  name: string;
  price_delta: string;
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductOptionsData {
  groups: CatalogProductOptionGroup[];
  options: CatalogProductOption[];
}

export interface ProductOptionsError {
  code: string | null;
  message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Você não tem permissão para gerenciar opções desta unidade.',
  PED12: 'Unidade não encontrada.',
  PED24: 'Produto não encontrado. Atualize a página e tente novamente.',
  PED25: 'Informe o nome do grupo ou da opção.',
  PED26: 'O nome deve ter no máximo 80 caracteres.',
  PED28: 'Informe um valor válido para o preço adicional (até 2 casas decimais).',
  PED30: 'Informe um estado válido.',
  PED72: 'O grupo de opções não foi encontrado. Atualize a página e tente novamente.',
  PED73: 'A regra de seleção é inválida para este tipo de grupo.',
  PED74: 'A opção não foi encontrada. Atualize a página e tente novamente.',
  PED75: 'A opção não está disponível no momento.',
  PED76: 'A quantidade obrigatória de opções não foi selecionada.',
  PED77: 'A seleção excede o limite de opções do grupo.',
  PED78: 'A seleção pertence a outro cardápio publicado.',
};

type RpcError = {
  message?: string;
  code?: string | null;
  details?: string | null;
};

export function extractProductOptionsError(error: RpcError): ProductOptionsError {
  const content = [error.code, error.message, error.details].filter(Boolean).join(' ');
  const matchedCode = content.match(/\bPED(?:1[0-2]|2[4-6]|28|30|7[2-8])\b/)?.[0] ?? null;
  const code = matchedCode ?? error.code ?? null;
  return {
    code,
    message:
      (matchedCode !== null ? ERROR_MESSAGES[matchedCode] : undefined) ??
      error.message ??
      'Não foi possível atualizar as opções do produto.',
  };
}

function optionsError(error: RpcError): Error {
  return new Error(extractProductOptionsError(error).message);
}

export function productOptionsQueryKey(unitId: string, productId: string) {
  return ['admin-catalog-options', unitId, productId] as const;
}

type OptionRow = {
  price_delta?: unknown;
};

function toDeltaText(value: unknown): string {
  const raw =
    typeof value === 'number' || typeof value === 'bigint' ? String(value) : String(value ?? '0');
  const negative = raw.startsWith('-');
  const abs = negative ? raw.slice(1) : raw;
  const [integer = '0', fraction = ''] = abs.split('.');
  return `${negative ? '-' : ''}${integer}.${(fraction + '00').slice(0, 2)}`;
}

function sortByOrder<T extends { sort_order: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

async function selectOptionRows(
  table: 'catalog_product_option_groups' | 'catalog_product_options',
  unitId: string,
  productId: string,
) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('unit_id', unitId)
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });
  if (error) {
    throw optionsError(error);
  }
  return (data ?? []) as unknown[];
}

export async function fetchProductOptionGroups(
  unitId: string,
  productId: string,
): Promise<ProductOptionsData> {
  const [groupRows, optionRows] = await Promise.all([
    selectOptionRows('catalog_product_option_groups', unitId, productId),
    selectOptionRows('catalog_product_options', unitId, productId),
  ]);

  const groups = sortByOrder(groupRows as CatalogProductOptionGroup[]);
  const options = (optionRows as (OptionRow & CatalogProductOption)[]).map((option) => ({
    ...option,
    price_delta: toDeltaText(option.price_delta),
  }));

  return { groups, options };
}

async function mutateOptions(rpc: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(rpc, parameters);
  if (error) {
    throw optionsError(error);
  }
  return data;
}

export function createCatalogProductOptionGroup(
  unitId: string,
  productId: string,
  name: string,
  kind: OptionGroupKind,
  selectionMode: OptionSelectionMode,
  minSelect: number,
  maxSelect: number,
) {
  return mutateOptions('create_catalog_product_option_group', {
    p_unit_id: unitId,
    p_product_id: productId,
    p_name: name,
    p_kind: kind,
    p_selection_mode: selectionMode,
    p_min_select: minSelect,
    p_max_select: maxSelect,
  });
}

export function updateCatalogProductOptionGroup(
  groupId: string,
  name: string,
  kind: OptionGroupKind,
  selectionMode: OptionSelectionMode,
  minSelect: number,
  maxSelect: number,
) {
  return mutateOptions('update_catalog_product_option_group', {
    p_group_id: groupId,
    p_name: name,
    p_kind: kind,
    p_selection_mode: selectionMode,
    p_min_select: minSelect,
    p_max_select: maxSelect,
  });
}

export function setCatalogProductOptionGroupActive(groupId: string, isActive: boolean) {
  return mutateOptions('set_catalog_product_option_group_active', {
    p_group_id: groupId,
    p_is_active: isActive,
  });
}

export function createCatalogProductOption(groupId: string, name: string, priceDelta: string) {
  return mutateOptions('create_catalog_product_option', {
    p_group_id: groupId,
    p_name: name,
    p_price_delta: priceDelta,
  });
}

export function updateCatalogProductOption(optionId: string, name: string, priceDelta: string) {
  return mutateOptions('update_catalog_product_option', {
    p_option_id: optionId,
    p_name: name,
    p_price_delta: priceDelta,
  });
}

export function setCatalogProductOptionActive(optionId: string, isActive: boolean) {
  return mutateOptions('set_catalog_product_option_active', {
    p_option_id: optionId,
    p_is_active: isActive,
  });
}

export function setCatalogProductOptionAvailable(optionId: string, isAvailable: boolean) {
  return mutateOptions('set_catalog_product_option_available', {
    p_option_id: optionId,
    p_is_available: isAvailable,
  });
}

export function normalizeOptionDelta(input: string, kind: OptionGroupKind): string {
  const value = input.trim();
  if (value === '') {
    throw new Error('Informe o preço adicional.');
  }
  if (/[eE]/.test(value)) {
    throw new Error('Não use notação exponencial no preço.');
  }
  if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(value)) {
    throw new Error('Use um valor com no máximo 2 casas decimais.');
  }

  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [rawInteger = '', rawFraction = ''] = raw.replace(',', '.').split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.padEnd(2, '0');

  if (integer.length > 10 || (integer.length === 10 && integer > '9999999999')) {
    throw new Error('O valor máximo é 9999999999,99.');
  }

  const magnitudeIsZero = /^0+$/.test(integer) && /^0*$/.test(fraction);
  if (negative && !magnitudeIsZero) {
    if (kind === 'addon') {
      throw new Error('Adicionais não podem ter preço negativo.');
    }
    if (kind === 'removal') {
      throw new Error('Remoções não podem alterar o preço.');
    }
  } else if (kind === 'removal' && !magnitudeIsZero) {
    throw new Error('Remoções não podem alterar o preço.');
  }

  const canonical = `${negative ? '-' : ''}${integer}.${fraction}`;
  return magnitudeIsZero ? '0.00' : canonical;
}

export function formatOptionDelta(delta: string): string {
  const value = toDeltaText(delta);
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const [integer = '0', fraction = '00'] = abs.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (/^0+$/.test(integer) && /^0*$/.test(fraction)) {
    return 'Sem acréscimo';
  }
  return negative ? `- R$ ${grouped},${fraction}` : `+ R$ ${grouped},${fraction}`;
}

export function selectionSummary(
  group: Pick<CatalogProductOptionGroup, 'kind' | 'selection_mode' | 'min_select' | 'max_select'>,
): string {
  const { min_select: min, max_select: max } = group;
  if (min === 0 && max === 0) {
    return 'Opcional';
  }
  if (min === 0) {
    return `Opcional — escolha até ${max}`;
  }
  if (min === max) {
    return `Obrigatório — escolha ${min}`;
  }
  return `Escolha de ${min} a ${max}`;
}
