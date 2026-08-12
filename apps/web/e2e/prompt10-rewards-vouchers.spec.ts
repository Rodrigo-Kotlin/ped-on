import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const SLUG = 'abcdef1234567890abcdef12';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const MEMBERSHIP_ID = '44444444-4444-4444-8444-444444444444';
const REWARD_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_REWARD_ID = '66666666-6666-4666-8666-666666666666';
const LOYALTY_TOKEN = 'a'.repeat(64);
const VOUCHER_CODE = 'ABCD-EF12-3456-7890';
const CREATED_AT = '2026-08-11T12:00:00.000Z';
const REVISION = '2026-08-11T12:00:00.123456Z';

type AdminRole = 'owner' | 'manager' | 'operator';
type RestHandler = (rpc: string | null, route: Route) => Promise<boolean>;

const jsonHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,content-profile,accept-profile,x-client-info',
  'content-type': 'application/json',
};

const publicMenu = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro', is_active: true },
  loyalty: { enabled: true },
  menu: {
    version_id: '77777777-7777-4777-8777-777777777777',
    version_number: 1,
    published_at: CREATED_AT,
  },
  operation: {
    configured: true,
    accepting_orders: true,
    revision: '2026-08-11T12:00:00.000000Z',
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

const publicReward = {
  id: REWARD_ID,
  name: 'Café grátis',
  description: 'Um café da casa',
  points_cost: '80',
  available: true,
  revision: REVISION,
};

const publicRewards = {
  found: true,
  loyalty_enabled: true,
  rewards: [publicReward],
};

const redemption = {
  found: true,
  redemption: {
    reward_name: publicReward.name,
    points_cost: publicReward.points_cost,
    created_at: '2026-08-11T13:00:00.000Z',
  },
  voucher: { code: VOUCHER_CODE, status: 'issued', issued_at: '2026-08-11T13:00:00.000Z' },
};

const adminReward = {
  id: REWARD_ID,
  organization_id: ORGANIZATION_ID,
  name: 'Café grátis',
  description: 'Um café da casa',
  points_cost: '80',
  stock_quantity: '12',
  is_active: true,
  sort_order: 1,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  revision: REVISION,
};

async function fulfillJson(route: Route, status: number, json: unknown) {
  await route.fulfill({ status, headers: jsonHeaders, json });
}

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: jsonHeaders });
  return true;
}

async function installRestMock(page: Page, handler: RestHandler) {
  await page.route('**/rest/v1/**', async (route) => {
    if (await fulfillPreflight(route)) return;
    const pathname = new URL(route.request().url()).pathname;
    const prefix = '/rest/v1/rpc/';
    const rpc = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
    if (await handler(rpc, route)) return;
    await fulfillJson(route, 404, { message: `E2E route not mocked: ${pathname}` });
  });
}

async function installPublicMock(page: Page, extra?: RestHandler) {
  await installRestMock(page, async (rpc, route) => {
    if (rpc === 'get_public_menu') {
      await fulfillJson(route, 200, publicMenu);
      return true;
    }
    if (rpc === 'get_public_loyalty_rewards') {
      await fulfillJson(route, 200, publicRewards);
      return true;
    }
    return (await extra?.(rpc, route)) ?? false;
  });
}

async function installIdentityMock(page: Page, requests: Record<string, unknown>[] = []) {
  await page.route('**/functions/v1/**', async (route) => {
    if (await fulfillPreflight(route)) return;
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/functions/v1/loyalty-cpf') {
      await fulfillJson(route, 404, { message: `E2E route not mocked: ${pathname}` });
      return;
    }
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, {
      found: true,
      membership_id: MEMBERSHIP_ID,
      customer: { name: 'Maria Silva', cpf_last2: '25' },
      account: { points_balance: 120, recovery_points: 0 },
      statement: [
        {
          entry_type: 'redeem',
          gross_points: 20,
          points_delta: -20,
          recovery_delta: 0,
          eligible_amount: null,
          order_number: null,
          created_at: '2026-08-10T15:00:00.000Z',
        },
      ],
      vouchers: [
        {
          code: 'DCBA-21FE-6543-0987',
          reward_name: 'Suco grátis',
          points_cost: '40',
          issued_at: '2026-08-10T15:00:00.000Z',
        },
      ],
      token: { access_token: LOYALTY_TOKEN, expires_at: '2026-08-11T14:00:00.000Z' },
    });
  });
}

