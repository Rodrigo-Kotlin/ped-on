import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SLUG = 'abcdef1234567890abcdef12';

const foundMenu = {
  found: true,
  organization: { name: 'Cantina da Praça' },
  unit: { name: 'Loja Centro', is_active: true },
  loyalty: { enabled: false },
  menu: { version_id: 'version-1', version_number: 1, published_at: '2026-08-10T12:00:00.000Z' },
  operation: {
    configured: true,
    accepting_orders: true,
    revision: '2026-08-10T12:00:00.000000Z',
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
      id: 'cat-1',
      name: 'Lanches',
      sort_order: 1,
      products: [
        {
          id: 'prod-1',
          name: 'X-Salada',
          description: 'Pão, carne e salada',
          price: '29.90',
          sort_order: 1,
          is_available: true,
          is_configurable: true,
          option_groups: [],
        },
        {
          id: 'prod-3',
          name: 'X-Tudo',
          description: 'O completo',
          price: '29.90',
          sort_order: 2,
          is_available: true,
          is_configurable: true,
          option_groups: [
            {
              id: 'grp-1',
              name: 'Tamanho',
              kind: 'variation',
              selection_mode: 'single',
              min_select: 1,
              max_select: 1,
              options: [
                { id: 'opt-1', name: 'Duplo', price_delta: '5.00', is_available: true },
                { id: 'opt-4', name: 'Triplo', price_delta: '10.00', is_available: true },
              ],
            },
            {
              id: 'grp-2',
              name: 'Adicionais',
              kind: 'addon',
              selection_mode: 'multiple',
              min_select: 0,
              max_select: 2,
              options: [
                { id: 'opt-2', name: 'Bacon', price_delta: '4.00', is_available: true },
                { id: 'opt-6', name: 'Queijo', price_delta: '3.00', is_available: true },
                { id: 'opt-7', name: 'Molho da casa', price_delta: '2.00', is_available: true },
                { id: 'opt-8', name: 'Chipa', price_delta: '2.00', is_available: false },
              ],
            },
            {
              id: 'grp-3',
              name: 'Sem',
              kind: 'removal',
              selection_mode: 'multiple',
              min_select: 0,
              max_select: 3,
              options: [
                { id: 'opt-3', name: 'Sem cebola', price_delta: '0.00', is_available: true },
                { id: 'opt-5', name: 'Sem picles', price_delta: '0.00', is_available: true },
              ],
            },
          ],
        },
      ],
    },
  ],
};

async function installPublicMenuHarness(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_menu', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: foundMenu }),
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

test('4A-1 produto simples continua com Adicionar direto e preço base no carrinho', async ({
  page,
}) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Adicionar X-Salada' }).click();
  await expect(page.getByRole('link', { name: /Ver carrinho \(1\).*R\$ 29,90/ })).toBeVisible();
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await expect(page.getByRole('heading', { name: 'X-Salada' })).toBeVisible();
  await expect(page.getByText('R$ 29,90 cada')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-2 variação obrigatória bloqueia envio sem seleção', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await expect(page.getByRole('dialog', { name: 'X-Tudo' })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByRole('alert')).toHaveText('Escolha 1 opção de Tamanho.');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-3 adicionais múltiplos somam no preço e aparecem no carrinho', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('checkbox', { name: /Bacon/ }).check();
  await page.getByRole('checkbox', { name: /Queijo/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByRole('link', { name: /Ver carrinho \(1\).*R\$ 41,90/ })).toBeVisible();

  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await expect(page.getByText('Tamanho: Duplo')).toBeVisible();
  await expect(page.getByText('+ Bacon')).toBeVisible();
  await expect(page.getByText('+ Queijo')).toBeVisible();
  await expect(page.getByText('R$ 41,90 cada')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-4 remoção aparece como opção sem acréscimo', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('checkbox', { name: /Sem cebola/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();

  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await expect(page.getByText('Sem cebola')).toBeVisible();
  await expect(page.getByText('R$ 34,90 cada')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-5 limite máximo de adicionais bloqueia o envio', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('checkbox', { name: /Bacon/ }).check();
  await page.getByRole('checkbox', { name: /Queijo/ }).check();
  await page.getByRole('checkbox', { name: /Molho da casa/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByRole('alert')).toHaveText('Escolha no máximo 2 adicionais.');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-6 opção indisponível fica visível porém desabilitada', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  const chipa = page.getByRole('checkbox', { name: /Chipa/ });
  await expect(chipa).toBeDisabled();
  await expect(page.getByText('Indisponível')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-7 configurações diferentes geram linhas separadas no carrinho', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Triplo/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();

  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await expect(page.getByRole('heading', { name: 'X-Tudo' })).toHaveCount(2);
  await expect(page.getByText('R$ 34,90 cada')).toBeVisible();
  await expect(page.getByText('R$ 39,90 cada')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-8 configuração idêntica consolida quantidade na mesma linha', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();

  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await expect(page.getByRole('heading', { name: 'X-Tudo' })).toHaveCount(1);
  await expect(page.locator('output')).toHaveText('2');
  await expect(page.getByText('R$ 69,80')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

test('4A-9 recarregar a página preserva a configuração e o preço', async ({ page }) => {
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await page.getByRole('checkbox', { name: /Bacon/ }).check();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await page.getByRole('link', { name: /Ver carrinho/ }).click();
  await expect(page.getByText('Tamanho: Duplo')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Tamanho: Duplo')).toBeVisible();
  await expect(page.getByText('+ Bacon')).toBeVisible();
  await expect(page.getByText('R$ 38,90 cada')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir para checkout' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('4A-10 personalizador abre como bottom sheet no mobile 360 sem overflow', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360', 'apenas viewport 360');
  await installPublicMenuHarness(page);
  await page.goto(`/menu/${SLUG}`);

  await page.getByRole('button', { name: 'Personalizar X-Tudo' }).click();
  await expect(page.getByRole('dialog', { name: 'X-Tudo' })).toBeVisible();
  await page.getByRole('radio', { name: /Duplo/ }).check();
  await expect(page.getByText('R$ 34,90')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
