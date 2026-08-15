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
  withPii?: boolean;
  noOrder?: boolean;
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
          customer_name: 'CLIENTE-SECRETO',
          customer_phone: '99999999999',
          delivery_address: 'RUA-SECRETA',
          total: '999.99',
          payment_method: 'cash',
          loyalty_token: 'TOKEN-SECRETO',
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

async function mockKds(page: Page, role: AdminRole, options: KdsMockOptions = {}) {
  const status = options.status ?? 'new';
  const serviceMode = options.serviceMode ?? 'pickup';
  const orders = options.noOrder ? [] : [kdsBoardOrder(status, serviceMode, options.withPii)];

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
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_ID, name: 'Loja Centro' },
          truncated: false,
          orders,
        },
      });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });
}

function installPrintSpy(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(window, 'print', {
      configurable: true,
      writable: true,
      value: () => {
        const state = window as unknown as { __printCalls?: number };
        state.__printCalls = (state.__printCalls ?? 0) + 1;
      },
    });
  });
}

async function printCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __printCalls?: number }).__printCalls ?? 0);
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

test('L: Imprimir no card abre a comanda e Voltar para cozinha retorna', async ({ page }) => {
  await mockKds(page, 'owner');
  await page.goto('/app/cozinha');

  const article = page.getByRole('article', { name: 'Pedido #81' });
  await expect(article.getByRole('link', { name: 'Imprimir' })).toBeVisible();
  await article.getByRole('link', { name: 'Imprimir' }).click();

  await expect(page).toHaveURL(/\/app\/cozinha\/imprimir\/44444444-4444-4444-8444-444444444444$/);

  const ticket = page.getByRole('article', { name: 'Comanda do pedido #81' });
  await expect(ticket).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comanda do pedido #81' })).toBeVisible();
  await expect(ticket.getByText('Loja Centro')).toBeVisible();
  await expect(ticket.getByText('Comanda da cozinha')).toBeVisible();
  await expect(ticket.getByText('Pedido #81')).toBeVisible();
  await expect(ticket.getByText('Retirada')).toBeVisible();
  await expect(ticket.getByText('Novo')).toBeVisible();
  await expect(ticket.getByText('Recebido')).toBeVisible();
  await expect(ticket.getByText('Previsto')).toBeVisible();
  await expect(ticket.getByText('2x')).toBeVisible();
  await expect(ticket.getByText('Prato E2E')).toBeVisible();
  await expect(ticket.getByText('Tamanho: Duplo')).toBeVisible();
  await expect(ticket.getByText('Adicionais: Bacon')).toBeVisible();
  await expect(ticket.getByText('RETIRAR: Cebola')).toBeVisible();
  await expect(ticket.getByText('OBS: Sem cebola')).toBeVisible();
  await expect(ticket.getByText(/Impresso em:/)).toBeVisible();

  await page.getByRole('link', { name: 'Voltar para cozinha' }).click();
  await expect(page).toHaveURL(/\/app\/cozinha$/);
  await expect(page.getByRole('article', { name: 'Pedido #81' })).toBeVisible();
});

test('M: window.print só ocorre por ação explícita e conta cada clique', async ({ page }) => {
  await installPrintSpy(page);
  await mockKds(page, 'owner');
  await page.goto(`/app/cozinha/imprimir/${ORDER_ID}`);

  await expect(page.getByRole('article', { name: 'Comanda do pedido #81' })).toBeVisible();
  expect(await printCalls(page)).toBe(0);

  await page.getByRole('button', { name: 'Imprimir comanda' }).click();
  await expect.poll(() => printCalls(page)).toBe(1);

  await page.getByRole('button', { name: 'Imprimir comanda' }).click();
  await expect.poll(() => printCalls(page)).toBe(2);
});

test('N: comanda não contém PII, pagamento ou valores', async ({ page }) => {
  await mockKds(page, 'owner', { withPii: true });
  await page.goto(`/app/cozinha/imprimir/${ORDER_ID}`);

  const ticket = page.getByRole('article', { name: 'Comanda do pedido #81' });
  await expect(ticket).toBeVisible();
  for (const sentinel of ['CLIENTE-SECRETO', '99999999999', 'RUA-SECRETA', 'TOKEN-SECRETO']) {
    await expect(ticket.getByText(new RegExp(sentinel))).toHaveCount(0);
  }
  await expect(ticket.getByText(/R\$\s*999,99|999\.99/)).toHaveCount(0);
  await expect(ticket.getByText('Prato E2E')).toBeVisible();
  await expect(ticket.getByText('RETIRAR: Cebola')).toBeVisible();
  await expect(ticket.getByText('OBS: Sem cebola')).toBeVisible();
});

test('O: prévia da comanda não estoura o viewport de 360 a 1440', async ({ page }) => {
  await mockKds(page, 'owner');
  await page.goto(`/app/cozinha/imprimir/${ORDER_ID}`);
  await expect(page.getByRole('article', { name: 'Comanda do pedido #81' })).toBeVisible();

  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('article', { name: 'Comanda do pedido #81' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('P: pedido pronto permite reimpressão sem ação de cozinha na comanda', async ({ page }) => {
  await mockKds(page, 'owner', { status: 'ready' });
  await page.goto('/app/cozinha');

  const article = page
    .getByRole('region', { name: 'Prontos (1)' })
    .getByRole('article', { name: 'Pedido #81' });
  await expect(article.getByText('Pronto')).toBeVisible();
  await expect(article.getByRole('button')).toHaveCount(0);
  await expect(article.getByRole('link', { name: 'Imprimir' })).toBeVisible();
  await article.getByRole('link', { name: 'Imprimir' }).click();

  const ticket = page.getByRole('article', { name: 'Comanda do pedido #81' });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByText('Pronto')).toBeVisible();
  await expect(
    ticket.getByRole('button', { name: /Confirmar|Marcar pronto|Iniciar preparo/ }),
  ).toHaveCount(0);
});

test('Q: owner, manager e operator acessam a rota de impressão diretamente', async ({ page }) => {
  for (const role of ['owner', 'manager', 'operator'] as const) {
    await mockKds(page, role);
    await page.goto(`/app/cozinha/imprimir/${ORDER_ID}`);
    await expect(page.getByRole('article', { name: 'Comanda do pedido #81' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Imprimir comanda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar para cozinha' })).toHaveAttribute(
      'href',
      '/app/cozinha',
    );
  }
});

test('R: pedido fora da fila mostra estado indisponível sem imprimir', async ({ page }) => {
  await installPrintSpy(page);
  await mockKds(page, 'owner', { noOrder: true });
  await page.goto(`/app/cozinha/imprimir/${ORDER_ID}`);

  await expect(
    page.getByText('Este pedido não está mais disponível na fila da cozinha.'),
  ).toBeVisible();
  expect(await printCalls(page)).toBe(0);
  await expect(page.getByRole('link', { name: 'Voltar para cozinha' })).toHaveAttribute(
    'href',
    '/app/cozinha',
  );
  await page.getByRole('link', { name: 'Voltar para cozinha' }).click();
  await expect(page.getByText('Nenhum pedido ativo na cozinha.')).toBeVisible();
});
