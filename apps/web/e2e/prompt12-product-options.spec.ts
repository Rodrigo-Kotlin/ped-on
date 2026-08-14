import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

type AdminRole = 'owner' | 'manager' | 'operator';
type OptionGroupKind = 'variation' | 'addon' | 'removal';
type OptionSelectionMode = 'single' | 'multiple';

interface GroupRow {
  id: string;
  organization_id: string;
  unit_id: string;
  product_id: string;
  name: string;
  kind: OptionGroupKind;
  selection_mode: OptionSelectionMode;
  min_select: number;
  max_select: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface OptionRow {
  id: string;
  organization_id: string;
  unit_id: string;
  product_id: string;
  group_id: string;
  name: string;
  price_delta: string;
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const seededGroups: GroupRow[] = [
  {
    id: 'g-1',
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    product_id: 'product-1',
    name: 'Tamanho',
    kind: 'variation',
    selection_mode: 'single',
    min_select: 1,
    max_select: 1,
    is_active: true,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'g-2',
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    product_id: 'product-1',
    name: 'Adicionais',
    kind: 'addon',
    selection_mode: 'multiple',
    min_select: 0,
    max_select: 3,
    is_active: true,
    sort_order: 2,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const seededOptions: OptionRow[] = [
  {
    id: 'o-1',
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    product_id: 'product-1',
    group_id: 'g-1',
    name: 'Médio',
    price_delta: '0.00',
    is_active: true,
    is_available: true,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'o-2',
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    product_id: 'product-1',
    group_id: 'g-1',
    name: 'Grande',
    price_delta: '4.00',
    is_active: true,
    is_available: true,
    sort_order: 2,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'o-3',
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    product_id: 'product-1',
    group_id: 'g-2',
    name: 'Queijo extra',
    price_delta: '5.00',
    is_active: true,
    is_available: false,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

async function installOptionsHarness(
  page: Page,
  role: AdminRole,
  groups: GroupRow[] = seededGroups,
  options: OptionRow[] = seededOptions,
) {
  const groupsState = structuredClone(groups);
  const optionsState = structuredClone(options);
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  let groupSequence = 100;
  let optionSequence = 100;

  await page.addInitScript(
    ({ unitId, userId }) => {
      const session = {
        access_token: 'prompt12-e2e-access-token',
        refresh_token: 'prompt12-e2e-refresh-token',
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: userId,
          email: 'prompt12-e2e@pedon.invalid',
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

    if (request.method() === 'GET') {
      if (pathname === '/rest/v1/profiles') {
        await route.fulfill({
          status: 200,
          headers,
          json: [
            {
              id: USER_ID,
              email: 'prompt12-e2e@pedon.invalid',
              full_name: 'Usuário Opções E2E',
              onboarding_status: 'completed',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
        return;
      }

      if (pathname === '/rest/v1/catalog_product_option_groups') {
        await route.fulfill({ status: 200, headers, json: groupsState });
        return;
      }

      if (pathname === '/rest/v1/catalog_product_options') {
        await route.fulfill({ status: 200, headers, json: optionsState });
        return;
      }

      await route.fulfill({ status: 404, headers, json: { message: 'Not found' } });
      return;
    }

    if (pathname === '/rest/v1/rpc/get_my_admin_context') {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          profile: {
            id: USER_ID,
            email: 'prompt12-e2e@pedon.invalid',
            full_name: 'Usuário Opções E2E',
          },
          organization: { id: ORGANIZATION_ID, name: 'Cantina Opções E2E' },
          role,
          units: [{ id: UNIT_ID, name: 'Loja Centro', is_active: true }],
        },
      });
      return;
    }

    if (pathname === '/rest/v1/rpc/get_unit_catalog_admin') {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_ID, name: 'Loja Centro' },
          can_manage: role !== 'operator',
          role,
          categories: [
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
          ],
        },
      });
      return;
    }

    const rpc = pathname.replace('/rest/v1/rpc/', '');
    const body = request.postDataJSON() as Record<string, string | number | boolean | null>;
    calls.push({ rpc, body });

    if (rpc === 'create_catalog_product_option_group') {
      groupsState.push({
        id: `group-${groupSequence++}`,
        organization_id: ORGANIZATION_ID,
        unit_id: String(body.p_unit_id),
        product_id: String(body.p_product_id),
        name: String(body.p_name),
        kind: body.p_kind as OptionGroupKind,
        selection_mode: body.p_selection_mode as OptionSelectionMode,
        min_select: Number(body.p_min_select),
        max_select: Number(body.p_max_select),
        is_active: true,
        sort_order: groupsState.length + 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    } else if (rpc === 'update_catalog_product_option_group') {
      const group = groupsState.find((item) => item.id === body.p_group_id);
      if (group !== undefined) {
        group.name = String(body.p_name);
        group.kind = body.p_kind as OptionGroupKind;
        group.selection_mode = body.p_selection_mode as OptionSelectionMode;
        group.min_select = Number(body.p_min_select);
        group.max_select = Number(body.p_max_select);
      }
    } else if (rpc === 'set_catalog_product_option_group_active') {
      const group = groupsState.find((item) => item.id === body.p_group_id);
      if (group !== undefined) group.is_active = Boolean(body.p_is_active);
    } else if (rpc === 'create_catalog_product_option') {
      optionsState.push({
        id: `option-${optionSequence++}`,
        organization_id: ORGANIZATION_ID,
        unit_id: String(body.p_unit_id),
        product_id: String(body.p_product_id),
        group_id: String(body.p_group_id),
        name: String(body.p_name),
        price_delta: String(body.p_price_delta),
        is_active: true,
        is_available: true,
        sort_order: optionsState.length + 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    } else if (rpc === 'update_catalog_product_option') {
      const option = optionsState.find((item) => item.id === body.p_option_id);
      if (option !== undefined) {
        option.name = String(body.p_name);
        option.price_delta = String(body.p_price_delta);
      }
    } else if (rpc === 'set_catalog_product_option_active') {
      const option = optionsState.find((item) => item.id === body.p_option_id);
      if (option !== undefined) option.is_active = Boolean(body.p_is_active);
    } else if (rpc === 'set_catalog_product_option_available') {
      const option = optionsState.find((item) => item.id === body.p_option_id);
      if (option !== undefined) option.is_available = Boolean(body.p_is_available);
    }

    await route.fulfill({ status: 200, headers, json: { confirmed: true } });
  });

  return { calls, groups: groupsState, options: optionsState };
}

async function openPanel(page: Page) {
  await page.goto('/app/catalogo');
  await expect(page.getByRole('heading', { level: 4, name: 'X-Salada' })).toBeVisible();
  await page.getByRole('button', { name: /Opções e adicionais/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'X-Salada' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tamanho' })).toBeVisible();
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

test('owner abre o painel e vê grupos e opções formatados', async ({ page }) => {
  await installOptionsHarness(page, 'owner');
  await openPanel(page);

  const tamanho = page.getByRole('region', { name: 'Tamanho' });
  await expect(tamanho.getByText('Variação')).toBeVisible();
  await expect(tamanho.getByText('Obrigatório — escolha 1')).toBeVisible();
  await expect(tamanho.getByText('2 opções')).toBeVisible();
  await expect(tamanho.getByText('Médio', { exact: true })).toBeVisible();
  await expect(tamanho.getByText('Sem acréscimo')).toBeVisible();
  await expect(tamanho.getByText('Grande', { exact: true })).toBeVisible();
  await expect(tamanho.getByText('+ R$ 4,00')).toBeVisible();

  const adicionais = page.getByRole('region', { name: 'Adicionais' });
  await expect(adicionais.getByText('Adicional')).toBeVisible();
  await expect(adicionais.getByText('Opcional — escolha até 3')).toBeVisible();
  await expect(adicionais.getByText('Queijo extra', { exact: true })).toBeVisible();
  await expect(adicionais.getByText('+ R$ 5,00')).toBeVisible();
  await expect(adicionais.getByText('INDISPONÍVEL', { exact: true })).toBeVisible();

  await expectNoHorizontalOverflow(page);
});

test('owner cria grupo de variação obrigatória', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await page.getByLabel('Nome do grupo').fill('Tamanho do pão');
  await page.getByLabel('Tipo').selectOption('variation');
  await expect(page.getByLabel('Modo de seleção')).toBeDisabled();
  await expect(page.getByLabel('Modo de seleção')).toHaveValue('single');
  await expect(page.getByLabel('Mínimo')).toHaveValue('1');
  await expect(page.getByLabel('Máximo')).toBeDisabled();
  await expect(page.getByLabel('Máximo')).toHaveValue('1');

  await page.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByText('Grupo criado com sucesso.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tamanho do pão' })).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'create_catalog_product_option_group')?.body,
  ).toMatchObject({
    p_name: 'Tamanho do pão',
    p_kind: 'variation',
    p_selection_mode: 'single',
    p_min_select: 1,
    p_max_select: 1,
  });
  await expectNoHorizontalOverflow(page);
});

test('owner cria grupo de adicionais opcionais', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await page.getByLabel('Nome do grupo').fill('Extras');
  await page.getByLabel('Máximo').fill('3');

  await page.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByText('Grupo criado com sucesso.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Extras' })).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'create_catalog_product_option_group')?.body,
  ).toMatchObject({
    p_name: 'Extras',
    p_kind: 'addon',
    p_selection_mode: 'multiple',
    p_min_select: 0,
    p_max_select: 3,
  });
});

test('owner cria grupo de remoções com regras fixas', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await page.getByLabel('Nome do grupo').fill('Retirar ingredientes');
  await page.getByLabel('Tipo').selectOption('removal');
  await expect(page.getByLabel('Modo de seleção')).toBeDisabled();
  await expect(page.getByLabel('Modo de seleção')).toHaveValue('multiple');
  await expect(page.getByLabel('Mínimo')).toBeDisabled();
  await expect(page.getByLabel('Mínimo')).toHaveValue('0');
  await expect(page.getByLabel('Máximo')).toHaveValue('5');

  await page.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByText('Grupo criado com sucesso.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Retirar ingredientes' })).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'create_catalog_product_option_group')?.body,
  ).toMatchObject({
    p_name: 'Retirar ingredientes',
    p_kind: 'removal',
    p_selection_mode: 'multiple',
    p_min_select: 0,
    p_max_select: 5,
  });
});

