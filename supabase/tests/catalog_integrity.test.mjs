import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { Client } = pg;

let dbPassword = process.env.SUPABASE_DB_PASSWORD;
if (!dbPassword) {
  const envText = await readFile(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
  dbPassword = envText
    .split(/\r?\n/)
    .find((line) => line.startsWith('SUPABASE_DB_PASSWORD='))
    ?.slice('SUPABASE_DB_PASSWORD='.length);
}
if (!dbPassword) {
  console.error('SUPABASE_DB_PASSWORD não encontrada em ambiente nem em .env.');
  process.exit(2);
}

const password = encodeURIComponent(dbPassword);
const DIRECT_URL = `postgresql://postgres:${password}@db.zmuxkztnilnzjyyojbbr.supabase.co:5432/postgres`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function scenario(number, label) {
  console.log(`Cenário ${number} — ${label}`);
}

async function adminClient() {
  const c = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

async function sessionFor(userId) {
  const c = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('set role authenticated');
  await c.query(`set request.jwt.claims = '{"sub": "${userId}", "role": "authenticated"}'`);
  await c.query(`set request.jwt.claim.sub = '${userId}'`);
  return c;
}

async function anonClient() {
  const c = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('set role anon');
  return c;
}

async function authedNoSubClient() {
  const c = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('set role authenticated');
  await c.query(`set request.jwt.claims = '{"role": "authenticated"}'`);
  return c;
}

async function createTestUser(admin, email) {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
     values ($1, $2, crypt('TestPassw0rd!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now())`,
    [id, email],
  );
  return { id, email };
}

async function expectError(client, sql, params, expectedCode, label) {
  try {
    await client.query(sql, params);
    ok(false, `${label} (esperava erro ${expectedCode}, nenhum erro ocorreu)`);
    return null;
  } catch (error) {
    ok(error.code === expectedCode, `${label} (code=${error.code}, esperado ${expectedCode})`);
    return error;
  }
}

async function createCategory(client, unitId, name) {
  return (
    await client.query('select * from public.create_catalog_category($1, $2)', [unitId, name])
  ).rows[0];
}

async function createProduct(client, unitId, categoryId, name, description, price) {
  return (
    await client.query('select * from public.create_catalog_product($1, $2, $3, $4, $5)', [
      unitId,
      categoryId,
      name,
      description,
      price,
    ])
  ).rows[0];
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  try {
    const ownerA = await createTestUser(admin, `catalog-owner-a-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id);
    const managerA = await createTestUser(admin, `catalog-manager-a-${suffix}@pedon-test.invalid`);
    createdUsers.push(managerA.id);
    const operatorA = await createTestUser(
      admin,
      `catalog-operator-a-${suffix}@pedon-test.invalid`,
    );
    createdUsers.push(operatorA.id);
    const ownerB = await createTestUser(admin, `catalog-owner-b-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerB.id);

    const ownerAS = await sessionFor(ownerA.id);
    openClients.push(ownerAS);
    const managerAS = await sessionFor(managerA.id);
    openClients.push(managerAS);
    const operatorAS = await sessionFor(operatorA.id);
    openClients.push(operatorAS);
    const ownerBS = await sessionFor(ownerB.id);
    openClients.push(ownerBS);
    const noSubS = await authedNoSubClient();
    openClients.push(noSubS);
    const anon = await anonClient();
    openClients.push(anon);

    const orgA = (await ownerAS.query(`select public.complete_onboarding('Org A Catalog') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);
    const unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    const unitA2 = (await ownerAS.query('select (public.create_unit($1)).id as id', ['Filial A2']))
      .rows[0].id;

    const orgB = (await ownerBS.query(`select public.complete_onboarding('Org B Catalog') as org`))
      .rows[0].org;
    createdOrgIds.push(orgB);
    const unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB],
      )
    ).rows[0].id;
    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'manager'), ($1, $3, 'operator')`,
      [orgA, managerA.id, operatorA.id],
    );
    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3), ($1, $4, $3)`,
      [orgA, managerA.id, unitA1, operatorA.id],
    );

    // ============================================================
    // Leitura, autenticação e isolamento
    // ============================================================
    scenario(1, 'owner lê catálogo vazio com metadados administrativos');
    const ownerEmpty = (
      await ownerAS.query('select public.get_unit_catalog_admin($1) as catalog', [unitA1])
    ).rows[0].catalog;
    ok(
      ownerEmpty.unit.id === unitA1 && ownerEmpty.unit.name === 'Unidade principal',
      'unit correta',
    );
    ok(ownerEmpty.role === 'owner' && ownerEmpty.can_manage === true, 'owner pode gerenciar');
    ok(
      Array.isArray(ownerEmpty.categories) && ownerEmpty.categories.length === 0,
      'categorias vazias',
    );

    scenario(2, 'manager vinculado lê catálogo e pode gerenciar');
    const managerEmpty = (
      await managerAS.query('select public.get_unit_catalog_admin($1) as catalog', [unitA1])
    ).rows[0].catalog;
    ok(
      managerEmpty.role === 'manager' && managerEmpty.can_manage === true,
      'manager vinculado gerencia',
    );

    scenario(3, 'operator vinculado lê catálogo sem gestão estrutural');
    const operatorEmpty = (
      await operatorAS.query('select public.get_unit_catalog_admin($1) as catalog', [unitA1])
    ).rows[0].catalog;
    ok(
      operatorEmpty.role === 'operator' && operatorEmpty.can_manage === false,
      'operator apenas acessa',
    );

    scenario(4, 'anon obtém zero linhas nas duas tabelas por RLS');
    const anonCategories = await anon.query('select * from public.catalog_categories');
    const anonProducts = await anon.query('select * from public.catalog_products');
    ok(anonCategories.rows.length === 0, 'anon vê zero categorias');
    ok(anonProducts.rows.length === 0, 'anon vê zero produtos');

    scenario(5, 'anon não executa nenhuma RPC de catálogo');
    await expectError(
      anon,
      'select public.get_unit_catalog_admin($1)',
      [unitA1],
      '42501',
      'EXECUTE de get revogado de anon',
    );
    await expectError(
      anon,
      'select public.create_catalog_category($1, $2)',
      [unitA1, 'Anon'],
      '42501',
      'EXECUTE de create revogado de anon',
    );

    scenario(6, 'authenticated sem identidade recebe PED10');
    await expectError(
      noSubS,
      'select public.get_unit_catalog_admin($1)',
      [unitA1],
      'PED10',
      'get sem auth.uid: PED10',
    );
    await expectError(
      noSubS,
      'select public.create_catalog_category($1, $2)',
      [unitA1, 'Sem identidade'],
      'PED10',
      'create sem auth.uid: PED10',
    );

    scenario(7, 'manager não lê unidade sem vínculo no mesmo tenant');
    await expectError(
      managerAS,
      'select public.get_unit_catalog_admin($1)',
      [unitA2],
      'PED11',
      'cross-unit: PED11',
    );

    scenario(8, 'owner não lê unidade de outro tenant');
    await expectError(
      ownerAS,
      'select public.get_unit_catalog_admin($1)',
      [unitB1],
      'PED11',
      'cross-tenant: PED11',
    );

    scenario(9, 'unidade inexistente retorna PED12');
    await expectError(
      ownerAS,
      'select public.get_unit_catalog_admin($1)',
      [randomUUID()],
      'PED12',
      'unit not found: PED12',
    );

    // ============================================================
    // Categorias e escrita direta
    // ============================================================
    scenario(10, 'owner cria categoria com trim e ordem server-side');
    const categoryMain = await createCategory(ownerAS, unitA1, '  Lanches  ');
    ok(categoryMain.name === 'Lanches', 'nome de categoria normalizado');
    ok(categoryMain.sort_order === 100, 'primeira categoria recebe sort_order 100');
    ok(categoryMain.organization_id === orgA && categoryMain.unit_id === unitA1, 'escopo derivado');

    scenario(11, 'manager cria categoria na unidade vinculada');
    const categoryDrinks = await createCategory(managerAS, unitA1, 'Bebidas');
    ok(categoryDrinks.sort_order === 200, 'manager cria segunda categoria com ordem 200');

    scenario(12, 'operator não cria categoria');
    await expectError(
      operatorAS,
      'select public.create_catalog_category($1, $2)',
      [unitA1, 'Operador'],
      'PED11',
      'operator estrutural: PED11',
    );

    scenario(13, 'manager não cria categoria em outra unidade');
    await expectError(
      managerAS,
      'select public.create_catalog_category($1, $2)',
      [unitA2, 'Cross unit'],
      'PED11',
      'manager sem vínculo: PED11',
    );

    scenario(14, 'owner não cria categoria em outro tenant');
    await expectError(
      ownerAS,
      'select public.create_catalog_category($1, $2)',
      [unitB1, 'Cross tenant'],
      'PED11',
      'owner cross-tenant: PED11',
    );

    scenario(15, 'nome de categoria obrigatório retorna PED21');
    await expectError(
      ownerAS,
      'select public.create_catalog_category($1, $2)',
      [unitA1, '   '],
      'PED21',
      'categoria vazia: PED21',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_category($1, $2)',
      [unitA1, null],
      'PED21',
      'categoria null: PED21',
    );

    scenario(16, 'limite de categoria aceita 80 e rejeita 81 caracteres');
    const category80 = await createCategory(ownerAS, unitA1, 'C'.repeat(80));
    ok(category80.name.length === 80, 'categoria de 80 caracteres aceita');
    await expectError(
      ownerAS,
      'select public.create_catalog_category($1, $2)',
      [unitA1, 'C'.repeat(81)],
      'PED22',
      'categoria de 81 caracteres: PED22',
    );

    scenario(17, 'duplicidade case-insensitive e com trim retorna PED23');
    await expectError(
      ownerAS,
      'select public.create_catalog_category($1, $2)',
      [unitA1, '  lAnChEs '],
      'PED23',
      'duplicata funcional: PED23',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_category($1, $2)',
      [category80.id, ' LANCHES '],
      'PED23',
      'conflito no update: PED23',
    );

    scenario(18, 'update de categoria normaliza o nome');
    const updatedCategory = (
      await managerAS.query('select * from public.update_catalog_category($1, $2)', [
        categoryDrinks.id,
        '  Bebidas geladas  ',
      ])
    ).rows[0];
    ok(updatedCategory.name === 'Bebidas geladas', 'update aplica trim');
    ok(updatedCategory.sort_order === categoryDrinks.sort_order, 'update preserva sort_order');

    scenario(19, 'update de categoria valida ausência e tamanho');
    await expectError(
      ownerAS,
      'select public.update_catalog_category($1, $2)',
      [categoryMain.id, ''],
      'PED21',
      'update vazio: PED21',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_category($1, $2)',
      [categoryMain.id, 'X'.repeat(81)],
      'PED22',
      'update longo: PED22',
    );

    scenario(20, 'categoria inexistente retorna PED20');
    await expectError(
      ownerAS,
      'select public.update_catalog_category($1, $2)',
      [randomUUID(), 'Inexistente'],
      'PED20',
      'category not found: PED20',
    );

    const categoryA2 = await createCategory(ownerAS, unitA2, 'Categoria A2');
    const categoryB1 = await createCategory(ownerBS, unitB1, 'Categoria B1');

    scenario(21, 'INSERT direto em categorias é negado');
    await expectError(
      ownerAS,
      `insert into public.catalog_categories (organization_id, unit_id, name, sort_order)
       values ($1, $2, 'Direta', 999)`,
      [orgA, unitA1],
      '42501',
      'INSERT categoria direto negado',
    );

    scenario(22, 'UPDATE direto em categorias é negado');
    await expectError(
      ownerAS,
      'update public.catalog_categories set sort_order = 999 where id = $1',
      [categoryMain.id],
      '42501',
      'UPDATE categoria direto negado',
    );

    scenario(23, 'DELETE direto em categorias é negado');
    await expectError(
      ownerAS,
      'delete from public.catalog_categories where id = $1',
      [categoryMain.id],
      '42501',
      'DELETE categoria direto negado',
    );

    // ============================================================
    // Produtos, normalização e preço decimal
    // ============================================================
    scenario(24, 'owner cria produto normalizado com preço 29.90');
    const productMain = await createProduct(
      ownerAS,
      unitA1,
      categoryMain.id,
      '  X-Burger  ',
      '  Pão, carne e queijo  ',
      '29.90',
    );
    ok(productMain.name === 'X-Burger', 'nome do produto normalizado');
    ok(productMain.description === 'Pão, carne e queijo', 'descrição normalizada');
    ok(productMain.price === '29.90', '29.90 preservado como numeric textual');
    ok(productMain.sort_order === 100, 'primeiro produto recebe sort_order 100');

    scenario(25, 'manager cria produto de 0.01 na unidade vinculada');
    const productSecond = await createProduct(
      managerAS,
      unitA1,
      categoryMain.id,
      'Adicional',
      null,
      '0.01',
    );
    ok(productSecond.price === '0.01', 'preço mínimo 0.01 aceito');
    ok(productSecond.sort_order === 200, 'segundo produto recebe sort_order 200');

    scenario(26, 'operator não cria produto');
    await expectError(
      operatorAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitA1, categoryMain.id, 'Operador', null, '1.00'],
      'PED11',
      'operator estrutural: PED11',
    );

    scenario(27, 'manager não cria produto em unidade sem vínculo');
    await expectError(
      managerAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitA2, categoryA2.id, 'Cross unit', null, '1.00'],
      'PED11',
      'create product cross-unit: PED11',
    );

    scenario(28, 'owner não cria produto em outro tenant');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitB1, categoryB1.id, 'Cross tenant', null, '1.00'],
      'PED11',
      'create product cross-tenant: PED11',
    );

    scenario(29, 'nome de produto obrigatório retorna PED25');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitA1, categoryMain.id, '  ', null, '1.00'],
      'PED25',
      'produto vazio: PED25',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitA1, categoryMain.id, null, null, '1.00'],
      'PED25',
      'produto null: PED25',
    );

    scenario(30, 'limite de produto aceita 120 e rejeita 121 caracteres');
    const product120 = await createProduct(
      ownerAS,
      unitA1,
      categoryDrinks.id,
      'P'.repeat(120),
      null,
      '1.00',
    );
    ok(product120.name.length === 120, 'produto de 120 caracteres aceito');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitA1, categoryDrinks.id, 'P'.repeat(121), null, '1.00'],
      'PED26',
      'produto de 121 caracteres: PED26',
    );

    scenario(31, 'descrição vazia é normalizada para null');
    const emptyDescription = await createProduct(
      ownerAS,
      unitA1,
      categoryDrinks.id,
      'Água',
      '   ',
      '2.00',
    );
    ok(emptyDescription.description === null, 'descrição vazia vira null');

    scenario(32, 'descrição aceita 500 e rejeita 501 caracteres');
    const description500 = await createProduct(
      ownerAS,
      unitA1,
      categoryDrinks.id,
      'Descrição limite',
      'D'.repeat(500),
      '2.00',
    );
    ok(description500.description.length === 500, 'descrição de 500 aceita');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, $4, $5)',
      [unitA1, categoryDrinks.id, 'Longo', 'D'.repeat(501), '2.00'],
      'PED27',
      'descrição de 501: PED27',
    );

    scenario(33, 'preço zero e negativo são rejeitados com PED28');
    for (const value of ['0', '0.00', '-1', '-0.01']) {
      await expectError(
        ownerAS,
        'select public.create_catalog_product($1, $2, $3, null, $4)',
        [unitA1, categoryDrinks.id, `Preço ${value}`, value],
        'PED28',
        `preço ${value}: PED28`,
      );
    }

    scenario(34, 'preço com três casas, expoente e vírgula são rejeitados');
    for (const value of ['29.999', '1e5', '1E5', '29,90', '0001.00']) {
      await expectError(
        ownerAS,
        'select public.create_catalog_product($1, $2, $3, null, $4)',
        [unitA1, categoryDrinks.id, `Formato ${value}`, value],
        'PED28',
        `formato ${value}: PED28`,
      );
    }

    scenario(35, 'NaN, Infinity e textos não decimais são rejeitados');
    for (const value of ['NaN', 'Infinity', '-Infinity', 'abc', '', null]) {
      await expectError(
        ownerAS,
        'select public.create_catalog_product($1, $2, $3, null, $4)',
        [unitA1, categoryDrinks.id, `Inválido ${value || 'vazio'}`, value],
        'PED28',
        `preço ${value || 'vazio'}: PED28`,
      );
    }

    scenario(36, 'overflow de numeric(12,2) é rejeitado e máximo é aceito');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, null, $4)',
      [unitA1, categoryDrinks.id, 'Overflow', '10000000000.00'],
      'PED28',
      'overflow: PED28',
    );
    const maxPrice = await createProduct(
      ownerAS,
      unitA1,
      categoryDrinks.id,
      'Preço máximo',
      null,
      '9999999999.99',
    );
    ok(maxPrice.price === '9999999999.99', 'máximo numeric(12,2) aceito');

    scenario(37, 'round-trip 8.10 permanece string com duas casas');
    const roundTrip = await createProduct(
      ownerAS,
      unitA1,
      categoryDrinks.id,
      'Round trip',
      null,
      '8.10',
    );
    const roundCatalog = (
      await ownerAS.query('select public.get_unit_catalog_admin($1) as catalog', [unitA1])
    ).rows[0].catalog;
    const roundRead = roundCatalog.categories
      .flatMap((category) => category.products)
      .find((product) => product.id === roundTrip.id);
    ok(roundRead.price === '8.10' && typeof roundRead.price === 'string', '8.10 exato no JSON');

    scenario(38, 'categoria de outra unidade no create retorna PED29');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, null, $4)',
      [unitA1, categoryA2.id, 'Mismatch unit', '1.00'],
      'PED29',
      'category unit mismatch: PED29',
    );

    scenario(39, 'categoria de outro tenant no create retorna PED29');
    await expectError(
      ownerAS,
      'select public.create_catalog_product($1, $2, $3, null, $4)',
      [unitA1, categoryB1.id, 'Mismatch tenant', '1.00'],
      'PED29',
      'category tenant mismatch: PED29',
    );

    scenario(40, 'INSERT direto em produtos é negado');
    await expectError(
      ownerAS,
      `insert into public.catalog_products
         (organization_id, unit_id, category_id, name, price, sort_order)
       values ($1, $2, $3, 'Direto', 1.00, 999)`,
      [orgA, unitA1, categoryMain.id],
      '42501',
      'INSERT produto direto negado',
    );

    scenario(41, 'UPDATE direto em produtos é negado');
    await expectError(
      ownerAS,
      'update public.catalog_products set sort_order = 999 where id = $1',
      [productMain.id],
      '42501',
      'UPDATE produto direto negado',
    );

    scenario(42, 'DELETE direto em produtos é negado');
    await expectError(
      ownerAS,
      'delete from public.catalog_products where id = $1',
      [productMain.id],
      '42501',
      'DELETE produto direto negado',
    );

    // ============================================================
    // Update, flags e RBAC operacional
    // ============================================================
    scenario(43, 'update na mesma categoria preserva ordem e normaliza campos');
    const sameCategory = (
      await managerAS.query('select * from public.update_catalog_product($1, $2, $3, $4, $5)', [
        productMain.id,
        categoryMain.id,
        '  X-Salada  ',
        '   ',
        '31.50',
      ])
    ).rows[0];
    ok(
      sameCategory.name === 'X-Salada' && sameCategory.description === null,
      'campos normalizados',
    );
    ok(
      sameCategory.sort_order === 100 && sameCategory.price === '31.50',
      'ordem preservada e preço salvo',
    );

    scenario(44, 'produto pode mover para categoria da mesma unidade');
    const beforeTargetMax = Math.max(
      ...(
        await admin.query('select sort_order from public.catalog_products where category_id = $1', [
          categoryDrinks.id,
        ])
      ).rows.map((row) => row.sort_order),
    );
    const moved = (
      await ownerAS.query('select * from public.update_catalog_product($1, $2, $3, $4, $5)', [
        productMain.id,
        categoryDrinks.id,
        'X-Salada',
        null,
        '31.50',
      ])
    ).rows[0];
    ok(moved.category_id === categoryDrinks.id, 'categoria de destino aplicada');
    ok(moved.sort_order === beforeTargetMax + 100, 'move recebe max(target)+100');

    scenario(45, 'update rejeita categoria de outra unidade e tenant');
    await expectError(
      ownerAS,
      'select public.update_catalog_product($1, $2, $3, null, $4)',
      [productMain.id, categoryA2.id, 'Mismatch', '1.00'],
      'PED29',
      'move cross-unit: PED29',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_product($1, $2, $3, null, $4)',
      [productMain.id, categoryB1.id, 'Mismatch', '1.00'],
      'PED29',
      'move cross-tenant: PED29',
    );

    scenario(46, 'produto inexistente retorna PED24');
    await expectError(
      ownerAS,
      'select public.update_catalog_product($1, $2, $3, null, $4)',
      [randomUUID(), categoryMain.id, 'Inexistente', '1.00'],
      'PED24',
      'product not found: PED24',
    );

    scenario(47, 'operator não atualiza estrutura do produto');
    await expectError(
      operatorAS,
      'select public.update_catalog_product($1, $2, $3, null, $4)',
      [productMain.id, categoryDrinks.id, 'Operador', '1.00'],
      'PED11',
      'operator update: PED11',
    );

    scenario(48, 'is_active do produto não altera is_available');
    const productInactive = (
      await ownerAS.query('select * from public.set_catalog_product_active($1, false)', [
        productMain.id,
      ])
    ).rows[0];
    ok(productInactive.is_active === false, 'produto desativado');
    ok(productInactive.is_available === true, 'disponibilidade não sofreu cascata');

    scenario(49, 'categoria inativa não altera flags dos produtos');
    const beforeCategoryOff = await admin.query(
      'select id, is_active, is_available from public.catalog_products where category_id = $1 order by id',
      [categoryDrinks.id],
    );
    const categoryInactive = (
      await managerAS.query('select * from public.set_catalog_category_active($1, false)', [
        categoryDrinks.id,
      ])
    ).rows[0];
    const afterCategoryOff = await admin.query(
      'select id, is_active, is_available from public.catalog_products where category_id = $1 order by id',
      [categoryDrinks.id],
    );
    ok(categoryInactive.is_active === false, 'categoria desativada');
    ok(
      JSON.stringify(afterCategoryOff.rows) === JSON.stringify(beforeCategoryOff.rows),
      'produtos permanecem inalterados',
    );

    scenario(50, 'operator vinculado altera disponibilidade sem alterar active');
    const operatorUnavailable = (
      await operatorAS.query('select * from public.set_catalog_product_available($1, false)', [
        productSecond.id,
      ])
    ).rows[0];
    ok(operatorUnavailable.is_available === false, 'operator desliga disponibilidade');
    ok(operatorUnavailable.is_active === true, 'active estrutural permanece true');

    scenario(51, 'manager e owner também alteram disponibilidade');
    const managerAvailable = (
      await managerAS.query('select * from public.set_catalog_product_available($1, true)', [
        productSecond.id,
      ])
    ).rows[0];
    const ownerUnavailable = (
      await ownerAS.query('select * from public.set_catalog_product_available($1, false)', [
        productSecond.id,
      ])
    ).rows[0];
    ok(managerAvailable.is_available === true, 'manager liga disponibilidade');
    ok(ownerUnavailable.is_available === false, 'owner desliga disponibilidade');

    const productA2 = await createProduct(
      ownerAS,
      unitA2,
      categoryA2.id,
      'Produto A2',
      null,
      '5.00',
    );
    const productB1 = await createProduct(
      ownerBS,
      unitB1,
      categoryB1.id,
      'Produto B1',
      null,
      '5.00',
    );

    scenario(52, 'operator não altera disponibilidade em outra unidade');
    await expectError(
      operatorAS,
      'select public.set_catalog_product_available($1, false)',
      [productA2.id],
      'PED11',
      'availability cross-unit: PED11',
    );

    scenario(53, 'owner não altera disponibilidade em outro tenant');
    await expectError(
      ownerAS,
      'select public.set_catalog_product_available($1, false)',
      [productB1.id],
      'PED11',
      'availability cross-tenant: PED11',
    );

    scenario(54, 'RLS direto isola unidades e tenants para authenticated');
    const managerDirectCategories = await managerAS.query(
      'select unit_id from public.catalog_categories order by unit_id',
    );
    const ownerBDirectProducts = await ownerBS.query(
      'select id from public.catalog_products where id = $1',
      [productMain.id],
    );
    ok(
      managerDirectCategories.rows.length > 0 &&
        managerDirectCategories.rows.every((row) => row.unit_id === unitA1),
      'manager não lê categorias de A2/B1 diretamente',
    );
    ok(ownerBDirectProducts.rows.length === 0, 'owner B não lê produto de Org A diretamente');

    scenario(55, 'update de categoria bloqueia cross-unit e cross-tenant');
    await expectError(
      managerAS,
      'select public.update_catalog_category($1, $2)',
      [categoryA2.id, 'Cross unit'],
      'PED11',
      'manager atualizando categoria de A2: PED11',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_category($1, $2)',
      [categoryB1.id, 'Cross tenant'],
      'PED11',
      'owner A atualizando categoria de Org B: PED11',
    );

    scenario(56, 'operator não altera flag estrutural de categoria');
    await expectError(
      operatorAS,
      'select public.set_catalog_category_active($1, true)',
      [categoryDrinks.id],
      'PED11',
      'operator em category active: PED11',
    );

    scenario(57, 'manager altera active do produto e operator é negado');
    const managerActive = (
      await managerAS.query('select * from public.set_catalog_product_active($1, false)', [
        productSecond.id,
      ])
    ).rows[0];
    ok(managerActive.is_active === false, 'manager desativa produto');
    ok(managerActive.is_available === false, 'active não altera disponibilidade');
    await expectError(
      operatorAS,
      'select public.set_catalog_product_active($1, false)',
      [productMain.id],
      'PED11',
      'operator em product active: PED11',
    );

    scenario(58, 'RPCs de flags retornam PED20/PED24 para IDs inexistentes');
    await expectError(
      ownerAS,
      'select public.set_catalog_category_active($1, false)',
      [randomUUID()],
      'PED20',
      'category active inexistente: PED20',
    );
    await expectError(
      ownerAS,
      'select public.set_catalog_product_active($1, false)',
      [randomUUID()],
      'PED24',
      'product active inexistente: PED24',
    );
    await expectError(
      ownerAS,
      'select public.set_catalog_product_available($1, false)',
      [randomUUID()],
      'PED24',
      'product available inexistente: PED24',
    );
    await expectError(
      ownerAS,
      'select public.set_catalog_category_active($1, null)',
      [categoryMain.id],
      'PED30',
      'category active null: PED30',
    );
    await expectError(
      ownerAS,
      'select public.set_catalog_product_active($1, null)',
      [productMain.id],
      'PED30',
      'product active null: PED30',
    );
    await expectError(
      ownerAS,
      'select public.set_catalog_product_available($1, null)',
      [productMain.id],
      'PED30',
      'product available null: PED30',
    );

    scenario(59, 'get inclui inativos e ordena categorias/produtos por sort_order,id');
    const fullCatalog = (
      await operatorAS.query('select public.get_unit_catalog_admin($1) as catalog', [unitA1])
    ).rows[0].catalog;
    const categoryOrders = fullCatalog.categories.map((category) => category.sort_order);
    ok(
      categoryOrders.every((value, index) => index === 0 || categoryOrders[index - 1] <= value),
      'categorias ordenadas',
    );
    ok(
      fullCatalog.categories.some((category) => category.is_active === false),
      'categoria inativa incluída',
    );
    const allProducts = fullCatalog.categories.flatMap((category) => category.products);
    ok(
      allProducts.some((product) => product.is_active === false),
      'produto inativo incluído',
    );
    ok(
      fullCatalog.categories.every((category) =>
        category.products.every(
          (product, index) =>
            index === 0 || category.products[index - 1].sort_order <= product.sort_order,
        ),
      ),
      'produtos ordenados dentro das categorias',
    );

    scenario(60, 'unidade inativa continua legível conforme can_access_unit');
    await ownerAS.query('select public.set_unit_active($1, false)', [unitA2]);
    const inactiveUnitCatalog = (
      await ownerAS.query('select public.get_unit_catalog_admin($1) as catalog', [unitA2])
    ).rows[0].catalog;
    ok(inactiveUnitCatalog.unit.id === unitA2, 'catálogo de unidade inativa retornado');
    ok(inactiveUnitCatalog.categories.length === 1, 'dados da unidade inativa incluídos');

    // ============================================================
    // Superfície SQL, grants e concorrência
    // ============================================================
    scenario(61, 'não existe RPC de hard delete e assinaturas não recebem sort_order/org');
    const deleteRpcs = await admin.query(
      `select proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'delete_catalog_%'`,
    );
    const argumentNames = await admin.query(
      `select p.proname, coalesce(p.proargnames, array[]::text[]) as names
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('create_catalog_category', 'create_catalog_product')`,
    );
    ok(deleteRpcs.rows.length === 0, 'nenhuma RPC delete_catalog_* existe');
    ok(
      argumentNames.rows.every(
        (row) => !row.names.includes('p_sort_order') && !row.names.includes('p_organization_id'),
      ),
      'cliente não fornece sort_order nem organization_id',
    );

    scenario(62, 'grants expõem RPCs apenas a authenticated e helper permanece interno');
    const expectedRpcs = [
      'get_unit_catalog_admin',
      'create_catalog_category',
      'update_catalog_category',
      'set_catalog_category_active',
      'create_catalog_product',
      'update_catalog_product',
      'set_catalog_product_active',
      'set_catalog_product_available',
    ];
    const rpcGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = any($1::text[])
       order by routine_name, grantee`,
      [expectedRpcs],
    );
    const helperGrants = await admin.query(
      `select grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = '_validate_catalog_price'
         and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    ok(
      expectedRpcs.every((name) =>
        rpcGrants.rows.some((row) => row.routine_name === name && row.grantee === 'authenticated'),
      ),
      'authenticated possui EXECUTE nas oito RPCs',
    );
    ok(
      rpcGrants.rows.every((row) => !['PUBLIC', 'anon'].includes(row.grantee)),
      'PUBLIC e anon não possuem EXECUTE nas RPCs',
    );
    ok(helperGrants.rows.length === 0, 'helper sem EXECUTE público/anon/authenticated');

    scenario(63, 'criações concorrentes preservam ordens de categoria e produto');
    const concurrentClients = [];
    for (let index = 0; index < 8; index += 1) {
      const client = await sessionFor(ownerA.id);
      concurrentClients.push(client);
      openClients.push(client);
    }
    const categoryResults = await Promise.allSettled(
      concurrentClients.map((client, index) =>
        client.query('select * from public.create_catalog_category($1, $2)', [
          unitA1,
          `Concorrente ${index} ${suffix}`,
        ]),
      ),
    );
    ok(
      categoryResults.every((result) => result.status === 'fulfilled'),
      '8 categorias concorrentes criadas',
    );
    const concurrentCategoryRows = categoryResults.map((result) => result.value.rows[0]);
    const concurrentCategoryOrders = concurrentCategoryRows.map((row) => row.sort_order);
    ok(
      new Set(concurrentCategoryOrders).size === 8,
      'sort_order concorrente de categorias é único',
    );
    ok(
      concurrentCategoryOrders.every((order) => order > 0 && order % 100 === 0),
      'ordens concorrentes de categorias mantêm passos de 100',
    );

    const productCategory = concurrentCategoryRows[0];
    const productResults = await Promise.allSettled(
      concurrentClients.map((client, index) =>
        client.query('select * from public.create_catalog_product($1, $2, $3, $4, $5)', [
          unitA1,
          productCategory.id,
          `Produto concorrente ${index}`,
          null,
          `${index + 1}.00`,
        ]),
      ),
    );
    ok(
      productResults.every((result) => result.status === 'fulfilled'),
      '8 produtos concorrentes criados',
    );
    const concurrentProductOrders = productResults.map((result) => result.value.rows[0].sort_order);
    ok(new Set(concurrentProductOrders).size === 8, 'sort_order concorrente de produtos é único');
    ok(
      [...concurrentProductOrders]
        .sort((a, b) => a - b)
        .every((order, index) => order === (index + 1) * 100),
      'produtos concorrentes recebem sequência 100..800',
    );
  } finally {
    for (const c of openClients) {
      await c.end().catch(() => {});
    }
    if (createdOrgIds.length > 0) {
      await admin
        .query('delete from public.organizations where id = any($1::uuid[])', [createdOrgIds])
        .catch((error) => console.warn('cleanup orgs warning:', error.message));
    }
    if (createdUsers.length > 0) {
      await admin
        .query('delete from auth.users where id = any($1::uuid[])', [createdUsers])
        .catch((error) => console.warn('cleanup users warning:', error.message));
    }
    await admin.end().catch(() => {});
  }

  console.log('');
  console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
  if (failed > 0) {
    console.log('Falhas:', failures);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('ERRO NA EXECUÇÃO:', error.message);
  process.exitCode = 1;
});
