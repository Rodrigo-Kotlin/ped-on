import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

type AdminRole = 'owner' | 'manager' | 'operator';

const defaultConfig = {
  configured: false,
  unit_id: UNIT_ID,
  timezone: 'America/Sao_Paulo',
  pickup_enabled: true,
  delivery_enabled: false,
  delivery_fee: '0.00',
  min_order_value: '0.00',
  estimated_pickup_minutes: null,
  estimated_delivery_minutes: null,
  accepting_orders: false,
  business_hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: false,
    is_24h: false,
    open_time: null,
    close_time: null,
  })),
  payment_methods: [
    { method: 'cash', is_enabled: false },
    { method: 'pix', is_enabled: false },
    { method: 'credit_card', is_enabled: false },
    { method: 'debit_card', is_enabled: false },
  ],
};

async function mockAdminSession(page: Page, role: AdminRole) {
  const calls = {
    config: [] as Record<string, unknown>[],
    save: [] as Record<string, unknown>[],
  };

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
          email: 'e2e@pedon.invalid',
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
            email: 'e2e@pedon.invalid',
            full_name: 'Usuário E2E',
            onboarding_status: 'completed',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
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
          profile: {
            id: USER_ID,
            email: 'e2e@pedon.invalid',
            full_name: 'Usuário E2E',
          },
          organization: { id: ORGANIZATION_ID, name: 'Cantina E2E' },
          role,
          units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
        },
      });
      return;
    }

    if (pathname === '/rest/v1/rpc/get_unit_operational_config') {
      calls.config.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, headers, json: defaultConfig });
      return;
    }

    if (pathname === '/rest/v1/rpc/save_unit_operational_config') {
      const body = request.postDataJSON() as {
        p_unit_id: string;
        p_config: Record<string, unknown>;
      };
      calls.save.push(body);
      await route.fulfill({
        status: 200,
        headers,
        json: { configured: true, unit_id: body.p_unit_id, ...body.p_config },
      });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });

  return calls;
}

test.use({ serviceWorkers: 'block' });

test('/app/configuracoes exige sessão autenticada', async ({ page }) => {
  await page.goto('/app/configuracoes');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no Ped-On' })).toBeVisible();
});

test('owner visualiza configuração segura, formulário completo e salva pelo harness', async ({
  page,
}) => {
  const calls = await mockAdminSession(page, 'owner');

  await page.goto('/app/configuracoes');

  await expect(page).toHaveURL(/\/app\/configuracoes$/);
  await expect(page.getByText('Proprietário')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Loja Centro' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('pedidos desligados');
  await expect(page.getByRole('checkbox', { name: /Aceitando pedidos/ })).not.toBeChecked();

  await expect(page.getByRole('region', { name: 'Modalidades de atendimento' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Retirada no local (pickup)' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Entrega (delivery)' })).not.toBeChecked();
  await expect(page.getByRole('region', { name: 'Formas de pagamento' })).toBeVisible();
  for (const method of ['Dinheiro', 'Pix', 'Cartão de crédito', 'Cartão de débito']) {
    await expect(page.getByRole('checkbox', { name: method })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Horários de funcionamento' })).toBeVisible();
  for (const weekday of ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']) {
    await expect(page.getByRole('checkbox', { name: weekday, exact: true })).toBeVisible();
  }

  await expect.poll(() => calls.config.length).toBe(1);
  expect(calls.config[0]).toEqual({ p_unit_id: UNIT_ID });

  await page.getByLabel('Taxa de entrega (R$)').fill('6.50');
  await page.getByRole('button', { name: 'Salvar configuração' }).click();

  await expect.poll(() => calls.save.length).toBe(1);
  expect(calls.save[0]).toMatchObject({
    p_unit_id: UNIT_ID,
    p_config: { delivery_fee: '6.50', accepting_orders: false },
  });
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('manager autorizado acessa a edição da unidade vinculada', async ({ page }) => {
  await mockAdminSession(page, 'manager');

  await page.goto('/app/configuracoes');

  await expect(page).toHaveURL(/\/app\/configuracoes$/);
  await expect(page.getByText('Gerente')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Loja Centro' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar configuração' })).toBeEnabled();
});

test('operator é removido da edição antes de carregar a configuração', async ({ page }) => {
  const calls = await mockAdminSession(page, 'operator');

  await page.goto('/app/configuracoes');

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('header').getByText('Operador')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir configurações' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Salvar configuração' })).toHaveCount(0);
  expect(calls.config).toHaveLength(0);
  expect(calls.save).toHaveLength(0);
});
