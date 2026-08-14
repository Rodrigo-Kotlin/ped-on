import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const SLUG = 'abcdef1234567890abcdef12';
const TOKEN = 'd'.repeat(32);
const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const DUPLO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TRIPLO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const BACON_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const REMOVAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

const menu = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro', is_active: true },
  loyalty: { enabled: false },
  menu: { version_id: VERSION_ID, version_number: 1, published_at: '2026-08-14T00:00:00Z' },
  operation: {
    configured: true,
    accepting_orders: true,
    revision: '2026-08-14T00:00:00.000000Z',
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
      id: 'category-1',
      name: 'Lanches',
      sort_order: 1,
      products: [
        {
          id: PRODUCT_ID,
          name: 'X-Tudo',
          description: 'O completo',
          price: '29.90',
          sort_order: 1,
          is_available: true,
          is_configurable: true,
          option_groups: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Tamanho',
              kind: 'variation',
              selection_mode: 'single',
              min_select: 1,
              max_select: 1,
              options: [
                { id: DUPLO_ID, name: 'Duplo', price_delta: '5.00', is_available: true },
                { id: TRIPLO_ID, name: 'Triplo', price_delta: '10.00', is_available: true },
              ],
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Adicionais',
              kind: 'addon',
              selection_mode: 'multiple',
              min_select: 0,
              max_select: 2,
              options: [{ id: BACON_ID, name: 'Bacon', price_delta: '4.00', is_available: true }],
            },
            {
              id: '55555555-5555-4555-8555-555555555555',
              name: 'Sem',
              kind: 'removal',
              selection_mode: 'multiple',
              min_select: 0,
              max_select: 2,
              options: [
                { id: REMOVAL_ID, name: 'Sem cebola', price_delta: '0.00', is_available: true },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const creationResult = {
  order_number: 91,
  tracking_token: TOKEN,
  tracking_path: `/pedido/${TOKEN}`,
  service_mode: 'pickup',
  payment_method: 'pix',
  subtotal: '38.90',
  delivery_fee: '0.00',
  total: '38.90',
  estimated_minutes: 20,
  created_at: '2026-08-14T00:00:00Z',
};

const trackingOrder = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro' },
  order: {
    order_number: 91,
    status: 'new',
    payment_status: 'pending',
    service_mode: 'pickup',
    payment_method: 'pix',
    subtotal: '38.90',
    delivery_fee: '0.00',
    total: '38.90',
    estimated_minutes: 20,
    created_at: '2026-08-14T00:00:00Z',
    status_updated_at: '2026-08-14T00:00:00Z',
    completed_at: null,
    cancelled_at: null,
    items: [
      {
        name: 'X-Tudo',
        unit_price: '38.90',
        quantity: 1,
        line_total: '38.90',
        options: [
          {
            group_name: 'Tamanho',
            group_kind: 'variation',
            option_name: 'Duplo',
            price_delta: '5.00',
          },
          {
            group_name: 'Adicionais',
            group_kind: 'addon',
            option_name: 'Bacon',
            price_delta: '4.00',
          },
          {
            group_name: 'Sem',
            group_kind: 'removal',
            option_name: 'Sem cebola',
            price_delta: '0.00',
          },
        ],
      },
    ],
  },
};

async function installMenu(page: Page, payload: object = menu) {
  await page.route('**/rest/v1/rpc/get_public_menu', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: payload }),
  );
}

async function configureProduct(
  page: Page,
  size: 'Duplo' | 'Triplo',
  extras: { bacon?: boolean; removal?: boolean } = {},
) {
  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: new RegExp(size) }).check();
  if (extras.bacon) await page.getByRole('checkbox', { name: /Bacon/ }).check();
  if (extras.removal) await page.getByRole('checkbox', { name: /Sem cebola/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
}

async function submitCheckout(page: Page) {
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await page.getByRole('link', { name: 'Ir para checkout' }).click();
  await page.getByLabel('Nome').fill('Maria Silva');
  await page.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await page.getByRole('radio', { name: 'Pix' }).check();
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
}

function orderRouteError(route: Route, code: string) {
  return route.fulfill({
    status: 400,
    contentType: 'application/json',
    json: { code: 'P0001', message: `${code} DATABASE_DETAILS`, details: null, hint: null },
  });
}

test.use({ serviceWorkers: 'block' });

test('4B-1 envia somente option IDs e tracking mostra snapshot autoritativo', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | undefined;
  await installMenu(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    submittedPayload = (route.request().postDataJSON() as { p_payload: Record<string, unknown> })
      .p_payload;
    await route.fulfill({ status: 200, contentType: 'application/json', json: creationResult });
  });
  await page.route('**/rest/v1/rpc/get_public_order', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: trackingOrder }),
  );

  await page.goto(`/menu/${SLUG}`);
  await configureProduct(page, 'Duplo', { bacon: true, removal: true });
  await submitCheckout(page);

  await expect(page).toHaveURL(`/pedido/${TOKEN}`);
  expect(submittedPayload).toMatchObject({
    menu_version_id: VERSION_ID,
    items: [
      {
        menu_item_id: PRODUCT_ID,
        quantity: 1,
        options: [DUPLO_ID, BACON_ID, REMOVAL_ID],
      },
    ],
  });
  expect(JSON.stringify(submittedPayload)).not.toMatch(
    /unit_price|price_delta|group_name|menu_group_id|options_fingerprint|Duplo|Bacon|Sem cebola/,
  );
  await expect(page.getByText('Tamanho: Duplo')).toBeVisible();
  await expect(page.getByText('+ Bacon')).toBeVisible();
  await expect(page.getByText('Sem cebola')).toBeVisible();
  await expect(page.getByText('R$ 38,90 cada')).toBeVisible();
  await expect(page.getByText(new RegExp(`${DUPLO_ID}|${BACON_ID}|${REMOVAL_ID}`))).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `pedon:cart:${SLUG}`))
    .toBeNull();
});

