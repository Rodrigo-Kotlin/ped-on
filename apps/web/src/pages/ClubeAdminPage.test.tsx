import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AdminProvider } from '../lib/admin/AdminProvider';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { ClubeAdminPage } from './ClubeAdminPage';

const adminContext = {
  profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
  organization: { id: 'org-1', name: 'Cantina da Praça' },
  role: 'owner',
  units: [{ id: 'unit-1', name: 'Loja Centro', is_active: true }],
};

const programData = {
  organization_id: 'org-1',
  program: {
    exists: true,
    enabled: true,
    points_per_real: '1.00',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  stats: { members_count: 2, total_earned: 500, total_reversed: 30 },
};

const membersPage = {
  organization_id: 'org-1',
  count: 1,
  has_more: false,
  next_cursor: null,
  members: [
    {
      id: 'm-1',
      cpf_last2: '25',
      name: 'Maria Silva',
      points_balance: 150,
      recovery_points: 0,
      total_earned: 300,
      total_reversed: 50,
      member_since: '2026-08-01T00:00:00Z',
    },
    {
      id: 'm-2',
      cpf_last2: '12',
      name: null,
      points_balance: 10,
      recovery_points: 5,
      total_earned: 20,
      total_reversed: 0,
      member_since: '2026-08-05T00:00:00Z',
    },
  ],
};

function mockRpc(overrides: Record<string, unknown> = {}) {
  let enabled = programData.program.enabled;
  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_my_admin_context') {
      return Promise.resolve({ data: adminContext, error: null });
    }
    if (fn === 'get_loyalty_program_admin') {
      return Promise.resolve({
        data: { ...programData, program: { ...programData.program, enabled } },
        error: null,
      });
    }
    if (fn === 'get_loyalty_members_admin') {
      return Promise.resolve({ data: membersPage, error: null });
    }
    if (fn === 'set_loyalty_program_enabled') {
      enabled = Boolean(overrides.enabled ?? false);
      return Promise.resolve({
        data: {
          organization_id: 'org-1',
          program: { ...programData.program, enabled },
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function renderClubeAdmin() {
  return renderWithProviders(
    <AdminProvider>
      <ClubeAdminPage />
    </AdminProvider>,
  );
}

describe('ClubeAdminPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('exibe o programa, regra, métricas e membros', async () => {
    mockRpc();
    renderClubeAdmin();

    expect(await screen.findByRole('heading', { name: 'Clube Ped-On' })).toBeInTheDocument();
    expect(screen.getByText('Programa ativo')).toBeInTheDocument();
    expect(
      screen.getByText('Regra: 1.00 ponto(s) por R$ 1,00 em compras concluídas.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desativar Clube' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Membros' })).toBeInTheDocument();
    expect(screen.getByText('Pontos acumulados')).toBeInTheDocument();
    expect(screen.getByText('Pontos estornados')).toBeInTheDocument();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('Cliente anônimo')).toBeInTheDocument();
    expect(screen.getAllByText(/desde/)).toHaveLength(2);
    expect(screen.getByText('150 pts')).toBeInTheDocument();
    expect(screen.getByText('2 membros exibidos')).toBeInTheDocument();
  });

  it('avisa que o Clube está desativado e oferece ativação', async () => {
    mockRpc();
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({
          data: { ...programData, program: null },
          error: null,
        });
      }
      if (fn === 'get_loyalty_members_admin') {
        return Promise.resolve({ data: membersPage, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    expect(
      await screen.findByText('O Clube está desativado. Nenhum cliente acumula pontos no momento.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Programa desativado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ativar Clube$/ })).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('desativa o programa após confirmar', async () => {
    const user = userEvent.setup();
    mockRpc();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderClubeAdmin();

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await user.click(screen.getByRole('button', { name: 'Desativar Clube' }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith('set_loyalty_program_enabled', {
        p_organization_id: 'org-1',
        p_enabled: false,
      });
    });
    expect(screen.getByRole('button', { name: 'Ativar Clube' })).toBeInTheDocument();
  });

  it('ativa o programa e preserva as métricas após buscar o contrato completo', async () => {
    const user = userEvent.setup();
    let enabled = false;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({
          data: {
            ...programData,
            program: enabled ? { ...programData.program, enabled: true } : null,
          },
          error: null,
        });
      }
      if (fn === 'get_loyalty_members_admin') {
        return Promise.resolve({ data: membersPage, error: null });
      }
      if (fn === 'set_loyalty_program_enabled') {
        enabled = true;
        return Promise.resolve({
          data: {
            organization_id: 'org-1',
            program: { ...programData.program, enabled: true },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    await user.click(await screen.findByRole('button', { name: 'Ativar Clube' }));

    expect(await screen.findByRole('button', { name: 'Desativar Clube' })).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('não chama a RPC quando o proprietário cancela', async () => {
    const user = userEvent.setup();
    mockRpc();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderClubeAdmin();

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await user.click(screen.getByRole('button', { name: 'Desativar Clube' }));

    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      'set_loyalty_program_enabled',
      expect.anything(),
    );
  });

  it('carrega mais membros com o cursor', async () => {
    const user = userEvent.setup();
    mockRpc();
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({ data: programData, error: null });
      }
      if (fn === 'get_loyalty_members_admin') {
        return Promise.resolve({
          data: {
            organization_id: 'org-1',
            count: 1,
            has_more: true,
            next_cursor: 'cursor-2',
            members: [membersPage.members[0]],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    await screen.findByText('Maria Silva');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith('get_loyalty_members_admin', {
        p_organization_id: 'org-1',
        p_limit: 50,
        p_cursor: 'cursor-2',
      });
    });
  });

  it('deduplica membros repetidos entre páginas', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({ data: programData, error: null });
      }
      if (fn === 'get_loyalty_members_admin') {
        const secondPage = args?.p_cursor === 'cursor-2';
        return Promise.resolve({
          data: secondPage
            ? {
                ...membersPage,
                members: [
                  membersPage.members[0],
                  { ...membersPage.members[1], id: 'm-3', name: 'Ana Souza' },
                ],
              }
            : {
                ...membersPage,
                has_more: true,
                next_cursor: 'cursor-2',
                members: [membersPage.members[0]],
              },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    await screen.findByText('Maria Silva');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getAllByText('Maria Silva')).toHaveLength(1);
    expect(screen.getByText('2 membros exibidos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('mostra PED53 ao falhar ao alterar o programa sem apagar as métricas', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({ data: programData, error: null });
      }
      if (fn === 'get_loyalty_members_admin') {
        return Promise.resolve({ data: membersPage, error: null });
      }
      if (fn === 'set_loyalty_program_enabled') {
        return Promise.resolve({ data: null, error: { code: 'PED53', message: 'DB' } });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    await user.click(await screen.findByRole('button', { name: 'Desativar Clube' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Inconsistência interna do Clube');
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('mostra erro amigável quando só o proprietário pode acessar', async () => {
    mockRpc();
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({ data: null, error: { code: 'PED11', message: 'DB' } });
      }
      if (fn === 'get_loyalty_members_admin') {
        return Promise.resolve({ data: membersPage, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    expect(
      await screen.findByText('Apenas o proprietário da organização pode acessar o Clube.'),
    ).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há membros', async () => {
    mockRpc();
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext, error: null });
      }
      if (fn === 'get_loyalty_program_admin') {
        return Promise.resolve({ data: programData, error: null });
      }
      if (fn === 'get_loyalty_members_admin') {
        return Promise.resolve({
          data: {
            organization_id: 'org-1',
            count: 0,
            has_more: false,
            next_cursor: null,
            members: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClubeAdmin();

    expect(await screen.findByText('Nenhum cliente entrou no Clube ainda.')).toBeInTheDocument();
  });
});
