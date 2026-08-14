import { renderWithProviders } from '@pedon/test-utils';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AppShell } from '../components/AppShell';
import { AdminContext } from '../lib/admin/admin-context';
import type { AdminContextValue, AdminRole, AdminUnit } from '../lib/admin/admin-context';
import { AuthContext } from '../lib/auth/auth-context';
import type { AuthContextValue } from '../lib/auth/auth-context';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { CriticalOperationProvider, useCriticalOperation } from '../lib/pwa/critical-operation';
import { VouchersPage } from './VouchersPage';

const unitOne = { id: 'unit-1', name: 'Loja Centro', is_active: true };
const unitTwo = { id: 'unit-2', name: 'Loja Bairro', is_active: true };
const issuedVoucher = {
  found: true,
  code: 'ABCD-EF12-3456-7890',
  status: 'issued',
  reward_name: 'Pizza grande',
  points_cost: '500',
  issued_at: '2026-08-11T13:00:00Z',
  consumed_at: null,
};

const authValue = {
  authStatus: 'signed-in',
  user: { id: 'user-1', email: 'staff@example.com' },
  session: null,
  profile: null,
  profileLoading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  completeOnboarding: vi.fn(),
  refreshProfile: vi.fn(),
} as unknown as AuthContextValue;

function adminValue(
  role: AdminRole | null = 'operator',
  selectedUnit: AdminUnit | null = unitOne,
  units: AdminUnit[] = selectedUnit === null ? [] : [unitOne],
): AdminContextValue {
  return {
    adminStatus: 'ready',
    error: null,
    profile: { id: 'user-1', full_name: 'Equipe', email: 'staff@example.com' },
    organization: { id: 'org-1', name: 'Cantina' },
    role,
    units,
    selectedUnit,
    canManageUnit: role === 'owner' || role === 'manager',
    selectUnit: vi.fn(),
    refresh: vi.fn(),
  };
}

function PageContext({
  children,
  value = adminValue(),
}: {
  children: ReactNode;
  value?: AdminContextValue;
}) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

function ShellHarness({ role }: { role: AdminRole }) {
  const units = [unitOne, unitTwo];
  const [selectedUnit, setSelectedUnit] = useState<AdminUnit>(unitOne);
  const value = adminValue(role, selectedUnit, units);
  value.selectUnit = (unitId) => {
    const nextUnit = units.find((unit) => unit.id === unitId);
    if (nextUnit) setSelectedUnit(nextUnit);
  };

  return (
    <AuthContext.Provider value={authValue}>
      <AdminContext.Provider value={value}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="vouchers" element={<VouchersPage />} />
          </Route>
        </Routes>
      </AdminContext.Provider>
    </AuthContext.Provider>
  );
}

function renderPage(value = adminValue()) {
  return renderWithProviders(
    <CriticalOperationProvider>
      <CriticalOperationProbe />
      <PageContext value={value}>
        <VouchersPage />
      </PageContext>
    </CriticalOperationProvider>,
  );
}

function CriticalOperationProbe() {
  const { activeOperations } = useCriticalOperation();
  return <span aria-label="Operações críticas">{activeOperations}</span>;
}

