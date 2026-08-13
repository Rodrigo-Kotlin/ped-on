import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_UNIT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-13T12:00:00.000Z';

type AdminRole = 'owner' | 'manager' | 'operator';
type RestHandler = (rpc: string | null, route: Route) => Promise<boolean>;

const jsonHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,content-profile,accept-profile,x-client-info',
  'content-type': 'application/json',
};

const readinessChecks = [
  { code: 'ORG_NAME', label: 'Nome da organização', ok: true, blocking: true, detail: 'Definido.' },
  {
    code: 'ACTIVE_UNIT',
    label: 'Unidade ativa',
    ok: true,
    blocking: true,
    detail: 'Loja Centro ativa.',
  },
  {
    code: 'OPERATIONAL',
    label: 'Configuração operacional',
    ok: true,
    blocking: true,
    detail: 'Horários, modalidades e pagamento definidos.',
  },
  {
    code: 'MENU_PUBLISHED',
    label: 'Cardápio publicado',
    ok: false,
    blocking: true,
    detail: 'Nenhuma publicação encontrada.',
  },
  {
    code: 'LOYALTY',
    label: 'Fidelidade',
    ok: false,
    blocking: false,
    detail: 'Opcional antes do piloto.',
  },
];

function readiness(ready: boolean, unitsSummary: unknown[]) {
  return {
    organization_id: ORGANIZATION_ID,
    ready,
    blocking_ok: ready ? 4 : 3,
    blocking_total: 4,
    checked_at: '2026-08-13T12:00:00.000Z',
    checks: readinessChecks,
    units_summary: unitsSummary,
  };
}

const unitsSummary = [
  {
    unit_id: UNIT_ID,
    name: 'Loja Centro',
    is_active: true,
    op_configured: true,
    hours_ok: true,
    payment_ok: true,
    catalog_ok: false,
    menu_published: false,
  },
  {
    unit_id: SECOND_UNIT_ID,
    name: 'Loja Norte',
    is_active: false,
    op_configured: false,
    hours_ok: false,
    payment_ok: false,
    catalog_ok: false,
    menu_published: false,
  },
];

const members = [
  {
    id: MEMBER_ID,
    full_name: 'Maria Silva',
    email: 'maria@example.com',
    role: 'manager',
    unit_ids: [UNIT_ID],
    created_at: CREATED_AT,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    full_name: null,
    email: 'ops@example.com',
    role: 'operator',
    unit_ids: [],
    created_at: CREATED_AT,
  },
];

function adminContext(role: AdminRole) {
  return {
    profile: { id: USER_ID, email: `staff@pedon.invalid`, full_name: 'Equipe Ped-On' },
    organization: { id: ORGANIZATION_ID, name: 'Cantina da Praça' },
    role,
    units: [
      { id: UNIT_ID, name: 'Loja Centro', is_active: true },
      { id: SECOND_UNIT_ID, name: 'Loja Norte', is_active: true },
    ],
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

async function installAdminMock(
  page: Page,
  handler: RestHandler,
  options: { role?: AdminRole; org?: boolean } = {},
) {
  const { role = 'owner', org = true } = options;
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [profile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      const context = adminContext(role);
      await fulfillJson(route, 200, org ? context : { ...context, organization: null, units: [] });
      return true;
    }
    if (rpc === 'get_org_pilot_readiness') {
      await fulfillJson(route, 200, readiness(false, unitsSummary));
      return true;
    }
    if (rpc === 'get_org_members_admin') {
      await fulfillJson(route, 200, members);
      return true;
    }
    return (await handler(rpc, route)) ?? false;
  });
}

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

