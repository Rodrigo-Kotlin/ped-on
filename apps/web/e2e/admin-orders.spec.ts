import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-10T14:05:00.000Z';

type AdminRole = 'owner' | 'operator';
type OrderStatus =
  'new' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
type PaymentStatus = 'pending' | 'paid' | 'refunded';
type ServiceMode = 'pickup' | 'delivery';

interface OrderFixtureOptions {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  serviceMode?: ServiceMode;
}

function orderFixture({ status, paymentStatus, serviceMode = 'pickup' }: OrderFixtureOptions) {
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
    payment_status: paymentStatus,
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
    completed_at: status === 'completed' ? CREATED_AT : null,
    cancelled_at: status === 'cancelled' ? CREATED_AT : null,
    paid_at: paymentStatus === 'pending' ? null : CREATED_AT,
    refunded_at: paymentStatus === 'refunded' ? CREATED_AT : null,
    items: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        menu_item_id: '77777777-7777-4777-8777-777777777777',
        product_name: 'Prato E2E',
        unit_price: '25.00',
        quantity: 1,
        line_total: '25.00',
        note: null,
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
          {
            id: '99999999-9999-4999-8999-999999999994',
            group_id: '99999999-9999-4999-8999-999999999995',
            group_name: 'Adicionais',
            group_kind: 'addon',
            option_id: '99999999-9999-4999-8999-999999999996',
            option_name: 'Bacon',
            price_delta: '4.00',
          },
          {
            id: '99999999-9999-4999-8999-999999999997',
            group_id: '99999999-9999-4999-8999-999999999998',
            group_name: 'Sem',
            group_kind: 'removal',
            option_id: '99999999-9999-4999-8999-999999999999',
            option_name: 'Sem cebola',
            price_delta: '0.00',
          },
        ],
      },
    ],
    events: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        event_type: 'created',
        from_value: null,
        to_value: 'new',
        note: null,
        actor_type: 'customer',
        actor_user_id: null,
        created_at: CREATED_AT,
      },
    ],
  };
}

function orderSummaryFixture(
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  serviceMode: ServiceMode = 'pickup',
) {
  const detail = orderFixture({ status, paymentStatus, serviceMode });
  return {
    id: detail.id,
    order_number: detail.order_number,
    status: detail.status,
    payment_status: detail.payment_status,
    service_mode: detail.service_mode,
    payment_method: detail.payment_method,
    item_count: detail.item_count,
    subtotal: detail.subtotal,
    delivery_fee: detail.delivery_fee,
    total: detail.total,
    estimated_minutes: detail.estimated_minutes,
    expected_at: '2026-08-10T14:25:00.000Z',
    customer_name: detail.customer_name,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    status_updated_at: detail.status_updated_at,
    payment_status_updated_at: detail.payment_status_updated_at,
    completed_at: detail.completed_at,
    cancelled_at: detail.cancelled_at,
    paid_at: detail.paid_at,
    refunded_at: detail.refunded_at,
  };
}

interface AdminOrderFilters {
  view: 'active' | 'history';
  cursor?: string;
  statuses?: OrderStatus[];
  service_mode?: ServiceMode;
}

