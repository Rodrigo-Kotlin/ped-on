import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import type { PublicMenuData, PublicMenuResult } from '../lib/menu/menu';
import type { PublicRewardsResult } from '../lib/loyalty/public-rewards';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { ClubePage } from './ClubePage';

const foundMenu: PublicMenuData = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro', is_active: true },
  loyalty: { enabled: true },
  menu: { version_id: 'version-1', version_number: 1, published_at: '2026-08-10T12:00:00.000Z' },
  operation: {
    configured: true,
    accepting_orders: true,
    revision: '2026-08-10T12:00:00.000000Z',
    open_now: true,
    can_order_now: true,
    pickup_enabled: true,
    delivery_enabled: false,
    delivery_fee: '0.00',
    minimum_order_amount: '0.00',
    estimated_pickup_minutes: 20,
    estimated_delivery_minutes: null,
    payment_methods: [{ method: 'pix', is_enabled: true }],
    business_hours: [
      { weekday: 0, is_open: false, is_24h: false, open_time: null, close_time: null },
    ],
  },
  categories: [],
};

const foundPayload = {
  found: true,
  membership_id: '99999999-9999-4999-8999-999999999999',
  customer: { name: 'Maria Silva', cpf_last2: '25' },
  account: { points_balance: '120', recovery_points: '0' },
  statement: [],
  token: {
    access_token: 'a'.repeat(64),
    expires_at: '2026-08-11T14:00:00.000Z',
  },
};

const publicReward = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Café grátis',
  description: 'Um café da casa',
  points_cost: '80',
  available: true,
  revision: '2026-08-11T12:00:00.123456Z',
};

function edgeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderClube(
  result: PublicMenuResult,
  initialEntry = '/clube/abc',
  rewardsResult: PublicRewardsResult = { found: true, loyalty_enabled: true, rewards: [] },
  otherRpc?: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: unknown;
  }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  supabaseMock.rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === 'get_public_menu') {
      return Promise.resolve({ data: result, error: null });
    }
    if (fn === 'get_public_loyalty_rewards') {
      return Promise.resolve({ data: rewardsResult, error: null });
    }
    return otherRpc?.(fn, args) ?? Promise.resolve({ data: null, error: null });
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/clube/:publicSlug" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(<ClubePage />, { wrapper: Wrapper });
}

async function openLookup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Consultar meus pontos/ }));
}

