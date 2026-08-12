import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const SLUG = 'abcdef1234567890abcdef12';
const TRACKING_TOKEN = 'a'.repeat(32);
const LOYALTY_TOKEN = 'b'.repeat(64);
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-08-11T12:00:00.000Z';

type AdminRole = 'owner' | 'manager' | 'operator';

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
  menu: { version_id: 'version-1', version_number: 1, published_at: CREATED_AT },
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
          id: 'product-1',
          name: 'X-Salada',
          description: 'Pão, carne e salada',
          price: '29.90',
          sort_order: 1,
          is_available: true,
        },
      ],
    },
  ],
};

const orderSuccess = {
  order_number: 42,
  tracking_token: TRACKING_TOKEN,
  tracking_path: `/pedido/${TRACKING_TOKEN}`,
  service_mode: 'pickup',
  payment_method: 'pix',
  subtotal: '29.90',
  delivery_fee: '0.00',
  total: '29.90',
  estimated_minutes: 20,
  created_at: CREATED_AT,
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
    subtotal: '29.90',
    delivery_fee: '0.00',
    total: '29.90',
    estimated_minutes: 20,
    created_at: CREATED_AT,
    status_updated_at: CREATED_AT,
    completed_at: null,
    cancelled_at: null,
    items: [{ name: 'X-Salada', unit_price: '29.90', quantity: 1, line_total: '29.90' }],
  },
};

function identityResult(statement: object[] = []) {
  return {
    found: true,
    membership_id: '44444444-4444-4444-8444-444444444444',
    customer: { name: 'Maria Silva', cpf_last2: '25' },
    account: { points_balance: '120', recovery_points: '5' },
    statement,
    token: { access_token: LOYALTY_TOKEN, expires_at: '2026-08-11T14:00:00.000Z' },
  };
}

async function mockPublicMenu(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_menu', (route) =>
    route.fulfill({ status: 200, headers: jsonHeaders, json: publicMenu }),
  );
  await page.route('**/rest/v1/rpc/get_public_loyalty_rewards', (route) =>
    route.fulfill({
      status: 200,
      headers: jsonHeaders,
      json: { found: true, loyalty_enabled: true, rewards: [] },
    }),
  );
}

async function mockTracking(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_order', (route) =>
    route.fulfill({ status: 200, headers: jsonHeaders, json: trackingOrder }),
  );
}

async function fulfillJson(route: Route, status: number, json: unknown) {
  await route.fulfill({ status, headers: jsonHeaders, json });
}

async function openClubLookup(page: Page) {
  await page.goto(`/clube/${SLUG}`);
  await page.getByRole('button', { name: /Consultar meus pontos/ }).click();
  const panel = page.getByRole('region', { name: 'Consultar meus pontos' });
  await panel.getByRole('textbox', { name: 'CPF', exact: true }).fill('529.982.247-25');
  await panel.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  return panel;
}

async function openCheckout(page: Page) {
  await page.goto(`/menu/${SLUG}`);
  await page.getByRole('button', { name: 'Adicionar X-Salada' }).click();
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await page.getByRole('link', { name: 'Ir para checkout' }).click();
  await page.getByLabel('Nome').fill('Maria Silva');
  await page.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
}

async function linkExistingClub(page: Page) {
  await page.getByRole('button', { name: 'Quero ganhar pontos' }).click();
  await page.getByLabel('CPF').fill('529.982.247-25');
  await page.getByRole('button', { name: 'Vincular CPF' }).click();
  await expect(page.getByText(/Vinculado:.*Maria Silva/)).toBeVisible();
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

test('Clube público cadastra com telefone e consentimento e mostra saldo com extrato vazio', async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await mockPublicMenu(page);
  await page.route('**/functions/v1/loyalty-cpf', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, identityResult());
  });

  await page.goto(`/clube/${SLUG}`);
  await page.getByRole('button', { name: /Entrar no Clube/ }).click();
  const panel = page.getByRole('region', { name: 'Entrar no Clube' });
  await panel.getByRole('textbox', { name: 'CPF', exact: true }).fill('529.982.247-25');
  await panel.getByLabel('Telefone com DDD').fill('(11) 99999-9999');
  await panel.getByLabel('Nome').fill('Maria Silva');
  await panel.getByRole('checkbox', { name: /Aceito participar do Clube Ped-On/ }).check();
  await panel.getByRole('button', { name: 'Entrar no Clube' }).click();

  await expect(page.getByRole('heading', { name: 'Olá, Maria Silva' })).toBeVisible();
  await expect(page.getByText('Pontos disponíveis').locator('..')).toContainText('120');
  await expect(page.getByText('Em recuperação').locator('..')).toContainText('5');
  await expect(page.getByText('Nenhuma movimentação de pontos ainda.')).toBeVisible();
  expect(requests).toEqual([
    {
      public_slug: SLUG,
      mode: 'enroll',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
      name: 'Maria Silva',
      consent: true,
    },
  ]);
  await expectNoHorizontalOverflow(page);
});

