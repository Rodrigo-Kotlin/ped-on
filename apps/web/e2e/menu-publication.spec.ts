import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

type AdminRole = 'owner' | 'manager' | 'operator';

interface Version {
  version_id: string;
  version_number: number;
  created_at: string;
  category_count: number;
  product_count: number;
  is_current: boolean;
}

interface PublicationState {
  unit: { id: string; name: string; is_active: boolean };
  publication: {
    exists: boolean;
    public_slug: string | null;
    public_path: string | null;
    published_at: string | null;
    updated_at: string | null;
  };
  current_version: Version | null;
  history: Version[];
}

const SLUG = 'abcdef1234567890abcdef12';
const PUBLISHED_AT = '2026-08-10T12:00:00.000Z';

function emptyPublication(): PublicationState {
  return {
    unit: { id: UNIT_ID, name: 'Loja Centro', is_active: true },
    publication: {
      exists: false,
      public_slug: null,
      public_path: null,
      published_at: null,
      updated_at: null,
    },
    current_version: null,
    history: [],
  };
}

async function installMenuHarness(page: Page, role: AdminRole) {
  const state = emptyPublication();
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];

  await page.addInitScript(
    ({ unitId, userId }) => {
      const session = {
        access_token: 'menu-e2e-access-token',
        refresh_token: 'menu-e2e-refresh-token',
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: userId,
          email: 'menu-e2e@pedon.invalid',
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
            email: 'menu-e2e@pedon.invalid',
            full_name: 'Usuário Cardápio E2E',
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
            email: 'menu-e2e@pedon.invalid',
            full_name: 'Usuário Cardápio E2E',
          },
          organization: { id: ORGANIZATION_ID, name: 'Cantina Cardápio E2E' },
          role,
          units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
        },
      });
      return;
    }

    if (pathname === '/rest/v1/rpc/get_unit_menu_publication_admin') {
      calls.push({ rpc: 'get_unit_menu_publication_admin', body: request.postDataJSON() });
      await route.fulfill({ status: 200, headers, json: state });
      return;
    }

    if (pathname === '/rest/v1/rpc/publish_unit_menu') {
      calls.push({ rpc: 'publish_unit_menu', body: request.postDataJSON() });
      const nextNumber =
        state.history.length === 0
          ? 1
          : Math.max(...state.history.map((v) => v.version_number)) + 1;
      const version: Version = {
        version_id: `version-${nextNumber}`,
        version_number: nextNumber,
        created_at: PUBLISHED_AT,
        category_count: 2,
        product_count: 4,
        is_current: true,
      };
      state.publication = {
        exists: true,
        public_slug: SLUG,
        public_path: `/menu/${SLUG}`,
        published_at: PUBLISHED_AT,
        updated_at: PUBLISHED_AT,
      };
      state.history = [version, ...state.history.map((item) => ({ ...item, is_current: false }))];
      state.current_version = version;
      await route.fulfill({
        status: 200,
        headers,
        json: {
          version_id: version.version_id,
          version_number: version.version_number,
          published_at: PUBLISHED_AT,
          public_slug: SLUG,
          public_path: `/menu/${SLUG}`,
          category_count: version.category_count,
          product_count: version.product_count,
        },
      });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });

  return { state, calls };
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

test('/app/cardapio sem sessão redireciona para login', async ({ page }) => {
  await page.goto('/app/cardapio');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no Ped-On' })).toBeVisible();
});

test('owner publica o primeiro cardápio e vê o link público e o histórico', async ({ page }) => {
  const harness = await installMenuHarness(page, 'owner');
  await page.goto('/app/cardapio');

  await expect(page.getByText('Proprietário')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cardápio' })).toBeVisible();
  await expect(page.getByText('Este cardápio ainda não foi publicado.')).toBeVisible();

  await page.getByRole('button', { name: 'Publicar cardápio' }).click();

  await expect(page.getByText('Cardápio publicado. A versão 1 está no ar.')).toBeVisible();
  await expect(page.getByText('Cardápio publicado e no ar.')).toBeVisible();
  await expect(page.getByLabel('Link público do cardápio')).toHaveValue(
    `http://localhost:4173/menu/${SLUG}`,
  );
  await expect(page.getByRole('list')).toContainText('Versão 1');
  await expect(page.getByRole('button', { name: 'Republicar cardápio' })).toBeVisible();

  await expect
    .poll(() => harness.calls.some((call) => call.rpc === 'publish_unit_menu'))
    .toBe(true);
  expect(harness.calls.find((call) => call.rpc === 'publish_unit_menu')?.body).toEqual({
    p_unit_id: UNIT_ID,
  });
  await expectNoHorizontalOverflow(page);
});

test('owner republica com confirmação e o histórico preserva versões', async ({ page }) => {
  const harness = await installMenuHarness(page, 'owner');
  await page.goto('/app/cardapio');

  await page.getByRole('button', { name: 'Publicar cardápio' }).click();
  await expect(page.getByText('Cardápio publicado. A versão 1 está no ar.')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Republicar cardápio' }).click();

  await expect(page.getByText('Cardápio publicado. A versão 2 está no ar.')).toBeVisible();
  await expect(page.getByRole('list')).toContainText('Versão 1');
  await expect(page.getByRole('list')).toContainText('Versão 2');
  await expect(page.getByText('Atual', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Link público do cardápio')).toHaveValue(
    `http://localhost:4173/menu/${SLUG}`,
  );
  await expect
    .poll(() => harness.calls.filter((call) => call.rpc === 'publish_unit_menu').length)
    .toBe(2);
  await expectNoHorizontalOverflow(page);
});

test('manager vê o item Cardápio e a página de publicação', async ({ page }) => {
  const harness = await installMenuHarness(page, 'manager');
  await page.goto('/app/cardapio');

  await expect(page.getByText('Gerente')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cardápio' })).toBeVisible();
  await expect(page.getByText('Este cardápio ainda não foi publicado.')).toBeVisible();
  await expect.poll(() => harness.calls.length).toBeGreaterThan(0);
});

test('operator é removido do cardápio antes de carregar a publicação', async ({ page }) => {
  const harness = await installMenuHarness(page, 'operator');
  await page.goto('/app/cardapio');

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('header').getByText('Operador')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cardápio' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publicar cardápio' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Cantina Cardápio E2E' })).toBeVisible();
  expect(harness.calls.some((call) => call.rpc === 'get_unit_menu_publication_admin')).toBe(false);
  await expectNoHorizontalOverflow(page);
});
