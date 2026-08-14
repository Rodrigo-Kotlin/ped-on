import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-10T14:05:00.000Z';

type AdminRole = 'owner' | 'operator';
type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type PaymentStatus = 'pending' | 'paid' | 'refunded';

function orderFixture(status: OrderStatus, paymentStatus: PaymentStatus) {
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
    service_mode: 'pickup',
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

async function mockAdminOrders(page: Page, role: AdminRole, initialPayment: PaymentStatus) {
  let status: OrderStatus = 'new';
  let paymentStatus = initialPayment;
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
    if (pathname === '/rest/v1/rpc/get_unit_orders_admin') {
      const order = orderFixture(status, paymentStatus);
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_ID, name: 'Loja Centro' },
          status_filter: null,
          count: 1,
          orders: [order],
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_order_admin') {
      await route.fulfill({ status: 200, headers, json: orderFixture(status, paymentStatus) });
      return;
    }
    if (pathname === '/rest/v1/rpc/set_order_status') {
      const body = request.postDataJSON() as { p_next_status: OrderStatus };
      status = body.p_next_status;
      calls.statuses.push(status);
      await route.fulfill({ status: 200, headers, json: orderFixture(status, paymentStatus) });
      return;
    }
    if (pathname === '/rest/v1/rpc/set_order_payment_status') {
      const body = request.postDataJSON() as { p_payment_status: PaymentStatus };
      paymentStatus = body.p_payment_status;
      calls.payments.push(paymentStatus);
      await route.fulfill({ status: 200, headers, json: orderFixture(status, paymentStatus) });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });

  return calls;
}

test.use({ serviceWorkers: 'block' });

test('owner percorre lifecycle new até completed na central', async ({ page }) => {
  const calls = await mockAdminOrders(page, 'owner', 'pending');
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

  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Iniciar preparo' }).click();
  await page.getByRole('button', { name: 'Marcar pronto' }).click();
  const actions = page.getByRole('region', { name: 'Status: Pronto' });
  await expect(actions.getByRole('button', { name: 'Saiu para entrega' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Concluir' }).click();

  await expect(page.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
  expect(calls.statuses).toEqual(['confirmed', 'preparing', 'ready', 'completed']);
});

test('operator acessa pedidos e não recebe controle de refund', async ({ page }) => {
  await mockAdminOrders(page, 'operator', 'paid');
  await page.goto('/app/pedidos');

  await expect(page.locator('header').getByText('Operador')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pedidos' })).toBeVisible();
  await page.getByRole('button', { name: /Abrir pedido 81/ }).click();
  await expect(page.getByText('Pago', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar reembolso' })).toHaveCount(0);
});