describe('ClubePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exibe estado de carregamento enquanto a consulta está pendente', async () => {
    let resolveQuery!: (value: { data: PublicMenuResult; error: null }) => void;
    const pending = new Promise<{ data: PublicMenuResult; error: null }>((resolve) => {
      resolveQuery = resolve;
    });
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_public_menu') {
        return pending;
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderClube(foundMenu);

    expect(await screen.findByRole('status')).toHaveTextContent('Carregando Clube Ped-On…');

    resolveQuery({ data: foundMenu, error: null });
    expect(await screen.findByRole('heading', { name: 'Clube Ped-On' })).toBeInTheDocument();
  });

  it('mostra cardápio não encontrado para slug inválido', async () => {
    renderClube({ found: false });

    expect(
      await screen.findByRole('heading', { name: 'Cardápio não encontrado' }),
    ).toBeInTheDocument();
  });

  it('avisa quando o Clube está indisponível para o estabelecimento', async () => {
    renderClube({ ...foundMenu, loyalty: { enabled: false } });

    expect(
      await screen.findByText(
        'O Clube Ped-On está indisponível para este estabelecimento no momento.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao cardápio' })).toHaveAttribute(
      'href',
      '/menu/abc',
    );
  });

  it('oferece consulta e cadastro quando o Clube está ativo', async () => {
    renderClube(foundMenu);

    expect(await screen.findByRole('heading', { name: 'Clube Ped-On' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Consultar meus pontos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Entrar no Clube/ })).toBeInTheDocument();
  });

  it('mostra o catálogo antes da identificação usando uma chave pública por slug', async () => {
    renderClube(foundMenu, '/clube/abc', {
      found: true,
      loyalty_enabled: true,
      rewards: [publicReward],
    });

    expect(await screen.findByRole('heading', { name: 'Café grátis' })).toBeInTheDocument();
    expect(screen.getByText('80 pontos')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_loyalty_rewards', {
      p_public_slug: 'abc',
    });
  });

  it('pede a consulta e reutiliza o formulário CPF e telefone ao tentar trocar sem conta', async () => {
    const user = userEvent.setup();
    renderClube(foundMenu, '/clube/abc', {
      found: true,
      loyalty_enabled: true,
      rewards: [publicReward],
    });

    await user.click(await screen.findByRole('button', { name: 'Trocar por 80 pontos' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Consulte seus pontos para realizar a troca.',
    );
    expect(screen.getByRole('region', { name: 'Consultar meus pontos' })).toBeInTheDocument();
    expect(screen.getByLabelText('CPF')).toBeInTheDocument();
    expect(screen.getByLabelText('Telefone com DDD')).toBeInTheDocument();
  });

  it('bloqueia todas as recompensas disponíveis enquanto há pontos em recuperação', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, {
        ...foundPayload,
        account: { points_balance: '120', recovery_points: '5' },
      }),
    );
    renderClube(foundMenu, '/clube/abc', {
      found: true,
      loyalty_enabled: true,
      rewards: [
        publicReward,
        {
          ...publicReward,
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Almoço',
          points_cost: '150',
        },
        {
          ...publicReward,
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Brinde',
          available: false,
        },
      ],
    });

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('Em recuperação')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Troca bloqueada durante a recuperação' }),
    ).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Indisponível' })).toBeDisabled();
  });

  it('mostra recompensa suficiente e calcula exatamente os pontos faltantes', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    renderClube(foundMenu, '/clube/abc', {
      found: true,
      loyalty_enabled: true,
      rewards: [
        publicReward,
        {
          ...publicReward,
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Almoço',
          points_cost: '150',
        },
      ],
    });

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('button', { name: 'Trocar por 80 pontos' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Faltam 30 pontos' })).toBeDisabled();
  });

  it('confirma em diálogo acessível, restaura foco e exibe o voucher após o resgate', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    const redemption = {
      found: true,
      redemption: {
        reward_name: 'Café grátis',
        points_cost: '80',
        created_at: '2026-08-11T13:00:00Z',
      },
      voucher: {
        code: 'ABCD-EF12-3456-7890',
        status: 'issued',
        issued_at: '2026-08-11T13:00:00Z',
      },
    };
    renderClube(
      foundMenu,
      '/clube/abc',
      { found: true, loyalty_enabled: true, rewards: [publicReward] },
      (fn) =>
        Promise.resolve(
          fn === 'redeem_public_loyalty_reward'
            ? { data: redemption, error: null }
            : { data: null, error: null },
        ),
    );

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    const swapButton = await screen.findByRole('button', { name: 'Trocar por 80 pontos' });
    await user.click(swapButton);
    const dialog = screen.getByRole('dialog', { name: 'Confirmar troca' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Saldo atual')).toBeInTheDocument();
    expect(within(dialog).getByText('Saldo após troca')).toBeInTheDocument();
    expect(
      within(dialog).getByText('A troca gera um voucher e não pode ser cancelada no Core MVP.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(swapButton).toHaveFocus();

    await user.click(swapButton);
    await user.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    expect(await screen.findByText('Recompensa resgatada!')).toBeInTheDocument();
    expect(screen.getByText('ABCD-EF12-3456-7890')).toBeInTheDocument();
    expect(screen.getByText('Resgate de recompensa')).toBeInTheDocument();
    expect(screen.getByText('-80 pontos')).toBeInTheDocument();
    const redeemCall = supabaseMock.rpc.mock.calls.find(
      (call: unknown[]) => call[0] === 'redeem_public_loyalty_reward',
    );
    expect(redeemCall?.[1]).toMatchObject({
      p_public_slug: 'abc',
      p_reward_id: publicReward.id,
      p_reward_revision: publicReward.revision,
      p_access_token: 'a'.repeat(64),
    });
    expect(redeemCall?.[1]).not.toHaveProperty('p_points_cost');
    expect(String((redeemCall?.[1] as Record<string, unknown>).p_idempotency_key)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(String((redeemCall?.[1] as Record<string, unknown>).p_recovery_secret)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(localStorage.getItem('pedon:pending-redemption:abc')).toBeNull();
    expect(screen.getByRole('button', { name: 'Atualizar saldo' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Consulte novamente para outra troca' }),
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Recompensa resgatada!');
  });

  it('recupera uma troca pendente ao carregar e limpa somente após encontrar o voucher', async () => {
    localStorage.setItem(
      'pedon:pending-redemption:abc',
      JSON.stringify({
        public_slug: 'abc',
        idempotency_key: '22222222-2222-4222-8222-222222222222',
        recovery_secret: 'b'.repeat(64),
        reward_id: publicReward.id,
        created_at: new Date().toISOString(),
      }),
    );
    renderClube(foundMenu, '/clube/abc', undefined, (fn) =>
      Promise.resolve(
        fn === 'get_public_redemption_by_attempt'
          ? {
              data: {
                found: true,
                redemption: {
                  reward_name: 'Café grátis',
                  points_cost: '80',
                  created_at: '2026-08-11T13:00:00Z',
                },
                voucher: {
                  code: 'ABCD-EF12-3456-7890',
                  status: 'issued',
                  issued_at: '2026-08-11T13:00:00Z',
                },
              },
              error: null,
            }
          : { data: null, error: null },
      ),
    );

    expect(
      await screen.findByText('Troca recuperada com sucesso. Seu voucher está pronto.'),
    ).toBeInTheDocument();
    expect(screen.getByText('ABCD-EF12-3456-7890')).toBeInTheDocument();
    expect(localStorage.getItem('pedon:pending-redemption:abc')).toBeNull();
  });

  it.each(['PED33', 'PED51', 'PED53'] as const)(
    'não cria pending recovery para erro determinístico %s',
    async (code) => {
      const user = userEvent.setup();
      vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
      renderClube(
        foundMenu,
        '/clube/abc',
        { found: true, loyalty_enabled: true, rewards: [publicReward] },
        (fn) =>
          Promise.resolve(
            fn === 'redeem_public_loyalty_reward'
              ? { data: null, error: { code, message: 'deterministic' } }
              : { data: null, error: null },
          ),
      );

      await openLookup(user);
      await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
      await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
      await user.click(screen.getByRole('button', { name: 'Consultar' }));
      await user.click(await screen.findByRole('button', { name: 'Trocar por 80 pontos' }));
      await user.click(screen.getByRole('button', { name: 'Confirmar troca' }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(localStorage.getItem('pedon:pending-redemption:abc')).toBeNull();
      expect(screen.getByRole('button', { name: 'Trocar por 80 pontos' })).toBeEnabled();
    },
  );

  it('mantém pending recovery somente para ambiguidade de transporte', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    renderClube(
      foundMenu,
      '/clube/abc',
      { found: true, loyalty_enabled: true, rewards: [publicReward] },
      (fn) =>
        Promise.resolve(
          fn === 'redeem_public_loyalty_reward'
            ? { data: null, error: { message: 'Failed to fetch' } }
            : { data: null, error: null },
        ),
    );

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await user.click(await screen.findByRole('button', { name: 'Trocar por 80 pontos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(localStorage.getItem('pedon:pending-redemption:abc')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Atualizar saldo' })).toBeDisabled();
  });

  it('bloqueia a troca sem RPC quando o storage não garante a persistência verificável', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (String(key).startsWith('pedon:pending-redemption:')) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });
    renderClube(
      foundMenu,
      '/clube/abc',
      { found: true, loyalty_enabled: true, rewards: [publicReward] },
      (fn) =>
        Promise.resolve(
          fn === 'redeem_public_loyalty_reward'
            ? { data: { found: true }, error: null }
            : { data: null, error: null },
        ),
    );

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await user.click(await screen.findByRole('button', { name: 'Trocar por 80 pontos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('armazenamento do site');
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /QuotaExceeded|SecurityError|DOMException|localStorage/,
    );
    expect(
      supabaseMock.rpc.mock.calls.filter(
        (call: unknown[]) => call[0] === 'redeem_public_loyalty_reward',
      ),
    ).toHaveLength(0);
    expect(localStorage.getItem('pedon:pending-redemption:abc')).toBeNull();
    expect(screen.getByRole('button', { name: 'Atualizar saldo' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'Confirmar troca' })).toBeInTheDocument();
    setItem.mockRestore();
  });

  it('bloqueia a troca offline sem criar pending e preserva o token em memória', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderClube(
      foundMenu,
      '/clube/abc',
      { found: true, loyalty_enabled: true, rewards: [publicReward] },
      (fn) =>
        Promise.resolve(
          fn === 'redeem_public_loyalty_reward'
            ? { data: { found: true }, error: null }
            : { data: null, error: null },
        ),
    );

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await user.click(await screen.findByRole('button', { name: 'Trocar por 80 pontos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Você está offline');
    expect(
      supabaseMock.rpc.mock.calls.filter(
        (call: unknown[]) => call[0] === 'redeem_public_loyalty_reward',
      ),
    ).toHaveLength(0);
    expect(localStorage.getItem('pedon:pending-redemption:abc')).toBeNull();
    expect(screen.getByRole('button', { name: 'Atualizar saldo' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'Confirmar troca' })).toBeInTheDocument();
  });

  it('renderiza saldo acima de MAX_SAFE_INTEGER sem perda de precisão', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, {
        ...foundPayload,
        account: { points_balance: '9007199254740993', recovery_points: '0' },
      }),
    );
    renderClube(foundMenu);

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('9.007.199.254.740.993')).toBeInTheDocument();
  });

  it('consulta o CPF e exibe o saldo do cliente', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    renderClube(foundMenu);

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await openLookup(user);

    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('heading', { name: 'Olá, Maria Silva' })).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Cadastro ***.***.***-25')).toBeInTheDocument();

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/functions/v1/loyalty-cpf');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      public_slug: 'abc',
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    });
  });

  it('sugere entrar no Clube quando o CPF não tem cadastro', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, { found: false }));
    renderClube(foundMenu);

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await openLookup(user);

    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(
      await screen.findByText('Não foi possível confirmar um cadastro com os dados informados.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar no Clube agora' })).toBeInTheDocument();
  });

  it('exibe erro amigável quando a consulta falha por rede', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    renderClube(foundMenu);

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await openLookup(user);

    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível conectar ao Clube Ped-On',
    );
  });

  it('exige aceitar os termos para concluir o cadastro', async () => {
    const user = userEvent.setup();
    renderClube(foundMenu);

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await user.click(screen.getByRole('button', { name: /Entrar no Clube/ }));

    const panel = screen.getByRole('region', { name: 'Entrar no Clube' });
    await user.type(within(panel).getByLabelText('CPF'), '529.982.247-25');
    await user.type(within(panel).getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.type(within(panel).getByLabelText('Nome'), 'Maria Silva');
    await user.click(within(panel).getByRole('button', { name: 'Entrar no Clube' }));

    expect(
      await screen.findByText('É necessário aceitar os termos para entrar no Clube.'),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cadastra o cliente e exibe o saldo inicial', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    renderClube(foundMenu);

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await user.click(screen.getByRole('button', { name: /Entrar no Clube/ }));

    const panel = screen.getByRole('region', { name: 'Entrar no Clube' });
    await user.type(within(panel).getByLabelText('CPF'), '529.982.247-25');
    await user.type(within(panel).getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.type(within(panel).getByLabelText('Nome'), 'Maria Silva');
    await user.click(within(panel).getByRole('checkbox'));
    await user.click(within(panel).getByRole('button', { name: 'Entrar no Clube' }));

    expect(await screen.findByRole('heading', { name: 'Olá, Maria Silva' })).toBeInTheDocument();

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/functions/v1/loyalty-cpf');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: 'enroll',
      phone: '(11) 99999-9999',
      name: 'Maria Silva',
      consent: true,
    });
  });

  it('atualiza o saldo ao clicar em atualizar', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    renderClube(foundMenu);
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_public_menu') {
        return Promise.resolve({ data: foundMenu, error: null });
      }
      if (fn === 'get_public_loyalty_account') {
        return Promise.resolve({
          data: {
            found: true,
            organization: { name: 'Cantina da Praça' },
            customer: { name: 'Maria Silva', cpf_last2: '25' },
            account: {
              points_balance: '150',
              recovery_points: '0',
              updated_at: '2026-08-11T13:00:00Z',
            },
            statement: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await screen.findByRole('heading', { name: 'Clube Ped-On' });
    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    await screen.findByRole('heading', { name: 'Olá, Maria Silva' });
    expect(screen.getByText('120')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Atualizar saldo' }));

    expect(await screen.findByText('150')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_loyalty_account', {
      p_access_token: 'a'.repeat(64),
    });
  });

  it('renderiza o estado vazio do extrato', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(edgeResponse(200, foundPayload));
    renderClube(foundMenu);

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('heading', { name: 'Extrato de pontos' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma movimentação de pontos ainda.')).toBeInTheDocument();
  });

  it('formata recebimento, pedido, data e valor elegível em BRL', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, {
        ...foundPayload,
        statement: [
          {
            entry_type: 'earn',
            gross_points: '35',
            points_delta: '35',
            recovery_delta: '0',
            eligible_amount: '35.50',
            order_number: 42,
            created_at: '2026-08-11T12:30:00Z',
          },
        ],
      }),
    );
    renderClube(foundMenu);

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('Pontos recebidos')).toBeInTheDocument();
    expect(screen.getByText('+35 pontos')).toBeInTheDocument();
    expect(screen.getByText(/Pedido #42/)).toHaveTextContent(/11\/08\/2026/);
    expect(screen.getByText('Valor elegível: R$ 35,50')).toBeInTheDocument();
  });

  it('renderiza estorno sem inventar valor elegível', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, {
        ...foundPayload,
        statement: [
          {
            entry_type: 'reversal',
            gross_points: '20',
            points_delta: '-20',
            recovery_delta: '0',
            eligible_amount: null,
            order_number: 43,
            created_at: '2026-08-11T13:00:00Z',
          },
        ],
      }),
    );
    renderClube(foundMenu);

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('Estorno de pontos')).toBeInTheDocument();
    expect(screen.getByText('-20 pontos')).toBeInTheDocument();
    expect(screen.getByText('Saldo disponível: -20 pontos')).toBeInTheDocument();
    expect(screen.queryByText(/Valor elegível:/)).not.toBeInTheDocument();
  });

  it('renderiza resgate com pontos negativos sem Pedido #null e mostra vouchers ativos', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, {
        ...foundPayload,
        statement: [
          {
            entry_type: 'redeem',
            gross_points: '80',
            points_delta: '-80',
            recovery_delta: '0',
            eligible_amount: null,
            order_number: null,
            created_at: '2026-08-11T13:00:00Z',
          },
        ],
        vouchers: [
          {
            code: 'ABCD-EF12-3456-7890',
            reward_name: 'Café grátis',
            points_cost: '80',
            issued_at: '2026-08-11T13:00:00Z',
          },
        ],
      }),
    );
    renderClube(foundMenu);

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('Resgate de recompensa')).toBeInTheDocument();
    expect(screen.getByText('-80 pontos')).toBeInTheDocument();
    expect(screen.queryByText(/Pedido #null/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Meus vouchers' })).toBeInTheDocument();
    expect(screen.getByText('ABCD-EF12-3456-7890')).toBeInTheDocument();
  });

  it('explica pontos enviados e compensados na recuperação', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, {
        ...foundPayload,
        statement: [
          {
            entry_type: 'reversal',
            gross_points: '15',
            points_delta: '-10',
            recovery_delta: '5',
            eligible_amount: null,
            order_number: 44,
            created_at: '2026-08-11T13:00:00Z',
          },
          {
            entry_type: 'earn',
            gross_points: '8',
            points_delta: '3',
            recovery_delta: '-5',
            eligible_amount: '8.00',
            order_number: 45,
            created_at: '2026-08-11T14:00:00Z',
          },
        ],
      }),
    );
    renderClube(foundMenu);

    await openLookup(user);
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25');
    await user.type(screen.getByLabelText('Telefone com DDD'), '(11) 99999-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('Em recuperação: +5 pontos')).toBeInTheDocument();
    expect(screen.getByText('Recuperação compensada: 5 pontos')).toBeInTheDocument();
  });
});
