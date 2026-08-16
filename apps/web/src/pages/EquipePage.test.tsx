import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AdminProvider } from '../lib/admin/AdminProvider';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { EquipePage } from './EquipePage';

const adminContext = {
  profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
  organization: { id: 'org-1', name: 'Cantina da Praça' },
  role: 'owner',
  units: [
    { id: 'unit-1', name: 'Loja Centro', is_active: true },
    { id: 'unit-2', name: 'Loja Norte', is_active: false },
  ],
};

const members = [
  {
    id: 'm-1',
    full_name: 'Maria Silva',
    email: 'maria@example.com',
    role: 'manager',
    unit_ids: ['unit-1'],
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'm-2',
    full_name: null,
    email: 'ops@example.com',
    role: 'operator',
    unit_ids: [],
    created_at: '2026-08-02T00:00:00Z',
  },
  {
    id: 'm-3',
    full_name: 'Dono da Loja',
    email: 'dono@example.com',
    role: 'owner',
    unit_ids: [],
    created_at: '2026-08-01T00:00:00Z',
  },
];

const pendingInvites = [
  {
    id: 'inv-1',
    email: 'novo@example.com',
    role: 'manager' as const,
    status: 'pending' as const,
    created_at: '2026-08-10T00:00:00Z',
    expires_at: '2026-08-17T00:00:00Z',
    accepted_at: null,
    revoked_at: null,
  },
];

function mockRpc() {
  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_my_admin_context') return Promise.resolve({ data: adminContext, error: null });
    if (fn === 'get_org_members_admin') return Promise.resolve({ data: members, error: null });
    if (fn === 'get_org_member_invites') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function renderEquipe() {
  return renderWithProviders(
    <AdminProvider>
      <EquipePage />
    </AdminProvider>,
    { initialEntries: ['/app/equipe'] },
  );
}

describe('EquipePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
    setNavigatorOnline(true);
  });

  it('lista membros com papel e unidades vinculadas', async () => {
    mockRpc();
    renderEquipe();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('maria@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Gerente').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Operador').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ops@example.com').length).toBeGreaterThanOrEqual(1);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_org_members_admin', {
      p_organization_id: 'org-1',
    });
  });

  it('proprietário não tem vínculos por unidade', async () => {
    mockRpc();
    renderEquipe();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('Acesso completo a todas as unidades.')).toBeInTheDocument();
    const ownerCard = screen.getByText('Acesso completo a todas as unidades.').closest('li');
    expect(ownerCard).not.toBeNull();
    expect(ownerCard).not.toHaveTextContent('Unidades');
  });

  it('não permite vincular uma unidade inativa', async () => {
    const user = userEvent.setup();
    mockRpc();
    renderEquipe();

    const checkbox = await screen.findByRole('checkbox', {
      name: /Vincular Maria Silva à unidade Loja Norte/,
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();

    await user.click(checkbox);

    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('assign_unit_to_member', expect.anything());
  });

  it('remove o vínculo somente após confirmação', async () => {
    const user = userEvent.setup();
    mockRpc();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEquipe();

    const checkbox = await screen.findByRole('checkbox', {
      name: /Remover acesso de Maria Silva à unidade Loja Centro/,
    });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Maria Silva'));
    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith('remove_unit_from_member', {
        p_organization_id: 'org-1',
        p_user_id: 'm-1',
        p_unit_id: 'unit-1',
      });
    });
  });

  it('não chama a RPC quando a remoção é cancelada', async () => {
    const user = userEvent.setup();
    mockRpc();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderEquipe();

    const checkbox = await screen.findByRole('checkbox', {
      name: /Remover acesso de Maria Silva à unidade Loja Centro/,
    });
    await user.click(checkbox);

    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('remove_unit_from_member', expect.anything());
  });

  it('mostra unidade inativa com selo', async () => {
    mockRpc();
    renderEquipe();

    await screen.findByText('Maria Silva');
    expect(screen.getAllByText('inativa').length).toBeGreaterThanOrEqual(1);
  });

  it('bloqueia operações de equipe quando offline', async () => {
    const user = userEvent.setup();
    mockRpc();
    setNavigatorOnline(false);
    renderEquipe();

    const checkbox = await screen.findByRole('checkbox', {
      name: /Vincular ops@example.com à unidade Loja Centro/,
    });
    await user.click(checkbox);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Você está offline');
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('assign_unit_to_member', expect.anything());
  });

  it('mostra estado vazio sem organização', async () => {
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({
          data: { ...adminContext, organization: null, units: [] },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderEquipe();

    expect(await screen.findByText('Nenhuma organização.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('cria um convite de membro', async () => {
    const user = userEvent.setup();
    mockRpc();
    renderEquipe();

    await user.type(await screen.findByLabelText('E-mail'), 'novo@example.com');
    await user.selectOptions(await screen.findByLabelText('Função'), 'operator');
    await user.click(await screen.findByRole('button', { name: 'Convidar membro' }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith('invite_org_member', {
        p_email: 'novo@example.com',
        p_role: 'operator',
      });
    });
    expect(await screen.findByText('Convite criado para novo@example.com.')).toBeInTheDocument();
  });

  it('valida o e-mail antes de convidar', async () => {
    const user = userEvent.setup();
    mockRpc();
    renderEquipe();

    await user.type(await screen.findByLabelText('E-mail'), 'email-invalido');
    await user.click(await screen.findByRole('button', { name: 'Convidar membro' }));

    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('invite_org_member', expect.anything());
  });

  it('mapeia erro do servidor para mensagem amigável', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context')
        return Promise.resolve({ data: adminContext, error: null });
      if (fn === 'get_org_members_admin') return Promise.resolve({ data: members, error: null });
      if (fn === 'get_org_member_invites') return Promise.resolve({ data: [], error: null });
      if (fn === 'invite_org_member') {
        return Promise.resolve({
          data: null,
          error: { code: 'PED84', message: 'duplicate member' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderEquipe();

    await user.type(await screen.findByLabelText('E-mail'), 'maria@example.com');
    await user.click(await screen.findByRole('button', { name: 'Convidar membro' }));

    expect(
      await screen.findByText('Este e-mail já pertence a um membro da organização.'),
    ).toBeInTheDocument();
  });

  it('lista convites pendentes', async () => {
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context')
        return Promise.resolve({ data: adminContext, error: null });
      if (fn === 'get_org_members_admin') return Promise.resolve({ data: members, error: null });
      if (fn === 'get_org_member_invites') {
        return Promise.resolve({ data: pendingInvites, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderEquipe();

    expect(await screen.findByText('novo@example.com')).toBeInTheDocument();
    expect(screen.getByText(/válido até/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revogar' })).toBeInTheDocument();
  });

  it('revoga um convite pendente após confirmação', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context')
        return Promise.resolve({ data: adminContext, error: null });
      if (fn === 'get_org_members_admin') return Promise.resolve({ data: members, error: null });
      if (fn === 'get_org_member_invites') {
        return Promise.resolve({ data: pendingInvites, error: null });
      }
      if (fn === 'revoke_org_member_invite') {
        return Promise.resolve({ data: { revoked: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderEquipe();

    await user.click(await screen.findByRole('button', { name: 'Revogar' }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith('revoke_org_member_invite', {
        p_invite_id: 'inv-1',
      });
    });
  });
});
