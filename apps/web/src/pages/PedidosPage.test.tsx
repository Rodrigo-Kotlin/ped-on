import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AdminProvider } from '../lib/admin/AdminProvider';
import { useAdmin } from '../lib/admin/admin-context';
import type { AdminRole } from '../lib/admin/admin-context';
import type { AdminOrderDetail, AdminOrderSummary } from '../lib/orders/orders';
import { emitSupabaseRealtime, resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { PedidosPage } from './PedidosPage';

const createdAt = '2026-08-10T14:05:00.000Z';

const summary: AdminOrderSummary = {
  id: 'order-1',
  order_number: 42,
  status: 'new',
  payment_status: 'pending',
  service_mode: 'delivery',
  payment_method: 'cash',
  item_count: 2,
  subtotal: '35.00',
  delivery_fee: '5.00',
  total: '40.00',
  estimated_minutes: 35,
  customer_name: 'Maria Cliente',
  created_at: createdAt,
  updated_at: createdAt,
  status_updated_at: createdAt,
  payment_status_updated_at: createdAt,
  completed_at: null,
  cancelled_at: null,
  paid_at: null,
  refunded_at: null,
};

function makeDetail(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    ...summary,
    organization_id: 'org-1',
    unit_id: 'unit-1',
    menu_version_id: 'menu-1',
    menu_version_number: 3,
    tracking_token: 'a'.repeat(32),
    tracking_path: `/pedido/${'a'.repeat(32)}`,
    customer_phone: '11987654321',
    delivery_address: {
      street: 'Rua das Flores',
      number: '123',
      complement: 'Apto 4',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      postal_code: '01001000',
      reference: 'Ao lado da praça',
    },
    cash_change_for: '50.00',
    operation_revision: createdAt,
    notes: 'Sem talheres',
    items: [
      {
        id: 'item-1',
        menu_item_id: 'menu-item-1',
        product_name: 'X-Salada',
        unit_price: '15.00',
        quantity: 2,
        line_total: '30.00',
        note: 'Sem cebola',
        created_at: createdAt,
      },
      {
        id: 'item-2',
        menu_item_id: 'menu-item-2',
        product_name: 'Suco',
        unit_price: '5.00',
        quantity: 1,
        line_total: '5.00',
        note: null,
        created_at: createdAt,
      },
    ],
    events: [
      {
        id: 'event-1',
        event_type: 'created',
        from_value: null,
        to_value: 'new',
        note: null,
        actor_type: 'customer',
        actor_user_id: null,
        created_at: createdAt,
      },
    ],
    ...overrides,
  };
}

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

