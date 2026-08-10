import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SLUG = 'abcdef1234567890abcdef12';

interface PublicMenuPayload {
  found: boolean;
  organization?: { name: string };
  unit?: { name: string; is_active: boolean };
  menu?: { version_id: string; version_number: number; published_at: string };
  operation?: {
    configured: boolean;
    accepting_orders: boolean;
    pickup_enabled: boolean;
    delivery_enabled: boolean;
    delivery_fee: string;
    minimum_order_amount: string;
    estimated_pickup_minutes: number | null;
    estimated_delivery_minutes: number | null;
    payment_methods: { method: string; is_enabled: boolean }[];
    business_hours: { weekday: number; is_open: boolean }[];
  };
  categories: {
    id: string;
    name: string;
    sort_order: number;
    products: {
      id: string;
      name: string;
      description: string | null;
      price: string;
      sort_order: number;
      is_available: boolean;
    }[];
  }[];
}

const foundMenu: PublicMenuPayload = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro', is_active: true },
  menu: { version_id: 'version-1', version_number: 1, published_at: '2026-08-10T12:00:00.000Z' },
  operation: {
    configured: true,
    accepting_orders: true,
    pickup_enabled: true,
    delivery_enabled: false,
    delivery_fee: '0.00',
    minimum_order_amount: '0.00',
    estimated_pickup_minutes: 20,
    estimated_delivery_minutes: null,
    payment_methods: [{ method: 'pix', is_enabled: true }],
    business_hours: [{ weekday: 0, is_open: false }],
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
  ],
};

async function installPublicMenuHarness(page: Page, payload: PublicMenuPayload) {
  await page.route('**/rest/v1/rpc/get_public_menu', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      json: payload,
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

test.use({ serviceWorkers: 'block' });

test('cardápio público renderiza sem sessão com categorias, preços e indisponíveis', async ({
  page,
}) => {
  await installPublicMenuHarness(page, foundMenu);
  await page.goto(`/menu/${SLUG}`);

  await expect(page).toHaveURL(new RegExp(`/menu/${SLUG}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Loja Centro' })).toBeVisible();
  await expect(page.getByText('Cantina da Praça')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lanches' })).toBeVisible();
  await expect(page.getByText('X-Salada')).toBeVisible();
  await expect(page.getByText('Pão, carne e salada')).toBeVisible();
  await expect(page.getByText('R$ 29,90')).toBeVisible();
  await expect(page.getByText('Refrigerante')).toBeVisible();
  await expect(page.getByText('R$ 6,00')).toBeVisible();
  await expect(page.getByText('Indisponível')).toBeVisible();
  await expect(page.getByText('Pedidos abertos agora')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('cardápio público não encontrado para slug sem publicação', async ({ page }) => {
  await installPublicMenuHarness(page, { found: false, categories: [] });
  await page.goto(`/menu/${SLUG}`);

  await expect(page.getByRole('heading', { name: 'Cardápio não encontrado' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  await expectNoHorizontalOverflow(page);
});

test('cardápio público indica pedidos encerrados quando a unidade não aceita', async ({ page }) => {
  await installPublicMenuHarness(page, {
    ...foundMenu,
    operation: { ...foundMenu.operation!, accepting_orders: false },
  });
  await page.goto(`/menu/${SLUG}`);

  await expect(page.getByText('Pedidos encerrados no momento')).toBeVisible();
  await expect(page.getByText('Pedidos abertos agora')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('cardápio público com categorias vazias exibe estado vazio', async ({ page }) => {
  await installPublicMenuHarness(page, { ...foundMenu, categories: [] });
  await page.goto(`/menu/${SLUG}`);

  await expect(page.getByText('Este cardápio ainda não tem itens publicados.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
