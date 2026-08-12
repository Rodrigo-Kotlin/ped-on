import { z } from 'zod';
import { isPlainText } from '../plain-text';
import { supabase } from '../supabase';

const EDGE_FUNCTION_URL = `${
  import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'
}/functions/v1/loyalty-cpf`;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'placeholder-key';

export type LoyaltyMode = 'lookup' | 'enroll';

export type LoyaltyResolveInput =
  | { publicSlug: string; mode: 'lookup'; cpf: string; phone: string }
  | {
      publicSlug: string;
      mode: 'enroll';
      cpf: string;
      phone: string;
      name: string;
      consent: true;
    };

export interface LoyaltyStatementEntry {
  entry_type: 'earn' | 'reversal' | 'redeem';
  gross_points: number;
  points_delta: number;
  recovery_delta: number;
  eligible_amount: string | null;
  order_number: number | null;
  created_at: string;
}

export const LOYALTY_STATEMENT_MAX_ITEMS = 50;

export interface LoyaltyResolveFound {
  found: true;
  membership_id: string;
  customer: { name: string | null; cpf_last2: string };
  account: { points_balance: number; recovery_points: number };
  statement?: LoyaltyStatementEntry[] | undefined;
  vouchers?: LoyaltyVoucher[] | undefined;
  token: { access_token: string; expires_at: string };
}

export type LoyaltyResolveResult = LoyaltyResolveFound | { found: false };

export interface LoyaltyVoucher {
  code: string;
  reward_name: string;
  points_cost: string;
  issued_at: string;
}

const loyaltyStatementEntrySchema = z.object({
  entry_type: z.enum(['earn', 'reversal', 'redeem']),
  gross_points: z.number(),
  points_delta: z.number(),
  recovery_delta: z.number(),
  eligible_amount: z.string().nullable(),
  order_number: z.number().int().nullable(),
  created_at: z.string(),
});

const loyaltyVoucherSchema = z.object({
  code: z.string(),
  reward_name: z.string(),
  points_cost: z.string().regex(/^\d+$/),
  issued_at: z.string(),
});

const loyaltyResolveResultSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    membership_id: z.string().uuid(),
    customer: z.object({ name: z.string().nullable(), cpf_last2: z.string().regex(/^\d{2}$/) }),
    account: z.object({ points_balance: z.number(), recovery_points: z.number() }),
    statement: z.array(loyaltyStatementEntrySchema).optional(),
    vouchers: z.array(loyaltyVoucherSchema).optional(),
    token: z.object({
      access_token: z.string().regex(/^[a-f0-9]{64}$/),
      expires_at: z.string(),
    }),
  }),
]);

export type LoyaltyEdgeErrorCode =
  | 'INVALID_MODE'
  | 'INVALID_SLUG'
  | 'INVALID_CPF'
  | 'INVALID_PHONE'
  | 'INVALID_NAME'
  | 'IDENTITY_NOT_CONFIRMED'
  | 'CONSENT_REQUIRED'
  | 'RATE_LIMITED'
  | 'LOYALTY_UNAVAILABLE'
  | 'LOYALTY_INTEGRITY'
  | 'UPSTREAM_ERROR'
  | 'SERVER_CONFIG'
  | 'INVALID_JSON'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | null;

const EDGE_ERROR_MESSAGES: Record<Exclude<LoyaltyEdgeErrorCode, null>, string> = {
  INVALID_MODE: 'Não foi possível processar sua solicitação. Tente novamente.',
  INVALID_JSON: 'Não foi possível processar sua solicitação. Tente novamente.',
  METHOD_NOT_ALLOWED: 'Não foi possível processar sua solicitação. Tente novamente.',
  PAYLOAD_TOO_LARGE: 'Não foi possível processar sua solicitação. Tente novamente.',
  INVALID_SLUG: 'Cardápio não encontrado.',
  INVALID_CPF: 'CPF inválido. Confira os números informados.',
  INVALID_PHONE: 'Informe um telefone válido com DDD.',
  INVALID_NAME: 'Revise seu nome (use entre 2 e 120 caracteres).',
  IDENTITY_NOT_CONFIRMED: 'Não foi possível confirmar os dados informados.',
  CONSENT_REQUIRED: 'É necessário aceitar os termos para entrar no Clube.',
  RATE_LIMITED: 'Muitas tentativas foram realizadas. Aguarde um pouco e tente novamente.',
  LOYALTY_UNAVAILABLE: 'O Clube Ped-On está indisponível para este cardápio.',
  LOYALTY_INTEGRITY: 'Inconsistência interna do Clube. Tente novamente.',
  UPSTREAM_ERROR: 'Não foi possível processar sua solicitação. Tente novamente.',
  SERVER_CONFIG: 'Não foi possível processar sua solicitação. Tente novamente.',
};

