import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

type AdminRole = 'owner' | 'manager' | 'operator';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  sort_order: number;
  is_active: boolean;
  is_available: boolean;
}

interface Category {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  products: Product[];
}

const populatedCategories: Category[] = [
  {
    id: 'category-1',
    name: 'Lanches',
    sort_order: 1,
    is_active: true,
    products: [
      {
        id: 'product-1',
        name: 'X-Salada',
        description: 'Pão, carne e salada',
        price: '29.90',
        sort_order: 1,
        is_active: true,
        is_available: true,
      },
    ],
  },
  {
    id: 'category-2',
    name: 'Bebidas',
    sort_order: 2,
    is_active: true,
    products: [],
  },
];

async function installCatalogHarness(page: Page, role: AdminRole, initial: Category[]) {
  const categories = structuredClone(initial);
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  let categorySequence = 10;
  let productSequence = 10;

  await page.addInitScript(
    ({ unitId, userId }) => {
      const session = {
        access_token: 'catalog-e2e-access-token',
        refresh_token: 'catalog-e2e-refresh-token',
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: userId,
          email: 'catalog-e2e@pedon.invalid',
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
            email: 'catalog-e2e@pedon.invalid',
            full_name: 'Usuário Catálogo E2E',
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
            email: 'catalog-e2e@pedon.invalid',
            full_name: 'Usuário Catálogo E2E',
          },
          organization: { id: ORGANIZATION_ID, name: 'Cantina Catálogo E2E' },
          role,
          units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
        },
      });
      return;
    }

    if (pathname === '/rest/v1/rpc/get_unit_catalog_admin') {
      calls.push({ rpc: 'get_unit_catalog_admin', body: request.postDataJSON() });
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_ID, name: 'Loja Centro' },
          can_manage: role !== 'operator',
          role,
          categories,
        },
      });
      return;
    }

    const rpc = pathname.replace('/rest/v1/rpc/', '');
    const body = request.postDataJSON() as Record<string, string | boolean | null>;
    calls.push({ rpc, body });

    if (rpc === 'create_catalog_category') {
      categories.push({
        id: `category-${categorySequence++}`,
        name: String(body.p_name),
        sort_order: categories.length + 1,
        is_active: true,
        products: [],
      });
    } else if (rpc === 'update_catalog_category') {
      const category = categories.find((item) => item.id === body.p_category_id);
      if (category !== undefined) category.name = String(body.p_name);
    } else if (rpc === 'set_catalog_category_active') {
      const category = categories.find((item) => item.id === body.p_category_id);
      if (category !== undefined) category.is_active = Boolean(body.p_is_active);
    } else if (rpc === 'create_catalog_product') {
      const category = categories.find((item) => item.id === body.p_category_id);
      if (category !== undefined) {
        category.products.push({
          id: `product-${productSequence++}`,
          name: String(body.p_name),
          description: body.p_description === null ? null : String(body.p_description),
          price: String(body.p_price),
          sort_order: category.products.length + 1,
          is_active: true,
          is_available: true,
        });
      }
    } else if (rpc === 'update_catalog_product') {
      const source = categories.find((category) =>
        category.products.some((product) => product.id === body.p_product_id),
      );
      const product = source?.products.find((item) => item.id === body.p_product_id);
      const target = categories.find((category) => category.id === body.p_category_id);
      if (source !== undefined && product !== undefined && target !== undefined) {
        source.products = source.products.filter((item) => item.id !== product.id);
        target.products.push({
          ...product,
          name: String(body.p_name),
          description: body.p_description === null ? null : String(body.p_description),
          price: String(body.p_price),
        });
      }
    } else if (rpc === 'set_catalog_product_active') {
      const product = categories
        .flatMap((category) => category.products)
        .find((item) => item.id === body.p_product_id);
      if (product !== undefined) product.is_active = Boolean(body.p_is_active);
    } else if (rpc === 'set_catalog_product_available') {
      const product = categories
        .flatMap((category) => category.products)
        .find((item) => item.id === body.p_product_id);
      if (product !== undefined) product.is_available = Boolean(body.p_is_available);
    }

    await route.fulfill({ status: 200, headers, json: { confirmed: true } });
  });

  return { calls, categories };
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

test('/app/catalogo sem sessão redireciona para login', async ({ page }) => {
  await page.goto('/app/catalogo');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no Ped-On' })).toBeVisible();
});

