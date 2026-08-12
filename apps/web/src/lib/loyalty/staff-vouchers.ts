import { z } from 'zod';
import { supabase } from '../supabase';

const rawVoucherCodeSchema = z.string().regex(/^[A-F0-9]{16}$/);

const voucherFoundSchema = z.object({
  found: z.literal(true),
  code: z.string().regex(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/),
  status: z.enum(['issued', 'consumed']),
  reward_name: z.string().min(1).max(120),
  points_cost: z.string().regex(/^[1-9]\d*$/),
  issued_at: z.string().datetime({ offset: true }),
  consumed_at: z.string().datetime({ offset: true }).nullable(),
});

const voucherResultSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  voucherFoundSchema,
]);

export type StaffVoucher = z.infer<typeof voucherFoundSchema>;
export type StaffVoucherLookup = z.infer<typeof voucherResultSchema>;
export type StaffVoucherErrorCode = 'PED10' | 'PED11' | 'PED60' | 'PED61' | 'PED62' | null;

export class StaffVoucherError extends Error {
  constructor(
    message: string,
    public readonly code: StaffVoucherErrorCode,
    public readonly ambiguous = false,
  ) {
    super(message);
    this.name = 'StaffVoucherError';
  }
}

const ERROR_MESSAGES: Record<Exclude<StaffVoucherErrorCode, null>, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Você não tem permissão para operar vouchers desta unidade.',
  PED60: 'Voucher não encontrado.',
  PED61: 'Este voucher já foi utilizado.',
  PED62: 'Informe um código de voucher válido.',
};

const FALLBACK_MESSAGE =
  'Não foi possível consultar o voucher. Verifique sua conexão e tente novamente.';

function matchedErrorCode(value: string | null | undefined): StaffVoucherErrorCode {
  return value === 'PED10' ||
    value === 'PED11' ||
    value === 'PED60' ||
    value === 'PED61' ||
    value === 'PED62'
    ? value
    : null;
}

function staffVoucherError(error: unknown): StaffVoucherError {
  if (error instanceof StaffVoucherError) return error;
  const candidate = error as { code?: string | null } | null;
  const code = matchedErrorCode(candidate?.code);
  return new StaffVoucherError(
    code === null ? FALLBACK_MESSAGE : ERROR_MESSAGES[code],
    code,
    code === null,
  );
}

export function normalizeVoucherCode(value: string): string {
  return value.trim().toUpperCase().replace(/[ -]/g, '');
}

export function formatVoucherCodeInput(value: string): string {
  const raw = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
  return raw.match(/.{1,4}/g)?.join('-') ?? '';
}

async function voucherRpc(name: string, unitId: string, voucherCode: string) {
  const normalizedCode = normalizeVoucherCode(voucherCode);
  if (!rawVoucherCodeSchema.safeParse(normalizedCode).success) {
    throw new StaffVoucherError(ERROR_MESSAGES.PED62, 'PED62');
  }

  try {
    const { data, error } = await supabase.rpc(name, {
      p_unit_id: unitId,
      p_voucher_code: normalizedCode,
    });
    if (error) throw error;
    const parsed = voucherResultSchema.safeParse(data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    throw staffVoucherError(error);
  }
}

export function getLoyaltyVoucherStaff(
  unitId: string,
  voucherCode: string,
): Promise<StaffVoucherLookup> {
  return voucherRpc('get_loyalty_voucher_staff', unitId, voucherCode);
}

export async function consumeLoyaltyVoucher(
  unitId: string,
  voucherCode: string,
): Promise<StaffVoucher> {
  const result = await voucherRpc('consume_loyalty_voucher', unitId, voucherCode);
  if (!result.found) {
    throw new StaffVoucherError(ERROR_MESSAGES.PED60, 'PED60');
  }
  return result;
}
