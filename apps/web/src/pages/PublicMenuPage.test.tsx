import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import type { PublicMenuData, PublicMenuResult } from '../lib/menu/menu';
import { CartProvider } from '../lib/cart/CartProvider';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { PublicMenuPage } from './PublicMenuPage';

const foundMenu: PublicMenuData = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro', is_active: true },
  loyalty: { enabled: false },
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
  categories: [
    {
      id: 'cat-1',
      name: 'Lanches',
      sort_order: 1,
      products: [
        {
          id: 'prod-1',
          name: 'X-Salada',
          description: 'Pão, carne e salada',
          price: '29.90',
          sort_order: 1,
          is_available: true,
          is_configurable: true,
          option_groups: [],
        },
        {
          id: 'prod-2',
          name: 'Refrigerante',
          description: null,
          price: '6.00',
          sort_order: 2,
          is_available: false,
          is_configurable: true,
          option_groups: [],
        },
      ],
    },
    { id: 'cat-2', name: 'Bebidas', sort_order: 2, products: [] },
  ],
};

function renderPublicMenu(result: PublicMenuResult, initialEntry = '/menu/abc') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_public_menu') {
      return Promise.resolve({ data: result, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="/menu/:publicSlug"
              element={<CartProvider publicSlug="abc">{children}</CartProvider>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(<PublicMenuPage />, { wrapper: Wrapper });
}

describe('PublicMenuPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('renderiza cardápio público com categorias, produtos, preços e descrições', async () => {
    renderPublicMenu(foundMenu);

    expect(await screen.findByRole('heading', { name: 'Loja Centro' })).toBeInTheDocument();
    expect(screen.getByText('Cantina da Praça')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lanches' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bebidas' })).toBeInTheDocument();
    expect(screen.getByText('X-Salada')).toBeInTheDocument();
    expect(screen.getByText('Pão, carne e salada')).toBeInTheDocument();
    expect(screen.getByText('R$ 29,90')).toBeInTheDocument();
    expect(screen.getByText('R$ 6,00')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_menu', { p_public_slug: 'abc' });
  });

  it('indica produto indisponível sem oferecer CTA de compra', async () => {
    renderPublicMenu(foundMenu);

    expect(await screen.findByText('Refrigerante')).toBeInTheDocument();
    expect(screen.getByText('Indisponível')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Adicionar Refrigerante' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar X-Salada' })).toBeInTheDocument();
  });

  it('exibe status de pedidos abertos quando a unidade aceita pedidos', async () => {
    renderPublicMenu(foundMenu);

    expect(await screen.findByText('Pedidos abertos agora')).toBeInTheDocument();
  });

  it('exibe pedidos encerrados quando a unidade está inativa', async () => {
    renderPublicMenu({
      ...foundMenu,
      unit: { name: 'Loja Centro', is_active: false },
      operation: { ...foundMenu.operation, can_order_now: false },
    });

    expect(await screen.findByText('Pedidos indisponíveis no momento.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Adicionar/ })).not.toBeInTheDocument();
  });

  it('adiciona item e exibe CTA do carrinho com quantidade e subtotal exato', async () => {
    const user = userEvent.setup();
    renderPublicMenu(foundMenu);

    const addButton = await screen.findByRole('button', { name: 'Adicionar X-Salada' });
    await user.click(addButton);
    await user.click(addButton);
    expect(screen.getByRole('link', { name: /Ver carrinho \(2\).*R\$ 59,80/ })).toHaveAttribute(
      'href',
      '/menu/abc/carrinho',
    );
    expect(JSON.parse(window.localStorage.getItem('pedon:cart:abc')!).items).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('pedon:cart:abc')!).items[0].quantity).toBe(2);
  });

  it('não vaza identificadores internos nem campos de fonte', async () => {
    renderPublicMenu(foundMenu);

    await screen.findByRole('heading', { name: 'Loja Centro' });
    expect(screen.queryByText(/source_product_id|source_category_id/)).not.toBeInTheDocument();
    expect(screen.queryByText('cat-1')).not.toBeInTheDocument();
    expect(screen.queryByText('prod-1')).not.toBeInTheDocument();
    expect(screen.queryByText('version-1')).not.toBeInTheDocument();
  });

  it('mostra estado vazio quando não há categorias publicadas', async () => {
    renderPublicMenu({ ...foundMenu, categories: [] });

    expect(
      await screen.findByText('Este cardápio ainda não tem itens publicados.'),
    ).toBeInTheDocument();
  });

  it('exibe cardápio não encontrado para slug sem publicação', async () => {
    renderPublicMenu({ found: false });

    expect(
      await screen.findByRole('heading', { name: 'Cardápio não encontrado' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  });

  it('exibe carregando enquanto a consulta está pendente', async () => {
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
    renderPublicMenu(foundMenu);

    expect(await screen.findByRole('status')).toHaveTextContent('Carregando cardápio…');

    resolveQuery({ data: foundMenu, error: null });
    expect(await screen.findByRole('heading', { name: 'Loja Centro' })).toBeInTheDocument();
  });

  it('exibe CTA do Clube Ped-On quando o programa está ativo', async () => {
    renderPublicMenu({ ...foundMenu, loyalty: { enabled: true } });

    const link = await screen.findByRole('link', { name: /Clube Ped-On/ });
    expect(link).toHaveAttribute('href', '/clube/abc');
    expect(
      screen.getByText('Ganhe pontos nas suas compras e acompanhe seu saldo.'),
    ).toBeInTheDocument();
  });

  it('não exibe CTA do Clube quando o programa está desativado', async () => {
    renderPublicMenu(foundMenu);

    await screen.findByRole('heading', { name: 'Loja Centro' });
    expect(screen.queryByRole('link', { name: /Clube Ped-On/ })).not.toBeInTheDocument();
  });

  it('abre o personalizador para produto com grupos e exige seleção obrigatória', async () => {
    const user = userEvent.setup();
    renderPublicMenu(customizableMenu);

    const customizeButton = await screen.findByRole('button', { name: 'Personalizar X-Tudo' });
    expect(customizeButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar X-Tudo' })).not.toBeInTheDocument();

    await user.click(customizeButton);
    expect(screen.getByRole('dialog', { name: 'X-Tudo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar ao carrinho' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha 1 opção de Tamanho.');
  });

  it('adiciona item configurado ao carrinho com opções e preço exato', async () => {
    const user = userEvent.setup();
    renderPublicMenu(customizableMenu);

    await user.click(await screen.findByRole('button', { name: 'Personalizar X-Tudo' }));
    await user.click(screen.getByRole('radio', { name: /Duplo/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bacon/ }));
    await user.click(screen.getByRole('checkbox', { name: /Cebola/ }));
    await user.click(screen.getByRole('button', { name: 'Adicionar ao carrinho' }));

    expect(screen.getByRole('link', { name: /Ver carrinho \(1\).*R\$ 38,90/ })).toHaveAttribute(
      'href',
      '/menu/abc/carrinho',
    );
    const stored = JSON.parse(window.localStorage.getItem('pedon:cart:abc')!).items[0];
    expect(stored.unit_price).toBe('29.90');
    expect(stored.options).toEqual([
      { menu_group_id: 'grp-1', menu_option_id: 'opt-1', name: 'Duplo', price_delta: '5.00' },
      { menu_group_id: 'grp-2', menu_option_id: 'opt-2', name: 'Bacon', price_delta: '4.00' },
      { menu_group_id: 'grp-3', menu_option_id: 'opt-3', name: 'Cebola', price_delta: '0.00' },
    ]);
  });

  it('marca opções indisponíveis como desabilitadas no personalizador', async () => {
    const user = userEvent.setup();
    renderPublicMenu(customizableMenu);

    await user.click(await screen.findByRole('button', { name: 'Personalizar X-Tudo' }));
    const chipa = screen.getByRole('checkbox', { name: /Chipa/ });
    expect(chipa).toBeDisabled();
    expect(screen.getByText('Indisponível')).toBeInTheDocument();
  });

  it('fecha o personalizador com Escape e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    renderPublicMenu(customizableMenu);

    const customizeButton = await screen.findByRole('button', { name: 'Personalizar X-Tudo' });
    await user.click(customizeButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(customizeButton).toHaveFocus();
  });
});

const customizableMenu: PublicMenuData = {
  ...foundMenu,
  categories: [
    {
      id: 'cat-1',
      name: 'Lanches',
      sort_order: 1,
      products: [
        {
          id: 'prod-3',
          name: 'X-Tudo',
          description: 'O completo',
          price: '29.90',
          sort_order: 1,
          is_available: true,
          is_configurable: true,
          option_groups: [
            {
              id: 'grp-1',
              name: 'Tamanho',
              kind: 'variation',
              selection_mode: 'single',
              min_select: 1,
              max_select: 1,
              options: [
                { id: 'opt-1', name: 'Duplo', price_delta: '5.00', is_available: true },
                { id: 'opt-4', name: 'Triplo', price_delta: '10.00', is_available: true },
              ],
            },
            {
              id: 'grp-2',
              name: 'Adicionais',
              kind: 'addon',
              selection_mode: 'multiple',
              min_select: 0,
              max_select: 3,
              options: [
                { id: 'opt-2', name: 'Bacon', price_delta: '4.00', is_available: true },
                { id: 'opt-5', name: 'Chipa', price_delta: '2.00', is_available: false },
              ],
            },
            {
              id: 'grp-3',
              name: 'Sem',
              kind: 'removal',
              selection_mode: 'multiple',
              min_select: 0,
              max_select: 3,
              options: [{ id: 'opt-3', name: 'Cebola', price_delta: '0.00', is_available: true }],
            },
          ],
        },
      ],
    },
  ],
};
