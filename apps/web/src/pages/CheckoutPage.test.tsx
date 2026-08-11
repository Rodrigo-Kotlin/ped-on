import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { CartProvider } from '../lib/cart/CartProvider';
import { cartStorageKey } from '../lib/cart/cart';
import { pendingOrderStorageKey } from '../lib/orders/pending-order';
import type { PublicMenuData } from '../lib/menu/menu';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { CheckoutPage } from './CheckoutPage';

const menu: PublicMenuData = {
  found: true,
  organization: { name: 'Cantina' },
  unit: { name: 'Centro', is_active: true },
  loyalty: { enabled: false },
  menu: { version_id: 'version-1', version_number: 1, published_at: '2026-08-10T12:00:00Z' },
  operation: {
    configured: true,
    accepting_orders: true,
    revision: '2026-08-10T12:00:00.000000Z',
    open_now: true,
    can_order_now: true,
    pickup_enabled: true,
    delivery_enabled: true,
    delivery_fee: '6.50',
    minimum_order_amount: '20.00',
    estimated_pickup_minutes: 20,
    estimated_delivery_minutes: 40,
    payment_methods: [
      { method: 'cash', is_enabled: true },
      { method: 'pix', is_enabled: true },
      { method: 'credit_card', is_enabled: false },
      { method: 'debit_card', is_enabled: false },
    ],
    business_hours: [],
  },
  categories: [],
};

const TEST_TRACKING_TOKEN = 'a'.repeat(32);

const success = {
  order_number: 42,
  tracking_token: TEST_TRACKING_TOKEN,
  tracking_path: `/pedido/${TEST_TRACKING_TOKEN}`,
  service_mode: 'pickup',
  payment_method: 'pix',
  subtotal: '29.90',
  delivery_fee: '0.00',
  total: '29.90',
  estimated_minutes: 20,
  created_at: '2026-08-10T12:00:00Z',
};

function seedCart() {
  window.localStorage.setItem(
    cartStorageKey('abc'),
    JSON.stringify({
      slug: 'abc',
      menuVersionId: 'version-1',
      items: [
        {
          menu_item_id: 'item-1',
          name: 'X-Salada',
          unit_price: '29.90',
          quantity: 1,
          note: 'Sem cebola',
        },
      ],
    }),
  );
}

function renderCheckout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/menu/abc/checkout']}>
          <CartProvider publicSlug="abc">
            <Routes>
              <Route path="/menu/:publicSlug/checkout" element={children} />
              <Route path="/pedido/:trackingToken" element={<p>Tracking aberto</p>} />
            </Routes>
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<CheckoutPage />, { wrapper: Wrapper });
}

async function fillCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Nome'), 'Maria Silva');
  await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
}

function rpcCalls(name: string) {
  return supabaseMock.rpc.mock.calls.filter(([rpcName]) => rpcName === name);
}