export const LOYALTY_NETWORK_ERROR_MESSAGE =
  'Não foi possível conectar ao Clube Ped-On. Verifique sua conexão e tente novamente.';

export class LoyaltyError extends Error {
  constructor(
    message: string,
    public readonly code: LoyaltyEdgeErrorCode,
    public readonly isNetworkError = false,
  ) {
    super(message);
    this.name = 'LoyaltyError';
  }
}

function mapEdgeError(code: LoyaltyEdgeErrorCode): string {
  return (
    (code !== null && EDGE_ERROR_MESSAGES[code]) || 'Não foi possível processar a solicitação.'
  );
}

export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeCpf(value);
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(digits[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === Number(digits[10]);
}

export const cpfSchema = z
  .string()
  .trim()
  .refine(isValidCpf, 'CPF inválido. Confira os números informados.');

export const loyaltyPhoneSchema = z
  .string()
  .trim()
  .regex(
    /^([0-9]{10,11}|\([0-9]{2}\) ?[0-9]{4,5}-[0-9]{4}|[0-9]{2} ?[0-9]{4,5}-[0-9]{4})$/,
    'Informe um telefone válido com DDD.',
  );

export const loyaltyNameSchema = z
  .string()
  .trim()
  .min(2, 'Informe seu nome')
  .max(120, 'Use no máximo 120 caracteres')
  .refine(isPlainText, 'Use apenas texto simples');

export const clubLookupSchema = z.object({ cpf: cpfSchema, phone: loyaltyPhoneSchema });

export const clubEnrollSchema = z.object({
  cpf: cpfSchema,
  phone: loyaltyPhoneSchema,
  name: loyaltyNameSchema,
  consent: z
    .boolean()
    .refine((value) => value, 'É necessário aceitar os termos para entrar no Clube.'),
});

export async function resolveLoyaltyIdentity(
  input: LoyaltyResolveInput,
): Promise<LoyaltyResolveResult> {
  const body: Record<string, unknown> = {
    public_slug: input.publicSlug,
    mode: input.mode,
    cpf: input.cpf,
    phone: input.phone,
  };
  if (input.mode === 'enroll') {
    body.name = input.name;
    body.consent = input.consent;
  }

  let response: Response;
  try {
    response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new LoyaltyError(LOYALTY_NETWORK_ERROR_MESSAGE, null, true);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LoyaltyError('Não foi possível processar sua solicitação. Tente novamente.', null);
  }

  if (!response.ok) {
    const code = (payload as { error?: { code?: LoyaltyEdgeErrorCode } })?.error?.code ?? null;
    throw new LoyaltyError(mapEdgeError(code), code);
  }

  const result = loyaltyResolveResultSchema.safeParse(payload);
  if (!result.success) throw new LoyaltyError(mapEdgeError('UPSTREAM_ERROR'), 'UPSTREAM_ERROR');
  return result.data;
}

export function isLoyaltyToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function maskCpf(last2: string): string {
  return `***.***.***-${last2}`;
}

export interface PublicLoyaltyAccountFound {
  found: true;
  organization: { name: string };
  customer: { name: string | null; cpf_last2: string };
  account: { points_balance: number; recovery_points: number; updated_at: string };
  statement: LoyaltyStatementEntry[];
  vouchers: LoyaltyVoucher[];
}

export type PublicLoyaltyAccountResult = PublicLoyaltyAccountFound | { found: false };

const publicLoyaltyAccountResultSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    organization: z.object({ name: z.string() }),
    customer: z.object({ name: z.string().nullable(), cpf_last2: z.string().regex(/^\d{2}$/) }),
    account: z.object({
      points_balance: z.number(),
      recovery_points: z.number(),
      updated_at: z.string(),
    }),
    statement: z.array(loyaltyStatementEntrySchema),
    vouchers: z.array(loyaltyVoucherSchema).default([]),
  }),
]);

