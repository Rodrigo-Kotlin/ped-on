import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-10T14:05:00.000Z';

type AdminRole = 'owner' | 'manager' | 'operator';
type KdsStatus = 'new' | 'confirmed' | 'preparing' | 'ready';
type ServiceMode = 'pickup' | 'delivery';

interface KdsMockOptions {
  status?: KdsStatus;
  serviceMode?: ServiceMode;
  truncated?: boolean;
  fourColumns?: boolean;
  withPii?: boolean;
}

function kdsBoardOrder(status: KdsStatus, serviceMode: ServiceMode = 'pickup', withPii = false) {
  return {
    id: ORDER_ID,
    order_number: 81,
    status,
    service_mode: serviceMode,
    created_at: CREATED_AT,
    status_updated_at: CREATED_AT,
    estimated_minutes: 20,
    expected_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...(withPii
      ? {
          customer_name: 'Cliente Secreto',
          customer_phone: '11988887777',
          delivery_address: 'Rua Secreta 123',
          total: '40.00',
        }
      : {}),
    items: [
      {
        product_name: 'Prato E2E',
        quantity: 2,
        note: 'Sem cebola',
        options: [
          { group_name: 'Tamanho', group_kind: 'variation', option_name: 'Duplo' },
          { group_name: 'Adicionais', group_kind: 'addon', option_name: 'Bacon' },
          { group_name: 'Ingredientes', group_kind: 'removal', option_name: 'Cebola' },
        ],
      },
    ],
  };
}

function orderDetailFixture(status: KdsStatus | 'completed', serviceMode: ServiceMode) {
  return {
    id: ORDER_ID,
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    menu_version_id: '55555555-5555-4555-8555-555555555555',
    menu_version_number: 1,
    order_number: 81,
    tracking_token: 'a'.repeat(32),
    tracking_path: `/pedido/${'a'.repeat(32)}`,
    status,
    payment_status: 'pending',
    service_mode: serviceMode,
    payment_method: 'pix',
    customer_name: 'Cliente E2E',
    customer_phone: '11987654321',
    delivery_address: null,
    subtotal: '25.00',
    delivery_fee: '0.00',
    total: '25.00',
    cash_change_for: null,
    estimated_minutes: 20,
    operation_revision: CREATED_AT,
    notes: null,
    item_count: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    status_updated_at: CREATED_AT,
    payment_status_updated_at: CREATED_AT,
    completed_at: null,
    cancelled_at: null,
    paid_at: null,
    refunded_at: null,
    items: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        menu_item_id: '77777777-7777-4777-8777-777777777777',
        product_name: 'Prato E2E',
        unit_price: '25.00',
        quantity: 2,
        line_total: '50.00',
        note: 'Sem cebola',
        options: [
          {
            id: '99999999-9999-4999-8999-999999999991',
            group_id: '99999999-9999-4999-8999-999999999992',
            group_name: 'Tamanho',
            group_kind: 'variation',
            option_id: '99999999-9999-4999-8999-999999999993',
            option_name: 'Duplo',
            price_delta: '5.00',
          },
        ],
      },
    ],
    events: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        event_type: 'status_changed',
        from_value: null,
        to_value: status,
        note: null,
        actor_type: 'staff',
        actor_user_id: USER_ID,
        created_at: CREATED_AT,
      },
    ],
  };
}