test('Clube público consulta cadastro e rotula ganhos, estornos e recuperação', async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await mockPublicMenu(page);
  await page.route('**/functions/v1/loyalty-cpf', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(
      route,
      200,
      identityResult([
        {
          entry_type: 'earn',
          gross_points: '35',
          points_delta: '35',
          recovery_delta: '0',
          eligible_amount: '35.50',
          order_number: 42,
          created_at: '2026-08-11T12:30:00Z',
        },
        {
          entry_type: 'reversal',
          gross_points: '20',
          points_delta: '-15',
          recovery_delta: '5',
          eligible_amount: null,
          order_number: 43,
          created_at: '2026-08-11T13:00:00Z',
        },
        {
          entry_type: 'earn',
          gross_points: '8',
          points_delta: '3',
          recovery_delta: '-5',
          eligible_amount: '8.00',
          order_number: 44,
          created_at: '2026-08-11T14:00:00Z',
        },
      ]),
    );
  });

  const panel = await openClubLookup(page);
  await panel.getByRole('button', { name: 'Consultar' }).click();

  await expect(page.getByRole('heading', { name: 'Olá, Maria Silva' })).toBeVisible();
  await expect(page.getByText('Pontos recebidos')).toHaveCount(2);
  await expect(page.getByText('Estorno de pontos')).toBeVisible();
  await expect(page.getByText('+35 pontos', { exact: true })).toBeVisible();
  await expect(page.getByText('-20 pontos', { exact: true })).toBeVisible();
  await expect(page.getByText('Em recuperação: +5 pontos')).toBeVisible();
  await expect(page.getByText('Recuperação compensada: 5 pontos')).toBeVisible();
  expect(requests[0]).toMatchObject({ mode: 'lookup', phone: '(11) 99999-9999' });
  expect(requests[0]).not.toHaveProperty('consent');
  await expectNoHorizontalOverflow(page);
});

test('Clube público trata telefone incorreto com resposta 422 genérica', async ({ page }) => {
  await mockPublicMenu(page);
  await page.route('**/functions/v1/loyalty-cpf', (route) =>
    fulfillJson(route, 422, { error: { code: 'IDENTITY_NOT_CONFIRMED' } }),
  );

  const panel = await openClubLookup(page);
  await panel.getByRole('button', { name: 'Consultar' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Não foi possível confirmar os dados informados.',
  );
  await expect(
    page.getByText('Não foi possível confirmar um cadastro com os dados informados.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText(/telefone|CPF encontrado/i);
});

test('checkout permite pedido convidado sem enviar identidade do Clube', async ({ page }) => {
  const creates: Record<string, unknown>[] = [];
  await mockPublicMenu(page);
  await mockTracking(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    creates.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, orderSuccess);
  });

  await openCheckout(page);
  await page.getByRole('button', { name: 'Enviar pedido' }).click();

  await expect(page).toHaveURL(`/pedido/${TRACKING_TOKEN}`);
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({
    p_public_slug: SLUG,
    p_payload: { customer: { name: 'Maria Silva', phone: '(11) 99999-9999' } },
  });
  expect(creates[0]).toHaveProperty('p_idempotency_key');
  expect(creates[0]).toHaveProperty('p_attempt_hash');
  expect((creates[0]?.p_payload as Record<string, unknown>).loyalty_token).toBeUndefined();
});

test('checkout vincula cadastro existente e faz fallback convidado após token expirado', async ({
  page,
}) => {
  const identityRequests: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  await mockPublicMenu(page);
  await mockTracking(page);
  await page.route('**/functions/v1/loyalty-cpf', async (route) => {
    identityRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, identityResult());
  });
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    creates.push(body);
    const payload = body.p_payload as Record<string, unknown>;
    if (payload.loyalty_token !== undefined) {
      await fulfillJson(route, 400, {
        code: 'PED52',
        message: 'LOYALTY_TOKEN_INVALID',
        details: null,
        hint: null,
      });
      return;
    }
    await fulfillJson(route, 200, orderSuccess);
  });

  await openCheckout(page);
  await linkExistingClub(page);
  expect(identityRequests[0]).toMatchObject({
    mode: 'lookup',
    phone: '(11) 99999-9999',
  });
  expect(identityRequests[0]).not.toHaveProperty('consent');

  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByRole('alert')).toContainText('consulta do Clube expirou');
  await expect(page.getByRole('button', { name: 'Quero ganhar pontos' })).toBeVisible();
  expect((creates[0]?.p_payload as Record<string, unknown>).loyalty_token).toBe(LOYALTY_TOKEN);

  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page).toHaveURL(`/pedido/${TRACKING_TOKEN}`);
  expect(creates).toHaveLength(2);
  expect((creates[1]?.p_payload as Record<string, unknown>).loyalty_token).toBeUndefined();
});

