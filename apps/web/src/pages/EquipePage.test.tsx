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

function mockRpc() {
  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_my_admin_context') return Promise.resolve({ data: adminContext, error: null });
    if (fn === 'get_org_members_admin') return Promise.resolve({ data: members, error: null });
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
    expect(screen.getByText('Gerente')).toBeInTheDocument();
    expect(screen.getByText('Operador')).toBeInTheDocument();
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
});