function configureRpc(role: AdminRole = 'owner', initialDetail = makeDetail()) {
  let detail = initialDetail;
  supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === 'get_my_admin_context') {
      return Promise.resolve({ data: context(role), error: null });
    }
    if (name === 'get_unit_orders_admin') {
      const filtered = args?.p_status === null || args?.p_status === detail.status ? [detail] : [];
      return Promise.resolve({
        data: {
          unit: { id: 'unit-1', name: 'Loja Centro' },
          status_filter: args?.p_status ?? null,
          count: filtered.length,
          orders: filtered,
        },
        error: null,
      });
    }
    if (name === 'get_order_admin') return Promise.resolve({ data: detail, error: null });
    if (name === 'set_order_status') {
      detail = { ...detail, status: args?.p_next_status as AdminOrderDetail['status'] };
      return Promise.resolve({ data: detail, error: null });
    }
    if (name === 'set_order_payment_status') {
      detail = {
        ...detail,
        payment_status: args?.p_payment_status as AdminOrderDetail['payment_status'],
      };
      return Promise.resolve({ data: detail, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function renderOrders(children = <PedidosPage />) {
  return renderWithProviders(<AdminProvider>{children}</AdminProvider>);
}

describe('PedidosPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('lista, destaca novos e filtra no servidor com limite de 100', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();

    expect(await screen.findByText('#42', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Novo pedido')).toBeInTheDocument();
    expect(screen.getByText('Maria Cliente')).toBeInTheDocument();
    expect(screen.getByText('Dinheiro · Pendente')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmados' }));
    expect(await screen.findByText('Nenhum pedido neste filtro.')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_orders_admin', {
      p_unit_id: 'unit-1',
      p_status: 'confirmed',
      p_limit: 100,
    });
  });

  it('abre detalhe autorizado com PII, endereço, itens e aplica transição do servidor', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();

    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    expect(await screen.findByRole('heading', { name: 'Pedido #42' })).toHaveFocus();
    expect(screen.getByRole('link', { name: '(11) 98765-4321' })).toBeInTheDocument();
    expect(screen.getByText(/Rua das Flores, 123, Apto 4/)).toBeInTheDocument();
    expect(screen.getByText(/Referência: Ao lado da praça/)).toBeInTheDocument();
    expect(screen.getByText('Obs.: Sem cebola')).toBeInTheDocument();
    expect(screen.getByText('Observação: Sem talheres')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('button', { name: 'Iniciar preparo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_order_status', {
      p_order_id: 'order-1',
      p_next_status: 'confirmed',
      p_note: null,
    });
  });

  it('registra pago e permite reembolso confirmado para owner', async () => {
    const user = userEvent.setup();
    configureRpc();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderOrders();

    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    await user.click(await screen.findByRole('button', { name: 'Marcar como pago' }));
    const refund = await screen.findByRole('button', { name: 'Registrar reembolso' });
    await user.click(refund);

    expect(window.confirm).toHaveBeenCalledWith(
      'Esta ação apenas registra o reembolso no Ped-On. A devolução do valor deve ser realizada externamente. Deseja continuar?',
    );
    expect(await screen.findByText('Reembolsado')).toBeInTheDocument();
  });

  it('permite que manager registre reembolso', async () => {
    const user = userEvent.setup();
    configureRpc('manager', makeDetail({ payment_status: 'paid' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderOrders();
    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    await user.click(await screen.findByRole('button', { name: 'Registrar reembolso' }));
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_order_payment_status', {
      p_order_id: 'order-1',
      p_payment_status: 'refunded',
    });
  });

  it('operador pode registrar pago, mas não vê o controle de reembolso', async () => {
    const user = userEvent.setup();
    configureRpc('operator');
    renderOrders();

    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    await user.click(await screen.findByRole('button', { name: 'Marcar como pago' }));
    expect(await screen.findByText('Pago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar reembolso' })).not.toBeInTheDocument();
  });

  it('refaz a lista após Realtime sem aplicar o payload recebido', async () => {
    configureRpc();
    renderOrders();
    expect(await screen.findByText('Novo pedido')).toBeInTheDocument();
    const initialCalls = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin',
    ).length;

    emitSupabaseRealtime('UPDATE', { new: { id: 'order-1', status: 'cancelled' } });

    await waitFor(() => {
      expect(
        supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin').length,
      ).toBeGreaterThan(initialCalls);
    });
    expect(screen.getByText('Novo pedido')).toBeInTheDocument();
    expect(screen.queryByText('Cancelado')).not.toBeInTheDocument();
  });

  it('remove dados e canal antigos ao trocar a unidade selecionada', async () => {
    function SwitchHarness() {
      const { selectUnit } = useAdmin();
      return (
        <>
          <button type="button" onClick={() => selectUnit('unit-2')}>
            Trocar unidade
          </button>
          <PedidosPage />
        </>
      );
    }

    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner', true), error: null });
      }
      if (name === 'get_unit_orders_admin') {
        const unitId = args?.p_unit_id as string;
        return Promise.resolve({
          data: {
            unit: { id: unitId, name: unitId === 'unit-1' ? 'Loja Centro' : 'Loja Norte' },
            status_filter: null,
            count: unitId === 'unit-1' ? 1 : 0,
            orders: unitId === 'unit-1' ? [summary] : [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const user = userEvent.setup();
    renderOrders(<SwitchHarness />);
    expect(await screen.findByText('Maria Cliente')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trocar unidade' }));

    expect(await screen.findByText('Loja Norte')).toBeInTheDocument();
    expect(screen.queryByText('Maria Cliente')).not.toBeInTheDocument();
    expect(await screen.findByText('Nenhum pedido neste filtro.')).toBeInTheDocument();
    await waitFor(() => expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1));
    expect(supabaseMock.channel).toHaveBeenCalledWith('unit-orders:unit-2');
  });
});
