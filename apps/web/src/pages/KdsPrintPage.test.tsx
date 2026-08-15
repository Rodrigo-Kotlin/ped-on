import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import kdsPrintCss from '../styles/kds-print.css?raw';
import { AdminProvider } from '../lib/admin/AdminProvider';
import type { AdminRole } from '../lib/admin/admin-context';
import type { KdsOrder } from '../lib/orders/orders';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { KdsPrintPage } from './KdsPrintPage';

const createdAt = '2026-08-10T14:00:00.000Z';

function context(role: AdminRole, twoUnits = false) {
  return {
    profile: { id: 'user-1', full_name: 'Equipe', email: 'equipe@example.com' },
    organization: { id: 'org-1', name: 'Cantina' },
    role,
    units: [
      { id: 'unit-1', name: 'Loja Centro', is_active: true },
      ...(twoUnits ? [{ id: 'unit-2', name: 'Loja Norte', is_active: true }] : []),
    ],
  };
}

function kdsOrder(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: 'order-1',
    order_number: 128,
    status: 'preparing',
    service_mode: 'pickup',
    created_at: createdAt,
    status_updated_at: createdAt,
    estimated_minutes: 20,
    expected_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    items: [
      {
        product_name: 'X-Burger',
        quantity: 2,
        note: 'Sem sal',
        options: [
          { group_name: 'Tamanho', group_kind: 'variation', option_name: 'Grande' },
          { group_name: 'Adicionais', group_kind: 'addon', option_name: 'Bacon' },
          { group_name: 'Adicionais', group_kind: 'addon', option_name: 'Cheddar' },
          { group_name: 'Ingredientes', group_kind: 'removal', option_name: 'Cebola' },
          { group_name: 'Ingredientes', group_kind: 'removal', option_name: 'Tomate' },
        ],
      },
      { product_name: 'Batata Grande', quantity: 1, note: null, options: [] },
    ],
    ...overrides,
  };
}

function kdsResult(orders: KdsOrder[]) {
  return {
    unit: { id: 'unit-1', name: 'Loja Centro' },
    truncated: false,
    orders,
  };
}