async function identify(page: Page) {
  await page.goto(`/clube/${SLUG}`);
  await page.getByRole('button', { name: /Consultar meus pontos/ }).click();
  const panel = page.getByRole('region', { name: 'Consultar meus pontos' });
  await panel.getByRole('textbox', { name: 'CPF', exact: true }).fill('529.982.247-25');
  await panel.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await panel.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Maria Silva' })).toBeVisible();
}

function adminContext(role: AdminRole) {
  return {
    profile: { id: USER_ID, email: `${role}@pedon.invalid`, full_name: 'Equipe Ped-On' },
    organization: { id: ORGANIZATION_ID, name: 'Cantina da Praça' },
    role,
    units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
  };
}

const profile = {
  id: USER_ID,
  email: 'staff@pedon.invalid',
  full_name: 'Equipe Ped-On',
  onboarding_status: 'completed',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const program = {
  organization_id: ORGANIZATION_ID,
  program: {
    exists: true,
    enabled: true,
    points_per_real: '1.00',
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  },
  stats: { members_count: 1, total_earned: 120, total_reversed: 0 },
};

async function seedAdminSession(page: Page) {
  await page.addInitScript(
    ({ createdAt, selectedUnitId, userId }) => {
      const session = {
        access_token: `access-${userId}`,
        refresh_token: `refresh-${userId}`,
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: userId,
          email: 'staff@pedon.invalid',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: createdAt,
        },
      };
      for (const key of ['sb-zmuxkztnilnzjyyojbbr-auth-token', 'sb-placeholder-auth-token']) {
        window.localStorage.setItem(key, JSON.stringify(session));
      }
      window.localStorage.setItem('pedon:selectedUnitId', selectedUnitId);
    },
    { createdAt: CREATED_AT, selectedUnitId: UNIT_ID, userId: USER_ID },
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

test('catálogo público aparece sem identidade, estoque ou IDs e direciona para consulta', async ({
  page,
}) => {
  await installPublicMock(page);

  await page.goto(`/clube/${SLUG}`);

  await expect(page.getByRole('heading', { name: publicReward.name })).toBeVisible();
  await expect(page.getByText('80 pontos', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(REWARD_ID);
  await expect(page.locator('body')).not.toContainText(/estoque|12 unidades/i);
  await page.getByRole('button', { name: 'Trocar por 80 pontos' }).click();
  await expect(page.getByRole('status')).toHaveText('Consulte seus pontos para realizar a troca.');
  await expectNoHorizontalOverflow(page);
});

test('cliente confirma troca suficiente e recebe voucher sem persistir o token', async ({
  page,
}) => {
  const identityRequests: Record<string, unknown>[] = [];
  const redeemRequests: Record<string, unknown>[] = [];
  await installIdentityMock(page, identityRequests);
  await installPublicMock(page, async (rpc, route) => {
    if (rpc !== 'redeem_public_loyalty_reward') return false;
    redeemRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, redemption);
    return true;
  });

  await identify(page);
  expect(identityRequests).toEqual([
    {
      public_slug: SLUG,
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    },
  ]);
  await expect(page.getByText('Resgate de recompensa')).toBeVisible();
  await expect(page.getByText('DCBA-21FE-6543-0987')).toBeVisible();

  await page.getByRole('button', { name: 'Trocar por 80 pontos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar troca' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByText('Saldo atual').locator('..')).toContainText('120 pontos');
  await expect(dialog.getByText('Custo', { exact: true }).locator('..')).toContainText('80 pontos');
  await expect(dialog.getByText('Saldo após troca').locator('..')).toContainText('40 pontos');
  await expect(
    dialog.getByText('A troca gera um voucher e não pode ser cancelada no Core MVP.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Confirmar troca' }).click();

  await expect(page.getByText('Recompensa resgatada!')).toBeVisible();
  await expect(page.getByText(VOUCHER_CODE)).toBeVisible();
  expect(redeemRequests).toHaveLength(1);
  const request = redeemRequests[0]!;
  expect(Object.keys(request).sort()).toEqual(
    [
      'p_access_token',
      'p_idempotency_key',
      'p_public_slug',
      'p_recovery_secret',
      'p_reward_id',
      'p_reward_revision',
    ].sort(),
  );
  expect(request).toEqual({
    p_public_slug: SLUG,
    p_idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    p_reward_id: REWARD_ID,
    p_reward_revision: REVISION,
    p_access_token: LOYALTY_TOKEN,
    p_recovery_secret: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(request).not.toHaveProperty('points_cost');
  expect(request).not.toHaveProperty('p_points_cost');
  await expect(page.getByRole('button', { name: 'Atualizar saldo' })).toBeDisabled();
  const browserState = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(window.localStorage)),
    session: Object.fromEntries(Object.entries(window.sessionStorage)),
    search: window.location.search,
  }));
  expect(JSON.stringify(browserState)).not.toContain(LOYALTY_TOKEN);
  expect(browserState.search).toBe('');
  expect(browserState.local[`pedon:pending-redemption:${SLUG}`]).toBeUndefined();
  await expectNoHorizontalOverflow(page);
});

test('resposta ambígua recupera o mesmo voucher após reload sem resgatar novamente', async ({
  page,
}) => {
  const redeems: Record<string, unknown>[] = [];
  const recoveries: Record<string, unknown>[] = [];
  await installIdentityMock(page);
  await installPublicMock(page, async (rpc, route) => {
    if (rpc === 'redeem_public_loyalty_reward') {
      redeems.push(route.request().postDataJSON() as Record<string, unknown>);
      await fulfillJson(route, 500, {
        code: '',
        message: 'Failed to fetch after the redemption was accepted',
        details: null,
        hint: null,
      });
      return true;
    }
    if (rpc === 'get_public_redemption_by_attempt') {
      recoveries.push(route.request().postDataJSON() as Record<string, unknown>);
      await fulfillJson(route, 200, redemption);
      return true;
    }
    return false;
  });

  await identify(page);
  await page.getByRole('button', { name: 'Trocar por 80 pontos' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar troca' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível concluir a troca');

  const pendingKey = `pedon:pending-redemption:${SLUG}`;
  const pending = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
    pendingKey,
  );
  expect(Object.keys(pending as object).sort()).toEqual(
    ['created_at', 'idempotency_key', 'public_slug', 'recovery_secret', 'reward_id'].sort(),
  );
  expect(pending).toEqual({
    public_slug: SLUG,
    idempotency_key: redeems[0]?.p_idempotency_key,
    recovery_secret: redeems[0]?.p_recovery_secret,
    reward_id: REWARD_ID,
    created_at: expect.any(String),
  });

  await page.reload();

  await expect(
    page.getByText('Troca recuperada com sucesso. Seu voucher está pronto.'),
  ).toBeVisible();
  await expect(page.getByText(VOUCHER_CODE)).toBeVisible();
  expect(redeems).toHaveLength(1);
  expect(recoveries).toEqual([
    {
      p_public_slug: SLUG,
      p_idempotency_key: pending.idempotency_key,
      p_recovery_secret: pending.recovery_secret,
    },
  ]);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
  await expectNoHorizontalOverflow(page);
});

test('owner lista, cria, edita, desativa, reativa e ajusta estoque sem exclusão', async ({
  page,
}) => {
  const rewardCalls: { rpc: string; body: Record<string, unknown> }[] = [];
  let rewards: Array<Omit<typeof adminReward, 'description'> & { description: string | null }> = [
    { ...adminReward },
  ];
  await seedAdminSession(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [profile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, adminContext('owner'));
      return true;
    }
    if (rpc === 'get_loyalty_program_admin') {
      await fulfillJson(route, 200, program);
      return true;
    }
    if (rpc === 'get_loyalty_members_admin') {
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        count: 0,
        has_more: false,
        next_cursor: null,
        members: [],
      });
      return true;
    }
    if (rpc === 'get_loyalty_rewards_admin') {
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        count: rewards.length,
        has_more: false,
        next_cursor: null,
        rewards,
      });
      return true;
    }
    if (
      rpc === 'create_loyalty_reward' ||
      rpc === 'update_loyalty_reward' ||
      rpc === 'set_loyalty_reward_active' ||
      rpc === 'set_loyalty_reward_stock'
    ) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      rewardCalls.push({ rpc, body });
      if (rpc === 'create_loyalty_reward') {
        rewards = [
          ...rewards,
          {
            ...adminReward,
            id: CREATED_REWARD_ID,
            name: 'Suco grátis',
            description: null,
            points_cost: '50',
            stock_quantity: '7',
            sort_order: 2,
          },
        ];
        await fulfillJson(route, 200, rewards[1]);
        return true;
      }
      const current = rewards[0]!;
      if (rpc === 'update_loyalty_reward') {
        const payload = body.p_payload as Record<string, unknown>;
        rewards[0] = { ...current, ...payload, revision: '2026-08-11T12:01:00.234567Z' };
      } else if (rpc === 'set_loyalty_reward_active') {
        rewards[0] = {
          ...current,
          is_active: body.p_active as boolean,
          revision: '2026-08-11T12:02:00.345678Z',
        };
      } else {
        rewards[0] = {
          ...current,
          stock_quantity: body.p_stock as string,
          revision: '2026-08-11T12:03:00.456789Z',
        };
      }
      await fulfillJson(route, 200, rewards[0]);
      return true;
    }
    return false;
  });

  await page.goto('/app/clube');
  await expect(page.getByRole('heading', { name: 'Recompensas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Café grátis' })).toBeVisible();
  await expect(page.getByText('12 unidades')).toBeVisible();

  const createForm = page.getByRole('form', { name: 'Criar recompensa' });
  await createForm.getByLabel('Nome').fill('Suco grátis');
  await createForm.getByLabel('Custo em pontos').fill('50');
  await createForm.getByLabel('Estoque inicial').fill('7');
  await createForm.getByRole('button', { name: 'Criar recompensa' }).click();
  await expect(page.getByRole('heading', { name: 'Suco grátis' })).toBeVisible();

  let card = page.getByRole('listitem').filter({ hasText: 'Café grátis' });
  await card.getByRole('button', { name: 'Editar recompensa' }).click();
  await card.getByLabel('Nome').fill('Café especial');
  await card.getByLabel('Custo em pontos').fill('90');
  await card.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('heading', { name: 'Café especial' })).toBeVisible();

  card = page.getByRole('listitem').filter({ hasText: 'Café especial' });
  await card.getByRole('button', { name: 'Desativar recompensa' }).click();
  await expect(card.getByText('Inativa', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Ativar recompensa' }).click();
  await expect(card.getByText('Ativa', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Ajustar estoque' }).click();
  await card.getByLabel('Novo estoque').fill('25');
  await card.getByRole('button', { name: 'Confirmar novo estoque' }).click();
  await expect(card.getByText('25 unidades')).toBeVisible();

  expect(rewardCalls).toContainEqual({
    rpc: 'create_loyalty_reward',
    body: {
      p_organization_id: ORGANIZATION_ID,
      p_payload: { name: 'Suco grátis', description: null, points_cost: '50', initial_stock: '7' },
    },
  });
  expect(rewardCalls).toContainEqual({
    rpc: 'update_loyalty_reward',
    body: {
      p_reward_id: REWARD_ID,
      p_payload: { name: 'Café especial', description: 'Um café da casa', points_cost: '90' },
    },
  });
  expect(rewardCalls).toContainEqual({
    rpc: 'set_loyalty_reward_active',
    body: { p_reward_id: REWARD_ID, p_active: false },
  });
  expect(rewardCalls).toContainEqual({
    rpc: 'set_loyalty_reward_active',
    body: { p_reward_id: REWARD_ID, p_active: true },
  });
  expect(rewardCalls).toContainEqual({
    rpc: 'set_loyalty_reward_stock',
    body: { p_reward_id: REWARD_ID, p_stock: '25' },
  });
  await expect(page.getByText(/Excluir/i)).toHaveCount(0);
  expect(rewardCalls.some(({ rpc }) => rpc === 'delete_loyalty_reward')).toBe(false);
  await expectNoHorizontalOverflow(page);
});

for (const role of ['manager', 'operator'] as const) {
  test(`${role} não acessa /app/clube nem chama RPC administrativa de recompensas`, async ({
    page,
  }) => {
    const rewardAdminCalls: string[] = [];
    await seedAdminSession(page);
    await installRestMock(page, async (rpc, route) => {
      if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
        await fulfillJson(route, 200, [profile]);
        return true;
      }
      if (rpc === 'get_my_admin_context') {
        await fulfillJson(route, 200, adminContext(role));
        return true;
      }
      if (rpc?.includes('loyalty_reward')) rewardAdminCalls.push(rpc);
      return false;
    });

    await page.goto('/app/clube');

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', { name: 'Clube Ped-On' })).toHaveCount(0);
    expect(rewardAdminCalls).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
}

test('staff autorizado consulta e consome voucher na unidade selecionada sem vazar o código', async ({
  page,
}) => {
  const voucherCalls: { rpc: string; body: Record<string, unknown> }[] = [];
  const issuedVoucher = {
    found: true,
    code: VOUCHER_CODE,
    status: 'issued',
    reward_name: 'Café grátis',
    points_cost: '80',
    issued_at: '2026-08-11T13:00:00.000Z',
    consumed_at: null,
  };
  await seedAdminSession(page);
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [profile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, adminContext('operator'));
      return true;
    }
    if (rpc === 'get_loyalty_voucher_staff' || rpc === 'consume_loyalty_voucher') {
      voucherCalls.push({
        rpc,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      await fulfillJson(
        route,
        200,
        rpc === 'consume_loyalty_voucher'
          ? {
              ...issuedVoucher,
              status: 'consumed',
              consumed_at: '2026-08-11T13:05:00.000Z',
            }
          : issuedVoucher,
      );
      return true;
    }
    return false;
  });

  await page.goto('/app/vouchers');
  await expect(page.getByRole('link', { name: 'Vouchers' })).toBeVisible();
  await expect(page.getByText('Validação e entrega em Loja Centro.')).toBeVisible();
  await page.getByLabel('Código do voucher').fill('abcd ef12 3456 7890');
  await page.getByRole('button', { name: 'Validar' }).click();
  await expect(page.getByRole('heading', { name: 'Café grátis' })).toBeVisible();
  await expect(page.getByText('Disponível')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar entrega' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Confirmar entrega da recompensa Café grátis?',
  });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Confirmar entrega' }).click();

  await expect(page.getByRole('status')).toHaveText('Voucher utilizado com sucesso.');
  await expect(page.getByText('Utilizado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Utilizado em/)).toBeVisible();
  expect(voucherCalls).toEqual([
    {
      rpc: 'get_loyalty_voucher_staff',
      body: { p_unit_id: UNIT_ID, p_voucher_code: 'ABCDEF1234567890' },
    },
    {
      rpc: 'consume_loyalty_voucher',
      body: { p_unit_id: UNIT_ID, p_voucher_code: 'ABCDEF1234567890' },
    },
  ]);
  const browserState = await page.evaluate(() => ({
    href: window.location.href,
    local: Object.fromEntries(Object.entries(window.localStorage)),
    session: Object.fromEntries(Object.entries(window.sessionStorage)),
  }));
  expect(browserState.href).not.toContain(VOUCHER_CODE);
  expect(browserState.href).not.toContain('ABCDEF1234567890');
  expect(
    JSON.stringify({ local: browserState.local, session: browserState.session }),
  ).not.toContain(VOUCHER_CODE);
  expect(
    JSON.stringify({ local: browserState.local, session: browserState.session }),
  ).not.toContain('ABCDEF1234567890');
  await expectNoHorizontalOverflow(page);
});
