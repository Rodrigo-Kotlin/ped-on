import { renderWithProviders } from '@pedon/test-utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AdminProvider } from '../lib/admin/AdminProvider';
import { useAdmin } from '../lib/admin/admin-context';
import type { AdminRole } from '../lib/admin/admin-context';
import { KDS_ORDER_STATUSES } from '../lib/orders/orders';
import type { KdsOrder } from '../lib/orders/orders';
import { emitSupabaseRealtime, resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { KdsPage } from './KdsPage';

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
    order_number: 81,
    status: 'new',
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
          { group_name: 'Ingredientes', group_kind: 'removal', option_name: 'Cebola' },
        ],
      },
    ],
    ...overrides,
  };
}

function kdsResult(orders: KdsOrder[], options: { truncated?: boolean } = {}) {
  return {
    unit: { id: 'unit-1', name: 'Loja Centro' },
    truncated: options.truncated ?? false,
    orders,
  };
}

function configureKdsRpc(
  role: AdminRole = 'owner',
  initialOrders: KdsOrder[] = [kdsOrder()],
  options: { truncated?: boolean } = {},
) {
  const orders = initialOrders.map((order) => ({ ...order }));
  const calls = { kds: 0, statuses: [] as Array<{ orderId: string; nextStatus: string }> };
  supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === 'get_my_admin_context') {
      return Promise.resolve({ data: context(role), error: null });
    }
    if (name === 'get_kds_orders_minimal') {
      calls.kds += 1;
      return Promise.resolve({
        data: {
          unit: { id: 'unit-1', name: 'Loja Centro' },
          truncated: options.truncated ?? false,
          orders: orders.map((order) => ({ ...order })),
        },
        error: null,
      });
    }
    if (name === 'set_order_status') {
      const order = orders.find((candidate) => candidate.id === args?.p_order_id);
      calls.statuses.push({
        orderId: args?.p_order_id as string,
        nextStatus: args?.p_next_status as string,
      });
      if (order !== undefined) {
        order.status = args?.p_next_status as KdsOrder['status'];
      }
      return Promise.resolve({
        data: { id: order?.id ?? args?.p_order_id, status: order?.status },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return calls;
}

function renderKds(children = <KdsPage />) {
  return renderWithProviders(<AdminProvider>{children}</AdminProvider>);
}

describe('KdsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('renderiza as quatro colunas na ordem do backend com contadores', async () => {
    const orders = [
      kdsOrder({ id: 'o-new', order_number: 81, status: 'new' }),
      kdsOrder({ id: 'o-conf', order_number: 82, status: 'confirmed' }),
      kdsOrder({ id: 'o-prep', order_number: 83, status: 'preparing', service_mode: 'delivery' }),
      kdsOrder({ id: 'o-ready', order_number: 84, status: 'ready' }),
    ];
    configureKdsRpc('owner', orders);
    renderKds();

    expect(await screen.findByRole('heading', { name: 'Cozinha' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: /Novos/ })).toBeInTheDocument();
    expect(screen.getByText('Loja Centro')).toBeInTheDocument();

    const headingTexts = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent?.replace(/\s+/g, ''));
    expect(headingTexts).toEqual(['Novos(1)', 'Confirmados(1)', 'Empreparo(1)', 'Prontos(1)']);

    expect(screen.getByRole('region', { name: /Confirmados/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Em preparo/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Prontos/ })).toBeInTheDocument();
  });

  it('exibe itens, variação, adicionais, retirada e nota sem dinheiro', async () => {
    configureKdsRpc('owner', [kdsOrder()]);
    renderKds();

    const card = within(await screen.findByRole('article', { name: 'Pedido #81' }));
    expect(card.getByText('2x X-Burger')).toBeInTheDocument();
    expect(card.getByText('Tamanho: Grande')).toBeInTheDocument();
    expect(card.getByText('Adicionais: Bacon')).toBeInTheDocument();
    expect(card.getByText('Retirar: Cebola')).toBeInTheDocument();
    expect(card.getByText('Obs.: Sem sal')).toBeInTheDocument();
    expect(card.queryByText(/R\$|\b15\.00\b|\b35\.00\b/)).not.toBeInTheDocument();
  });

  it('mostra tempos operacionais e ETA no card', async () => {
    configureKdsRpc('owner', [kdsOrder()]);
    renderKds();

    const card = within(await screen.findByRole('article', { name: 'Pedido #81' }));
    expect(card.getByText('Recebido há')).toBeInTheDocument();
    expect(card.getByText('No status há')).toBeInTheDocument();
    expect(card.getByText('Previsto')).toBeInTheDocument();
    expect(card.getAllByText(/\d+ min/).length).toBeGreaterThanOrEqual(2);
    expect(card.getByText('Novo')).toBeInTheDocument();
  });

  it('destaca atraso textualmente quando o ETA já passou', async () => {
    const order = kdsOrder({ expected_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    configureKdsRpc('owner', [order]);
    renderKds();
    const card = within(await screen.findByRole('article', { name: 'Pedido #81' }));
    expect(card.getByText('Atrasado', { exact: true })).toBeInTheDocument();
    expect(card.getByText('Atrasado há')).toBeInTheDocument();
  });

  it('marca pronto sem oferecer ação e mostra a bandeira textual', async () => {
    configureKdsRpc('owner', [kdsOrder({ status: 'ready' })]);
    renderKds();

    const card = within(await screen.findByRole('article', { name: 'Pedido #81' }));
    expect(card.getByText('Pronto')).toBeInTheDocument();
    expect(card.queryByRole('button')).not.toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Imprimir' })).toHaveAttribute(
      'href',
      '/app/cozinha/imprimir/order-1',
    );
  });

  it('oferece Imprimir em todos os cards, sem alterar o pedido', async () => {
    const orders = [
      kdsOrder({ id: 'o-new', order_number: 81, status: 'new' }),
      kdsOrder({ id: 'o-conf', order_number: 82, status: 'confirmed' }),
      kdsOrder({ id: 'o-prep', order_number: 83, status: 'preparing' }),
      kdsOrder({ id: 'o-ready', order_number: 84, status: 'ready' }),
    ];
    const calls = configureKdsRpc('owner', orders);
    renderKds();

    const articles = await screen.findAllByRole('article');
    expect(articles).toHaveLength(4);
    for (const article of articles) {
      expect(within(article).getByRole('link', { name: 'Imprimir' })).toBeInTheDocument();
    }
    const printHrefs = screen
      .getAllByRole('link', { name: 'Imprimir' })
      .map((link) => link.getAttribute('href'));
    expect(printHrefs).toEqual([
      '/app/cozinha/imprimir/o-new',
      '/app/cozinha/imprimir/o-conf',
      '/app/cozinha/imprimir/o-prep',
      '/app/cozinha/imprimir/o-ready',
    ]);
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(0);
    expect(calls.statuses).toHaveLength(0);
  });

  it('confirma, inicia preparo e marca pronto movendo o card entre colunas', async () => {
    const user = userEvent.setup();
    configureKdsRpc('owner', [kdsOrder()]);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(
      await within(screen.getByRole('region', { name: /Confirmados/ })).findByRole('article', {
        name: 'Pedido #81',
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Iniciar preparo' }));
    expect(
      await within(screen.getByRole('region', { name: /Em preparo/ })).findByRole('article', {
        name: 'Pedido #81',
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Marcar pronto' }));
    expect(
      await within(screen.getByRole('region', { name: /Prontos/ })).findByRole('article', {
        name: 'Pedido #81',
      }),
    ).toBeInTheDocument();

    expect(
      supabaseMock.rpc.mock.calls
        .filter(([name]) => name === 'set_order_status')
        .map(([, args]) => args),
    ).toEqual([
      { p_order_id: 'order-1', p_next_status: 'confirmed', p_note: null },
      { p_order_id: 'order-1', p_next_status: 'preparing', p_note: null },
      { p_order_id: 'order-1', p_next_status: 'ready', p_note: null },
    ]);
  });

  it('exibe Atualizando…, desabilita e bloqueia clique duplo na ação', async () => {
    const user = userEvent.setup();
    let resolveStatus!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_kds_orders_minimal') {
        return Promise.resolve({ data: kdsResult([kdsOrder()]), error: null });
      }
      if (name === 'set_order_status') {
        void args;
        return gate;
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    const button = screen.getByRole('button', { name: 'Confirmar' });
    await user.click(button);
    expect(await screen.findByRole('button', { name: 'Atualizando…' })).toBeDisabled();

    await user.dblClick(button);
    await user.click(screen.getByRole('button', { name: 'Atualizando…' }));
    expect(
      supabaseMock.rpc.mock.calls.filter(([name]) => name === 'set_order_status'),
    ).toHaveLength(1);

    resolveStatus({ data: null, error: null });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Atualizando…' })).not.toBeInTheDocument();
    });
  });

  it('mostra erro amigável e recarrega sem reexecutar a ação em PED47', async () => {
    const user = userEvent.setup();
    const calls = configureKdsRpc('owner', [kdsOrder()]);
    const original = supabaseMock.rpc.getMockImplementation()!;
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'set_order_status') {
        calls.statuses.push({
          orderId: args?.p_order_id as string,
          nextStatus: args?.p_next_status as string,
        });
        return Promise.resolve({
          data: null,
          error: { code: 'P0001', message: 'PED47 INVALID_ORDER_TRANSITION' },
        });
      }
      return original(name, args);
    });
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });
    const initialKds = calls.kds;

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este pedido foi atualizado por outra operação. Recarregue os dados e tente novamente.',
    );
    expect(calls.statuses).toHaveLength(1);
    await waitFor(() => expect(calls.kds).toBeGreaterThan(initialKds));
    expect(
      within(screen.getByRole('region', { name: /Novos/ })).getByRole('article', {
        name: 'Pedido #81',
      }),
    ).toBeInTheDocument();
  });

  it('converte falha de rede da ação em erro amigável sem reexecutar', async () => {
    const user = userEvent.setup();
    const calls = configureKdsRpc('owner', [kdsOrder()]);
    const original = supabaseMock.rpc.getMockImplementation()!;
    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'set_order_status') {
        calls.statuses.push({
          orderId: args?.p_order_id as string,
          nextStatus: args?.p_next_status as string,
        });
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return original(name, args);
    });
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });
    const initialKds = calls.kds;

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível atualizar os pedidos. Verifique sua conexão e tente novamente.',
    );
    expect(calls.statuses).toHaveLength(1);
    expect(calls.kds).toBe(initialKds);
    expect(
      within(screen.getByRole('region', { name: /Novos/ })).getByRole('article', {
        name: 'Pedido #81',
      }),
    ).toBeInTheDocument();
  });

  it('bloqueia ações offline com a mensagem compartilhada', async () => {
    const user = userEvent.setup();
    const calls = configureKdsRpc();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Você está offline. Operações que exigem conexão estão pausadas.',
    );
    expect(calls.statuses).toHaveLength(0);
  });

  it('mostra o aviso de truncamento acima de 200 pedidos', async () => {
    configureKdsRpc('owner', [kdsOrder()], { truncated: true });
    renderKds();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Há mais de 200 pedidos ativos na cozinha. A tela mostra somente os 200 pedidos priorizados.',
    );
  });

  it('exibe Carregando cozinha… durante a busca', async () => {
    let resolveFetch!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_kds_orders_minimal') {
        return gate;
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderKds();

    expect(await screen.findByRole('status')).toHaveTextContent('Carregando cozinha…');

    resolveFetch({ data: kdsResult([kdsOrder()]), error: null });
    expect(await screen.findByRole('article', { name: 'Pedido #81' })).toBeInTheDocument();
  });

  it('mostra erro amigável quando o fetch KDS falha', async () => {
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_kds_orders_minimal') {
        return Promise.resolve({
          data: null,
          error: { code: 'PED11', message: 'FORBIDDEN' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderKds();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Você não tem permissão para acessar os pedidos desta unidade.',
    );
  });

  it('mostra estado vazio e vazios por coluna', async () => {
    configureKdsRpc('owner', []);
    renderKds();

    expect(await screen.findByText('Nenhum pedido ativo na cozinha.')).toBeInTheDocument();
  });

  it('mostra Nenhum pedido nas colunas vazias', async () => {
    configureKdsRpc('owner', [kdsOrder()]);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    expect(
      within(screen.getByRole('region', { name: /Confirmados/ })).getByText('Nenhum pedido'),
    ).toBeInTheDocument();
  });

  it('refaz o board após Realtime sem aplicar o payload recebido', async () => {
    const calls = configureKdsRpc('owner', [kdsOrder()]);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });
    const initialKds = calls.kds;

    emitSupabaseRealtime('UPDATE', { new: { id: 'order-1', status: 'ready' } });

    await waitFor(() => expect(calls.kds).toBeGreaterThan(initialKds));
    expect(screen.queryByText('Pronto')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: /Novos/ })).getByRole('article', {
        name: 'Pedido #81',
      }),
    ).toBeInTheDocument();
  });

  it('não duplica cards ao receber eventos Realtime repetidos', async () => {
    const calls = configureKdsRpc('owner', [kdsOrder()]);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    emitSupabaseRealtime('INSERT', { new: { id: 'order-1' } });
    emitSupabaseRealtime('UPDATE', { new: { id: 'order-1' } });

    await waitFor(() => expect(calls.kds).toBeGreaterThan(2));
    expect(screen.getAllByRole('article', { name: 'Pedido #81' })).toHaveLength(1);
  });

  it('remove o canal Realtime ao desmontar', async () => {
    configureKdsRpc('owner', [kdsOrder()]);
    const view = renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    view.unmount();
    await waitFor(() => expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1));
  });

  it('troca para outra unidade e reconecta o Realtime na unidade certa', async () => {
    function SwitchHarness() {
      const { selectUnit } = useAdmin();
      return (
        <>
          <button type="button" onClick={() => selectUnit('unit-2')}>
            Trocar unidade
          </button>
          <KdsPage />
        </>
      );
    }

    supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner', true), error: null });
      }
      if (name === 'get_kds_orders_minimal') {
        const unitId = args?.p_unit_id as string;
        const unitOrders =
          unitId === 'unit-1'
            ? [kdsOrder({ id: 'o-1', order_number: 81 })]
            : [kdsOrder({ id: 'o-2', order_number: 90 })];
        return Promise.resolve({
          data: {
            unit: { id: unitId, name: unitId === 'unit-1' ? 'Loja Centro' : 'Loja Norte' },
            truncated: false,
            orders: unitOrders,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const user = userEvent.setup();
    renderKds(<SwitchHarness />);
    expect(await screen.findByText('Loja Centro')).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Pedido #81' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trocar unidade' }));

    expect(await screen.findByText('Loja Norte')).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Pedido #90' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Pedido #81' })).not.toBeInTheDocument();
    await waitFor(() => expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1));
    expect(supabaseMock.channel).toHaveBeenCalledWith('unit-orders:unit-2');
  });

  it.each(['owner', 'manager', 'operator'] as const)(
    '%s acessa o board da cozinha',
    async (role) => {
      configureKdsRpc(role, [kdsOrder()]);
      renderKds();

      expect(await screen.findByRole('heading', { name: 'Cozinha' })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    },
  );

  it('não renderiza cliente, telefone, endereço, pagamento ou dinheiro', async () => {
    const order = kdsOrder() as KdsOrder & Record<string, unknown>;
    order.customer_name = 'Maria Cliente KDS';
    order.customer_phone = '11999998888';
    order.delivery_address = 'Rua Secreta 123';
    order.payment_method = 'cash';
    order.total = '40.00';
    configureKdsRpc('owner', [order]);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    expect(screen.queryByText('Maria Cliente KDS')).not.toBeInTheDocument();
    expect(screen.queryByText('11999998888')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rua Secreta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/40,00|40\.00|R\$ 40/)).not.toBeInTheDocument();
  });

  it('move o foco para o card na nova coluna após a ação', async () => {
    const user = userEvent.setup();
    configureKdsRpc('owner', [kdsOrder()]);
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    const movedCard = await within(screen.getByRole('region', { name: /Confirmados/ })).findByRole(
      'article',
      { name: 'Pedido #81' },
    );
    await waitFor(() => expect(movedCard).toHaveFocus());
  });

  it('foca o heading do board quando o pedido sai do KDS após a ação', async () => {
    const user = userEvent.setup();
    let order = kdsOrder();
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return Promise.resolve({ data: context('owner'), error: null });
      }
      if (name === 'get_kds_orders_minimal') {
        const visibleOrders = KDS_ORDER_STATUSES.includes(order.status) ? [order] : [];
        return Promise.resolve({ data: kdsResult(visibleOrders), error: null });
      }
      if (name === 'set_order_status') {
        order = { ...order, status: 'completed' as KdsOrder['status'] };
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderKds();
    await screen.findByRole('article', { name: 'Pedido #81' });

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    const boardHeading = screen.getByRole('heading', { name: 'Cozinha' });
    await waitFor(() => expect(boardHeading).toHaveFocus());
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
