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

function assertTextMoney(label, actual, expected) {
  ok(actual === expected, `${label} (esperado ${expected}, obtido ${actual})`);
}

function isHex24(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
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
  await c.query(`set request.jwt.claims = '{"role": "anon"}'`);
  await c.query(`set request.jwt.claim.sub = ''`);
  return c;
}

async function createTestUser(admin, email) {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
     values ($1, $2, crypt('TestPassw0rd!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now())`,
    [id, email]
  );
  return { id, email };
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

async function setCategoryActive(client, categoryId, isActive) {
  return (
    await client.query('select * from public.set_catalog_category_active($1, $2)', [
      categoryId,
      isActive,
    ])
  ).rows[0];
}

async function setProductActive(client, productId, isActive) {
  return (
    await client.query('select * from public.set_catalog_product_active($1, $2)', [
      productId,
      isActive,
    ])
  ).rows[0];
}

async function setProductAvailable(client, productId, isAvailable) {
  return (
    await client.query('select * from public.set_catalog_product_available($1, $2)', [
      productId,
      isAvailable,
    ])
  ).rows[0];
}

async function updateCatalogProduct(client, productId, categoryId, name, description, price) {
  return (
    await client.query('select * from public.update_catalog_product($1, $2, $3, $4, $5)', [
      productId,
      categoryId,
      name,
      description,
      price,
    ])
  ).rows[0];
}

async function saveUnitOperationalConfig(client, unitId, config) {
  const r = await client.query(
    `select * from public.save_unit_operational_config($1, $2) as out`,
    [unitId, JSON.stringify(config)]
  );
  return r.rows[0].out;
}

async function setUnitActive(client, unitId, isActive) {
  const r = await client.query(
    `select * from public.set_unit_active($1, $2) as out`,
    [unitId, isActive]
  );
  return r.rows[0].out;
}

async function publish(client, unitId) {
  const r = await client.query(
    `select * from public.publish_unit_menu($1) as out`,
    [unitId]
  );
  return r.rows[0].out;
}

async function getPublicMenu(client, slug) {
  const r = await client.query(
    `select * from public.get_public_menu($1) as out`,
    [slug]
  );
  return r.rows[0].out;
}

async function getUnitPublication(client, unitId) {
  const r = await client.query(
    `select * from public.get_unit_menu_publication_admin($1) as out`,
    [unitId]
  );
  return r.rows[0].out;
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

function baseConfig(overrides = {}) {
  return {
    timezone: 'America/Sao_Paulo',
    pickup_enabled: true,
    delivery_enabled: true,
    delivery_fee: '8.00',
    min_order_value: '20.00',
    estimated_pickup_minutes: 30,
    estimated_delivery_minutes: 50,
    accepting_orders: true,
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
      const isOpen = weekday >= 1 && weekday <= 6;
      return {
        weekday,
        is_open: isOpen,
        is_24h: false,
        open_time: isOpen ? '09:00' : null,
        close_time: isOpen ? '22:00' : null,
      };
    }),
    payment_methods: [
      { method: 'cash', is_enabled: true },
      { method: 'pix', is_enabled: true },
      { method: 'credit_card', is_enabled: false },
      { method: 'debit_card', is_enabled: false },
    ],
    ...overrides,
  };
}

function menuCategories(menu) {
  return (menu && menu.categories) || [];
}

function categoryByName(categories, name) {
  return categories.find((c) => c.name === name);
}

function productByName(categories, name) {
  for (const c of categories) {
    for (const p of c.products || []) {
      if (p.name === name) return p;
    }
  }
  return null;
}

function productInCategory(categories, categoryName, productName) {
  const c = categoryByName(categories, categoryName);
  if (!c) return null;
  return (c.products || []).find((p) => p.name === productName) || null;
}

async function expectWriteDenied(client, sql, params, label) {
  try {
    await client.query(sql, params);
    ok(false, `${label} (nenhum erro foi lançado)`);
  } catch (err) {
    ok(err.code === '42501', `${label} (código obtido: ${err.code})`);
  }
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [admin];

  let ownerA;
  let ownerAS;
  let managerAS;
  let operatorAS;
  let managerOtherS;
  let ownerBS;
  let anon;
  let orgA;
  let orgB;
  let unitA1;
  let unitA2;
  let unitB1;
  let currentSlug;
  let lanches;

  try {
    scenario(0, 'Setup — identidades e unidades');
    ownerA = await createTestUser(admin, `pub-owner-a-${suffix}@pedon-test.invalid`);
    const managerA = await createTestUser(admin, `pub-manager-a-${suffix}@pedon-test.invalid`);
    const operatorA = await createTestUser(admin, `pub-operator-a-${suffix}@pedon-test.invalid`);
    const managerOther = await createTestUser(admin, `pub-manager-other-${suffix}@pedon-test.invalid`);
    const ownerB = await createTestUser(admin, `pub-owner-b-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, managerOther.id, ownerB.id);

    ownerAS = await sessionFor(ownerA.id);
    managerAS = await sessionFor(managerA.id);
    operatorAS = await sessionFor(operatorA.id);
    managerOtherS = await sessionFor(managerOther.id);
    ownerBS = await sessionFor(ownerB.id);
    anon = await anonClient();
    openClients.push(ownerAS, managerAS, operatorAS, managerOtherS, ownerBS, anon);

    orgA = (
      await ownerAS.query(`select public.complete_onboarding('Lanches do Zé') as org`)
    ).rows[0].org;
    createdOrgIds.push(orgA);
    unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA]
      )
    ).rows[0].id;
    unitA2 = (
      await ownerAS.query('select (public.create_unit($1)).id as id', ['Restaurante A2'])
    ).rows[0].id;

    orgB = (
      await ownerBS.query(`select public.complete_onboarding('Org B') as org`)
    ).rows[0].org;
    createdOrgIds.push(orgB);
    unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB]
      )
    ).rows[0].id;

    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'manager'), ($1, $3, 'operator'), ($1, $4, 'manager')`,
      [orgA, managerA.id, operatorA.id, managerOther.id]
    );
    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3), ($1, $4, $3), ($1, $5, $6)`,
      [orgA, managerA.id, unitA1, operatorA.id, managerOther.id, unitA2]
    );

    scenario(7, 'Menu vazio não pode ser publicado (PED31) e nada é persistido');
    await expectError(
      ownerAS,
      `select * from public.publish_unit_menu($1) as out`,
      [unitA1],
      'PED31',
      '7.1 publicar unidade sem catálogo lança PED31 MENU_EMPTY'
    );
    const emptyVersionCount = await ownerAS.query(
      `select count(*)::int as n from public.menu_versions where unit_id = $1`,
      [unitA1]
    );
    ok(emptyVersionCount.rows[0].n === 0, '7.2 nenhuma menu_version criada na falha');
    const emptyPubCount = await ownerAS.query(
      `select count(*)::int as n from public.menu_publications where unit_id = $1`,
      [unitA1]
    );
    ok(emptyPubCount.rows[0].n === 0, '7.3 nenhuma menu_publication criada na falha');

    scenario(1, 'População do catálogo da unidade A1');
    lanches = await createCategory(ownerAS, unitA1, 'Lanches');
    const bebidas = await createCategory(ownerAS, unitA1, 'Bebidas');
    const inativaCat = await createCategory(ownerAS, unitA1, 'Inativa');
    const vazia = await createCategory(ownerAS, unitA1, 'Vazia');
    const ofertas = await createCategory(ownerAS, unitA1, 'Ofertas');
    await setCategoryActive(ownerAS, inativaCat.id, false);

    const xbacon = await createProduct(ownerAS, unitA1, lanches.id, 'X-Bacon', 'Pão, carne, bacon e queijo', '29.90');
    const xbaconInativo = await createProduct(ownerAS, unitA1, lanches.id, 'X-Bacon Inativo', null, '25.00');
    await setProductActive(ownerAS, xbaconInativo.id, false);
    const xbaconIndisponivel = await createProduct(ownerAS, unitA1, lanches.id, 'X-Bacon Indisponível', null, '31.00');
    await setProductAvailable(ownerAS, xbaconIndisponivel.id, false);
    const refrigerante = await createProduct(ownerAS, unitA1, bebidas.id, 'Refrigerante', null, '6.00');
    const suco = await createProduct(ownerAS, unitA1, bebidas.id, 'Suco', null, '8.00');
    await setProductActive(ownerAS, suco.id, false);
    const escondido = await createProduct(ownerAS, unitA1, inativaCat.id, 'Escondido', null, '5.00');

    scenario(83, 'Autenticação e autorização da publicação');
    const anonPublishError = await publish(anon, unitA1).then(() => null).catch((e) => e);
    ok(
      anonPublishError && (anonPublishError.code === 'PED10' || anonPublishError.code === '42501'),
      `83.1 anon não pode publicar (PED10 ou 42501, obtido ${anonPublishError?.code})`
    );
    await expectError(
      operatorAS,
      `select * from public.publish_unit_menu($1) as out`,
      [unitA1],
      'PED11',
      '83.2 operador não pode publicar (PED11)'
    );
    await expectError(
      managerOtherS,
      `select * from public.publish_unit_menu($1) as out`,
      [unitA1],
      'PED11',
      '83.3 manager sem vínculo com a unidade não pode publicar (PED11)'
    );
    await expectError(
      ownerAS,
      `select * from public.publish_unit_menu($1) as out`,
      [unitB1],
      'PED11',
      '83.4 owner de outra organização não pode publicar (PED11)'
    );

    scenario(84, 'Primeira publicação — versão 1, slug estável e opaco');
    const r1 = await publish(ownerAS, unitA1);
    ok(r1.version_number === 1, `84.1 primeira publicação gera version_number 1 (obtido ${r1.version_number})`);
    ok(isUuid(r1.version_id), '84.2 version_id é uuid');
    ok(isHex24(r1.public_slug), '84.3 public_slug é opaco (24 hex)');
    ok(r1.category_count === 2, `84.4 category_count = 2 (obtido ${r1.category_count})`);
    ok(r1.product_count === 3, `84.5 product_count = 3 (obtido ${r1.product_count})`);
    ok(r1.public_path === `/menu/${r1.public_slug}`, '84.6 public_path derivado do slug');
    currentSlug = r1.public_slug;

    const createdBy = await ownerAS.query(
      `select created_by from public.menu_versions where id = $1`,
      [r1.version_id]
    );
    ok(createdBy.rows[0].created_by === ownerA.id, '84.7 created_by registra o autor');

    scenario(85, 'Snapshot imutável — somente catálogo estruturalmente ativo');
    const snap1 = await ownerAS.query(
      `select c.name as cat, p.name as prod, p.price::text as price,
              p.description as descr, c.sort_order as c_sort, p.sort_order as p_sort,
              c.source_category_id, p.source_product_id
       from public.menu_version_categories c
       left join public.menu_version_products p
         on p.menu_version_id = c.menu_version_id
        and p.menu_category_id = c.id
       where c.menu_version_id = $1
       order by c.sort_order, p.sort_order`,
      [r1.version_id]
    );
    const snapRows = snap1.rows;
    const catsInSnap = new Set(snapRows.map((r) => r.cat).filter((c) => c !== null && c !== undefined));
    ok(catsInSnap.has('Lanches') && catsInSnap.has('Bebidas'), '85.1 Lanches e Bebidas presentes');
    ok(!catsInSnap.has('Inativa'), '85.2 categoria Inativa excluída do snapshot');
    ok(!catsInSnap.has('Vazia'), '85.3 categoria sem produtos ativos excluída');
    ok(!catsInSnap.has('Ofertas'), '85.4 Ofertas (sem produtos) excluída');
    ok(snapRows.some((r) => r.prod === 'X-Bacon'), '85.5 X-Bacon presente');
    ok(snapRows.some((r) => r.prod === 'X-Bacon Indisponível'), '85.6 produto indisponível permanece no snapshot');
    ok(snapRows.some((r) => r.prod === 'Refrigerante'), '85.7 Refrigerante presente');
    ok(!snapRows.some((r) => r.prod === 'X-Bacon Inativo'), '85.8 produto inativo excluído');
    ok(!snapRows.some((r) => r.prod === 'Suco'), '85.9 Suco (inativo) excluído');
    ok(!snapRows.some((r) => r.prod === 'Escondido'), '85.10 produto de categoria inativa excluído');
    ok(snapRows.length === 3, `85.11 total de linhas = 3 (obtido ${snapRows.length})`);

    const xbaconSnap = snapRows.find((r) => r.prod === 'X-Bacon');
    ok(xbaconSnap.cat === 'Lanches', '85.12 associação X-Bacon -> Lanches preservada');
    assertTextMoney('85.13 price de X-Bacon capturado', xbaconSnap.price, '29.90');
    ok(xbaconSnap.descr === 'Pão, carne, bacon e queijo', '85.14 description de X-Bacon capturada');
    ok(xbaconSnap.c_sort === 100 && xbaconSnap.p_sort === 100, '85.15 sort_order preservado');
    ok(isUuid(xbaconSnap.source_product_id) && isUuid(xbaconSnap.source_category_id), '85.16 rastreabilidade source_* preservada');

    scenario(86, 'Versões seguintes — numeração crescente, slug estável, ponte única');
    const r2 = await publish(managerAS, unitA1);
    ok(r2.version_number === 2, '86.1 manager publica version_number 2');
    ok(r2.public_slug === currentSlug, '86.2 slug permanece estável');
    const r3 = await publish(ownerAS, unitA1);
    ok(r3.version_number === 3, '86.3 nova publicação gera version_number 3');
    const pubRow = await ownerAS.query(
      `select count(*)::int as n from public.menu_publications where unit_id = $1`,
      [unitA1]
    );
    ok(pubRow.rows[0].n === 1, '86.4 existe exatamente uma linha na ponte por unidade');
    const currentRow = await ownerAS.query(
      `select current_menu_version_id from public.menu_publications where unit_id = $1`,
      [unitA1]
    );
    ok(currentRow.rows[0].current_menu_version_id === r3.version_id, '86.5 ponte aponta para a versão corrente');

    scenario(87, 'Imutabilidade — escrita direta bloqueada por RLS');
    const mvCatId = snapRows.find((r) => r.cat === 'Lanches').source_category_id;
    await expectWriteDenied(
      ownerAS,
      `insert into public.menu_versions (organization_id, unit_id, version_number, created_by)
       values ($1, $2, 99, $3)`,
      [orgA, unitA1, ownerA.id],
      '87.1 INSERT em menu_versions bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `update public.menu_versions set version_number = 500 where id = $1`,
      [r3.version_id],
      '87.2 UPDATE em menu_versions bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `delete from public.menu_versions where id = $1`,
      [r3.version_id],
      '87.3 DELETE em menu_versions bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `insert into public.menu_version_categories
         (organization_id, unit_id, menu_version_id, source_category_id, name, sort_order)
       values ($1, $2, $3, $4, 'Invasora', 1)`,
      [orgA, unitA1, r3.version_id, mvCatId],
      '87.4 INSERT em menu_version_categories bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `update public.menu_version_categories set name = 'Invasora'
       where menu_version_id = $1 and source_category_id = $2`,
      [r3.version_id, mvCatId],
      '87.5 UPDATE em menu_version_categories bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `delete from public.menu_version_categories where menu_version_id = $1`,
      [r3.version_id],
      '87.6 DELETE em menu_version_categories bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `insert into public.menu_version_products
         (organization_id, unit_id, menu_version_id, menu_category_id, source_product_id, name, price, sort_order)
       values ($1, $2, $3, null, $4, 'Invasor', '1.00', 1)`,
      [orgA, unitA1, r3.version_id, xbacon.id],
      '87.7 INSERT em menu_version_products bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `update public.menu_version_products set name = 'Invasor' where menu_version_id = $1`,
      [r3.version_id],
      '87.8 UPDATE em menu_version_products bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `delete from public.menu_version_products where menu_version_id = $1`,
      [r3.version_id],
      '87.9 DELETE em menu_version_products bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `insert into public.menu_publications
         (organization_id, unit_id, public_slug, current_menu_version_id, published_at)
       values ($1, $2, '000000000000000000000000', $3, now())`,
      [orgA, unitA1, r3.version_id],
      '87.10 INSERT em menu_publications bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `update public.menu_publications set public_slug = '000000000000000000000001' where unit_id = $1`,
      [unitA1],
      '87.11 UPDATE em menu_publications bloqueado'
    );
    await expectWriteDenied(
      ownerAS,
      `delete from public.menu_publications where unit_id = $1`,
      [unitA1],
      '87.12 DELETE em menu_publications bloqueado'
    );
    await expectError(anon, 'select * from public.menu_versions limit 1', [], '42501',
      '87.13 anon não lê menu_versions');
    await expectError(anon, 'select * from public.menu_version_categories limit 1', [], '42501',
      '87.14 anon não lê menu_version_categories');
    await expectError(anon, 'select * from public.menu_version_products limit 1', [], '42501',
      '87.15 anon não lê menu_version_products');
    await expectError(anon, 'select * from public.menu_publications limit 1', [], '42501',
      '87.16 anon não lê menu_publications');

    scenario(88, 'Snapshot congelado — mutações no catálogo não vazam');
    let pub = await getPublicMenu(anon, currentSlug);
    ok(pub.found === true, '88.1 menu público encontrado');
    assertTextMoney('88.2 preço publicado (X-Bacon)', productByName(menuCategories(pub), 'X-Bacon').price, '29.90');

    await updateCatalogProduct(ownerAS, xbacon.id, lanches.id, 'X-Bacon', 'Pão, carne, bacon e queijo', '34.90');
    pub = await getPublicMenu(anon, currentSlug);
    assertTextMoney('88.3 mudança de preço não vaza ao snapshot', productByName(menuCategories(pub), 'X-Bacon').price, '29.90');

    await updateCatalogProduct(ownerAS, xbacon.id, lanches.id, 'Super Bacon', 'Pão, carne, bacon e queijo', '34.90');
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'X-Bacon') !== null, '88.4 mudança de nome não vaza ao snapshot');
    ok(productByName(menuCategories(pub), 'Super Bacon') === null, '88.5 nome novo ausente no menu público');

    await updateCatalogProduct(ownerAS, xbacon.id, lanches.id, 'Super Bacon', 'Descrição nova', '34.90');
    pub = await getPublicMenu(anon, currentSlug);
    const xbaconPub = productByName(menuCategories(pub), 'X-Bacon');
    ok(xbaconPub.description === 'Pão, carne, bacon e queijo', '88.6 mudança de descrição não vaza ao snapshot');

    await updateCatalogProduct(ownerAS, xbacon.id, ofertas.id, 'Super Bacon', 'Descrição nova', '34.90');
    pub = await getPublicMenu(anon, currentSlug);
    ok(productInCategory(menuCategories(pub), 'Lanches', 'X-Bacon') !== null, '88.7 mudança de categoria não vaza ao snapshot');
    ok(productInCategory(menuCategories(pub), 'Ofertas', 'X-Bacon') === null, '88.8 categoria de destino ainda ausente');

    await createProduct(ownerAS, unitA1, lanches.id, 'Batata', null, '10.00');
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'Batata') === null, '88.9 produto novo não entra no snapshot corrente');

    await setProductActive(ownerAS, xbacon.id, false);
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'X-Bacon') !== null, '88.10 desativação não remove item do snapshot corrente');

    scenario(89, 'Republicação captura novo estado sem alterar histórico');
    const r4 = await publish(ownerAS, unitA1);
    ok(r4.version_number === 4, '89.1 nova versão = 4');
    pub = await getPublicMenu(anon, currentSlug);
    ok(pub.menu.version_number === 4, '89.2 menu público aponta para versão 4');
    ok(productByName(menuCategories(pub), 'Batata') !== null, '89.3 produto novo entra na nova versão');
    ok(productByName(menuCategories(pub), 'X-Bacon') === null, '89.4 produto inativo sai na nova versão');
    ok(productByName(menuCategories(pub), 'Super Bacon') === null, '89.5 nome antigo não aparece');
    ok(productByName(menuCategories(pub), 'X-Bacon Indisponível') !== null, '89.6 indisponível permanece na nova versão');
    ok(productByName(menuCategories(pub), 'Refrigerante') !== null, '89.7 Refrigerante presente');

    const v3products = await ownerAS.query(
      `select p.name, p.price::text as price, p.description
       from public.menu_version_products p
       where p.menu_version_id = $1
         and p.source_product_id = $2`,
      [r3.version_id, xbacon.id]
    );
    ok(v3products.rows.length === 1, '89.8 versão 3 preservada no histórico');
    ok(v3products.rows[0].name === 'X-Bacon', '89.9 nome original preservado na v3');
    assertTextMoney('89.10 preço original preservado na v3', v3products.rows[0].price, '29.90');
    ok(v3products.rows[0].description === 'Pão, carne, bacon e queijo', '89.11 descrição original preservada na v3');

    scenario(90, 'API pública');
    ok(pub.found === true, '90.1 menu público acessível sem sessão');
    ok(pub.organization && pub.organization.name === 'Lanches do Zé', '90.2 organization.name exposto');
    ok(pub.unit && pub.unit.name === 'Unidade principal', '90.3 unit.name exposto');
    ok(isUuid(pub.menu.version_id), '90.4 menu.version_id é uuid');
    const json = JSON.stringify(pub);
    ok(!json.includes('organization_id'), '90.5 organization_id não vazado');
    ok(!json.includes('unit_id'), '90.6 unit_id não vazado');
    ok(!json.includes('source_product_id'), '90.7 source_product_id não vazado');
    ok(!json.includes('source_category_id'), '90.8 source_category_id não vazado');
    ok(!json.includes('created_by'), '90.9 created_by não vazado');
    ok(!json.includes('@pedon-test.invalid'), '90.10 e-mail não vazado');
    const refrigerantePub = productByName(menuCategories(pub), 'Refrigerante');
    ok(typeof refrigerantePub.price === 'string' && /^[0-9]+\.[0-9]{2}$/.test(refrigerantePub.price),
      `90.11 preço é string monetária (obtido ${refrigerantePub.price})`);
    ok(isUuid(refrigerantePub.id), '90.12 id de produto público é uuid');

    scenario(91, 'Disponibilidade em overlay — is_available sem republicação');
    ok(refrigerantePub.is_available === true, '91.1 Refrigerante disponível');
    await setProductAvailable(operatorAS, refrigerante.id, false);
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'Refrigerante').is_available === false, '91.2 indisponibilizar reflete imediatamente');
    ok(pub.menu.version_number === 4, '91.3 sem nova versão gerada');
    await setProductAvailable(operatorAS, refrigerante.id, true);
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'Refrigerante').is_available === true, '91.4 disponibilizar de volta reflete');

    scenario(92, 'Overlay com fonte deletada');
    const fantasma = await createProduct(ownerAS, unitA1, lanches.id, 'Fantasma', null, '1.50');
    const r5 = await publish(ownerAS, unitA1);
    ok(r5.version_number === 5, '92.1 versão 5 com Fantasma');
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'Fantasma') !== null, '92.2 Fantasma no snapshot');
    await admin.query(`delete from public.catalog_products where id = $1`, [fantasma.id]);
    pub = await getPublicMenu(anon, currentSlug);
    ok(productByName(menuCategories(pub), 'Fantasma').is_available === false, '92.3 produto sem fonte fica is_available=false');

    scenario(93, 'Configuração operacional refletida na API pública');
    await saveUnitOperationalConfig(ownerAS, unitA1, baseConfig());
    pub = await getPublicMenu(anon, currentSlug);
    ok(pub.operation.configured === true, '93.1 configured = true');
    ok(pub.operation.accepting_orders === true, '93.2 accepting_orders = true');
    assertTextMoney('93.3 delivery_fee como string', pub.operation.delivery_fee, '8.00');
    assertTextMoney('93.4 minimum_order_amount como string', pub.operation.minimum_order_amount, '20.00');
    ok(pub.operation.business_hours.length === 7, '93.5 business_hours com 7 dias');
    const sunday = pub.operation.business_hours.find((h) => h.weekday === 0);
    ok(sunday.is_open === false && sunday.open_time === null, '93.6 dia fechado com horários nulos');
    const monday = pub.operation.business_hours.find((h) => h.weekday === 1);
    ok(monday.is_open === true && monday.open_time === '09:00' && monday.close_time === '22:00', '93.7 dia aberto com horários');
    const pix = pub.operation.payment_methods.find((p) => p.method === 'pix');
    const cash = pub.operation.payment_methods.find((p) => p.method === 'cash');
    ok(pix && pix.is_enabled === true && cash && cash.is_enabled === true, '93.8 métodos de pagamento refletidos');

    scenario(94, 'Slug inválido ou inexistente retorna found=false');
    const notFound = await getPublicMenu(anon, 'slug-invalido');
    ok(notFound.found === false, '94.1 slug inválido -> found=false');
    const randomSlug = randomUUID().replaceAll('-', '').slice(0, 24);
    const notFound2 = await getPublicMenu(anon, randomSlug);
    ok(notFound2.found === false, '94.2 slug inexistente -> found=false');

    scenario(95, 'Unidade inativa e configuração ausente');
    const pubBeforeInactive = await getPublicMenu(anon, currentSlug);
    ok(pubBeforeInactive.operation.accepting_orders === true, '95.1 aceitando antes da inativação');

    await saveUnitOperationalConfig(ownerAS, unitA2, baseConfig({ delivery_enabled: false }));
    const cardapioA2 = await createCategory(ownerAS, unitA2, 'Cardápio A2');
    await createProduct(ownerAS, unitA2, cardapioA2.id, 'Prato A2', null, '12.00');
    const a2pub = await publish(ownerAS, unitA2);
    const pubA2 = await getPublicMenu(anon, a2pub.public_slug);
    ok(pubA2.operation.accepting_orders === true, '95.2 A2 aceitando pedidos');

    await setUnitActive(ownerAS, unitA2, false);
    const pubA2Inactive = await getPublicMenu(anon, a2pub.public_slug);
    ok(pubA2Inactive.unit.is_active === false, '95.3 unit.is_active=false exposto');
    ok(pubA2Inactive.operation.accepting_orders === false, '95.4 unidade inativa derruba accepting_orders');
    await setUnitActive(ownerAS, unitA2, true);
    const pubA2Active = await getPublicMenu(anon, a2pub.public_slug);
    ok(pubA2Active.operation.accepting_orders === true, '95.5 reativação restaura accepting_orders');

    await createCategory(ownerBS, unitB1, 'Cardápio B');
    const b1cat = (
      await ownerBS.query('select id from public.catalog_categories where unit_id = $1 limit 1', [unitB1])
    ).rows[0];
    await createProduct(ownerBS, unitB1, b1cat.id, 'Prato B', null, '15.00');
    const b1pub = await publish(ownerBS, unitB1);
    const pubB1 = await getPublicMenu(anon, b1pub.public_slug);
    ok(pubB1.operation.configured === false, '95.6 sem configuração -> configured=false');
    ok(pubB1.operation.accepting_orders === false, '95.7 sem configuração -> accepting_orders=false');

    scenario(96, 'Isolamento entre organizações');
    const ownerForeignRead = await getUnitPublication(ownerAS, unitB1)
      .then(() => null)
      .catch((e) => e);
    ok(ownerForeignRead && ownerForeignRead.code === 'PED11', '96.1 owner A não lê publicação de B1 (PED11)');
    const adminViewForeign = await getUnitPublication(ownerBS, unitB1);
    ok(adminViewForeign.publication.exists === true && adminViewForeign.unit.name === 'Unidade principal',
      '96.1b owner B lê sua própria publicação');
    const ownerForeign = await publish(ownerAS, unitB1).catch((e) => ({ error: e }));
    ok(ownerForeign.error && ownerForeign.error.code === 'PED11', '96.2 owner A não publica unidade B (PED11)');
    const adminViewA1 = await getUnitPublication(ownerAS, unitA1);
    ok(adminViewA1.publication.public_slug === currentSlug, '96.3 leitura administrativa A1 confere slug');
    ok(adminViewA1.current_version.version_number === 5, '96.4 current_version aponta para versão corrente');
    ok(Array.isArray(adminViewA1.history) && adminViewA1.history.length === 5, '96.5 histórico com 5 versões');

    scenario(97, 'Publicações concorrentes serializam');
    const ownerASecond = await sessionFor(ownerA.id);
    openClients.push(ownerASecond);
    const [c1, c2] = await Promise.allSettled([
      publish(ownerAS, unitA1),
      publish(ownerASecond, unitA1),
    ]);
    ok(c1.status === 'fulfilled' && c2.status === 'fulfilled', '97.1 ambas as publicações concluem');
    const v1 = c1.status === 'fulfilled' ? c1.value.version_number : -1;
    const v2 = c2.status === 'fulfilled' ? c2.value.version_number : -1;
    ok(v1 !== v2, `97.2 números de versão distintos (${v1} e ${v2})`);
    const pair = [Math.min(v1, v2), Math.max(v1, v2)];
    ok(pair[0] === 6 && pair[1] === 7, `97.3 versões são sequenciais (6 e 7), obtido ${pair.join(', ')}`);
    const afterConcurrent = await ownerAS.query(
      `select v.version_number
       from public.menu_publications m
       join public.menu_versions v on v.id = m.current_menu_version_id
       where m.unit_id = $1`,
      [unitA1]
    );
    ok(afterConcurrent.rows[0].version_number === 7, '97.4 ponte aponta para a versão mais nova');

    scenario(98, 'Sem vazamento entre unidades diferentes');
    const pubA2Now = await getPublicMenu(anon, a2pub.public_slug);
    ok(menuCategories(pubA2Now).length === 1, '98.1 A2 tem somente sua categoria');
    ok(productInCategory(menuCategories(pubA2Now), 'Cardápio A2', 'Prato A2') !== null, '98.2 A2 expõe seu produto');
    ok(productByName(menuCategories(pubA2Now), 'Prato B') === null, '98.3 A2 não vaza produtos de outra unidade');
  } finally {
    for (const orgId of createdOrgIds) {
      await admin.query('delete from public.organizations where id = $1', [orgId]).catch(() => {});
    }
    if (createdUsers.length > 0) {
      await admin
        .query('delete from auth.users where id = any($1::uuid[])', [createdUsers])
        .catch((error) => console.warn('cleanup users warning:', error.message));
    }
    await admin.end().catch(() => {});
    for (const c of openClients) {
      try { await c.end(); } catch {}
    }
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