async function mockKds(page: Page, role: AdminRole, options: KdsMockOptions = {}) {
  let status: KdsStatus | 'completed' = options.status ?? 'new';
  const serviceMode = options.serviceMode ?? 'pickup';
  const calls = { statuses: [] as string[], kds: 0 };

  await page.routeWebSocket('**/realtime/v1/**', (webSocket) => webSocket.close());
  await page.addInitScript(
    ({ unitId, userId }) => {
      const session = {
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: userId,
          email: 'kds@pedon.invalid',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z',
        },
      };
      for (const key of ['sb-zmuxkztnilnzjyyojbbr-auth-token', 'sb-placeholder-auth-token']) {
        window.localStorage.setItem(key, JSON.stringify(session));
      }
      window.localStorage.setItem('pedon:selectedUnitId', unitId);
    },
    { unitId: UNIT_ID, userId: USER_ID },
  );

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers':
        'authorization,apikey,content-type,content-profile,accept-profile,x-client-info',
      'content-type': 'application/json',
    };

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (pathname === '/rest/v1/profiles') {
      await route.fulfill({
        status: 200,
        headers,
        json: [
          {
            id: USER_ID,
            email: 'kds@pedon.invalid',
            full_name: 'Equipe E2E',
            onboarding_status: 'completed',
            created_at: CREATED_AT,
            updated_at: CREATED_AT,
          },
        ],
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_my_admin_context') {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          profile: { id: USER_ID, email: 'kds@pedon.invalid', full_name: 'Equipe E2E' },
          organization: { id: ORGANIZATION_ID, name: 'Cantina E2E' },
          role,
          units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_kds_orders_minimal') {
      calls.kds += 1;
      const orders = options.fourColumns
        ? (['new', 'confirmed', 'preparing', 'ready'] as const).map((nextStatus) =>
            kdsBoardOrder(nextStatus, serviceMode, options.withPii),
          )
        : [kdsBoardOrder(status as KdsStatus, serviceMode, options.withPii)];
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_ID, name: 'Loja Centro' },
          truncated: options.truncated ?? false,
          orders,
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/set_order_status') {
      const body = request.postDataJSON() as { p_next_status: KdsStatus | 'completed' };
      status = body.p_next_status;
      calls.statuses.push(status);
      await route.fulfill({
        status: 200,
        headers,
        json: orderDetailFixture(status, serviceMode),
      });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });

  return calls;
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

