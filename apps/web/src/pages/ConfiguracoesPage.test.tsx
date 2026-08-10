import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { AdminProvider } from '../lib/admin/AdminProvider';
import { ConfiguracoesPage } from './ConfiguracoesPage';

const adminContext = {
  profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
  organization: { id: 'org-1', name: 'Cantina da Praça' },
  role: 'owner',
  units: [{ id: 'unit-1', name: 'Loja Centro', is_active: true }],
};

const operationalConfig = {
  unit_id: 'unit-1',
  timezone: 'America/Sao_Paulo',
  pickup_enabled: true,
  delivery_enabled: false,
  delivery_fee: '5.00',
  min_order_value: '0.00',
  estimated_pickup_minutes: 20,
  estimated_delivery_minutes: null,
  accepting_orders: true,
  business_hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: weekday === 1,
    is_24h: false,
    open_time: weekday === 1 ? '08:00' : null,
    close_time: weekday === 1 ? '18:00' : null,
  })),
  payment_methods: [
    { method: 'cash', is_enabled: true },
    { method: 'pix', is_enabled: false },
    { method: 'credit_card', is_enabled: false },
    { method: 'debit_card', is_enabled: false },
  ],
};

function mockRpcFor(context: unknown, config: unknown) {
  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_my_admin_context') {
      return Promise.resolve({ data: context, error: null });
    }
    if (fn === 'get_unit_operational_config') {
      return Promise.resolve({ data: config, error: null });
    }
    if (fn === 'save_unit_operational_config') {
      return Promise.resolve({ data: config, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function renderConfig() {
  return renderWithProviders(
    <AdminProvider>
      <ConfiguracoesPage />
    </AdminProvider>,
  );
}

describe('ConfiguracoesPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('carrega e exibe a configuração da unidade selecionada', async () => {
    mockRpcFor(adminContext, operationalConfig);

    renderConfig();

    expect(await screen.findByRole('heading', { name: 'Loja Centro' })).toBeInTheDocument();
    expect(screen.getByText('Modalidades de atendimento')).toBeInTheDocument();
    expect(screen.getByLabelText('Retirada no local (pickup)')).toBeChecked();
    expect(screen.getByLabelText('Entrega (delivery)')).not.toBeChecked();
    expect(screen.getByLabelText('Taxa de entrega (R$)')).toHaveValue('5.00');
    expect(screen.getByLabelText('Retirada')).toHaveValue(20);
    expect(screen.getByLabelText('Segunda')).toBeChecked();
    expect(screen.getByLabelText('Terça')).not.toBeChecked();
    expect(screen.getByLabelText('Dinheiro')).toBeChecked();
    expect(screen.getByLabelText('Pix')).not.toBeChecked();
  });

  it('exibe erro de validação quando nenhuma modalidade é selecionada', async () => {
    const user = userEvent.setup();
    mockRpcFor(adminContext, operationalConfig);

    renderConfig();

    await screen.findByRole('heading', { name: 'Loja Centro' });

    await user.click(screen.getByLabelText('Retirada no local (pickup)'));

    await user.click(screen.getByRole('button', { name: 'Salvar configuração' }));

    expect(
      await screen.findByText('Selecione ao menos uma modalidade (retirada ou entrega)'),
    ).toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      'save_unit_operational_config',
      expect.anything(),
    );
  });

  it('salva a configuração editada chamando a RPC', async () => {
    const user = userEvent.setup();
    mockRpcFor(adminContext, operationalConfig);

    renderConfig();

    await screen.findByRole('heading', { name: 'Loja Centro' });

    await user.clear(screen.getByLabelText('Taxa de entrega (R$)'));
    await user.type(screen.getByLabelText('Taxa de entrega (R$)'), '6.50');

    await user.click(screen.getByRole('button', { name: 'Salvar configuração' }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        'save_unit_operational_config',
        expect.objectContaining({ p_unit_id: 'unit-1' }),
      );
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'save_unit_operational_config',
      expect.objectContaining({
        p_config: expect.objectContaining({ delivery_fee: '6.50' }),
      }),
    );
  });
});