test('owner vê a prontidão derivada no painel e navega para equipe', async ({ page }) => {
  await seedAdminSession(page);
  await installAdminMock(page, async () => false);

  await page.goto('/app');

  await expect(page.getByRole('heading', { name: 'Prontidão para piloto' })).toBeVisible();
  await expect(page.getByText('Em preparação (3 de 4)')).toBeVisible();
  await expect(page.getByText('Cardápio publicado')).toBeVisible();
  await expect(page.getByText('Opcional antes do piloto.')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Navegação do painel' })
    .getByRole('link', { name: 'Equipe' })
    .click();
  await expect(page.getByRole('heading', { name: 'Membros de Cantina da Praça' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('owner vê o estado pronto para piloto quando todos os bloqueios passam', async ({ page }) => {
  await seedAdminSession(page);
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [profile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, adminContext('owner'));
      return true;
    }
    if (rpc === 'get_org_pilot_readiness') {
      await fulfillJson(route, 200, readiness(true, unitsSummary));
      return true;
    }
    return false;
  });

  await page.goto('/app');

  await expect(page.getByText('Pronto para piloto')).toBeVisible();
  await expect(page.getByText('Em preparação')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('owner vincula uma unidade a um membro sem confirmação', async ({ page }) => {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  await seedAdminSession(page);
  await installAdminMock(page, async (rpc, route) => {
    if (rpc !== 'assign_unit_to_member') return false;
    calls.push({ rpc, body: route.request().postDataJSON() as Record<string, unknown> });
    await fulfillJson(route, 200, { assigned: true, already_assigned: false });
    return true;
  });

  await page.goto('/app/equipe');
  await expect(page.getByRole('heading', { name: 'Membros de Cantina da Praça' })).toBeVisible();

  const checkbox = page.getByRole('checkbox', {
    name: /Vincular Maria Silva à unidade Loja Norte/,
  });
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({
    rpc: 'assign_unit_to_member',
    body: {
      p_organization_id: ORGANIZATION_ID,
      p_user_id: MEMBER_ID,
      p_unit_id: SECOND_UNIT_ID,
    },
  });
  await expectNoHorizontalOverflow(page);
});

test('owner remove o vínculo de um membro somente após confirmar', async ({ page }) => {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  await seedAdminSession(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await installAdminMock(page, async (rpc, route) => {
    if (rpc !== 'remove_unit_from_member') return false;
    calls.push({ rpc, body: route.request().postDataJSON() as Record<string, unknown> });
    await fulfillJson(route, 200, { removed: true });
    return true;
  });

  await page.goto('/app/equipe');
  const checkbox = page.getByRole('checkbox', {
    name: /Remover acesso de Maria Silva à unidade Loja Centro/,
  });
  await expect(checkbox).toBeChecked();
  await checkbox.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({
    rpc: 'remove_unit_from_member',
    body: {
      p_organization_id: ORGANIZATION_ID,
      p_user_id: MEMBER_ID,
      p_unit_id: UNIT_ID,
    },
  });
  await expectNoHorizontalOverflow(page);
});

test('owner cancelar a remoção não chama a RPC', async ({ page }) => {
  const calls: string[] = [];
  await seedAdminSession(page);
  page.on('dialog', (dialog) => void dialog.dismiss());
  await installAdminMock(page, async (rpc) => {
    if (rpc?.includes('remove_unit_from_member')) calls.push(rpc);
    return false;
  });

  await page.goto('/app/equipe');
  const checkbox = page.getByRole('checkbox', {
    name: /Remover acesso de Maria Silva à unidade Loja Centro/,
  });
  await expect(checkbox).toBeChecked();
  await checkbox.click();

  await expect.poll(() => calls.length).toBe(0);
  expect(calls).toEqual([]);
});

test('equipe mostra estado vazio sem organização', async ({ page }) => {
  await seedAdminSession(page);
  await installAdminMock(page, async () => false, { org: false });

  await page.goto('/app/equipe');

  await expect(page.getByText('Nenhuma organização.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('diagnóstico exibe versão, contexto e conectividade sem segredos', async ({ page }) => {
  await seedAdminSession(page);
  await installAdminMock(page, async () => false);

  await page.goto('/app/diagnostico');

  await expect(page.getByRole('heading', { name: 'Versão da aplicação' })).toBeVisible();
  await expect(page.getByText('Revisão (commit)')).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Proprietário' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Cantina da Praça' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Loja Centro' })).toBeVisible();
  await expect(page.getByText(/Conexão OK\. Última verificação às/)).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('staff@pedon.invalid');
  expect(bodyText).not.toMatch(/secret|password|jwt|token|código do voucher/i);
  await expectNoHorizontalOverflow(page);
});

test('diagnóstico lista pré-requisitos por unidade e reexecuta verificação', async ({ page }) => {
  const readinessCalls: string[] = [];
  await seedAdminSession(page);
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [profile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, adminContext('owner'));
      return true;
    }
    if (rpc === 'get_org_pilot_readiness') {
      readinessCalls.push(rpc);
      await fulfillJson(route, 200, readiness(false, unitsSummary));
      return true;
    }
    return false;
  });

  await page.goto('/app/diagnostico');

  await expect(page.getByText('Em preparação (3 de 4 verificações concluídas).')).toBeVisible();
  await expect(page.getByText('configuração · horários · pagamento')).toBeVisible();
  await expect(page.getByText('sem pré-requisitos concluídos')).toBeVisible();
  await expect(page.getByText('inativa', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Executar verificação' }).click();
  await expect.poll(() => readinessCalls.length).toBeGreaterThanOrEqual(2);
  await expectNoHorizontalOverflow(page);
});

for (const path of ['equipe', 'diagnostico'] as const) {
  test(`manager não acessa /app/${path} nem chama RPC de equipe`, async ({ page }) => {
    const rpcCalls: string[] = [];
    await seedAdminSession(page);
    await installAdminMock(
      page,
      async (rpc) => {
        if (
          rpc &&
          /get_org_members_admin|assign_unit_to_member|remove_unit_from_member/.test(rpc)
        ) {
          rpcCalls.push(rpc);
        }
        return false;
      },
      { role: 'manager' },
    );

    await page.goto(`/app/${path}`);

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText('Visão geral')).toBeVisible();
    expect(rpcCalls).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
}

test('banner offline aparece e operações de equipe ficam pausadas até reconectar', async ({
  page,
}) => {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  await seedAdminSession(page);
  await installAdminMock(page, async (rpc, route) => {
    if (rpc !== 'assign_unit_to_member') return false;
    calls.push({ rpc, body: route.request().postDataJSON() as Record<string, unknown> });
    await fulfillJson(route, 200, { assigned: true, already_assigned: false });
    return true;
  });

  await page.goto('/app/equipe');
  await expect(page.getByRole('heading', { name: 'Membros de Cantina da Praça' })).toBeVisible();
  await expect(page.getByText('Sem conexão com a internet.')).toHaveCount(0);

  await page.context().setOffline(true);
  await expect(page.getByText('Sem conexão com a internet.')).toBeVisible();

  const checkbox = page.getByRole('checkbox', {
    name: /Vincular Maria Silva à unidade Loja Norte/,
  });
  await checkbox.click();
  await expect.poll(() => calls.length).toBe(0);

  await page.context().setOffline(false);
  await expect(page.getByText('Sem conexão com a internet.')).toHaveCount(0);

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({
    rpc: 'assign_unit_to_member',
    body: {
      p_organization_id: ORGANIZATION_ID,
      p_user_id: MEMBER_ID,
      p_unit_id: SECOND_UNIT_ID,
    },
  });
  await expectNoHorizontalOverflow(page);
});
