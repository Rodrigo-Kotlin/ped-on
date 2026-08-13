import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import { fetchPilotReadiness } from './pilot-readiness';

const readiness = {
  organization_id: 'org-1',
  ready: false,
  blocking_ok: 3,
  blocking_total: 5,
  checked_at: '2026-08-13T10:00:00Z',
  checks: [
    {
      code: 'ORG_NAME',
      label: 'Nome da organização',
      ok: true,
      blocking: true,
      detail: 'Definido.',
    },
    {
      code: 'ACTIVE_UNIT',
      label: 'Unidade ativa',
      ok: false,
      blocking: true,
      detail: 'Nenhuma unidade ativa.',
    },
    {
      code: 'LOYALTY',
      label: 'Fidelidade',
      ok: false,
      blocking: false,
      detail: 'Opcional antes do piloto.',
    },
  ],
  units_summary: [
    {
      unit_id: 'unit-1',
      name: 'Loja Centro',
      is_active: true,
      op_configured: true,
      hours_ok: true,
      payment_ok: true,
      catalog_ok: false,
      menu_published: false,
    },
  ],
};

describe('fetchPilotReadiness', () => {
  beforeEach(() => resetSupabaseMock());

  it('consulta a prontidão derivada com o id da organização', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: readiness, error: null });

    const result = await fetchPilotReadiness('org-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_org_pilot_readiness', {
      p_organization_id: 'org-1',
    });
    expect(result.ready).toBe(false);
    expect(result.blocking_ok).toBe(3);
    expect(result.checks).toHaveLength(3);
  });

  it('lança erro com a mensagem do banco quando a RPC falha', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED69', message: 'FORBIDDEN' },
    });

    await expect(fetchPilotReadiness('org-1')).rejects.toThrow('FORBIDDEN');
  });
});
