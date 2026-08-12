import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import {
  consumeLoyaltyVoucher,
  formatVoucherCodeInput,
  getLoyaltyVoucherStaff,
  normalizeVoucherCode,
  StaffVoucherError,
} from './staff-vouchers';

const issuedVoucher = {
  found: true,
  code: 'ABCD-EF12-3456-7890',
  status: 'issued',
  reward_name: 'Pizza grande',
  points_cost: '500',
  issued_at: '2026-08-11T13:00:00Z',
  consumed_at: null,
  internal_id: 'must-not-leak',
};

describe('staff vouchers client', () => {
  beforeEach(() => resetSupabaseMock());

  it('normaliza o código para exibição e para o parâmetro do backend', async () => {
    expect(formatVoucherCodeInput('abcd ef12-3456 7890')).toBe('ABCD-EF12-3456-7890');
    expect(normalizeVoucherCode('  abcd-ef12 3456-7890 ')).toBe('ABCDEF1234567890');
    supabaseMock.rpc.mockResolvedValue({ data: issuedVoucher, error: null });

    const result = await getLoyaltyVoucherStaff('unit-1', ' abcd-ef12 3456-7890 ');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_loyalty_voucher_staff', {
      p_unit_id: 'unit-1',
      p_voucher_code: 'ABCDEF1234567890',
    });
    expect(result).toEqual({
      found: true,
      code: 'ABCD-EF12-3456-7890',
      status: 'issued',
      reward_name: 'Pizza grande',
      points_cost: '500',
      issued_at: '2026-08-11T13:00:00Z',
      consumed_at: null,
    });
  });

  it('aceita o retorno tenant-safe de voucher desconhecido', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { found: false }, error: null });
    await expect(getLoyaltyVoucherStaff('unit-1', 'F'.repeat(16))).resolves.toEqual({
      found: false,
    });
  });

  it('consome com os mesmos parâmetros normalizados', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { ...issuedVoucher, status: 'consumed', consumed_at: '2026-08-11T14:00:00Z' },
      error: null,
    });

    await expect(consumeLoyaltyVoucher('unit-1', issuedVoucher.code)).resolves.toMatchObject({
      status: 'consumed',
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('consume_loyalty_voucher', {
      p_unit_id: 'unit-1',
      p_voucher_code: 'ABCDEF1234567890',
    });
  });

  it('rejeita código inválido antes da rede', async () => {
    const error = await getLoyaltyVoucherStaff('unit-1', 'invalido').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StaffVoucherError);
    expect((error as StaffVoucherError).code).toBe('PED62');
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['PED10', 'sessão expirou'],
    ['PED11', 'permissão'],
    ['PED60', 'não encontrado'],
    ['PED61', 'já foi utilizado'],
    ['PED62', 'código de voucher válido'],
  ])('mapeia %s para uma mensagem segura', async (code, message) => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code, message: 'DB detail' } });
    const error = await getLoyaltyVoucherStaff('unit-1', 'A'.repeat(16)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StaffVoucherError);
    expect((error as StaffVoucherError).message).toContain(message);
    expect((error as StaffVoucherError).message).not.toContain('DB detail');
  });

  it('marca falhas de rede e contratos inválidos como ambíguos', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { found: true, customer_name: 'PII' },
      error: null,
    });
    const error = await consumeLoyaltyVoucher('unit-1', 'A'.repeat(16)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StaffVoucherError);
    expect((error as StaffVoucherError).ambiguous).toBe(true);
  });
});