describe('CheckoutPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
    window.localStorage.clear();
    seedCart();
    vi.restoreAllMocks();
  });

  it('envia pickup com payload estrito e só limpa/navega após RPC confirmada', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'get_public_menu' ? { data: menu, error: null } : { data: success, error: null },
      ),
    );
    renderCheckout();
    await fillCustomer(user);
    expect(screen.queryByLabelText('Cartão de crédito')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Pix' }));
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Tracking aberto')).toBeInTheDocument();
    const args = rpcCalls('create_public_order_v2')[0]![1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_public_slug: 'abc' });
    expect(args.p_attempt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_payload).toEqual({
      menu_version_id: 'version-1',
      operation_revision: menu.operation.revision,
      service_mode: 'pickup',
      payment_method: 'pix',
      customer: { name: 'Maria Silva', phone: '(11) 99999-9999' },
      items: [{ menu_item_id: 'item-1', quantity: 1, note: 'Sem cebola' }],
    });
    expect(JSON.stringify(args.p_payload)).not.toMatch(
      /unit_price|price|total|organization|unit_id|name":"X-Salada/,
    );
    expect(window.localStorage.getItem(cartStorageKey('abc'))).toBeNull();
    expect(window.localStorage.getItem(pendingOrderStorageKey('abc'))).toBeNull();
  });

  it('envia endereço, taxa, dinheiro e troco somente no fluxo delivery/cash', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'get_public_menu'
          ? { data: menu, error: null }
          : { data: { ...success, service_mode: 'delivery', payment_method: 'cash' }, error: null },
      ),
    );
    renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('radio', { name: 'Entrega' }));
    expect(screen.getByText('R$ 6,50')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rua'), 'Rua das Flores');
    await user.type(screen.getByLabelText('Número'), '10');
    await user.type(screen.getByLabelText('Bairro'), 'Centro');
    await user.type(screen.getByLabelText('Cidade'), 'São Paulo');
    await user.type(screen.getByLabelText('UF'), 'sp');
    await user.click(screen.getByRole('radio', { name: 'Dinheiro' }));
    await user.type(screen.getByLabelText('Troco para quanto? (opcional)'), '50,00');
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    await screen.findByText('Tracking aberto');
    const payload = (
      rpcCalls('create_public_order_v2')[0]![1] as { p_payload: Record<string, unknown> }
    ).p_payload;
    expect(payload).toMatchObject({
      service_mode: 'delivery',
      payment_method: 'cash',
      cash_change_for: '50.00',
      delivery_address: {
        street: 'Rua das Flores',
        number: '10',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
      },
    });
  });

  it('reusa chave no retry de rede e cria nova chave após edição do formulário', async () => {
    const user = userEvent.setup();
    const randomUUID = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    supabaseMock.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'get_public_menu'
          ? { data: menu, error: null }
          : { data: null, error: { code: '', message: 'Failed to fetch' } },
      ),
    );
    renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique sua conexão');
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(rpcCalls('create_public_order_v2')).toHaveLength(2));

    const firstKey = (rpcCalls('create_public_order_v2')[0]![1] as { p_idempotency_key: string })
      .p_idempotency_key;
    const secondKey = (rpcCalls('create_public_order_v2')[1]![1] as { p_idempotency_key: string })
      .p_idempotency_key;
    expect(secondKey).toBe(firstKey);
    await user.type(screen.getByLabelText('Nome'), ' Souza');
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(rpcCalls('create_public_order_v2')).toHaveLength(3));
    expect(
      (rpcCalls('create_public_order_v2')[2]![1] as { p_idempotency_key: string })
        .p_idempotency_key,
    ).not.toBe(firstKey);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(cartStorageKey('abc'))).not.toBeNull();
  });

  it('recupera após resposta perdida no remount e limpa carrinho e tentativa pendente', async () => {
    const user = userEvent.setup();
    let orderAccepted = false;
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_public_menu') return Promise.resolve({ data: menu, error: null });
      if (name === 'create_public_order_v2') {
        orderAccepted = true;
        return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } });
      }
      if (name === 'get_public_order_by_attempt') {
        return Promise.resolve({
          data: orderAccepted ? { found: true, ...success } : { found: false },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const firstView = renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique sua conexão');

    const stored = window.localStorage.getItem(pendingOrderStorageKey('abc'))!;
    const firstKey = (JSON.parse(stored) as { idempotency_key: string }).idempotency_key;
    expect(stored).not.toMatch(/Maria|99999|Sem cebola|loyalty|token|payload/i);
    firstView.unmount();

    renderCheckout();
    expect(await screen.findByText('Tracking aberto')).toBeInTheDocument();
    expect(window.localStorage.getItem(cartStorageKey('abc'))).toBeNull();
    expect(window.localStorage.getItem(pendingOrderStorageKey('abc'))).toBeNull();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_order_by_attempt', {
      p_public_slug: 'abc',
      p_idempotency_key: firstKey,
      p_attempt_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('reusa a tentativa pendente no remount quando o pedido ainda não existe', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_public_menu') return Promise.resolve({ data: menu, error: null });
      if (name === 'get_public_order_by_attempt') {
        return Promise.resolve({ data: { found: false }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } });
    });

    const firstView = renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await screen.findByRole('alert');
    const firstKey = (rpcCalls('create_public_order_v2')[0]![1] as { p_idempotency_key: string })
      .p_idempotency_key;
    firstView.unmount();

    renderCheckout();
    await fillCustomer(user);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(rpcCalls('create_public_order_v2')).toHaveLength(2));

    expect(
      (rpcCalls('create_public_order_v2')[1]![1] as { p_idempotency_key: string })
        .p_idempotency_key,
    ).toBe(firstKey);
  });

  it.each([
    ['PED36', 'atualizou as condições do pedido'],
    ['PED38', 'itens não estão disponíveis'],
  ])('refaz o menu e mantém o carrinho no erro %s', async (code, message) => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'get_public_menu'
          ? { data: menu, error: null }
          : { data: null, error: { code, message: 'DB_ERROR' } },
      ),
    );
    renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    await waitFor(() => expect(rpcCalls('get_public_menu').length).toBeGreaterThanOrEqual(2));
    expect(window.localStorage.getItem(cartStorageKey('abc'))).not.toBeNull();
  });

  it('trata PED35 como stale com ação explícita e PED41 como mínimo não atingido', async () => {
    const user = userEvent.setup();
    let code = 'PED35';
    supabaseMock.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'get_public_menu'
          ? { data: menu, error: null }
          : { data: null, error: { code, message: 'DB_ERROR' } },
      ),
    );
    const view = renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(
      await screen.findByRole('button', { name: 'Limpar e refazer carrinho' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(cartStorageKey('abc'))).not.toBeNull();

    view.unmount();
    code = 'PED41';
    renderCheckout();
    await fillCustomer(user);
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valor mínimo');
    expect(screen.getByRole('alert')).toHaveTextContent('Mínimo: R$ 20,00');
  });

  describe('Clube Ped-On no checkout', () => {
    const loyaltyMenu: PublicMenuData = { ...menu, loyalty: { enabled: true } };

    const foundPayload = {
      found: true,
      membership_id: '99999999-9999-4999-8999-999999999999',
      customer: { name: 'Maria Silva', cpf_last2: '25' },
      account: { points_balance: 120, recovery_points: 0 },
      token: {
        access_token: 'a'.repeat(64),
        expires_at: '2026-08-11T14:00:00.000Z',
      },
    };

    function edgeResponse(status: number, body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    function mockRpcWithLoyalty() {
      supabaseMock.rpc.mockImplementation((name: string) =>
        Promise.resolve(
          name === 'get_public_menu'
            ? { data: loyaltyMenu, error: null }
            : { data: success, error: null },
        ),
      );
    }

    function clubSection() {
      const heading = screen.getByRole('heading', { name: 'Clube Ped-On' });
      const section = heading.closest('section');
      if (section === null) throw new Error('Clube Ped-On section não encontrada');
      return section;
    }

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('oculta o Clube quando o programa está desativado', async () => {
      supabaseMock.rpc.mockImplementation((name: string) =>
        Promise.resolve(
          name === 'get_public_menu' ? { data: menu, error: null } : { data: success, error: null },
        ),
      );
      renderCheckout();

      await screen.findByLabelText('Nome');
      expect(screen.queryByRole('heading', { name: 'Clube Ped-On' })).not.toBeInTheDocument();
    });

    it('vincula o CPF e inclui o token do Clube no pedido', async () => {
      const user = userEvent.setup();
      mockRpcWithLoyalty();
      vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
      renderCheckout();
      await fillCustomer(user);

      await user.click(screen.getByRole('button', { name: 'Quero ganhar pontos' }));
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.click(screen.getByRole('button', { name: 'Vincular CPF' }));

      expect(
        await screen.findByText(/Maria Silva · \*\*\*\.\*\*\*\.\*\*\*-25/),
      ).toBeInTheDocument();
      expect(screen.getByText(/Vinculado:/)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Acumular pontos nesta compra' })).toBeChecked();

      await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
      expect(await screen.findByText('Tracking aberto')).toBeInTheDocument();
      const payload = (
        rpcCalls('create_public_order_v2')[0]![1] as { p_payload: Record<string, unknown> }
      ).p_payload;
      expect(payload.loyalty_token).toBe('a'.repeat(64));
      const identityBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)) as Record<
        string,
        unknown
      >;
      expect(identityBody.phone).toBe('(11) 99999-9999');
    });

    it('oferece cadastro quando o CPF não tem cadastro e inclui o token no pedido', async () => {
      const user = userEvent.setup();
      mockRpcWithLoyalty();
      vi.mocked(fetch)
        .mockResolvedValueOnce(edgeResponse(200, { found: false }))
        .mockResolvedValueOnce(edgeResponse(200, foundPayload));
      renderCheckout();
      await fillCustomer(user);

      await user.click(screen.getByRole('button', { name: 'Quero ganhar pontos' }));
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.click(screen.getByRole('button', { name: 'Vincular CPF' }));

      expect(
        await screen.findByText(/Não foi possível confirmar um cadastro com os dados informados/),
      ).toBeInTheDocument();

      await user.type(within(clubSection()).getByLabelText('Nome'), 'Maria Silva');
      await user.click(
        within(clubSection()).getByRole('checkbox', { name: /Aceito participar do Clube Ped-On/ }),
      );
      await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }));

      expect(
        await screen.findByText(/Maria Silva · \*\*\*\.\*\*\*\.\*\*\*-25/),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));
      expect(await screen.findByText('Tracking aberto')).toBeInTheDocument();
      const payload = (
        rpcCalls('create_public_order_v2')[0]![1] as { p_payload: Record<string, unknown> }
      ).p_payload;
      expect(payload.loyalty_token).toBe('a'.repeat(64));
      const enrollBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body)) as Record<
        string,
        unknown
      >;
      expect(enrollBody).toMatchObject({ phone: '(11) 99999-9999', consent: true });
    });

    it('exige aceitar os termos antes de cadastrar', async () => {
      const user = userEvent.setup();
      mockRpcWithLoyalty();
      vi.mocked(fetch).mockResolvedValue(edgeResponse(200, { found: false }));
      renderCheckout();
      await fillCustomer(user);

      await user.click(screen.getByRole('button', { name: 'Quero ganhar pontos' }));
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.click(screen.getByRole('button', { name: 'Vincular CPF' }));

      await screen.findByText(/Não foi possível confirmar um cadastro com os dados informados/);
      await user.type(within(clubSection()).getByLabelText('Nome'), 'Maria Silva');
      await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }));

      expect(
        await screen.findByText('É necessário aceitar os termos para entrar no Clube.'),
      ).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('mostra erro amigável quando a consulta de CPF falha por rede', async () => {
      const user = userEvent.setup();
      mockRpcWithLoyalty();
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
      renderCheckout();
      await fillCustomer(user);

      await user.click(screen.getByRole('button', { name: 'Quero ganhar pontos' }));
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.click(screen.getByRole('button', { name: 'Vincular CPF' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível conectar ao Clube Ped-On',
      );
    });

    it('valida o telefone principal antes de consultar o Clube', async () => {
      const user = userEvent.setup();
      mockRpcWithLoyalty();
      renderCheckout();

      await screen.findByLabelText('Nome');
      await user.click(screen.getByRole('button', { name: 'Quero ganhar pontos' }));
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.click(screen.getByRole('button', { name: 'Vincular CPF' }));

      expect(await screen.findByText('Informe um telefone com DDD')).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('permite desvincular o CPF após vincular', async () => {
      const user = userEvent.setup();
      mockRpcWithLoyalty();
      vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
      renderCheckout();
      await fillCustomer(user);

      await user.click(screen.getByRole('button', { name: 'Quero ganhar pontos' }));
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.click(screen.getByRole('button', { name: 'Vincular CPF' }));

      await screen.findByText(/Vinculado:/);
      await user.click(screen.getByRole('button', { name: 'Desvincular' }));

      expect(screen.getByRole('button', { name: 'Quero ganhar pontos' })).toBeInTheDocument();
    });
  });
});