test('owner percorre vazio, categoria, produto, edição e indisponibilidade', async ({ page }) => {
  const harness = await installCatalogHarness(page, 'owner', []);
  await page.goto('/app/catalogo');

  await expect(page.getByRole('heading', { name: 'Nenhuma categoria cadastrada.' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar primeira categoria' }).click();
  await page.getByLabel('Nome da categoria').fill('Lanches');
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(page.getByRole('heading', { name: 'Lanches' })).toBeVisible();

  await page.getByRole('button', { name: 'Novo produto em Lanches' }).click();
  await page.getByLabel('Nome do produto').fill('X-Bacon');
  await page.getByLabel('Descrição (opcional)').fill('Pão, carne e bacon');
  await page.getByLabel('Preço (R$)').fill('29,90');
  await page.getByRole('button', { name: 'Criar produto' }).click();
  await expect(page.getByRole('heading', { name: 'X-Bacon' })).toBeVisible();
  await expect(page.getByText('R$ 29,90')).toBeVisible();

  await page.getByRole('button', { name: 'Editar X-Bacon' }).click();
  await page.getByLabel('Nome do produto').fill('X-Bacon especial');
  await page.getByLabel('Preço (R$)').fill('32');
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(page.getByRole('heading', { name: 'X-Bacon especial' })).toBeVisible();
  await expect(page.getByText('R$ 32,00')).toBeVisible();

  await page.getByRole('button', { name: /Marcar como indisponível/ }).click();
  await expect(page.getByText('INDISPONÍVEL', { exact: true })).toBeVisible();
  await expect
    .poll(() => harness.calls.filter((call) => call.rpc === 'set_catalog_product_available').length)
    .toBe(1);
  expect(harness.calls.find((call) => call.rpc === 'create_catalog_product')?.body).toMatchObject({
    p_price: '29.90',
  });
  await expectNoHorizontalOverflow(page);
});

test('manager gerencia categoria e edita, move e desativa produto', async ({ page }) => {
  const harness = await installCatalogHarness(page, 'manager', populatedCategories);
  await page.goto('/app/catalogo');

  await expect(page.getByText('Gerente')).toBeVisible();
  const lanches = page.getByRole('region', { name: 'Lanches' });
  await lanches.getByRole('button', { name: 'Editar categoria' }).click();
  await page.getByLabel('Nome da categoria').fill('Hambúrgueres');
  await page.getByRole('button', { name: 'Salvar categoria' }).click();
  await expect(page.getByRole('heading', { name: 'Hambúrgueres' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('region', { name: 'Hambúrgueres' })
    .getByRole('button', { name: 'Desativar categoria' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Hambúrgueres' }).getByText('INATIVA'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Editar X-Salada' }).click();
  await page.getByLabel('Categoria').selectOption('category-2');
  await page.getByLabel('Nome do produto').fill('X-Salada especial');
  await page.getByLabel('Preço (R$)').fill('31,50');
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Bebidas' })
      .getByRole('heading', { name: 'X-Salada especial' }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Desativar produto' }).click();
  await expect(page.getByRole('region', { name: 'Bebidas' }).getByText('INATIVO')).toBeVisible();
  expect(harness.calls.some((call) => call.rpc === 'update_catalog_category')).toBe(true);
  expect(harness.calls.some((call) => call.rpc === 'set_catalog_category_active')).toBe(true);
  expect(harness.calls.some((call) => call.rpc === 'update_catalog_product')).toBe(true);
  expect(harness.calls.some((call) => call.rpc === 'set_catalog_product_active')).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('operator visualiza catálogo e altera somente availability', async ({ page }) => {
  const harness = await installCatalogHarness(page, 'operator', populatedCategories);
  await page.goto('/app/catalogo');

  await expect(page.getByText('Operador', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Catálogo' })).toBeVisible();
  await expect(page.getByRole('note')).toHaveText(
    'Como operador, você pode alterar apenas a disponibilidade dos produtos.',
  );
  await expect(page.getByRole('button', { name: 'Nova categoria' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar X-Salada' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desativar produto' })).toHaveCount(0);

  await page.getByRole('button', { name: /Marcar como indisponível/ }).click();
  await expect(page.getByText('INDISPONÍVEL', { exact: true })).toBeVisible();
  await expect
    .poll(() => harness.calls.filter((call) => call.rpc === 'set_catalog_product_available').length)
    .toBe(1);
  const mutationCalls = harness.calls.filter((call) => !call.rpc.startsWith('get_'));
  expect(mutationCalls.map((call) => call.rpc)).toEqual(['set_catalog_product_available']);
  await expectNoHorizontalOverflow(page);
});