async function mockAdminOrders(
  page: Page,
  role: AdminRole,
  options: {
    status?: OrderStatus;
    payment?: PaymentStatus;
    serviceMode?: ServiceMode;
  } = {},
) {
  let status: OrderStatus = options.status ?? 'new';
  let paymentStatus = options.payment ?? 'pending';
  const serviceMode = options.serviceMode ?? 'pickup';
  const calls = { statuses: [] as string[], payments: [] as string[] };

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
          email: 'orders@pedon.invalid',
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
            email: 'orders@pedon.invalid',
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
          profile: { id: USER_ID, email: 'orders@pedon.invalid', full_name: 'Equipe E2E' },
          organization: { id: ORGANIZATION_ID, name: 'Cantina E2E' },
          role,
          units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_unit_orders_admin_v2') {
      const body = request.postDataJSON() as { p_filters: AdminOrderFilters };
      const filters = body.p_filters;
      const isTerminal = status === 'completed' || status === 'cancelled';
      const historyOrder = {
        ...orderSummaryFixture('completed', paymentStatus, serviceMode),
        id: '44444444-4444-4444-8444-444444444440',
        order_number: 80,
        customer_name: 'Cliente Histórico',
      };
      const secondOrder = {
        ...orderSummaryFixture('confirmed', paymentStatus, serviceMode),
        id: '44444444-4444-4444-8444-444444444442',
        order_number: 82,
        customer_name: 'Segundo pedido E2E',
      };
      const matchesServiceFilter =
        filters.service_mode === undefined || filters.service_mode === serviceMode;
      const matchesStatusFilter =
        filters.statuses === undefined || filters.statuses.includes(status);
      const hideActive = isTerminal || !matchesServiceFilter || !matchesStatusFilter;
      const activeOrders = hideActive
        ? []
        : filters.cursor === 'cursor-page-2'
          ? [secondOrder]
          : [orderSummaryFixture(status, paymentStatus, serviceMode)];
      const orders = filters.view === 'history' ? [historyOrder] : activeOrders;
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_ID, name: 'Loja Centro' },
          view: filters.view,
          filters: {
            view: filters.view,
            statuses:
              filters.view === 'active'
                ? ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery']
                : ['completed', 'cancelled'],
            service_mode: filters.service_mode ?? null,
            payment_status: null,
            payment_method: null,
            order_number: null,
            date_from: null,
            date_to: null,
            limit: 50,
          },
          snapshot_at: filters.view === 'active' ? CREATED_AT : null,
          total_count: filters.view === 'active' ? (hideActive ? 0 : 2) : 1,
          orders,
          page_info: {
            has_more: filters.view === 'active' && filters.cursor === undefined && !hideActive,
            next_cursor:
              filters.view === 'active' && filters.cursor === undefined && !hideActive
                ? 'cursor-page-2'
                : null,
          },
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_order_admin') {
      await route.fulfill({
        status: 200,
        headers,
        json: orderFixture({ status, paymentStatus, serviceMode }),
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/set_order_status') {
      const body = request.postDataJSON() as { p_next_status: OrderStatus };
      status = body.p_next_status;
      calls.statuses.push(status);
      await route.fulfill({
        status: 200,
        headers,
        json: orderFixture({ status, paymentStatus, serviceMode }),
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/set_order_payment_status') {
      const body = request.postDataJSON() as { p_payment_status: PaymentStatus };
      paymentStatus = body.p_payment_status;
      calls.payments.push(paymentStatus);
      await route.fulfill({
        status: 200,
        headers,
        json: orderFixture({ status, paymentStatus, serviceMode }),
      });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });

  return calls;
}

test.use({ serviceWorkers: 'block' });

test('owner percorre lifecycle new até completed na central', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await expect(page.getByRole('link', { name: 'Pedidos' })).toBeVisible();
  await expect(page.getByText('Novo pedido')).toBeVisible();
  await page.getByRole('button', { name: /Abrir pedido 81/ }).click();
  await expect(page.getByRole('heading', { name: 'Pedido #81' })).toBeFocused();
  await expect(page.getByText('Tamanho: Duplo')).toBeVisible();
  await expect(page.getByText('+ Bacon')).toBeVisible();
  await expect(page.getByText('Sem cebola')).toBeVisible();
  await expect(page.getByText('R$ 25,00 cada')).toBeVisible();
  await expect(page.getByText(/99999999-9999/)).toHaveCount(0);

  const detail = page.getByRole('region', { name: 'Pedido #81' });
  await detail.getByRole('button', { name: 'Marcar como pago' }).click();
  await expect(
    page.getByRole('region', { name: 'Pagamento' }).getByText('Pago', { exact: true }),
  ).toBeVisible();

  await detail.getByRole('button', { name: 'Confirmar' }).click();
  await detail.getByRole('button', { name: 'Iniciar preparo' }).click();
  await detail.getByRole('button', { name: 'Marcar pronto' }).click();
  const actions = page.getByRole('region', { name: 'Status: Pronto' });
  await expect(actions.getByRole('button', { name: 'Saiu para entrega' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Concluir retirada' }).click();

  await expect(page.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
  expect(calls.statuses).toEqual(['confirmed', 'preparing', 'ready', 'completed']);
  expect(calls.payments).toEqual(['paid']);
});

test('operator acessa pedidos e não recebe controle de refund', async ({ page }) => {
  await mockAdminOrders(page, 'operator', { payment: 'paid' });
  await page.goto('/app/pedidos');

  await expect(page.locator('header').getByText('Operador')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pedidos' })).toBeVisible();
  await page.getByRole('button', { name: /Abrir pedido 81/ }).click();
  await expect(
    page.getByRole('region', { name: 'Pagamento' }).getByText('Pago', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar reembolso' })).toHaveCount(0);
});

test('Central v2 alterna views, aplica/limpa filtro, pagina e preserva detalhe', async ({
  page,
}) => {
  await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await expect(page.getByRole('button', { name: 'Ativos' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('2 pedidos encontrados · 1 exibido')).toBeVisible();
  await page.getByRole('button', { name: 'Carregar mais' }).click();
  await expect(page.getByText('2 pedidos encontrados · 2 exibidos')).toBeVisible();
  await expect(page.getByText('Segundo pedido E2E')).toBeVisible();

  await page.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.getByText('Cliente Histórico')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Concluído' })).toBeVisible();
  await page.getByRole('button', { name: 'Ativos' }).click();

  await page.getByLabel('Modalidade').selectOption('delivery');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar', exact: true }).click();
  await expect(page.getByText('Cliente E2E')).toBeVisible();
  await page.getByRole('button', { name: /Abrir pedido 81/ }).click();
  await expect(page.getByRole('heading', { name: 'Pedido #81' })).toBeFocused();
});

test('A: ação rápida confirma do card sem abrir detalhe', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar preparo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pedido #81' })).toHaveCount(0);
  expect(calls.statuses).toEqual(['confirmed']);
});

test('B: lifecycle ativo completo pelas ações rápidas do card (retirada)', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Iniciar preparo' }).click();
  await page.getByRole('button', { name: 'Marcar pronto' }).click();
  await expect(page.getByText('Pronto para retirada')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir retirada' }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
  expect(calls.statuses).toEqual(['confirmed', 'preparing', 'ready', 'completed']);
});

test('C: fluxo de entrega exibe Em rota e Concluir entrega', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner', { serviceMode: 'delivery' });
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Iniciar preparo' }).click();
  await page.getByRole('button', { name: 'Marcar pronto' }).click();
  await expect(page.getByText('Pronto para entrega')).toBeVisible();
  await page.getByRole('button', { name: 'Saiu para entrega' }).click();
  await expect(page.getByText('Em rota')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir entrega' }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
  expect(calls.statuses).toEqual([
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'completed',
  ]);
});

test('D: marca pago pela ação rápida e esconde o botão', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await expect(page.getByText('Pix · Pendente')).toBeVisible();
  await page.getByRole('button', { name: 'Marcar pago' }).click();
  await expect(page.getByText('Pix · Pago')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar pago' })).toHaveCount(0);
  expect(calls.payments).toEqual(['paid']);
});

test('E: cancelamento aceito remove o pedido da lista ativa', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  const calls = await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
  expect(calls.statuses).toEqual(['cancelled']);
});

test('F: cancelamento recusado mantém o pedido', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.dismiss());
  const calls = await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Novo pedido')).toBeVisible();
  expect(calls.statuses).toEqual([]);
});

test('G: operador executa ações rápidas sem controle de reembolso', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'operator');
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Marcar pago' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar preparo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar reembolso' })).toHaveCount(0);
  expect(calls.statuses).toEqual(['confirmed']);
  expect(calls.payments).toEqual(['paid']);
});