export async function fetchPublicLoyaltyAccount(
  accessToken: string,
): Promise<PublicLoyaltyAccountResult> {
  try {
    const { data, error } = await supabase.rpc('get_public_loyalty_account', {
      p_access_token: accessToken,
    });
    if (error) {
      throw error;
    }
    const parsed = publicLoyaltyAccountResultSchema.safeParse(data ?? { found: false });
    if (!parsed.success) throw new Error('Invalid loyalty account response');
    return parsed.data;
  } catch {
    throw new LoyaltyError(
      'Não foi possível atualizar o saldo. Verifique sua conexão e tente novamente.',
      null,
      true,
    );
  }
}

export type LoyaltyAdminErrorCode = 'PED10' | 'PED11' | 'PED53' | null;

export class LoyaltyAdminError extends Error {
  constructor(
    message: string,
    public readonly code: LoyaltyAdminErrorCode,
  ) {
    super(message);
    this.name = 'LoyaltyAdminError';
  }
}

const ADMIN_ERROR_MESSAGES: Record<'PED10' | 'PED11' | 'PED53', string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Apenas o proprietário da organização pode acessar o Clube.',
  PED53: 'Inconsistência interna do Clube. Recarregue e tente novamente.',
};

const ADMIN_FALLBACK_MESSAGE =
  'Não foi possível carregar o Clube. Verifique sua conexão e tente novamente.';

function extractLoyaltyAdminError(error: {
  code?: string | null;
  message?: string;
}): LoyaltyAdminError {
  const code = error?.code ?? null;
  const matched = code === 'PED10' || code === 'PED11' || code === 'PED53' ? code : null;
  return new LoyaltyAdminError(
    matched !== null ? ADMIN_ERROR_MESSAGES[matched] : ADMIN_FALLBACK_MESSAGE,
    matched,
  );
}

async function loyaltyAdminRpc<T>(name: string, parameters: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await supabase.rpc(name, parameters);
    if (error) throw extractLoyaltyAdminError(error);
    return data as T;
  } catch (error) {
    if (error instanceof LoyaltyAdminError) throw error;
    throw extractLoyaltyAdminError({
      message: error instanceof Error ? error.message : 'Network error',
    });
  }
}

export interface LoyaltyProgramInfo {
  exists: true;
  enabled: boolean;
  points_per_real: string;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyProgramAdmin {
  organization_id: string;
  program: LoyaltyProgramInfo | null;
  stats: {
    members_count: number;
    total_earned: number;
    total_reversed: number;
  };
}

export interface LoyaltyMember {
  id: string;
  cpf_last2: string;
  name: string | null;
  points_balance: number;
  recovery_points: number;
  total_earned: number;
  total_reversed: number;
  member_since: string;
}

export interface LoyaltyMembersAdmin {
  organization_id: string;
  count: number;
  has_more: boolean;
  next_cursor: string | null;
  members: LoyaltyMember[];
}

export function fetchLoyaltyProgramAdmin(organizationId: string): Promise<LoyaltyProgramAdmin> {
  return loyaltyAdminRpc('get_loyalty_program_admin', { p_organization_id: organizationId });
}

export interface LoyaltyProgramEnabledResult {
  organization_id: string;
  program: LoyaltyProgramInfo;
}

export function setLoyaltyProgramEnabled(
  organizationId: string,
  enabled: boolean,
): Promise<LoyaltyProgramEnabledResult> {
  return loyaltyAdminRpc('set_loyalty_program_enabled', {
    p_organization_id: organizationId,
    p_enabled: enabled,
  });
}

export function fetchLoyaltyMembersAdmin(
  organizationId: string,
  cursor: string | null,
): Promise<LoyaltyMembersAdmin> {
  return loyaltyAdminRpc('get_loyalty_members_admin', {
    p_organization_id: organizationId,
    p_limit: 50,
    p_cursor: cursor,
  });
}

export function loyaltyProgramKey(userId: string, organizationId: string) {
  return ['loyalty-program', userId, organizationId] as const;
}

export function loyaltyMembersKey(userId: string, organizationId: string, cursor: string | null) {
  return ['loyalty-members', userId, organizationId, cursor ?? 'first'] as const;
}

export function loyaltyMembersPrefix(userId: string, organizationId: string) {
  return ['loyalty-members', userId, organizationId] as const;
}