test('validação rejeita mínimo maior que máximo sem chamar RPC', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await page.getByLabel('Nome do grupo').fill('Regra inválida');
  await page.getByLabel('Mínimo').fill('3');
  await page.getByLabel('Máximo').fill('2');

  await page.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByRole('alert')).toHaveText('O mínimo não pode ser maior que o máximo.');
  await expect(page.getByRole('region', { name: 'Regra inválida' })).toHaveCount(0);
  expect(
    harness.calls.filter((call) => call.rpc === 'create_catalog_product_option_group'),
  ).toHaveLength(0);
});

test('owner cria opção adicional com preço positivo', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  const adicionais = page.getByRole('region', { name: 'Adicionais' });
  await adicionais.getByRole('button', { name: 'Nova opção' }).click();
  await page.getByLabel('Nome da opção').fill('Bacon extra');
  await page.getByLabel('Preço adicional (R$)').fill('4,50');

  await page.getByRole('button', { name: 'Criar opção' }).click();
  await expect(page.getByText('Opção criada com sucesso.')).toBeVisible();
  await expect(adicionais.getByText('Bacon extra', { exact: true })).toBeVisible();
  await expect(adicionais.getByText('+ R$ 4,50')).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'create_catalog_product_option')?.body,
  ).toMatchObject({
    p_group_id: 'g-2',
    p_name: 'Bacon extra',
    p_price_delta: '4.50',
  });
});

