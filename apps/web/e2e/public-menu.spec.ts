import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SLUG = 'abcdef1234567890abcdef12';
const TOKEN = 'a'.repeat(32);

const foundMenu = {
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
    payment_methods: [
      { method: 'cash', is_enabled: false },
      { method: 'pix', is_enabled: true },
      { method: 'credit_card', is_enabled: false },
      { method: 'debit_card', is_enabled: false },
    ],
    business_hours: [],
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

const trackingOrder = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro' },
  order: {
    order_number: 42,
    status: 'new',
    payment_status: 'pending',
    service_mode: 'pickup',
    payment_method: 'pix',
    subtotal: '59.80',
    delivery_fee: '0.00',
    total: '59.80',
    estimated_minutes: 20,
    created_at: '2026-08-10T12:00:00Z',
    status_updated_at: '2026-08-10T12:00:00Z',
    completed_at: null,
    cancelled_at: null,
    items: [{ name: 'X-Salada', unit_price: '29.90', quantity: 2, line_total: '59.80' }],
  },
};

async function installPublicMenuHarness(page: Page, payload: object = foundMenu) {
  await page.route('**/rest/v1/rpc/get_public_menu', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: payload }),
  );
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

test('cardápio público oferece add/CTA sem botão para indisponível', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Loja Centro' })).toBeVisible();
  await expect(page.getByText('Pedidos abertos agora')).toBeVisible();
  await expect(page.getByText('Indisponível')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar Refrigerante' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar X-Salada' }).click();
  await expect(page.getByRole('link', { name: /Ver carrinho \(1\).*R\$ 29,90/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('fluxo pickup determinístico: menu, carrinho, checkout, sucesso e tracking', async ({
  page,
}) => {
  let submittedPayload: Record<string, unknown> | undefined;
  await installPublicMenuHarness(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    const body = route.request().postDataJSON() as { p_payload: Record<string, unknown> };
    submittedPayload = body.p_payload;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        order_number: 42,
        tracking_token: TOKEN,
        tracking_path: `/pedido/${TOKEN}`,
        service_mode: 'pickup',
        payment_method: 'pix',
        subtotal: '59.80',
        delivery_fee: '0.00',
        total: '59.80',
        estimated_minutes: 20,
        created_at: '2026-08-10T12:00:00Z',
      },
    });
  });
  await page.route('**/rest/v1/rpc/get_public_order', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: trackingOrder }),
  );

  await page.goto(`/menu/${SLUG}`);
  await page.getByRole('button', { name: 'Adicionar X-Salada' }).click();
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await page.getByRole('button', { name: 'Aumentar X-Salada' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subtotal estimado' }).locator('..'),
  ).toContainText('R$ 59,80');
  await page.getByRole('link', { name: 'Ir para checkout' }).click();
  await page.getByLabel('Nome').fill('Maria Silva');
  await page.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await page.getByRole('radio', { name: 'Pix' }).check();
  await page.getByRole('button', { name: 'Enviar pedido' }).click();

  await expect(page).toHaveURL(`/pedido/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Pedido #42' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Novo');
  expect(submittedPayload).toEqual({
    menu_version_id: 'version-1',
    operation_revision: foundMenu.operation.revision,
    service_mode: 'pickup',
    payment_method: 'pix',
    customer: { name: 'Maria Silva', phone: '(11) 99999-9999' },
    items: [{ menu_item_id: 'prod-1', quantity: 2 }],
  });
  expect(JSON.stringify(submittedPayload)).not.toMatch(/price|total|organization|unit_id/);
  await expectNoHorizontalOverflow(page);
});

test('fluxo delivery calcula taxa, coleta endereço e envia cash com troco', async ({ page }) => {
  const deliveryMenu = {
    ...foundMenu,
    operation: {
      ...foundMenu.operation,
      pickup_enabled: true,
      delivery_enabled: true,
      delivery_fee: '5.50',
      estimated_delivery_minutes: 45,
      payment_methods: [
        { method: 'cash', is_enabled: true },
        { method: 'pix', is_enabled: true },
        { method: 'credit_card', is_enabled: false },
        { method: 'debit_card', is_enabled: false },
      ],
    },
  };
  let submittedPayload: Record<string, unknown> | undefined;
  await installPublicMenuHarness(page, deliveryMenu);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    const body = route.request().postDataJSON() as { p_payload: Record<string, unknown> };
    submittedPayload = body.p_payload;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        order_number: 43,
        tracking_token: TOKEN,
        tracking_path: `/pedido/${TOKEN}`,
        service_mode: 'delivery',
        payment_method: 'cash',
        subtotal: '29.90',
        delivery_fee: '5.50',
        total: '35.40',
        estimated_minutes: 45,
        created_at: '2026-08-10T12:00:00Z',
      },
    });
  });
  await page.route('**/rest/v1/rpc/get_public_order', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        ...trackingOrder,
        order: {
          ...trackingOrder.order,
          order_number: 43,
          service_mode: 'delivery',
          payment_method: 'cash',
          subtotal: '29.90',
          delivery_fee: '5.50',
          total: '35.40',
          estimated_minutes: 45,
          items: [
            {
              name: 'X-Salada',
              unit_price: '29.90',
              quantity: 1,
              line_total: '29.90',
            },
          ],
        },
      },
    }),
  );

  await page.goto(`/menu/${SLUG}`);
  await page.getByRole('button', { name: 'Adicionar X-Salada' }).click();
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await page.getByRole('link', { name: 'Ir para checkout' }).click();
  await page.getByLabel('Nome').fill('Cliente Delivery');
  await page.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await page.getByRole('radio', { name: 'Entrega' }).check();
  await page.getByLabel('Rua').fill('Rua Sintética');
  await page.getByLabel('Número').fill('100');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Cidade').fill('Cidade Teste');
  await page.getByLabel('UF').fill('sp');
  await page.getByLabel('CEP (opcional)').fill('01001-000');
  await page.getByRole('radio', { name: 'Dinheiro' }).check();
  await page.getByLabel('Troco para quanto? (opcional)').fill('50,00');
  await expect(page.getByText('R$ 5,50')).toBeVisible();
  await expect(page.getByText('R$ 35,40')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar pedido' }).click();

  await expect(page).toHaveURL(`/pedido/${TOKEN}`);
  expect(submittedPayload).toMatchObject({
    service_mode: 'delivery',
    payment_method: 'cash',
    cash_change_for: '50.00',
    delivery_address: {
      street: 'Rua Sintética',
      number: '100',
      neighborhood: 'Centro',
      city: 'Cidade Teste',
      state: 'SP',
      postal_code: '01001-000',
    },
  });
  expect(JSON.stringify(submittedPayload)).not.toMatch(/price|subtotal|delivery_fee|total/);
  await expectNoHorizontalOverflow(page);
});

test('PED35 preserva carrinho e exige limpeza explícita sem navegar para sucesso', async ({
  page,
}) => {
  await installPublicMenuHarness(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      json: { code: 'PED35', message: 'MENU_CHANGED', details: null, hint: null },
    }),
  );
  await page.goto(`/menu/${SLUG}`);
  await page.getByRole('button', { name: 'Adicionar X-Salada' }).click();
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await page.getByRole('link', { name: 'Ir para checkout' }).click();
  await page.getByLabel('Nome').fill('Maria Silva');
  await page.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();

  await expect(page.getByRole('button', { name: 'Limpar e refazer carrinho' })).toBeVisible();
  await expect(page).toHaveURL(`/menu/${SLUG}/checkout`);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `pedon:cart:${SLUG}`))
    .not.toBeNull();
});

test('cardápio não encontrado e pedidos indisponíveis têm estados públicos corretos', async ({
  page,
}) => {
  await installPublicMenuHarness(page, { found: false });
  await page.goto(`/menu/${SLUG}`);
  await expect(page.getByRole('heading', { name: 'Cardápio não encontrado' })).toBeVisible();

  await page.unroute('**/rest/v1/rpc/get_public_menu');
  await installPublicMenuHarness(page, {
    ...foundMenu,
    operation: { ...foundMenu.operation, accepting_orders: false, can_order_now: false },
  });
  await page.goto(`/menu/${SLUG}`);
  await expect(page.getByText('Pedidos indisponíveis no momento.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Adicionar/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