describe('VouchersPage', () => {
  beforeEach(() => resetSupabaseMock());

  it.each(['owner', 'manager', 'operator'] as const)(
    'exibe a rota no shell para %s e usa a unidade selecionada',
    async (role) => {
      renderWithProviders(<ShellHarness role={role} />, { initialEntries: ['/app/vouchers'] });

      expect(screen.getByRole('link', { name: 'Vouchers' })).toHaveAttribute(
        'href',
        '/app/vouchers',
      );
      expect(screen.getByRole('heading', { name: 'Vouchers' })).toBeInTheDocument();
      expect(screen.getByText('Validação e entrega em Loja Centro.')).toBeInTheDocument();
    },
  );

  it('oculta a navegação de vouchers sem papel administrativo', () => {
    const value = adminValue(null, null, []);
    renderWithProviders(
      <AuthContext.Provider value={authValue}>
        <AdminContext.Provider value={value}>
          <Routes>
            <Route path="/app" element={<AppShell />} />
          </Routes>
        </AdminContext.Provider>
      </AuthContext.Provider>,
      { initialEntries: ['/app'] },
    );

    expect(screen.queryByRole('link', { name: 'Vouchers' })).not.toBeInTheDocument();
  });

  it('mostra estado vazio sem unidade autorizada', () => {
    renderPage(adminValue('operator', null, []));
    expect(screen.getByRole('heading', { name: 'Nenhuma unidade disponível' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument();
  });

  it('consulta por mutação, exibe apenas dados operacionais e não coloca o código na URL', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({
      data: { ...issuedVoucher, customer_name: 'Maria', membership_id: 'secret-id' },
      error: null,
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), 'abcd ef12 3456 7890');
    expect(screen.getByLabelText('Código do voucher')).toHaveValue('ABCD-EF12-3456-7890');
    await user.click(screen.getByRole('button', { name: 'Validar' }));

    expect(await screen.findByRole('heading', { name: 'Pizza grande' })).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('ABCD-EF12-3456-7890')).toBeInTheDocument();
    expect(screen.getByText('Disponível')).toBeInTheDocument();
    expect(screen.queryByText('Maria')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-id')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_loyalty_voucher_staff', {
      p_unit_id: 'unit-1',
      p_voucher_code: 'ABCDEF1234567890',
    });
  });

  it('associa erro de voucher ao campo inválido', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText('Código do voucher');
    await user.type(input, 'invalido');
    await user.click(screen.getByRole('button', { name: 'Validar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('id', 'voucher-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'voucher-code-help voucher-error');
  });

  it('confirma a entrega em diálogo e apresenta o sucesso consumido', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === 'consume_loyalty_voucher'
            ? { ...issuedVoucher, status: 'consumed' }
            : issuedVoucher,
        error: null,
      }),
    );
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));

    const dialog = screen.getByRole('dialog', {
      name: 'Confirmar entrega da recompensa Pizza grande?',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar entrega' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Voucher utilizado com sucesso.');
    expect(screen.getByRole('status')).toHaveFocus();
    expect(screen.getByText('Utilizado')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar entrega' })).not.toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('consume_loyalty_voucher', {
      p_unit_id: 'unit-1',
      p_voucher_code: 'ABCDEF1234567890',
    });
  });

  it('informa voucher já consumido na consulta e não oferece segunda confirmação', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({
      data: { ...issuedVoucher, status: 'consumed' },
      error: null,
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));

    expect(await screen.findByText('Este voucher já foi utilizado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar entrega' })).not.toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('consume_loyalty_voucher', expect.anything());
  });

  it('trata PED61 durante consumo como já utilizado sem nova confirmação', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'consume_loyalty_voucher'
        ? Promise.resolve({ data: null, error: { code: 'PED61', message: 'DB' } })
        : Promise.resolve({ data: issuedVoucher, error: null }),
    );
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    expect(await screen.findByText('Este voucher já foi utilizado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar entrega' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('0');
  });

  it('recupera resposta perdida do consumo por lookup seguro', async () => {
    const user = userEvent.setup();
    let lookupCount = 0;
    let resolveRecovery!: (value: { data: typeof issuedVoucher; error: null }) => void;
    const recovery = new Promise<{ data: typeof issuedVoucher; error: null }>((resolve) => {
      resolveRecovery = resolve;
    });
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'consume_loyalty_voucher') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      lookupCount += 1;
      if (lookupCount === 1) return Promise.resolve({ data: issuedVoucher, error: null });
      return recovery;
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    await waitFor(() => expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1'));
    await act(async () =>
      resolveRecovery({ data: { ...issuedVoucher, status: 'consumed' }, error: null }),
    );
    expect(await screen.findByText('Voucher utilizado com sucesso.')).toBeInTheDocument();
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('0');
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(3);
  });

  it('libera a janela crítica após consumo conclusivo', async () => {
    const user = userEvent.setup();
    let resolveConsume!: (value: { data: typeof issuedVoucher; error: null }) => void;
    const consumePromise = new Promise<{ data: typeof issuedVoucher; error: null }>((resolve) => {
      resolveConsume = resolve;
    });
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'consume_loyalty_voucher'
        ? consumePromise
        : Promise.resolve({ data: issuedVoucher, error: null }),
    );
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    await waitFor(() => expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1'));
    await act(async () =>
      resolveConsume({ data: { ...issuedVoucher, status: 'consumed' }, error: null }),
    );
    expect(await screen.findByText('Voucher utilizado com sucesso.')).toBeInTheDocument();
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('0');
  });

  it('libera a janela quando a verificação conclui que o voucher não foi consumido e permite nova tentativa', async () => {
    const user = userEvent.setup();
    let consumeCount = 0;
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'consume_loyalty_voucher') {
        consumeCount += 1;
        if (consumeCount === 1) {
          return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
        }
        return Promise.resolve({ data: { ...issuedVoucher, status: 'consumed' }, error: null });
      }
      return Promise.resolve({ data: issuedVoucher, error: null });
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    expect(
      await screen.findByText('O consumo não foi confirmado. Tente novamente.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Confirmar entrega' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Voucher utilizado com sucesso.');
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('0');
  });

  it('mantém a janela crítica quando a verificação falha por rede', async () => {
    const user = userEvent.setup();
    let lookupCount = 0;
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'consume_loyalty_voucher') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      lookupCount += 1;
      if (lookupCount === 1) return Promise.resolve({ data: issuedVoucher, error: null });
      return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    const dialog = await screen.findByRole('alertdialog', { name: 'Verificação pendente' });
    expect(dialog).toHaveTextContent('Não foi possível confirmar se o voucher foi utilizado.');
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Verificar novamente' })).toBeInTheDocument();
    expect(screen.queryByText('Voucher utilizado com sucesso.')).not.toBeInTheDocument();
  });

  it('mantém a janela crítica quando a verificação não encontra o voucher', async () => {
    const user = userEvent.setup();
    let lookupCount = 0;
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'consume_loyalty_voucher') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      lookupCount += 1;
      if (lookupCount === 1) return Promise.resolve({ data: issuedVoucher, error: null });
      return Promise.resolve({ data: { found: false }, error: null });
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    expect(
      await screen.findByRole('alertdialog', { name: 'Verificação pendente' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1');
  });

  it('mantém a janela crítica após nova verificação inconclusiva', async () => {
    const user = userEvent.setup();
    let lookupCount = 0;
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'consume_loyalty_voucher') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      lookupCount += 1;
      if (lookupCount === 1) return Promise.resolve({ data: issuedVoucher, error: null });
      return Promise.resolve({ data: { found: false }, error: null });
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    const dialog = await screen.findByRole('alertdialog', { name: 'Verificação pendente' });
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1');

    await user.click(within(dialog).getByRole('button', { name: 'Verificar novamente' }));
    await waitFor(() => expect(supabaseMock.rpc).toHaveBeenCalledTimes(4));
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1');
    expect(screen.getByRole('alertdialog', { name: 'Verificação pendente' })).toBeInTheDocument();
  });

  it('resolve a janela crítica quando nova verificação encontra o consumo', async () => {
    const user = userEvent.setup();
    let lookupCount = 0;
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'consume_loyalty_voucher') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      lookupCount += 1;
      if (lookupCount === 1) return Promise.resolve({ data: issuedVoucher, error: null });
      if (lookupCount === 2) return Promise.resolve({ data: { found: false }, error: null });
      return Promise.resolve({ data: { ...issuedVoucher, status: 'consumed' }, error: null });
    });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar entrega' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar entrega' }),
    );

    const dialog = await screen.findByRole('alertdialog', { name: 'Verificação pendente' });
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('1');

    await user.click(within(dialog).getByRole('button', { name: 'Verificar novamente' }));

    expect(await screen.findByText('Voucher utilizado com sucesso.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Operações críticas')).toHaveTextContent('0');
  });

  it('fecha o diálogo com Escape e devolve o foco ao botão de entrega', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({ data: issuedVoucher, error: null });
    renderPage();

    await user.type(screen.getByLabelText('Código do voucher'), issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    const deliveryButton = await screen.findByRole('button', { name: 'Confirmar entrega' });
    await user.click(deliveryButton);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(deliveryButton).toHaveFocus());
  });

  it('remonta o conteúdo ao trocar unidade e limpa código e resultado anteriores', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({ data: issuedVoucher, error: null });
    renderWithProviders(<ShellHarness role="operator" />, { initialEntries: ['/app/vouchers'] });

    const input = screen.getByLabelText('Código do voucher');
    await user.type(input, issuedVoucher.code);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(await screen.findByRole('heading', { name: 'Pizza grande' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Selecionar unidade'), 'unit-2');

    expect(screen.getByText('Validação e entrega em Loja Bairro.')).toBeInTheDocument();
    expect(screen.getByLabelText('Código do voucher')).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Pizza grande' })).not.toBeInTheDocument();
  });
});