test('owner cria opção de variação com desconto', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  const tamanho = page.getByRole('region', { name: 'Tamanho' });
  await tamanho.getByRole('button', { name: 'Nova opção' }).click();
  await page.getByLabel('Nome da opção').fill('Média');
  await page.getByLabel('Preço adicional (R$)').fill('-2,00');

  await page.getByRole('button', { name: 'Criar opção' }).click();
  await expect(page.getByText('Opção criada com sucesso.')).toBeVisible();
  await expect(tamanho.getByText('Média', { exact: true })).toBeVisible();
  await expect(tamanho.getByText('- R$ 2,00')).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'create_catalog_product_option')?.body,
  ).toMatchObject({
    p_group_id: 'g-1',
    p_name: 'Média',
    p_price_delta: '-2.00',
  });
});

test('owner cria opção de remoção sempre sem acréscimo', async ({ page }) => {
  const removalGroup: GroupRow = {
    id: 'g-3',
    organization_id: ORGANIZATION_ID,
    unit_id: UNIT_ID,
    product_id: 'product-1',
    name: 'Remover',
    kind: 'removal',
    selection_mode: 'multiple',
    min_select: 0,
    max_select: 5,
    is_active: true,
    sort_order: 3,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const harness = await installOptionsHarness(page, 'owner', [...seededGroups, removalGroup]);
  await openPanel(page);

  const remover = page.getByRole('region', { name: 'Remover' });
  await remover.getByRole('button', { name: 'Nova opção' }).click();
  await expect(page.getByLabel('Preço adicional (remoção sem acréscimo)')).toHaveValue(
    'Sem acréscimo',
  );
  await page.getByLabel('Nome da opção').fill('Sem cebola');

  await page.getByRole('button', { name: 'Criar opção' }).click();
  await expect(page.getByText('Opção criada com sucesso.')).toBeVisible();
  await expect(remover.getByText('Sem cebola', { exact: true })).toBeVisible();
  await expect(remover.getByText('Sem acréscimo')).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'create_catalog_product_option')?.body,
  ).toMatchObject({
    p_group_id: 'g-3',
    p_name: 'Sem cebola',
    p_price_delta: '0.00',
  });
});