function configureKdsRpc(
  role: AdminRole = 'owner',
  ordersByUnit: (unitId: string) => KdsOrder[] = () => [kdsOrder()],
) {
  const calls = { kds: [] as string[] };
  supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === 'get_my_admin_context') {
      return Promise.resolve({ data: context(role, true), error: null });
    }
    if (name === 'get_kds_orders_minimal') {
      const unitId = args?.p_unit_id as string;
      calls.kds.push(unitId);
      return Promise.resolve({ data: kdsResult(ordersByUnit(unitId)), error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return calls;
}

function renderPrint(orderId = 'order-1') {
  return renderWithProviders(
    <AdminProvider>
      <Routes>
        <Route path="/app/cozinha/imprimir/:orderId" element={<KdsPrintPage />} />
      </Routes>
    </AdminProvider>,
    { initialEntries: [`/app/cozinha/imprimir/${orderId}`] },
  );
}

describe('KdsPrintPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('monta a comanda com cabeçalho, modalidade, status, itens, opções e ETA', async () => {
    configureKdsRpc();
    renderPrint();

    const ticket = within(await screen.findByRole('article', { name: 'Comanda do pedido #128' }));
    expect(ticket.getByText('Loja Centro')).toBeInTheDocument();
    expect(ticket.getByText('Comanda da cozinha')).toBeInTheDocument();
    expect(ticket.getByText('Pedido #128')).toBeInTheDocument();
    expect(ticket.getByText('Retirada')).toBeInTheDocument();
    expect(ticket.getByText('Em preparo')).toBeInTheDocument();
    expect(ticket.getByText('Recebido')).toBeInTheDocument();
    expect(ticket.getAllByText(/^\d{2}:\d{2}$/).length).toBeGreaterThanOrEqual(2);
    expect(ticket.getByText('Previsto')).toBeInTheDocument();
    expect(ticket.getByText('2x')).toBeInTheDocument();
    expect(ticket.getByText('X-Burger')).toBeInTheDocument();
    expect(ticket.getByText('Tamanho: Grande')).toBeInTheDocument();
    expect(ticket.getByText('Adicionais: Bacon, Cheddar')).toBeInTheDocument();
    expect(ticket.getByText('RETIRAR: Cebola, Tomate')).toBeInTheDocument();
    expect(ticket.getByText('OBS: Sem sal')).toBeInTheDocument();
    expect(ticket.getByText('Batata Grande')).toBeInTheDocument();
    expect(ticket.getByText(/Impresso em:/)).toBeInTheDocument();
  });

  it.each(['owner', 'manager', 'operator'] as const)(
    '%s acessa a rota de impressão diretamente',
    async (role) => {
      configureKdsRpc(role);
      renderPrint('order-1');

      expect(
        await screen.findByRole('heading', { name: 'Comanda do pedido #128' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voltar para cozinha' })).toHaveAttribute(
        'href',
        '/app/cozinha',
      );
      expect(screen.getByRole('button', { name: 'Imprimir comanda' })).toBeInTheDocument();
    },
  );

  it('não chama window.print no mount e imprime somente ao clicar', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    configureKdsRpc();
    renderPrint();

    await screen.findByRole('article', { name: 'Comanda do pedido #128' });
    expect(printSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Imprimir comanda' }));
    expect(printSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Imprimir comanda' }));
    expect(printSpy).toHaveBeenCalledTimes(2);
  });

  it('mostra estado amigável sem imprimir quando o pedido saiu da fila do KDS', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    configureKdsRpc('owner', () => [kdsOrder({ id: 'order-out', order_number: 200 })]);
    renderPrint('order-1');

    expect(
      await screen.findByText('Este pedido não está mais disponível na fila da cozinha.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para cozinha' })).toHaveAttribute(
      'href',
      '/app/cozinha',
    );
    expect(screen.queryByRole('button', { name: 'Imprimir comanda' })).not.toBeInTheDocument();
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('não busca a unidade do pedido quando selectedUnit não o contém', async () => {
    window.localStorage.setItem('pedon:selectedUnitId', 'unit-2');
    const calls = configureKdsRpc('owner', (unitId) =>
      unitId === 'unit-2' ? [kdsOrder({ id: 'order-90', order_number: 90 })] : [],
    );
    renderPrint('order-1');

    expect(
      await screen.findByText('Este pedido não está mais disponível na fila da cozinha.'),
    ).toBeInTheDocument();
    expect(calls.kds).toEqual(['unit-2']);
    expect(calls.kds).not.toContain('unit-1');
  });

  it('mantém o foco inicial no heading da comanda', async () => {
    configureKdsRpc();
    renderPrint();

    const heading = await screen.findByRole('heading', { name: 'Comanda do pedido #128' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('não renderiza cliente, telefone, endereço, pagamento ou dinheiro', async () => {
    const order = kdsOrder() as KdsOrder & Record<string, unknown>;
    order.customer_name = 'CLIENTE-SECRETO';
    order.customer_phone = '99999999999';
    order.delivery_address = 'RUA-SECRETA';
    order.payment_method = 'cash';
    order.total = '999.99';
    order.cash_change_for = 'R$ 999,99';
    order.loyalty_token = 'TOKEN-SECRETO';
    order.cpf = 'CPF-SECRETO';
    configureKdsRpc('owner', () => [order]);
    renderPrint();

    const ticket = within(await screen.findByRole('article', { name: 'Comanda do pedido #128' }));
    expect(
      ticket.queryByText(/CLIENTE-SECRETO|99999999999|RUA-SECRETA|TOKEN-SECRETO|CPF-SECRETO/),
    ).not.toBeInTheDocument();
    expect(ticket.queryByText(/R\$\s*999,99|999\.99/)).not.toBeInTheDocument();
  });

  it('estilos de impressão são otimizados para 80 mm e monocromáticos', () => {
    expect(kdsPrintCss).toContain('.kds-print-ticket');
    expect(kdsPrintCss).toMatch(/width:\s*72mm/);
    expect(kdsPrintCss).toContain('@media print');
    expect(kdsPrintCss).toMatch(/\.kds-print-screen\s*\{[^}]*display:\s*none\s*!important/);
    expect(kdsPrintCss).toContain('.kds-ticket-note');
    expect(kdsPrintCss).toMatch(/\.kds-ticket-note\s*\{[^}]*border:/);
    expect(kdsPrintCss).toMatch(/\.kds-ticket-note\s*\{[^}]*font-weight:\s*700/);
    expect(kdsPrintCss).toMatch(/\.kds-ticket-removal\s*\{[^}]*font-weight:\s*800/);
    expect(kdsPrintCss).toContain('@page');
    expect(kdsPrintCss).toMatch(/margin:\s*3mm/);
  });
});
