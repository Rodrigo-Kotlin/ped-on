import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import { assignUnitToMember, fetchOrgMembers, removeUnitFromMember } from './team';

const members = [
  {
    id: 'm-1',
    full_name: 'Maria Silva',
    email: 'maria@example.com',
    role: 'manager',
    unit_ids: ['unit-1'],
    created_at: '2026-08-01T00:00:00Z',
  },
];

describe('team RPC clients', () => {
  beforeEach(() => resetSupabaseMock());

  it('lista membros da organização com as unidades vinculadas', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: members, error: null });

    const result = await fetchOrgMembers('org-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_org_members_admin', {
      p_organization_id: 'org-1',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('manager');
    expect(result[0]?.unit_ids).toEqual(['unit-1']);
  });

  it('retorna lista vazia quando o banco responde null', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    await expect(fetchOrgMembers('org-1')).resolves.toEqual([]);
  });

  it('vincula uma unidade a um membro', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { assigned: true, already_assigned: false },
      error: null,
    });

    const result = await assignUnitToMember('org-1', 'm-1', 'unit-2');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('assign_unit_to_member', {
      p_organization_id: 'org-1',
      p_user_id: 'm-1',
      p_unit_id: 'unit-2',
    });
    expect(result.assigned).toBe(true);
  });

  it('informa quando o vínculo já existia', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { assigned: false, already_assigned: true },
      error: null,
    });

    const result = await assignUnitToMember('org-1', 'm-1', 'unit-1');

    expect(result.already_assigned).toBe(true);
  });

  it('remove uma unidade de um membro', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { removed: true }, error: null });

    const result = await removeUnitFromMember('org-1', 'm-1', 'unit-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('remove_unit_from_member', {
      p_organization_id: 'org-1',
      p_user_id: 'm-1',
      p_unit_id: 'unit-1',
    });
    expect(result.removed).toBe(true);
  });

  it('lança erro com a mensagem do banco quando uma RPC falha', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED69', message: 'FORBIDDEN' },
    });

    await expect(fetchOrgMembers('org-1')).rejects.toThrow('FORBIDDEN');
    await expect(assignUnitToMember('org-1', 'm-1', 'unit-1')).rejects.toThrow('FORBIDDEN');
    await expect(removeUnitFromMember('org-1', 'm-1', 'unit-1')).rejects.toThrow('FORBIDDEN');
  });
});
