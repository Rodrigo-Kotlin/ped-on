import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AdminProvider } from '../lib/admin/AdminProvider';
import { useAdmin } from '../lib/admin/admin-context';
import type { AdminRole } from '../lib/admin/admin-context';
import { useOperationalOrdersBridge } from '../lib/orders/useOperationalOrdersBridge';
import type {
  AdminOrderDetail,
  AdminOrdersV2Result,
  AdminOrderSummaryV2,
  OrderStatus,
} from '../lib/orders/orders';
import { emitSupabaseRealtime, resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { PedidosPage } from './PedidosPage';

const createdAt = '2026-08-10T14:05:00.000Z';

const summary: AdminOrderSummaryV2 = {
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
  expected_at: '2026-08-10T14:40:00.000Z',
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

interface V2RequestFilters {
  view: 'active' | 'history';
  statuses?: OrderStatus[];
  service_mode?: 'pickup' | 'delivery';
  payment_status?: 'pending' | 'paid' | 'refunded';
  payment_method?: 'cash' | 'pix' | 'credit_card' | 'debit_card';
  order_number?: number;
  date_from?: string;
  date_to?: string;
  limit?: number;
  cursor?: string;
}

function v2Result(
  orders: AdminOrderSummaryV2[],
  options: {
    view?: 'active' | 'history';
    totalCount?: number;
    hasMore?: boolean;
    nextCursor?: string | null;
    filters?: V2RequestFilters;
  } = {},
): AdminOrdersV2Result {
  const view = options.filters?.view ?? options.view ?? 'active';
  const filters = options.filters;
  return {
    unit: { id: 'unit-1', name: 'Loja Centro' },
    view,
    filters: {
      view,
      statuses:
        filters?.statuses ??
        (view === 'active'
          ? ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery']
          : ['completed', 'cancelled']),
      service_mode: filters?.service_mode ?? null,
      payment_status: filters?.payment_status ?? null,
      payment_method: filters?.payment_method ?? null,
      order_number: filters?.order_number ?? null,
      date_from: filters?.date_from ?? null,
      date_to: filters?.date_to ?? null,
      limit: filters?.limit ?? 50,
    },
    snapshot_at: view === 'active' ? createdAt : null,
    total_count: options.totalCount ?? orders.length,
    orders,
    page_info: {
      has_more: options.hasMore ?? false,
      next_cursor: options.nextCursor ?? null,
    },
  };
}

function summaryFromDetail(
  detail: AdminOrderDetail,
  expectedAt: string | null,
): AdminOrderSummaryV2 {
  return {
    id: detail.id,
    order_number: detail.order_number,
    status: detail.status,
    payment_status: detail.payment_status,
    service_mode: detail.service_mode,
    payment_method: detail.payment_method,
    item_count: detail.item_count,
    subtotal: detail.subtotal,
    delivery_fee: detail.delivery_fee,
    total: detail.total,
    estimated_minutes: detail.estimated_minutes,
    expected_at: expectedAt,
    customer_name: detail.customer_name,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    status_updated_at: detail.status_updated_at,
    payment_status_updated_at: detail.payment_status_updated_at,
    completed_at: detail.completed_at,
    cancelled_at: detail.cancelled_at,
    paid_at: detail.paid_at,
    refunded_at: detail.refunded_at,
  };
}

function makeDetail(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  const { expected_at: _expectedAt, ...v1Summary } = summary;
  void _expectedAt;
  return {
    ...v1Summary,
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
        options: [
          {
            id: 'item-option-1',
            group_id: 'group-1',
            group_name: 'Tamanho',
            group_kind: 'variation',
            option_id: 'option-1',
            option_name: 'Duplo',
            price_delta: '5.00',
          },
          {
            id: 'item-option-2',
            group_id: 'group-2',
            group_name: 'Adicionais',
            group_kind: 'addon',
            option_id: 'option-2',
            option_name: 'Bacon',
            price_delta: '4.00',
          },
          {
            id: 'item-option-3',
            group_id: 'group-3',
            group_name: 'Sem',
            group_kind: 'removal',
            option_id: 'option-3',
            option_name: 'Sem cebola',
            price_delta: '0.00',
          },
        ],
      },
      {
        id: 'item-2',
        menu_item_id: 'menu-item-2',
        product_name: 'Suco',
        unit_price: '5.00',
        quantity: 1,
        line_total: '5.00',
        note: null,
        options: [],
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

function configureRpc(
  role: AdminRole = 'owner',
  initialDetail = makeDetail(),
  initialExpectedAt: string | null = summary.expected_at,
) {
  let detail = initialDetail;
  const expectedAt = initialExpectedAt;
  supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === 'get_my_admin_context') {
      return Promise.resolve({ data: context(role), error: null });
    }
    if (name === 'get_unit_orders_admin_v2') {
      const filters = args?.p_filters as V2RequestFilters;
      const active = !['completed', 'cancelled'].includes(detail.status);
      const viewMatches = filters.view === 'active' ? active : !active;
      const filtered =
        viewMatches &&
        (filters.statuses === undefined || filters.statuses.includes(detail.status)) &&
        (filters.service_mode === undefined || filters.service_mode === detail.service_mode) &&
        (filters.payment_status === undefined ||
          filters.payment_status === detail.payment_status) &&
        (filters.payment_method === undefined ||
          filters.payment_method === detail.payment_method) &&
        (filters.order_number === undefined || filters.order_number === detail.order_number)
          ? [summaryFromDetail(detail, expectedAt)]
          : [];
      return Promise.resolve({
        data: v2Result(filtered, { filters }),
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

function OperationalBridge({ children }: { children: ReactNode }) {
  const { selectedUnit } = useAdmin();
  useOperationalOrdersBridge(selectedUnit?.id ?? null);
  return <>{children}</>;
}

function renderOrdersOperational(children = <PedidosPage />) {
  return renderWithProviders(
    <AdminProvider>
      <OperationalBridge>{children}</OperationalBridge>
    </AdminProvider>,
  );
}

describe('PedidosPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('abre em Ativos, destaca novos e aplica status no servidor sem RPC a cada clique', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();

    expect(await screen.findByText('#42', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Novo pedido')).toBeInTheDocument();
    expect(screen.getAllByText('Maria Cliente')).not.toHaveLength(0);
    expect(screen.getByText('Dinheiro · Pendente')).toBeInTheDocument();

    const callsBeforeDraft = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin_v2',
    ).length;
    await user.click(screen.getByRole('checkbox', { name: 'Confirmado' }));
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin_v2').length,
    ).toBe(callsBeforeDraft);
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByText('Nenhum pedido ativo.')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_orders_admin_v2', {
      p_unit_id: 'unit-1',
      p_filters: { view: 'active', statuses: ['confirmed'], limit: 50 },
    });
  });

  it('alterna Active/History imediatamente e descarta status incompatível', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    expect(await screen.findByRole('button', { name: 'Ativos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('checkbox', { name: 'Novo' }));

    await user.click(screen.getByRole('button', { name: 'Histórico' }));

    expect(screen.queryByRole('checkbox', { name: 'Novo' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Concluído' })).not.toBeChecked();
    expect(
      await screen.findByText('Nenhum pedido no histórico para estes filtros.'),
    ).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_orders_admin_v2', {
      p_unit_id: 'unit-1',
      p_filters: { view: 'history', limit: 50 },
    });
  });

  it('aplica e limpa filtros server-side completos com datas ISO', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Maria Cliente');

    await user.click(screen.getByRole('checkbox', { name: 'Novo' }));
    await user.selectOptions(screen.getByLabelText('Modalidade'), 'delivery');
    await user.selectOptions(screen.getByLabelText('Pagamento'), 'pending');
    await user.selectOptions(screen.getByLabelText('Forma de pagamento'), 'cash');
    await user.type(screen.getByLabelText('Número do pedido'), '42');
    await user.type(screen.getByLabelText('Data inicial'), '2026-08-10T10:00');
    await user.type(screen.getByLabelText('Data final'), '2026-08-10T18:00');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_orders_admin_v2', {
      p_unit_id: 'unit-1',
      p_filters: {
        view: 'active',
        limit: 50,
        statuses: ['new'],
        service_mode: 'delivery',
        payment_status: 'pending',
        payment_method: 'cash',
        order_number: 42,
        date_from: new Date(2026, 7, 10, 10, 0).toISOString(),
        date_to: new Date(2026, 7, 10, 18, 0).toISOString(),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByLabelText('Número do pedido')).toHaveValue('');
    expect(screen.getByLabelText('Modalidade')).toHaveValue('');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_orders_admin_v2', {
      p_unit_id: 'unit-1',
      p_filters: { view: 'active', limit: 50 },
    });
  });

  it('mantém pedidos, filtros, cursor e snapshot somente no cache em memória', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Maria Cliente');
    const storageBefore = { ...window.localStorage };

    await user.selectOptions(screen.getByLabelText('Pagamento'), 'pending');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await screen.findByText('Maria Cliente');

    expect({ ...window.localStorage }).toEqual(storageBefore);
    expect(JSON.stringify(window.localStorage)).not.toMatch(
      /Maria Cliente|snapshot_at|next_cursor|payment_status|40\.00/,
    );
  });

  it('bloqueia número e intervalo de datas inválidos sem chamar a RPC', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Maria Cliente');
    const callsBefore = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin_v2',
    ).length;

    await user.type(screen.getByLabelText('Número do pedido'), '0');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.getByRole('alert')).toHaveTextContent('maior que zero');
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin_v2'),
    ).toHaveLength(callsBefore);

    await user.clear(screen.getByLabelText('Número do pedido'));
    await user.type(screen.getByLabelText('Data inicial'), '2026-08-11T12:00');
    await user.type(screen.getByLabelText('Data final'), '2026-08-10T12:00');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.getByRole('alert')).toHaveTextContent('data inicial');
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin_v2'),
    ).toHaveLength(callsBefore);
  });

  it('carrega 50 + 20 por cursor, preserva ordem server-side e não soma total_count', async () => {
    const page1 = Array.from({ length: 50 }, (_, index) => ({
      ...summary,
      id: `page1-${index}`,
      order_number: 200 - index,
      customer_name: `Ordem servidor A${String(index).padStart(2, '0')}`,
    }));
    const page2 = Array.from({ length: 20 }, (_, index) => ({
      ...summary,
      id: `page2-${index}`,
      order_number: 100 - index,
      customer_name: `Ordem servidor B${String(index).padStart(2, '0')}`,
    }));
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_unit_orders_admin_v2') {
        const filters = args?.p_filters as { cursor?: string };
        return Promise.resolve({
          data:
            filters.cursor === 'abc'
              ? v2Result(page2, { totalCount: 83 })
              : v2Result(page1, { totalCount: 83, hasMore: true, nextCursor: 'abc' }),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const user = userEvent.setup();
    renderOrders();

    expect(await screen.findByText('83 pedidos encontrados · 50 exibidos')).toBeInTheDocument();
    const firstPageNames = screen
      .getAllByRole('button', { name: /Abrir pedido/ })
      .map((button) => button.getAttribute('aria-label'));
    expect(firstPageNames[0]).toContain('Ordem servidor A00');
    expect(firstPageNames[1]).toContain('Ordem servidor A01');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('83 pedidos encontrados · 70 exibidos')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Abrir pedido/ })).toHaveLength(70);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
    const v2Calls = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin_v2',
    );
    expect(v2Calls[0]?.[1]).toEqual({
      p_unit_id: 'unit-1',
      p_filters: { view: 'active', limit: 50 },
    });
    expect(v2Calls[1]?.[1]).toEqual({
      p_unit_id: 'unit-1',
      p_filters: { view: 'active', limit: 50, cursor: 'abc' },
    });
  });

  it('exibe PED79 amigável sem detalhes internos', async () => {
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_unit_orders_admin_v2') {
        return Promise.resolve({
          data: null,
          error: { code: 'P0001', message: 'PED79 INVALID_ORDER_FILTER raw SQL' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderOrders();
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise os filtros');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/PED79|SQL/);
  });

  it('distingue erro de rede com mensagem sanitizada', async () => {
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_unit_orders_admin_v2') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch internal-host' } });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderOrders();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível atualizar os pedidos. Verifique sua conexão e tente novamente.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('internal-host');
  });

  it('mostra idade, estágio, expected_at e atraso sem reordenar ou atrasar terminais', async () => {
    const now = Date.now();
    const overdueOrder: AdminOrderSummaryV2 = {
      ...summary,
      created_at: new Date(now - 10 * 60_000).toISOString(),
      status_updated_at: new Date(now - 5 * 60_000).toISOString(),
      expected_at: new Date(now - 2 * 60_000).toISOString(),
    };
    configureRpc(
      'owner',
      makeDetail({
        created_at: overdueOrder.created_at,
        status_updated_at: overdueOrder.status_updated_at,
      }),
      overdueOrder.expected_at,
    );
    renderOrders();

    expect(await screen.findByText('Recebido há 10 min')).toBeInTheDocument();
    expect(screen.getByText('No status há 5 min')).toBeInTheDocument();
    expect(screen.getByText('Atrasado há 2 min')).toBeInTheDocument();
    expect(screen.getByText('Atrasado', { exact: true })).toBeInTheDocument();
  });

  it('mostra prazo futuro do servidor e não inventa ETA quando expected_at é null', async () => {
    const now = Date.now();
    const future = {
      ...summary,
      id: 'future-order',
      order_number: 43,
      customer_name: 'Pedido no prazo',
      expected_at: new Date(now + 10 * 60_000).toISOString(),
    };
    const withoutEta = {
      ...summary,
      id: 'without-eta',
      order_number: 44,
      customer_name: 'Pedido sem prazo',
      expected_at: null,
    };
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_unit_orders_admin_v2') {
        return Promise.resolve({ data: v2Result([future, withoutEta]), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderOrders();

    const futureCard = await screen.findByRole('button', { name: /Abrir pedido 43/ });
    const noEtaCard = screen.getByRole('button', { name: /Abrir pedido 44/ });
    expect(within(futureCard).getByText(/Previsto/)).toHaveTextContent('Restam 10 min');
    expect(within(futureCard).queryByText(/Atrasado/)).not.toBeInTheDocument();
    expect(within(noEtaCard).queryByText(/Previsto|Restam|Atrasado/)).not.toBeInTheDocument();
  });

  it('não cria prazo artificial e usa timestamp final no histórico', async () => {
    const user = userEvent.setup();
    const completedAt = new Date().toISOString();
    configureRpc(
      'owner',
      makeDetail({
        status: 'completed',
        completed_at: completedAt,
      }),
      null,
    );
    renderOrders();
    await user.click(await screen.findByRole('button', { name: 'Histórico' }));

    expect(
      await screen.findByText(
        `Concluído às ${new Intl.DateTimeFormat('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(completedAt))}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Atrasado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Previsto/)).not.toBeInTheDocument();
  });

  it('fecha detalhe ao aplicar filtros e restaura foco ao fechar manualmente quando o card existe', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    const card = await screen.findByRole('button', { name: /Abrir pedido 42/ });
    await user.click(card);
    await user.click(screen.getByRole('button', { name: 'Fechar pedido 42' }));
    await waitFor(() => expect(card).toHaveFocus());

    await user.click(card);
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.queryByRole('heading', { name: 'Pedido #42' })).not.toBeInTheDocument();
  });

  it('abre detalhe autorizado com PII, endereço, itens e aplica transição do servidor', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();

    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    const detail = screen.getByRole('region', { name: 'Pedido #42' });
    expect(await screen.findByRole('heading', { name: 'Pedido #42' })).toHaveFocus();
    expect(screen.getByRole('link', { name: '(11) 98765-4321' })).toBeInTheDocument();
    expect(screen.getByText(/Rua das Flores, 123, Apto 4/)).toBeInTheDocument();
    expect(screen.getByText(/Referência: Ao lado da praça/)).toBeInTheDocument();
    expect(screen.getByText('Obs.: Sem cebola')).toBeInTheDocument();
    expect(screen.getByText('Tamanho: Duplo')).toBeInTheDocument();
    expect(screen.getByText('+ Bacon')).toBeInTheDocument();
    expect(screen.getByText('Sem cebola', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('R$ 15,00 cada')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/item-option-1|group-1|option-1/);
    expect(screen.getByText('Observação: Sem talheres')).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Confirmar' }));
    expect(await within(detail).findByRole('button', { name: 'Iniciar preparo' })).toBeVisible();
    expect(within(detail).queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_order_status', {
      p_order_id: 'order-1',
      p_next_status: 'confirmed',
      p_note: null,
    });
  });

  it('preserva transições delivery, conclusão e cancelamento no detalhe', async () => {
    const user = userEvent.setup();
    configureRpc('owner', makeDetail({ status: 'ready', service_mode: 'delivery' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderOrders();
    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    const detail = screen.getByRole('region', { name: 'Pedido #42' });

    await user.click(within(detail).getByRole('button', { name: 'Saiu para entrega' }));
    expect(await screen.findByRole('heading', { name: 'Status: Saiu para entrega' })).toBeVisible();
    await user.click(within(detail).getByRole('button', { name: 'Concluir entrega' }));
    expect(await screen.findByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
  });

  it('mantém cancelamento confirmado e mutações fail-closed enquanto offline', async () => {
    const user = userEvent.setup();
    configureRpc();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    renderOrders();
    const card = await screen.findByRole('button', { name: /Abrir pedido 42/ });
    const callsBefore = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin_v2',
    ).length;
    online.mockReturnValue(false);

    await user.selectOptions(screen.getByLabelText('Modalidade'), 'delivery');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.getByText(/pedidos carregados continuam visíveis/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir pedido 42/ })).toBeInTheDocument();
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin_v2'),
    ).toHaveLength(callsBefore);

    await user.click(card);
    const detail = screen.getByRole('region', { name: 'Pedido #42' });

    await user.click(within(detail).getByRole('button', { name: 'Confirmar' }));
    expect(
      (await screen.findAllByRole('alert')).some((alert) =>
        /offline/i.test(alert.textContent ?? ''),
      ),
    ).toBe(true);
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(0);
    expect(screen.getAllByText('Maria Cliente')).not.toHaveLength(0);

    online.mockReturnValue(true);
    await user.click(within(detail).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('heading', { name: 'Status: Cancelado' })).toBeVisible();
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
    expect(await screen.findByText('Reembolsado', { selector: 'dd' })).toBeInTheDocument();
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
    expect(await screen.findByText('Pago', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar reembolso' })).not.toBeInTheDocument();
  });

  it('refaz a lista após Realtime sem aplicar o payload recebido', async () => {
    configureRpc();
    renderOrdersOperational();
    expect(await screen.findByText('Novo pedido')).toBeInTheDocument();
    const initialCalls = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin_v2',
    ).length;

    emitSupabaseRealtime('UPDATE', { new: { id: 'order-1', status: 'cancelled' } });

    await waitFor(() => {
      expect(
        supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin_v2').length,
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
      if (name === 'get_unit_orders_admin_v2') {
        const unitId = args?.p_unit_id as string;
        const filters = args?.p_filters as { view: 'active' | 'history' };
        const result = v2Result(unitId === 'unit-1' ? [summary] : [], {
          view: filters.view,
        });
        return Promise.resolve({
          data: {
            ...result,
            unit: { id: unitId, name: unitId === 'unit-1' ? 'Loja Centro' : 'Loja Norte' },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const user = userEvent.setup();
    renderOrdersOperational(<SwitchHarness />);
    expect(await screen.findByText('Maria Cliente')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trocar unidade' }));

    expect(await screen.findByText('Loja Norte')).toBeInTheDocument();
    expect(screen.queryByText('Maria Cliente')).not.toBeInTheDocument();
    expect(await screen.findByText('Nenhum pedido ativo.')).toBeInTheDocument();
    await waitFor(() => expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1));
    expect(supabaseMock.channel).toHaveBeenCalledWith('unit-orders:unit-2');
  });

  it('confirma pedido pela ação rápida do card sem abrir o detalhe', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('button', { name: 'Iniciar preparo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pedido #42' })).not.toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_order_status', {
      p_order_id: 'order-1',
      p_next_status: 'confirmed',
      p_note: null,
    });
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(1);
  });

  it('exibe Atualizando…, desabilita e bloqueia clique duplo na ação rápida', async () => {
    const user = userEvent.setup();
    let resolveStatus!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    let nextDetail = makeDetail();
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_unit_orders_admin_v2') {
        const filters = args?.p_filters as V2RequestFilters;
        const active = !['completed', 'cancelled'].includes(nextDetail.status);
        const filtered =
          (filters.view === 'active' ? active : !active) &&
          (filters.statuses === undefined || filters.statuses.includes(nextDetail.status))
            ? [summaryFromDetail(nextDetail, summary.expected_at)]
            : [];
        return Promise.resolve({ data: v2Result(filtered, { filters }), error: null });
      }
      if (name === 'get_order_admin') return Promise.resolve({ data: nextDetail, error: null });
      if (name === 'set_order_status') {
        nextDetail = {
          ...nextDetail,
          status: args?.p_next_status as AdminOrderDetail['status'],
        };
        return gate;
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderOrders();
    await screen.findByText('Novo pedido');

    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    await user.click(confirmButton);

    const card = screen.getByRole('article');
    const updating = await within(card).findByRole('button', { name: 'Atualizando…' });
    expect(updating).toBeDisabled();
    await user.click(updating);

    resolveStatus({ data: nextDetail, error: null });
    expect(await screen.findByRole('button', { name: 'Iniciar preparo' })).toBeInTheDocument();
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(1);
  });

  it('mostra PED47 amigável na ação rápida e refaz a lista sem repetir a mutação', async () => {
    const user = userEvent.setup();
    configureRpc();
    const original = supabaseMock.rpc.getMockImplementation()!;
    const initialListCalls = supabaseMock.rpc.mock.calls.filter(
      ([name]) => name === 'get_unit_orders_admin_v2',
    ).length;
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'set_order_status') {
        return Promise.resolve({ data: null, error: { code: 'P0001', message: 'PED47 CONFLICT' } });
      }
      return original(name, args);
    });
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este pedido foi atualizado por outra operação. Recarregue os dados e tente novamente.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(/PED47|SQL/);
    await waitFor(() => {
      expect(
        supabaseMock.rpc.mock.calls.filter(([name]) => name === 'get_unit_orders_admin_v2').length,
      ).toBeGreaterThan(initialListCalls);
    });
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(1);
  });

  it('mantém erro de rede amigável na ação rápida do card', async () => {
    const user = userEvent.setup();
    configureRpc();
    const original = supabaseMock.rpc.getMockImplementation()!;
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'set_order_status') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return original(name, args);
    });
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível atualizar os pedidos. Verifique sua conexão e tente novamente.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
  });

  it('marca pago pela ação rápida do card e remove o botão ao pagar', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Marcar pago' }));
    await waitFor(() => expect(screen.getByText('Dinheiro · Pago')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Marcar pago' })).not.toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_order_payment_status', {
      p_order_id: 'order-1',
      p_payment_status: 'paid',
    });
  });

  it('não oferece pagamento rápido para pedidos reembolsados', async () => {
    configureRpc('owner', makeDetail({ payment_status: 'refunded' }), null);
    renderOrders();
    await screen.findByText('Novo pedido');
    expect(screen.queryByRole('button', { name: 'Marcar pago' })).not.toBeInTheDocument();
  });

  it('não chama RPC de pagamento quando offline e mostra alerta no card', async () => {
    const user = userEvent.setup();
    configureRpc();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Marcar pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_payment_status'),
    ).toHaveLength(0);
  });

  it('mostra PED48 amigável ao marcar pago pela ação rápida', async () => {
    const user = userEvent.setup();
    configureRpc();
    const original = supabaseMock.rpc.getMockImplementation()!;
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'set_order_payment_status') {
        return Promise.resolve({
          data: null,
          error: { code: 'P0001', message: 'PED48 CONFLICT' },
        });
      }
      return original(name, args);
    });
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Marcar pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O pagamento foi atualizado por outra operação. Recarregue os dados e tente novamente.',
    );
  });

  it('cancela pelo card somente com confirmação explícita e remove o pedido da lista ativa', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirmSpy).toHaveBeenCalledWith(
      'Cancelar o pedido #42? Esta ação não pode ser desfeita.',
    );
    expect(await screen.findByText('Nenhum pedido ativo.')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_order_status', {
      p_order_id: 'order-1',
      p_next_status: 'cancelled',
      p_note: null,
    });
  });

  it('mantém o pedido ativo ao recusar o cancelamento', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText('Novo pedido')).toBeInTheDocument();
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(0);
  });

  it('não oferece cancelamento para pedidos terminais no histórico', async () => {
    const user = userEvent.setup();
    configureRpc('owner', makeDetail({ status: 'completed', completed_at: createdAt }), null);
    renderOrders();
    await user.click(await screen.findByRole('button', { name: 'Histórico' }));
    await screen.findByText(/Concluído às/);

    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });

  it('aplica filtro de status e move o pedido ao confirmar pela ação rápida', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('checkbox', { name: 'Novo' }));
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByText('Maria Cliente')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Nenhum pedido ativo.')).toBeInTheDocument();
  });

  it('não expõe telefone ou endereço nos cards', async () => {
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    expect(screen.getByText('Maria Cliente')).toBeInTheDocument();
    expect(screen.queryByText('(11) 98765-4321')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rua das Flores/)).not.toBeInTheDocument();
  });

  it('mantém foco na nova ação primária após confirmar pelo card', async () => {
    const user = userEvent.setup();
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar preparo' })).toHaveFocus();
    });
  });

  it('restaura o foco para o título da lista ao cancelar o último pedido', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    configureRpc();
    renderOrders();
    await screen.findByText('Novo pedido');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Nenhum pedido ativo.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pedidos' })).toHaveFocus());
  });

  it('deriva marcos e durações da Operação no detalhe a partir dos eventos', async () => {
    const user = userEvent.setup();
    const events = [
      { id: 'e1', event_type: 'created', from_value: null, to_value: 'new' },
      { id: 'e2', event_type: 'status_changed', from_value: 'new', to_value: 'confirmed' },
      { id: 'e3', event_type: 'status_changed', from_value: 'confirmed', to_value: 'preparing' },
      { id: 'e4', event_type: 'status_changed', from_value: 'preparing', to_value: 'ready' },
      {
        id: 'e5',
        event_type: 'status_changed',
        from_value: 'ready',
        to_value: 'out_for_delivery',
      },
      {
        id: 'e6',
        event_type: 'status_changed',
        from_value: 'out_for_delivery',
        to_value: 'completed',
      },
    ] as const;
    const timelineEvents = events.map((event, index) => ({
      ...event,
      note: null,
      actor_type: 'customer' as const,
      actor_user_id: null,
      created_at: new Date(Date.parse(createdAt) + index * 5 * 60_000).toISOString(),
    }));
    configureRpc(
      'owner',
      makeDetail({
        status: 'completed',
        service_mode: 'delivery',
        completed_at: timelineEvents[5]!.created_at,
        events: timelineEvents,
      }),
      null,
    );
    renderOrders();
    await user.click(await screen.findByRole('button', { name: 'Histórico' }));
    await user.click(await screen.findByRole('button', { name: /Abrir pedido 42/ }));
    const detail = screen.getByRole('region', { name: 'Pedido #42' });
    const operacao = screen.getByRole('region', { name: 'Operação' });
    const timeline = screen.getByRole('region', { name: 'Linha do tempo' });

    expect(within(detail).getByText('Operação')).toBeInTheDocument();
    expect(within(operacao).getByText('Recebido')).toBeInTheDocument();
    expect(within(operacao).getByText('Aceitação')).toBeInTheDocument();
    expect(within(operacao).getByText('Preparo')).toBeInTheDocument();
    expect(within(operacao).getByText('Entrega')).toBeInTheDocument();
    expect(within(operacao).getByText('Ciclo total')).toBeInTheDocument();
    expect(within(operacao).getAllByText('5 min').length).toBeGreaterThan(0);
    expect(within(operacao).getAllByText('25 min').length).toBeGreaterThan(0);
    expect(within(timeline).getByText('Status: Novo → Confirmado')).toBeInTheDocument();
    expect(within(timeline).getByText('Status: Saiu para entrega → Concluído')).toBeInTheDocument();
  });
});