test('owner edita grupo e edita opção existentes', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  const adicionais = page.getByRole('region', { name: 'Adicionais' });
  await adicionais.getByRole('button', { name: 'Editar grupo' }).click();
  await page.getByLabel('Nome do grupo').fill('Extras');
  await page.getByLabel('Máximo').fill('4');

  await page.getByRole('button', { name: 'Salvar grupo' }).click();
  await expect(page.getByText('Grupo atualizado com sucesso.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Extras' })).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'update_catalog_product_option_group')?.body,
  ).toMatchObject({
    p_group_id: 'g-2',
    p_name: 'Extras',
    p_max_select: 4,
  });

  const extras = page.getByRole('region', { name: 'Extras' });
  await extras.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Nome da opção').fill('Extra queijo');
  await page.getByLabel('Preço adicional (R$)').fill('6,00');

  await page.getByRole('button', { name: 'Salvar opção' }).click();
  await expect(page.getByText('Opção atualizada com sucesso.')).toBeVisible();
  await expect(extras.getByText('Extra queijo', { exact: true })).toBeVisible();
  await expect(extras.getByText('+ R$ 6,00')).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'update_catalog_product_option')?.body,
  ).toMatchObject({
    p_option_id: 'o-3',
    p_name: 'Extra queijo',
    p_price_delta: '6.00',
  });
});

test('owner desativa grupo após confirmar', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  page.once('dialog', (dialog) => dialog.accept());
  const adicionais = page.getByRole('region', { name: 'Adicionais' });
  await adicionais.getByRole('button', { name: 'Desativar grupo' }).click();

  await expect(page.getByText('Grupo desativado com sucesso.')).toBeVisible();
  await expect(adicionais.getByText('INATIVO', { exact: true })).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'set_catalog_product_option_group_active')?.body,
  ).toMatchObject({
    p_group_id: 'g-2',
    p_is_active: false,
  });
});

test('owner desativa opção e alterna disponibilidade', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  const adicionais = page.getByRole('region', { name: 'Adicionais' });
  await adicionais.getByRole('button', { name: 'Desativar', exact: true }).click();
  await expect(page.getByText('Opção desativada com sucesso.')).toBeVisible();
  await expect(adicionais.getByText('INATIVA', { exact: true })).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'set_catalog_product_option_active')?.body,
  ).toMatchObject({
    p_option_id: 'o-3',
    p_is_active: false,
  });

  await page.getByRole('button', { name: /Indisponível\s*:\s*Médio/ }).click();
  await expect(page.getByText('Opção marcada como indisponível.')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Tamanho' }).getByText('INDISPONÍVEL', { exact: true }),
  ).toBeVisible();
  expect(
    harness.calls.find((call) => call.rpc === 'set_catalog_product_option_available')?.body,
  ).toMatchObject({
    p_option_id: 'o-1',
    p_is_available: false,
  });
});

test('operador visualiza grupos e altera somente disponibilidade', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'operator');
  await openPanel(page);

  await expect(page.getByText(/Como operador, você pode visualizar os grupos/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo grupo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova opção' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar grupo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desativar', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /Disponível\s*:\s*Queijo extra/ }).click();
  await expect(page.getByText('Opção marcada como disponível.')).toBeVisible();
  const mutationCalls = harness.calls.filter((call) => !call.rpc.startsWith('get_'));
  expect(mutationCalls.map((call) => call.rpc)).toEqual(['set_catalog_product_option_available']);
  await expectNoHorizontalOverflow(page);
});

test('offline pausa todas as mutações até reconectar', async ({ page }) => {
  const harness = await installOptionsHarness(page, 'owner');
  await openPanel(page);

  await page.context().setOffline(true);
  await expect(page.getByText(/Você está offline/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo grupo' })).toBeDisabled();
  for (const button of await page.getByRole('button', { name: 'Editar grupo' }).all()) {
    await expect(button).toBeDisabled();
  }
  for (const button of await page.getByRole('button', { name: 'Desativar grupo' }).all()) {
    await expect(button).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: /Indisponível\s*:\s*Médio/ })).toBeDisabled();
  const createOptionButtons = page.getByRole('button', { name: 'Nova opção' });
  await expect(createOptionButtons).toHaveCount(2);
  for (const button of await createOptionButtons.all()) {
    await expect(button).toBeDisabled();
  }

  await page.context().setOffline(false);
  await expect(page.getByText(/Você está offline/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Novo grupo' })).toBeEnabled();

  const mutationCalls = harness.calls.filter((call) => !call.rpc.startsWith('get_'));
  expect(mutationCalls).toHaveLength(0);
  await expectNoHorizontalOverflow(page);
});