test('A: owner acessa o board da cozinha pela navegação do painel', async ({ page }) => {
  await mockKds(page, 'owner', { fourColumns: true });
  await page.goto('/app/cozinha');

  await expect(page.getByRole('navigation', { name: 'Navegação do painel' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cozinha' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toBeVisible();
  await expect(page.locator('p', { hasText: 'Loja Centro' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Novos (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirmados (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Em preparo (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prontos (1)' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Pedido #81' })).toHaveCount(4);
});

test('B: operator acessa o board da cozinha', async ({ page }) => {
  await mockKds(page, 'operator');
  await page.goto('/app/cozinha');

  await expect(page.locator('header').getByText('Operador')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Pedido #81' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clube Ped-On' })).toHaveCount(0);
});

test('C: Confirmar move o pedido de Novos para Confirmados', async ({ page }) => {
  const calls = await mockKds(page, 'owner');
  await page.goto('/app/cozinha');

  const novos = page.getByRole('region', { name: 'Novos (1)' });
  const article = novos.getByRole('article', { name: 'Pedido #81' });
  await expect(article.getByRole('button', { name: 'Confirmar' })).toBeVisible();

  await article.getByRole('button', { name: 'Confirmar' }).click();

  await expect(
    page.getByRole('region', { name: 'Confirmados (1)' }).getByRole('article', {
      name: 'Pedido #81',
    }),
  ).toBeVisible();
  await expect(article).toHaveCount(0);
  expect(calls.statuses).toEqual(['confirmed']);
});

test('D: Iniciar preparo move o pedido de Confirmados para Em preparo', async ({ page }) => {
  const calls = await mockKds(page, 'owner', { status: 'confirmed' });
  await page.goto('/app/cozinha');

  const confirmed = page.getByRole('region', { name: 'Confirmados (1)' });
  await confirmed
    .getByRole('article', { name: 'Pedido #81' })
    .getByRole('button', { name: 'Iniciar preparo' })
    .click();

  await expect(
    page.getByRole('region', { name: 'Em preparo (1)' }).getByRole('article', {
      name: 'Pedido #81',
    }),
  ).toBeVisible();
  expect(calls.statuses).toEqual(['preparing']);
});

test('E: Marcar pronto move o pedido para Prontos', async ({ page }) => {
  const calls = await mockKds(page, 'owner', { status: 'preparing' });
  await page.goto('/app/cozinha');

  await page
    .getByRole('region', { name: 'Em preparo (1)' })
    .getByRole('article', { name: 'Pedido #81' })
    .getByRole('button', { name: 'Marcar pronto' })
    .click();

  await expect(
    page.getByRole('region', { name: 'Prontos (1)' }).getByRole('article', {
      name: 'Pedido #81',
    }),
  ).toBeVisible();
  expect(calls.statuses).toEqual(['ready']);
});

test('F: pedido pronto não oferece ação e mostra a bandeira textual', async ({ page }) => {
  await mockKds(page, 'owner', { status: 'ready' });
  await page.goto('/app/cozinha');

  const article = page
    .getByRole('region', { name: 'Prontos (1)' })
    .getByRole('article', { name: 'Pedido #81' });
  await expect(article.getByText('Pronto')).toBeVisible();
  await expect(article.getByRole('button')).toHaveCount(0);
});

test('G: card mostra itens, variação, adicionais, retirada e nota sem dinheiro', async ({
  page,
}) => {
  await mockKds(page, 'owner');
  await page.goto('/app/cozinha');

  const article = page.getByRole('article', { name: 'Pedido #81' });
  await expect(article.getByText('2x Prato E2E')).toBeVisible();
  await expect(article.getByText('Tamanho: Duplo')).toBeVisible();
  await expect(article.getByText('Adicionais: Bacon')).toBeVisible();
  await expect(article.getByText('Retirar: Cebola')).toBeVisible();
  await expect(article.getByText('Obs.: Sem cebola')).toBeVisible();
  await expect(article.getByText(/R\$\s*25,00|R\$\s*40,00/)).toHaveCount(0);
});

test('H: card não renderiza cliente, telefone, endereço ou valor', async ({ page }) => {
  await mockKds(page, 'owner', { withPii: true });
  await page.goto('/app/cozinha');

  const article = page.getByRole('article', { name: 'Pedido #81' });
  await expect(article).toBeVisible();
  await expect(article.getByText('Cliente Secreto')).toHaveCount(0);
  await expect(article.getByText('11988887777')).toHaveCount(0);
  await expect(article.getByText(/Rua Secreta/)).toHaveCount(0);
  await expect(article.getByText(/R\$\s*40,00|40\.00/)).toHaveCount(0);
});

test('I: offline bloqueia a ação com a mensagem compartilhada', async ({ page }) => {
  const calls = await mockKds(page, 'owner');
  await page.goto('/app/cozinha');

  const article = page.getByRole('article', { name: 'Pedido #81' });
  await expect(article.getByRole('button', { name: 'Confirmar' })).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText(/Sem conexão com a internet/)).toBeVisible();
  await article.getByRole('button', { name: 'Confirmar' }).click();

  await expect(
    article.getByText('Você está offline. Operações que exigem conexão estão pausadas.'),
  ).toBeVisible();
  expect(calls.statuses).toEqual([]);

  await page.context().setOffline(false);
});

test('J: board se ajusta de 360 a 1440 sem estourar o viewport', async ({ page }) => {
  await mockKds(page, 'owner', { fourColumns: true });
  await page.goto('/app/cozinha');
  await expect(page.getByRole('article', { name: 'Pedido #81' })).toHaveCount(4);

  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('article', { name: 'Pedido #81' })).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
  }
});

test('K: aviso de truncamento acima de 200 pedidos', async ({ page }) => {
  await mockKds(page, 'owner', { truncated: true });
  await page.goto('/app/cozinha');

  await expect(
    page.getByText(
      'Há mais de 200 pedidos ativos na cozinha. A tela mostra somente os 200 pedidos priorizados.',
    ),
  ).toBeVisible();
});