test('checkout cadastra novo membro com telefone e consentimento antes de vincular', async ({
  page,
}) => {
  const identityRequests: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  await mockPublicMenu(page);
  await mockTracking(page);
  await page.route('**/functions/v1/loyalty-cpf', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    identityRequests.push(body);
    await fulfillJson(route, 200, body.mode === 'lookup' ? { found: false } : identityResult());
  });
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    creates.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, orderSuccess);
  });

  await openCheckout(page);
  await page.getByRole('button', { name: 'Quero ganhar pontos' }).click();
  await page.getByLabel('CPF').fill('529.982.247-25');
  await page.getByRole('button', { name: 'Vincular CPF' }).click();
  const club = page.getByRole('region', { name: 'Clube Ped-On' });
  await expect(club.getByText(/Complete seu cadastro para entrar no Clube/)).toBeVisible();
  await club.getByLabel('Nome').fill('Maria Silva');
  await club.getByRole('checkbox', { name: /Aceito participar do Clube Ped-On/ }).check();
  await club.getByRole('button', { name: 'Cadastrar e vincular' }).click();
  await expect(club.getByText(/Vinculado:.*Maria Silva/)).toBeVisible();

  expect(identityRequests).toHaveLength(2);
  expect(identityRequests[0]).toMatchObject({
    mode: 'lookup',
    phone: '(11) 99999-9999',
  });
  expect(identityRequests[1]).toMatchObject({
    mode: 'enroll',
    phone: '(11) 99999-9999',
    name: 'Maria Silva',
    consent: true,
  });

  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page).toHaveURL(`/pedido/${TRACKING_TOKEN}`);
  expect((creates[0]?.p_payload as Record<string, unknown>).loyalty_token).toBe(LOYALTY_TOKEN);
});

