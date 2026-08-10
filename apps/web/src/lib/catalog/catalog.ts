import { supabase } from '../supabase';

export type CatalogRole = 'owner' | 'manager' | 'operator';

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  sort_order: number;
  is_active: boolean;
  is_available: boolean;
}

export interface CatalogCategory {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  products: CatalogProduct[];
}

export interface AdminCatalog {
  unit: { id: string; name: string };
  can_manage: boolean;
  role: CatalogRole;
  categories: CatalogCategory[];
}

export interface CatalogError {
  code: string | null;
  message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Você não tem permissão para acessar o catálogo desta unidade.',
  PED12: 'Unidade não encontrada.',
  PED20: 'Categoria não encontrada.',
  PED21: 'Informe o nome da categoria.',
  PED22: 'O nome da categoria deve ter no máximo 80 caracteres.',
  PED23: 'Já existe uma categoria com esse nome nesta unidade.',
  PED24: 'Produto não encontrado.',
  PED25: 'Informe o nome do produto.',
  PED26: 'O nome do produto deve ter no máximo 120 caracteres.',
  PED27: 'A descrição do produto deve ter no máximo 500 caracteres.',
  PED28: 'Informe um preço válido, maior que zero e com até 2 casas decimais.',
  PED29: 'A categoria não pertence à unidade selecionada.',
  PED30: 'Informe um estado válido para o catálogo.',
};

type RpcError = {
  message?: string;
  code?: string | null;
  details?: string | null;
};

export function extractCatalogError(error: RpcError): CatalogError {
  const content = [error.code, error.message, error.details].filter(Boolean).join(' ');
  const matchedCode = content.match(/\bPED(?:1[0-2]|2[0-9]|30)\b/)?.[0] ?? null;
  const code = matchedCode ?? error.code ?? null;
  return {
    code,
    message:
      (matchedCode !== null ? ERROR_MESSAGES[matchedCode] : undefined) ??
      error.message ??
      'Não foi possível atualizar o catálogo.',
  };
}

export function normalizeCatalogPrice(input: string): string {
  const value = input.trim();
  if (value === '') {
    throw new Error('Informe o preço.');
  }
  if (/[eE]/.test(value)) {
    throw new Error('Não use notação exponencial no preço.');
  }
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) {
    throw new Error('Use um preço com no máximo 2 casas decimais.');
  }

  const [rawInteger = '', rawFraction = ''] = value.replace(',', '.').split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.padEnd(2, '0');

  if (/^0+$/.test(integer) && /^0*$/.test(fraction)) {
    throw new Error('O preço deve ser maior que zero.');
  }
  if (integer.length > 10 || (integer.length === 10 && integer > '9999999999')) {
    throw new Error('O preço máximo é 9999999999,99.');
  }

  return `${integer}.${fraction}`;
}

function catalogError(error: RpcError): Error {
  return new Error(extractCatalogError(error).message);
}

async function mutateCatalog(rpc: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(rpc, parameters);
  if (error) {
    throw catalogError(error);
  }
  return data;
}

export async function fetchAdminCatalog(unitId: string): Promise<AdminCatalog> {
  const { data, error } = await supabase.rpc('get_unit_catalog_admin', { p_unit_id: unitId });
  if (error) {
    throw catalogError(error);
  }
  return data as AdminCatalog;
}

export function createCatalogCategory(unitId: string, name: string) {
  return mutateCatalog('create_catalog_category', { p_unit_id: unitId, p_name: name });
}

export function updateCatalogCategory(categoryId: string, name: string) {
  return mutateCatalog('update_catalog_category', { p_category_id: categoryId, p_name: name });
}

export function setCatalogCategoryActive(categoryId: string, isActive: boolean) {
  return mutateCatalog('set_catalog_category_active', {
    p_category_id: categoryId,
    p_is_active: isActive,
  });
}

export function createCatalogProduct(
  unitId: string,
  categoryId: string,
  name: string,
  description: string | null,
  price: string,
) {
  return mutateCatalog('create_catalog_product', {
    p_unit_id: unitId,
    p_category_id: categoryId,
    p_name: name,
    p_description: description,
    p_price: price,
  });
}

export function updateCatalogProduct(
  productId: string,
  categoryId: string,
  name: string,
  description: string | null,
  price: string,
) {
  return mutateCatalog('update_catalog_product', {
    p_product_id: productId,
    p_category_id: categoryId,
    p_name: name,
    p_description: description,
    p_price: price,
  });
}

export function setCatalogProductActive(productId: string, isActive: boolean) {
  return mutateCatalog('set_catalog_product_active', {
    p_product_id: productId,
    p_is_active: isActive,
  });
}

export function setCatalogProductAvailable(productId: string, isAvailable: boolean) {
  return mutateCatalog('set_catalog_product_available', {
    p_product_id: productId,
    p_is_available: isAvailable,
  });
}
