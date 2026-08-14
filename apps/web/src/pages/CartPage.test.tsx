import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { CartProvider } from '../lib/cart/CartProvider';
import { cartStorageKey } from '../lib/cart/cart';
import type { PublicMenuData } from '../lib/menu/menu';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { CartPage } from './CartPage';

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
    delivery_enabled: false,
    delivery_fee: '0.00',
    minimum_order_amount: '0.00',
    estimated_pickup_minutes: 20,
    estimated_delivery_minutes: null,
    payment_methods: [{ method: 'pix', is_enabled: true }],
    business_hours: [],
  },
  categories: [],
};

function renderCart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/menu/abc/carrinho']}>
          <CartProvider publicSlug="abc">
            <Routes>
              <Route path="/menu/:publicSlug/carrinho" element={children} />
            </Routes>
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<CartPage />, { wrapper: Wrapper });
}

describe('CartPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
    window.localStorage.clear();
    window.localStorage.setItem(
      cartStorageKey('abc'),
      JSON.stringify({
        slug: 'abc',
        menuVersionId: 'version-1',
        items: [
          { menu_item_id: 'item-1', name: 'X-Salada', unit_price: '10.10', quantity: 2, note: '' },
        ],
      }),
    );
    supabaseMock.rpc.mockResolvedValue({ data: menu, error: null });
  });

  it('incrementa, decrementa, edita observação e remove item', async () => {
    const user = userEvent.setup();
    renderCart();

    expect(await screen.findAllByText('R$ 20,20')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Aumentar X-Salada' }));
    expect(screen.getAllByText('R$ 30,30')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Diminuir X-Salada' }));
    expect(screen.getAllByText('R$ 20,20')).toHaveLength(2);

    await user.type(screen.getByLabelText('Observação do item'), 'Sem cebola');
    expect(JSON.parse(window.localStorage.getItem(cartStorageKey('abc'))!).items[0].note).toBe(
      'Sem cebola',
    );

    await user.click(screen.getByRole('button', { name: 'Remover' }));
    expect(screen.getByText('Seu carrinho está vazio.')).toBeInTheDocument();
    expect(window.localStorage.getItem(cartStorageKey('abc'))).toBeNull();
  });

  it('bloqueia checkout e preserva snapshot quando o carrinho está stale', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { ...menu, menu: { ...menu.menu, version_id: 'version-2' } },
      error: null,
    });
    renderCart();

    expect(await screen.findByRole('alert')).toHaveTextContent('preços antigos foram preservados');
    expect(screen.getByRole('button', { name: 'Ir para checkout' })).toBeDisabled();
    expect(JSON.parse(window.localStorage.getItem(cartStorageKey('abc'))!).menuVersionId).toBe(
      'version-1',
    );
  });

  it('exibe configurações de opções e usa o preço configurado por linha', async () => {
    const menuWithGroups: PublicMenuData = {
      ...menu,
      categories: [
        {
          id: 'cat-1',
          name: 'Lanches',
          sort_order: 1,
          products: [
            {
              id: 'item-1',
              name: 'X-Salada',
              description: null,
              price: '10.10',
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
                  ],
                },
                {
                  id: 'grp-2',
                  name: 'Adicionais',
                  kind: 'addon',
                  selection_mode: 'multiple',
                  min_select: 0,
                  max_select: 2,
                  options: [
                    { id: 'opt-2', name: 'Bacon', price_delta: '4.00', is_available: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    supabaseMock.rpc.mockResolvedValue({ data: menuWithGroups, error: null });
    window.localStorage.setItem(
      cartStorageKey('abc'),
      JSON.stringify({
        slug: 'abc',
        menuVersionId: 'version-1',
        items: [
          {
            menu_item_id: 'item-1',
            name: 'X-Salada',
            unit_price: '10.10',
            quantity: 1,
            note: '',
            options: [
              {
                menu_group_id: 'grp-1',
                menu_option_id: 'opt-1',
                name: 'Duplo',
                price_delta: '5.00',
              },
              {
                menu_group_id: 'grp-2',
                menu_option_id: 'opt-2',
                name: 'Bacon',
                price_delta: '4.00',
              },
            ],
          },
        ],
      }),
    );
    renderCart();

    expect(await screen.findByText('Tamanho: Duplo')).toBeInTheDocument();
    expect(screen.getByText('+ Bacon')).toBeInTheDocument();
    expect(screen.getByText('R$ 19,10 cada')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 19,10').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: 'Ir para checkout' })).toHaveAttribute(
      'href',
      '/menu/abc/checkout',
    );
  });

  it('preserva duas linhas distintas para configurações diferentes do mesmo produto', async () => {
    window.localStorage.setItem(
      cartStorageKey('abc'),
      JSON.stringify({
        slug: 'abc',
        menuVersionId: 'version-1',
        items: [
          {
            menu_item_id: 'item-1',
            name: 'X-Salada',
            unit_price: '10.10',
            quantity: 1,
            note: '',
            options: [
              {
                menu_group_id: 'grp-1',
                menu_option_id: 'opt-1',
                name: 'Duplo',
                price_delta: '5.00',
              },
            ],
          },
          {
            menu_item_id: 'item-1',
            name: 'X-Salada',
            unit_price: '10.10',
            quantity: 1,
            note: '',
            options: [],
          },
        ],
      }),
    );
    renderCart();

    const names = await screen.findAllByRole('heading', { name: 'X-Salada' });
    expect(names).toHaveLength(2);
    expect(screen.getAllByText('R$ 15,10 cada')).toHaveLength(1);
    expect(screen.getAllByText('R$ 10,10 cada')).toHaveLength(1);
  });
});