test('checkout recupera resposta aceita após reload sem duplicar criação', async ({ page }) => {
  const creates: Record<string, unknown>[] = [];
  const recoveries: Record<string, unknown>[] = [];
  await mockPublicMenu(page);
  await mockTracking(page);
  await page.route('**/rest/v1/rpc/create_public_order_v2', async (route) => {
    creates.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 500, {
      code: '',
      message: 'Failed to fetch after the order was accepted',
      details: null,
      hint: null,
    });
  });
  await page.route('**/rest/v1/rpc/get_public_order_by_attempt', async (route) => {
    recoveries.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, 200, { found: true, ...orderSuccess });
  });

  await openCheckout(page);
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar o pedido');

  await page.reload();

  await expect(page).toHaveURL(`/pedido/${TRACKING_TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Pedido #42' })).toBeVisible();
  expect(creates).toHaveLength(1);
  expect(recoveries).toHaveLength(1);
  expect(recoveries[0]).toEqual({
    p_public_slug: SLUG,
    p_idempotency_key: creates[0]?.p_idempotency_key,
    p_attempt_hash: creates[0]?.p_attempt_hash,
  });
});

function adminContext(role: AdminRole, userId = USER_ID, suffix = 'A') {
  return {
    profile: {
      id: userId,
      email: `${suffix.toLowerCase()}@pedon.invalid`,
      full_name: `Usuário ${suffix}`,
    },
    organization: { id: ORGANIZATION_ID, name: `Cantina ${suffix}` },
    role,
    units: [{ id: UNIT_ID, name: `Loja ${suffix}`, is_active: true }],
  };
}

function member(id: string, name: string, points: number) {
  return {
    id,
    cpf_last2: id === 'member-a' ? '25' : '44',
    name,
    points_balance: String(points),
    recovery_points: '0',
    total_earned: String(points),
    total_redeemed: '0',
    total_reversed: '0',
    member_since: CREATED_AT,
  };
}

function program(enabled: boolean) {
  return {
    organization_id: ORGANIZATION_ID,
    program: enabled
      ? {
          exists: true,
          enabled,
          points_per_real: '1.00',
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        }
      : null,
    stats: {
      members_count: 2,
      total_earned: '500',
      total_redeemed: '100',
      total_reversed: '30',
    },
  };
}

async function seedAdminSession(page: Page, userId = USER_ID) {
  await page.addInitScript(
    ({ createdAt, selectedUnitId, sessionUserId }) => {
      const session = {
        access_token: `access-${sessionUserId}`,
        refresh_token: `refresh-${sessionUserId}`,
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: sessionUserId,
          email: `${sessionUserId}@pedon.invalid`,
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
    { createdAt: CREATED_AT, selectedUnitId: UNIT_ID, sessionUserId: userId },
  );
}

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: jsonHeaders });
  return true;
}

test('owner ativa e desativa com mutação parcial, refetch completo e paginação deduplicada', async ({
  page,
}) => {
  let enabled = false;
  let fullFetches = 0;
  const toggles: Record<string, unknown>[] = [];
  await seedAdminSession(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.route('**/rest/v1/**', async (route) => {
    if (await fulfillPreflight(route)) return;
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [
        {
          id: USER_ID,
          email: 'owner@pedon.invalid',
          full_name: 'Usuário A',
          onboarding_status: 'completed',
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
      ]);
      return;
    }
    if (pathname === '/rest/v1/rpc/get_my_admin_context') {
      await fulfillJson(route, 200, adminContext('owner'));
      return;
    }
    if (pathname === '/rest/v1/rpc/get_loyalty_program_admin') {
      fullFetches += 1;
      await fulfillJson(route, 200, program(enabled));
      return;
    }
    if (pathname === '/rest/v1/rpc/set_loyalty_program_enabled') {
      const body = request.postDataJSON() as Record<string, unknown>;
      toggles.push(body);
      enabled = body.p_enabled === true;
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        program: {
          exists: true,
          enabled,
          points_per_real: '1.00',
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_loyalty_members_admin') {
      const body = request.postDataJSON() as { p_cursor: string | null };
      const secondPage = body.p_cursor === 'cursor-2';
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        count: secondPage ? 2 : 1,
        has_more: !secondPage,
        next_cursor: secondPage ? null : 'cursor-2',
        members: secondPage
          ? [member('member-a', 'Maria Silva', 150), member('member-b', 'Ana Souza', 20)]
          : [member('member-a', 'Maria Silva', 150)],
      });
      return;
    }
    await fulfillJson(route, 404, { message: 'E2E route not mocked' });
  });

  await page.goto('/app/clube');
  await expect(page.getByRole('button', { name: 'Ativar Clube', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Carregar mais' }).click();
  await expect(page.getByText('Ana Souza')).toBeVisible();
  await expect(page.getByText('Maria Silva')).toHaveCount(1);
  await expect(page.getByText('2 membros exibidos')).toBeVisible();

  await page.getByRole('button', { name: 'Ativar Clube', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Desativar Clube', exact: true })).toBeVisible();
  await expect(page.getByText('Pontos acumulados').locator('..')).toContainText('500');
  await page.getByRole('button', { name: 'Desativar Clube', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ativar Clube', exact: true })).toBeVisible();

  expect(toggles).toEqual([
    { p_organization_id: ORGANIZATION_ID, p_enabled: true },
    { p_organization_id: ORGANIZATION_ID, p_enabled: false },
  ]);
  await expect.poll(() => fullFetches).toBe(3);
  await expectNoHorizontalOverflow(page);
});

for (const role of ['manager', 'operator'] as const) {
  test(`${role} não acessa a administração do Clube`, async ({ page }) => {
    let loyaltyCalls = 0;
    await seedAdminSession(page);
    await page.route('**/rest/v1/**', async (route) => {
      if (await fulfillPreflight(route)) return;
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/rest/v1/profiles') {
        await fulfillJson(route, 200, [
          {
            id: USER_ID,
            email: `${role}@pedon.invalid`,
            full_name: `Usuário ${role}`,
            onboarding_status: 'completed',
            created_at: CREATED_AT,
            updated_at: CREATED_AT,
          },
        ]);
        return;
      }
      if (pathname === '/rest/v1/rpc/get_my_admin_context') {
        await fulfillJson(route, 200, adminContext(role));
        return;
      }
      if (pathname.includes('loyalty')) loyaltyCalls += 1;
      await fulfillJson(route, 404, { message: 'E2E route not mocked' });
    });

    await page.goto('/app/clube');

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', { name: 'Clube Ped-On' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ativar Clube|Desativar Clube/ })).toHaveCount(0);
    expect(loyaltyCalls).toBe(0);
  });
}

test('troca de sessão A para B remove dados privados de A antes do refetch de B', async ({
  page,
}) => {
  const userB = '55555555-5555-4555-8555-555555555555';
  let activeUser = USER_ID;
  let releaseContextB!: () => void;
  const contextBReady = new Promise<void>((resolve) => {
    releaseContextB = resolve;
  });
  await seedAdminSession(page);
  await page.route('**/auth/v1/**', async (route) => {
    if (await fulfillPreflight(route)) return;
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/logout')) {
      await fulfillJson(route, 200, {});
      return;
    }
    if (url.pathname.endsWith('/token')) {
      activeUser = userB;
      await fulfillJson(route, 200, {
        access_token: `access-${userB}`,
        refresh_token: `refresh-${userB}`,
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: userB,
          email: 'b@pedon.invalid',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: CREATED_AT,
        },
      });
      return;
    }
    await fulfillJson(route, 404, { message: 'E2E auth route not mocked' });
  });
  await page.route('**/rest/v1/**', async (route) => {
    if (await fulfillPreflight(route)) return;
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/rest/v1/profiles') {
      const suffix = activeUser === USER_ID ? 'A' : 'B';
      await fulfillJson(route, 200, [
        {
          id: activeUser,
          email: `${suffix.toLowerCase()}@pedon.invalid`,
          full_name: `Usuário ${suffix}`,
          onboarding_status: 'completed',
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
      ]);
      return;
    }
    if (pathname === '/rest/v1/rpc/get_my_admin_context') {
      if (activeUser === userB) await contextBReady;
      await fulfillJson(
        route,
        200,
        adminContext('owner', activeUser, activeUser === USER_ID ? 'A' : 'B'),
      );
      return;
    }
    if (pathname === '/rest/v1/rpc/get_loyalty_program_admin') {
      await fulfillJson(route, 200, program(true));
      return;
    }
    if (pathname === '/rest/v1/rpc/get_loyalty_members_admin') {
      const isA = activeUser === USER_ID;
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        count: 1,
        has_more: false,
        next_cursor: null,
        members: [isA ? member('member-a', 'Membro A', 999) : member('member-b', 'Membro B', 20)],
      });
      return;
    }
    await fulfillJson(route, 404, { message: 'E2E route not mocked' });
  });

  await page.goto('/app/clube');
  await expect(page.getByText('Cantina A')).toBeVisible();
  await expect(page.getByText('Membro A')).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('E-mail').fill('b@pedon.invalid');
  await page.getByLabel('Senha').fill('senha-segura');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(/Cantina A|Membro A|999 pts/)).toHaveCount(0);

  releaseContextB();
  await expect(page.locator('header').getByRole('heading', { name: 'Cantina B' })).toBeVisible();
  await page.goto('/app/clube');
  await expect(page.getByText('Membro B')).toBeVisible();
  await expect(page.getByText('Membro A')).toHaveCount(0);
});
