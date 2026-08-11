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
        },
        {
          id: 'prod-2',
          name: 'Refrigerante',
          description: null,
          price: '6.00',
          sort_order: 2,
          is_available: false,
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
});