test('H: pedido concluído no histórico não oferece ações rápidas', async ({ page }) => {
  await mockAdminOrders(page, 'owner', { status: 'completed', payment: 'paid' });
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.getByText('Cliente Histórico')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Marcar pago' })).toHaveCount(0);
});

test('I: cards se ajustam em 360 a 1440 sem estourar o viewport', async ({ page }) => {
  await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');
  await expect(page.getByRole('button', { name: /Abrir pedido 81/ })).toBeVisible();

  for (const width of [360, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const openButton = page.getByRole('button', { name: /Abrir pedido 81/ });
    await expect(openButton).toBeVisible();
    const box = await openButton.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
  }
});

test('J: detalhe mantém ações via resolver para entrega', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner', {
    status: 'ready',
    serviceMode: 'delivery',
  });
  await page.goto('/app/pedidos');

  await page.getByRole('button', { name: /Abrir pedido 81/ }).click();
  const detail = page.getByRole('region', { name: 'Pedido #81' });
  await detail.getByRole('button', { name: 'Saiu para entrega' }).click();
  await expect(page.getByRole('heading', { name: 'Status: Saiu para entrega' })).toBeVisible();
  await detail.getByRole('button', { name: 'Concluir entrega' }).click();
  await expect(page.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
  expect(calls.statuses).toEqual(['out_for_delivery', 'completed']);
});

test('K: filtro de status move o pedido ao confirmar pela ação rápida', async ({ page }) => {
  await mockAdminOrders(page, 'owner');
  await page.goto('/app/pedidos');

  await page.getByRole('checkbox', { name: 'Novo' }).check();
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByText('Cliente E2E')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
});
