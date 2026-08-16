import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INVITEE_ID = '99999999-9999-4999-8999-999999999999';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const INVITE_ID = '77777777-7777-4777-8777-777777777777';
const CREATED_AT = '2026-08-16T12:00:00.000Z';

type RestHandler = (rpc: string | null, route: Route) => Promise<boolean>;

const jsonHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,content-profile,accept-profile,x-client-info',
  'content-type': 'application/json',
};

const ownerProfile = {
  id: USER_ID,
  email: 'staff@pedon.invalid',
  full_name: 'Equipe Ped-On',
  onboarding_status: 'completed',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const pendingProfile = {
  id: INVITEE_ID,
  email: 'invitee@example.com',
  full_name: null,
  onboarding_status: 'pending',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const completedProfile = {
  ...pendingProfile,
  onboarding_status: 'completed',
};

function ownerContext() {
  return {
    profile: { id: USER_ID, email: 'staff@pedon.invalid', full_name: 'Equipe Ped-On' },
    organization: { id: ORGANIZATION_ID, name: 'Cantina da Praça' },
    role: 'owner',
    units: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Loja Centro', is_active: true }],
  };
}

function inviteeContext() {
  return {
    profile: { id: INVITEE_ID, email: 'invitee@example.com', full_name: null },
    organization: { id: ORGANIZATION_ID, name: 'Cantina da Praça' },
    role: 'manager',
    units: [],
  };
}

const pendingInvite = {
  id: INVITE_ID,
  organization_id: ORGANIZATION_ID,
  organization_name: 'Cantina da Praça',
  role: 'manager',
  created_at: CREATED_AT,
  expires_at: '2026-08-23T12:00:00.000Z',
};

const ownerInvites = [
  {
    id: INVITE_ID,
    email: 'invitee@example.com',
    role: 'manager',
    status: 'pending',
    created_at: CREATED_AT,
    expires_at: '2026-08-23T12:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
  },
];

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

async function seedAdminSession(page: Page, userId: string) {
  await page.addInitScript(
    ({ createdAt, userId }) => {
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
      window.localStorage.removeItem('pedon:selectedUnitId');
    },
    { createdAt: CREATED_AT, userId },
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

test('owner convida um membro pelo painel de equipe', async ({ page }) => {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  await seedAdminSession(page, USER_ID);
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [ownerProfile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, ownerContext());
      return true;
    }
    if (rpc === 'get_org_member_invites') {
      await fulfillJson(route, 200, []);
      return true;
    }
    if (rpc === 'invite_org_member') {
      calls.push({ rpc, body: route.request().postDataJSON() as Record<string, unknown> });
      await fulfillJson(route, 200, {
        id: INVITE_ID,
        organization_id: ORGANIZATION_ID,
        email: 'invitee@example.com',
        role: 'operator',
        created_at: CREATED_AT,
        expires_at: '2026-08-23T12:00:00.000Z',
        status: 'pending',
        created: true,
        renewed: false,
      });
      return true;
    }
    return false;
  });

  await page.goto('/app/equipe');
  await expect(page.getByRole('heading', { name: 'Membros de Cantina da Praça' })).toBeVisible();

  await page.getByLabel('E-mail').fill('invitee@example.com');
  await page.getByLabel('Função').selectOption('operator');
  await page.getByRole('button', { name: 'Convidar membro' }).click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({
    rpc: 'invite_org_member',
    body: { p_email: 'invitee@example.com', p_role: 'operator' },
  });
  await expect(page.getByText('Convite criado para invitee@example.com.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('convidado aceita o convite e ganha acesso ao painel', async ({ page }) => {
  let accepted = false;
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  await seedAdminSession(page, INVITEE_ID);
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [accepted ? completedProfile : pendingProfile]);
      return true;
    }
    if (rpc === 'get_my_pending_member_invites') {
      await fulfillJson(route, 200, [pendingInvite]);
      return true;
    }
    if (rpc === 'accept_org_member_invite') {
      accepted = true;
      calls.push({ rpc, body: route.request().postDataJSON() as Record<string, unknown> });
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        role: 'manager',
        accepted: true,
      });
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, inviteeContext());
      return true;
    }
    if (rpc === 'get_org_pilot_readiness') {
      await fulfillJson(route, 200, {
        organization_id: ORGANIZATION_ID,
        ready: false,
        blocking_ok: 0,
        blocking_total: 9,
        checked_at: CREATED_AT,
        checks: [],
        units_summary: [],
      });
      return true;
    }
    return false;
  });

  await page.goto('/onboarding');

  await expect(page.getByRole('heading', { name: 'Configure sua conta' })).toBeVisible();
  await expect(page.getByText('Você foi convidado(a)')).toBeVisible();
  await expect(page.getByText('Cantina da Praça')).toBeVisible();
  await expect(page.getByText('Função: Gerente')).toBeVisible();

  await page.getByRole('button', { name: 'Aceitar convite' }).click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({
    rpc: 'accept_org_member_invite',
    body: { p_invite_id: INVITE_ID },
  });

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Visão geral')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('owner vê e revoga um convite pendente', async ({ page }) => {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  await seedAdminSession(page, USER_ID);
  page.on('dialog', (dialog) => void dialog.accept());
  await installRestMock(page, async (rpc, route) => {
    if (rpc === null && new URL(route.request().url()).pathname === '/rest/v1/profiles') {
      await fulfillJson(route, 200, [ownerProfile]);
      return true;
    }
    if (rpc === 'get_my_admin_context') {
      await fulfillJson(route, 200, ownerContext());
      return true;
    }
    if (rpc === 'get_org_member_invites') {
      await fulfillJson(route, 200, ownerInvites);
      return true;
    }
    if (rpc === 'revoke_org_member_invite') {
      calls.push({ rpc, body: route.request().postDataJSON() as Record<string, unknown> });
      await fulfillJson(route, 200, {
        id: INVITE_ID,
        organization_id: ORGANIZATION_ID,
        email: 'invitee@example.com',
        role: 'manager',
        status: 'revoked',
        revoked_at: CREATED_AT,
        revoked: true,
      });
      return true;
    }
    return false;
  });

  await page.goto('/app/equipe');

  await expect(page.getByRole('heading', { name: 'Membros de Cantina da Praça' })).toBeVisible();
  await expect(page.getByText('invitee@example.com')).toBeVisible();
  await expect(page.getByText(/válido até/)).toBeVisible();

  await page.getByRole('button', { name: 'Revogar' }).click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({
    rpc: 'revoke_org_member_invite',
    body: { p_invite_id: INVITE_ID },
  });
  await expect(page.getByText('Convite revogado.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