test('4B-2 duas configurações do mesmo produto chegam como duas linhas', async ({ page }) => {
  let submittedItems: unknown;
  await installMenu(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    const body = route.request().postDataJSON() as { p_payload: { items: unknown } };
    submittedItems = body.p_payload.items;
    await route.fulfill({ status: 200, contentType: 'application/json', json: creationResult });
  });
  await page.route('**/rest/v1/rpc/get_public_order', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: trackingOrder }),
  );

  await page.goto(`/menu/${SLUG}`);
  await configureProduct(page, 'Duplo');
  await configureProduct(page, 'Triplo');
  await submitCheckout(page);

  expect(submittedItems).toEqual([
    { menu_item_id: PRODUCT_ID, quantity: 1, options: [DUPLO_ID] },
    { menu_item_id: PRODUCT_ID, quantity: 1, options: [TRIPLO_ID] },
  ]);
});

test('4B-3 PED75 preserva configuração e exige revisão explícita', async ({ page }) => {
  let unavailable = false;
  await page.route('**/rest/v1/rpc/get_public_menu', (route) => {
    const payload = structuredClone(menu);
    payload.categories[0]!.products[0]!.option_groups[1]!.options[0]!.is_available = !unavailable;
    return route.fulfill({ status: 200, contentType: 'application/json', json: payload });
  });
  await page.route('**/rest/v1/rpc/create_public_order_v2', (route) => {
    unavailable = true;
    return orderRouteError(route, 'PED75');
  });

  await page.goto(`/menu/${SLUG}`);
  await configureProduct(page, 'Duplo', { bacon: true });
  await submitCheckout(page);

  await expect(page.getByRole('alert')).toContainText('ficou indisponível');
  await expect(page.getByRole('alert')).not.toContainText(/PED75|DATABASE/);
  const review = page.getByRole('link', { name: 'Revisar carrinho' });
  await expect(review).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `pedon:cart:${SLUG}`))
    .toContain(BACON_ID);
  await review.click();
  await expect(page.getByText('+ Bacon')).toBeVisible();
});

test('4B-4 retry de rede preserva chave, payload e configuração', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await installMenu(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', json: creationResult });
  });
  await page.route('**/rest/v1/rpc/get_public_order', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: trackingOrder }),
  );

  await page.goto(`/menu/${SLUG}`);
  await configureProduct(page, 'Duplo', { bacon: true });
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await page.getByRole('link', { name: 'Ir para checkout' }).click();
  await page.getByLabel('Nome').fill('Maria Silva');
  await page.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await page.getByRole('radio', { name: 'Pix' }).check();
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByRole('alert')).toContainText('Verifique sua conexão');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page).toHaveURL(`/pedido/${TOKEN}`);

  expect(requests).toHaveLength(2);
  expect(requests[1]!.p_idempotency_key).toBe(requests[0]!.p_idempotency_key);
  expect(requests[1]!.p_payload).toEqual(requests[0]!.p_payload);
});

test('4B-5 MENU_CHANGED não remapeia option IDs e mantém carrinho stale', async ({ page }) => {
  let changed = false;
  await page.route('**/rest/v1/rpc/get_public_menu', (route) => {
    if (!changed) {
      return route.fulfill({ status: 200, contentType: 'application/json', json: menu });
    }
    const nextMenu = structuredClone(menu);
    nextMenu.menu.version_id = '99999999-9999-4999-8999-999999999999';
    nextMenu.menu.version_number = 2;
    nextMenu.categories[0]!.products[0]!.option_groups[0]!.options[0]!.id =
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
    return route.fulfill({ status: 200, contentType: 'application/json', json: nextMenu });
  });
  await page.route('**/rest/v1/rpc/create_public_order_v2', (route) => {
    changed = true;
    return orderRouteError(route, 'PED35');
  });

  await page.goto(`/menu/${SLUG}`);
  await configureProduct(page, 'Duplo');
  await submitCheckout(page);

  await expect(page.getByRole('heading', { name: 'Revise seu carrinho' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Limpar e refazer carrinho' })).toBeVisible();
  const stored = await page.evaluate((key) => localStorage.getItem(key), `pedon:cart:${SLUG}`);
  expect(stored).toContain(DUPLO_ID);
  expect(stored).not.toContain('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1');
});
