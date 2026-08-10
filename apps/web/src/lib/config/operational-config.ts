import { supabase } from '../supabase';

export type ServiceMode = 'pickup' | 'delivery';

export interface BusinessHour {
  weekday: number;
  is_open: boolean;
  is_24h: boolean;
  open_time: string | null;
  close_time: string | null;
}

export interface PaymentMethod {
  method: 'cash' | 'pix' | 'credit_card' | 'debit_card';
  is_enabled: boolean;
}

export interface UnitOperationalConfig {
  configured: boolean;
  unit_id: string;
  timezone: string;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  delivery_fee: string;
  min_order_value: string;
  estimated_pickup_minutes: number | null;
  estimated_delivery_minutes: number | null;
  accepting_orders: boolean;
  business_hours: BusinessHour[];
  payment_methods: PaymentMethod[];
}

export type UnitOperationalConfigInput = Omit<UnitOperationalConfig, 'configured' | 'unit_id'>;

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod['method'], string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

export const WEEKDAY_LABELS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

export interface ConfigError {
  code: string | null;
  message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Você não tem permissão para gerenciar esta unidade.',
  PED12: 'Unidade não encontrada.',
  PED13: 'A unidade está inativa. Reative-a antes de configurar.',
  PED14: 'O fuso horário informado é inválido.',
  PED15: 'Selecione ao menos uma modalidade (retirada ou entrega).',
  PED16: 'Há um valor numérico inválido (use no máximo 2 casas decimais para dinheiro).',
  PED17: 'Há uma forma de pagamento inválida na configuração.',
  PED18: 'Os horários de funcionamento informados são inválidos.',
};

export function extractConfigError(error: {
  message?: string;
  code?: string | null;
  details?: string | null;
}): ConfigError {
  const code = error.code ?? null;
  const message = error.message ?? 'Não foi possível salvar a configuração.';
  const friendly = code !== null ? (ERROR_MESSAGES[code] ?? null) : null;
  return { code, message: friendly ?? message };
}

export async function fetchUnitOperationalConfig(unitId: string): Promise<UnitOperationalConfig> {
  const { data, error } = await supabase.rpc('get_unit_operational_config', {
    p_unit_id: unitId,
  });
  if (error) {
    throw new Error(extractConfigError(error).message);
  }
  return data as UnitOperationalConfig;
}

export async function saveUnitOperationalConfig(
  unitId: string,
  config: UnitOperationalConfigInput,
): Promise<{ config: UnitOperationalConfig | null; error: ConfigError | null }> {
  const { data, error } = await supabase.rpc('save_unit_operational_config', {
    p_unit_id: unitId,
    p_config: config,
  });
  if (error) {
    return { config: null, error: extractConfigError(error) };
  }
  return { config: (data as UnitOperationalConfig) ?? null, error: null };
}

export function normalizeConfig(config: UnitOperationalConfig): UnitOperationalConfig {
  return {
    ...config,
    timezone: config.timezone || DEFAULT_TIMEZONE,
    accepting_orders: config.accepting_orders ?? false,
    delivery_fee: config.delivery_fee ?? '0.00',
    min_order_value: config.min_order_value ?? '0.00',
    business_hours: Array.from({ length: 7 }, (_, weekday) => {
      const existing = config.business_hours.find((h) => h.weekday === weekday);
      return (
        existing ?? {
          weekday,
          is_open: false,
          is_24h: false,
          open_time: null,
          close_time: null,
        }
      );
    }).sort((a, b) => a.weekday - b.weekday),
    payment_methods: config.payment_methods ?? [],
  };
}
