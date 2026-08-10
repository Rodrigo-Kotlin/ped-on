import { supabase } from '../supabase';

export interface MenuPublicationVersion {
  version_id: string;
  version_number: number;
  created_at: string;
  category_count: number;
  product_count: number;
  is_current: boolean;
}

export interface MenuPublicationAdmin {
  unit: { id: string; name: string; is_active: boolean };
  publication: {
    exists: boolean;
    public_slug: string | null;
    public_path: string | null;
    published_at: string | null;
    updated_at: string | null;
  };
  current_version: (Omit<MenuPublicationVersion, 'is_current'> & { is_current: true }) | null;
  history: MenuPublicationVersion[];
}

export interface PublishMenuResult {
  version_id: string;
  version_number: number;
  published_at: string;
  public_slug: string;
  public_path: string;
  category_count: number;
  product_count: number;
}

export type PaymentMethodCode = 'cash' | 'pix' | 'credit_card' | 'debit_card';

export interface PublicMenuBusinessHour {
  weekday: number;
  is_open: boolean;
  is_24h: boolean;
  open_time: string | null;
  close_time: string | null;
}

export interface PublicMenuPaymentMethod {
  method: PaymentMethodCode;
  is_enabled: boolean;
}

export interface PublicMenuProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  sort_order: number;
  is_available: boolean;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  sort_order: number;
  products: PublicMenuProduct[];
}

export interface PublicMenuData {
  found: true;
  organization: { name: string };
  unit: { name: string; is_active: boolean };
  menu: { version_id: string; version_number: number; published_at: string };
  operation: {
    configured: boolean;
    accepting_orders: boolean;
    pickup_enabled: boolean;
    delivery_enabled: boolean;
    delivery_fee: string;
    minimum_order_amount: string;
    estimated_pickup_minutes: number | null;
    estimated_delivery_minutes: number | null;
    payment_methods: PublicMenuPaymentMethod[];
    business_hours: PublicMenuBusinessHour[];
  };
  categories: PublicMenuCategory[];
}

export interface PublicMenuNotFound {
  found: false;
}

export type PublicMenuResult = PublicMenuData | PublicMenuNotFound;

export interface MenuError {
  code: string | null;
  message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Você não tem permissão para publicar o cardápio desta unidade.',
  PED12: 'Unidade não encontrada.',
  PED31: 'O cardápio está vazio. Ative ao menos uma categoria com produtos para publicar.',
  PED32: 'Não foi possível gerar o link público. Tente publicar novamente.',
};

type RpcError = {
  message?: string;
  code?: string | null;
  details?: string | null;
};

export function extractMenuError(error: RpcError): MenuError {
  const content = [error.code, error.message, error.details].filter(Boolean).join(' ');
  const matchedCode = content.match(/\bPED(?:1[0-2]|3[12])\b/)?.[0] ?? null;
  const code = matchedCode ?? error.code ?? null;
  return {
    code,
    message:
      (matchedCode !== null ? ERROR_MESSAGES[matchedCode] : undefined) ??
      error.message ??
      'Não foi possível carregar a publicação do cardápio.',
  };
}

function menuError(error: RpcError): Error {
  return new Error(extractMenuError(error).message);
}

export async function fetchUnitMenuPublication(unitId: string): Promise<MenuPublicationAdmin> {
  const { data, error } = await supabase.rpc('get_unit_menu_publication_admin', {
    p_unit_id: unitId,
  });
  if (error) {
    throw menuError(error);
  }
  return data as MenuPublicationAdmin;
}

export async function publishUnitMenu(unitId: string): Promise<PublishMenuResult> {
  const { data, error } = await supabase.rpc('publish_unit_menu', { p_unit_id: unitId });
  if (error) {
    throw menuError(error);
  }
  return data as PublishMenuResult;
}

export async function fetchPublicMenu(publicSlug: string): Promise<PublicMenuResult> {
  const { data, error } = await supabase.rpc('get_public_menu', { p_public_slug: publicSlug });
  if (error) {
    throw menuError(error);
  }
  return (data as PublicMenuResult | null) ?? { found: false };
}

export function formatBRL(price: string): string {
  const [integer = '0', fraction = ''] = price.split('.');
  return `R$ ${integer},${fraction.padEnd(2, '0')}`;
}
