import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { databaseConfig } from './db-test-config.mjs';

// Suite do Prompt 12 - Remediation A: integridade do backend e
// serializacao da publicacao. Valida HIGH-1 (grupo obrigatorio
// insatisfazivel aborta a publicacao), HIGH-2 (publish serializado com
// todos os writers estruturais via lock de estrutura unit-scoped),
// vinculo relacional de order_item_options e regressoes de idempotencia,
// fingerprint canonico e earn de loyalty com opcoes.
const { Client } = pg;

const { connectionString: DIRECT_URL, ssl: DB_SSL } = await databaseConfig();

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
  console.log(`Cenario ${number} - ${label}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return randomBytes(32).toString('hex');
}

function inTwoHours() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

async function adminClient() {
  const client = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
  await client.connect();
  return client;
}

async function sessionFor(userId) {
  const client = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
  await client.connect();
  await client.query('set role authenticated');
  await client.query(`set request.jwt.claims = '{"sub": "${userId}", "role": "authenticated"}'`);
  await client.query(`set request.jwt.claim.sub = '${userId}'`);
  return client;
}

async function anonClient() {
  const client = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
  await client.connect();
  await client.query('set role anon');
  await client.query(`set request.jwt.claims = '{"role": "anon"}'`);
  await client.query(`set request.jwt.claim.sub = ''`);
  return client;
}

async function createTestUser(admin, email) {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users
       (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
        raw_user_meta_data, aud, role, created_at, updated_at)
     values
       ($1, $2, crypt('TestPassw0rd!', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', now(), now())`,
    [id, email],
  );
  return { id, email };
}

async function expectError(client, sql, params, expectedCode, label) {
  try {
    await client.query(sql, params);
    ok(false, `${label} (erro esperado nao ocorreu)`);
    return null;
  } catch (error) {
    ok(error.code === expectedCode, `${label} (codigo esperado)`);
    return error;
  }
}

async function createCategory(client, unitId, name) {
  return (
    await client.query('select * from public.create_catalog_category($1, $2)', [unitId, name])
  ).rows[0];
}

async function createProduct(client, unitId, categoryId, name, price) {
  return (
    await client.query('select * from public.create_catalog_product($1, $2, $3, null, $4)', [
      unitId,
      categoryId,
      name,
      price,
    ])
  ).rows[0];
}

async function updateProduct(client, productId, categoryId, name, price) {
  return (
    await client.query('select * from public.update_catalog_product($1, $2, $3, null, $4)', [
      productId,
      categoryId,
      name,
      price,
    ])
  ).rows[0];
}

async function createGroup(
  client,
  unitId,
  productId,
  name,
  kind,
  selectionMode,
  minSelect,
  maxSelect,
) {
  return (
    await client.query(
      `select * from public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)`,
      [unitId, productId, name, kind, selectionMode, minSelect, maxSelect],
    )
  ).rows[0];
}

async function createOption(client, groupId, name, delta) {
  return (
    await client.query('select * from public.create_catalog_product_option($1, $2, $3)', [
      groupId,
      name,
      delta,
    ])
  ).rows[0];
}

async function saveConfig(client, unitId, config) {
  const result = await client.query(
    'select public.save_unit_operational_config($1, $2::jsonb) as out',
    [unitId, JSON.stringify(config)],
  );
  return result.rows[0].out;
}

async function publish(client, unitId) {
  return (await client.query('select public.publish_unit_menu($1) as out', [unitId])).rows[0].out;
}

async function publicMenu(client, slug) {
  return (await client.query('select public.get_public_menu($1) as out', [slug])).rows[0].out;
}

async function checkout(client, slug, key, payload) {
  return (
    await client.query('select public.create_public_order($1, $2, $3::jsonb) as out', [
      slug,
      key,
      JSON.stringify(payload),
    ])
  ).rows[0].out;
}

async function setStatus(client, orderId, status) {
  return (await client.query('select public.set_order_status($1, $2) as out', [orderId, status]))
    .rows[0].out;
}

async function setPayment(client, orderId, status) {
  return (
    await client.query('select public.set_order_payment_status($1, $2) as out', [orderId, status])
  ).rows[0].out;
}

async function orderIdForCreation(client, creation) {
  return (
    await client.query('select id from public.orders where tracking_token = $1', [
      creation.tracking_token,
    ])
  ).rows[0]?.id;
}

async function accountOf(client, membershipId) {
  const row = (
    await client.query('select * from public.loyalty_accounts where membership_id = $1', [
      membershipId,
    ])
  ).rows[0];
  if (row) {
    row.points_balance = Number(row.points_balance);
    row.recovery_points = Number(row.recovery_points);
  }
  return row;
}

async function ledgerSum(client, membershipId) {
  return Number(
    (
      await client.query(
        'select coalesce(sum(amount), 0)::bigint as total from public.loyalty_ledger where membership_id = $1',
        [membershipId],
      )
    ).rows[0].total,
  );
}

async function setProgramEnabled(client, organizationId, enabled) {
  return (
    await client.query('select public.set_loyalty_program_enabled($1, $2) as out', [
      organizationId,
      enabled,
    ])
  ).rows[0].out;
}

async function resolveLoyalty(client, args) {
  const phoneFingerprint =
    args.phoneFingerprint ?? sha256(`pedon:phone:v1:${args.organizationId}:${args.fingerprint}`);
  const consentVersion =
    args.consentVersion === undefined && args.mode === 'enroll'
      ? 'test-consent-v1'
      : args.consentVersion;
  return (
    await client.query(
      `select public.resolve_loyalty_identity_internal_v2(
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       ) as out`,
      [
        args.organizationId,
        args.fingerprint,
        phoneFingerprint,
        args.last2,
        args.mode,
        args.name,
        args.tokenHash,
        args.expiresAt,
        consentVersion,
      ],
    )
  ).rows[0].out;
}

async function versionsCount(admin, unitId) {
  return (
    await admin.query(
      'select count(*)::int as count from public.menu_versions where unit_id = $1',
      [unitId],
    )
  ).rows[0].count;
}

async function currentVersionNumber(admin, unitId) {
  const row = await admin.query(
    `select mv.version_number
     from public.menu_publications mp
     join public.menu_versions mv on mv.id = mp.current_menu_version_id
     where mp.unit_id = $1`,
    [unitId],
  );
  return row.rows[0]?.version_number ?? null;
}

async function snapshotHasProduct(admin, unitId, sourceProductId, versionNumber) {
  const row = await admin.query(
    `select count(*)::int as count
     from public.menu_version_products p
     join public.menu_versions v on v.id = p.menu_version_id
     where v.unit_id = $1 and v.version_number = $2 and p.source_product_id = $3`,
    [unitId, versionNumber, sourceProductId],
  );
  return row.rows[0].count;
}

function allDays24h() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: true,
    is_24h: true,
    open_time: null,
    close_time: null,
  }));
}

function operationalConfig(overrides = {}) {
  const config = {
    timezone: 'America/Sao_Paulo',
    pickup_enabled: true,
    delivery_enabled: true,
    delivery_fee: '5.50',
    min_order_value: '0.00',
    estimated_pickup_minutes: 20,
    estimated_delivery_minutes: 45,
    accepting_orders: true,
    business_hours: allDays24h(),
    payment_methods: [
      { method: 'cash', is_enabled: true },
      { method: 'pix', is_enabled: true },
      { method: 'credit_card', is_enabled: true },
      { method: 'debit_card', is_enabled: false },
    ],
  };
  return {
    ...config,
    ...overrides,
    business_hours: overrides.business_hours ?? config.business_hours,
    payment_methods: overrides.payment_methods ?? config.payment_methods,
  };
}

function productByName(menu, name) {
  for (const category of menu.categories ?? []) {
    const product = (category.products ?? []).find((entry) => entry.name === name);
    if (product) return product;
  }
  return null;
}

function groupByName(product, name) {
  return (product.option_groups ?? []).find((entry) => entry.name === name);
}

function optionByName(group, name) {
  return (group.options ?? []).find((entry) => entry.name === name);
}

const BASE_CUSTOMER = {
  name: '  Cliente Remediacao  ',
  phone: '(11) 95555-0000',
};

function makePayload(menu, items, overrides = {}) {
  const base = {
    menu_version_id: menu.menu.version_id,
    operation_revision: menu.operation.revision,
    service_mode: 'pickup',
    payment_method: 'pix',
    customer: { ...BASE_CUSTOMER },
    items,
    notes: '  Observacao com opcoes (remediacao)  ',
    cash_change_for: null,
  };
  return {
    ...base,
    ...overrides,
    customer: overrides.customer === undefined ? base.customer : overrides.customer,
    items: overrides.items === undefined ? base.items : overrides.items,
  };
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  let ownerA;
  let ownerAS;
  let ownerAS2;
  let anon;
  let orgA;
  let unitA1;
  let slugA1;
  let categoryA1;
  let Simples;
  let Configuravel;
  let tamanho;
  let pequeno;
  let ConfiguravelB;
  let tamanhoB;
  let adicionaisB;
  let Concorrente;
  let Concorrente2;

  try {
    scenario(0, 'setup sintetico: tenant, catalogo configurável e publicacao base');
    ownerA = await createTestUser(admin, `remed-owner-a-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id);

    ownerAS = await sessionFor(ownerA.id);
    openClients.push(ownerAS);
    ownerAS2 = await sessionFor(ownerA.id);
    openClients.push(ownerAS2);
    anon = await anonClient();
    openClients.push(anon);

    orgA = (await ownerAS.query(`select public.complete_onboarding('Remediacao Org') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);
    unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;

    categoryA1 = await createCategory(ownerAS, unitA1, 'Remediacao Itens');

    Simples = await createProduct(ownerAS, unitA1, categoryA1.id, 'Simples', '4.00');
    Configuravel = await createProduct(ownerAS, unitA1, categoryA1.id, 'Configuravel', '5.00');
    tamanho = await createGroup(
      ownerAS,
      unitA1,
      Configuravel.id,
      'Tamanho',
      'variation',
      'single',
      1,
      1,
    );
    pequeno = await createOption(ownerAS, tamanho.id, 'Pequeno', '0.00');
    await createOption(ownerAS, tamanho.id, 'Grande', '2.00');
    const adicionais = await createGroup(
      ownerAS,
      unitA1,
      Configuravel.id,
      'Adicionais',
      'addon',
      'multiple',
      0,
      2,
    );
    await createOption(ownerAS, adicionais.id, 'Bacon', '1.50');
    await createOption(ownerAS, adicionais.id, 'Queijo', '1.00');

    ConfiguravelB = await createProduct(ownerAS, unitA1, categoryA1.id, 'ConfiguravelB', '6.00');
    tamanhoB = await createGroup(
      ownerAS,
      unitA1,
      ConfiguravelB.id,
      'Tamanho B',
      'variation',
      'single',
      1,
      1,
    );
    await createOption(ownerAS, tamanhoB.id, 'PequenoB', '0.00');
    await createOption(ownerAS, tamanhoB.id, 'GrandeB', '2.00');
    adicionaisB = await createGroup(
      ownerAS,
      unitA1,
      ConfiguravelB.id,
      'Adicionais B',
      'addon',
      'multiple',
      0,
      2,
    );
    await createOption(ownerAS, adicionaisB.id, 'BaconB', '1.50');
    await createOption(ownerAS, adicionaisB.id, 'QueijoB', '1.00');

    Concorrente = await createProduct(ownerAS, unitA1, categoryA1.id, 'Concorrente', '5.00');
    Concorrente2 = await createProduct(ownerAS, unitA1, categoryA1.id, 'Concorrente2', '3.00');

    await saveConfig(ownerAS, unitA1, operationalConfig());
    const pub1 = await publish(ownerAS, unitA1);
    slugA1 = pub1.public_slug;
    ok(pub1.version_number === 1, '0.1 publicacao base v1');
    const menu0 = await publicMenu(anon, slugA1);
    ok(menu0.found === true, '0.2 menu base publicado');
    ok(productByName(menu0, 'Simples') !== null, '0.3 produto simples presente (F)');
    ok(
      productByName(menu0, 'Configuravel') !== null &&
        productByName(menu0, 'ConfiguravelB') !== null,
      '0.4 produtos configuraveis presentes',
    );
    ok((await versionsCount(admin, unitA1)) === 1, '0.5 exatamente uma versao');

    scenario(1, 'HIGH-1-A: obrigatorio min=1 sem opcoes ativas bloqueia publicacao');
    const obrigatorioVazio = await createProduct(
      ownerAS,
      unitA1,
      categoryA1.id,
      'ObrigatorioVazio',
      '5.00',
    );
    const grupoVazio = await createGroup(
      ownerAS,
      unitA1,
      obrigatorioVazio.id,
      'Obrigatorio',
      'variation',
      'single',
      1,
      1,
    );
    await expectError(
      ownerAS,
      'select public.publish_unit_menu($1)',
      [unitA1],
      'PED73',
      '1.0 requerido min=1 sem opcoes -> PED73',
    );
    ok((await versionsCount(admin, unitA1)) === 1, '1.1 nenhuma versao parcial criada');
    ok((await currentVersionNumber(admin, unitA1)) === 1, '1.2 versao anterior permanece vigente');
    ok(
      (await snapshotHasProduct(admin, unitA1, obrigatorioVazio.id, 1)) === 0,
      '1.3 produto problematico ausente do snapshot vigente',
    );

    scenario(2, 'HIGH-1-B: obrigatorio min=2 com 1 opcao ativa bloqueia publicacao');
    const obrigatorio2 = await createProduct(
      ownerAS,
      unitA1,
      categoryA1.id,
      'Obrigatorio2',
      '6.00',
    );
    const grupoObrig2 = await createGroup(
      ownerAS,
      unitA1,
      obrigatorio2.id,
      'Obrigatorio 2',
      'addon',
      'multiple',
      2,
      2,
    );
    await createOption(ownerAS, grupoObrig2.id, 'Opc1', '0.50');
    await expectError(
      ownerAS,
      'select public.publish_unit_menu($1)',
      [unitA1],
      'PED73',
      '2.0 requerido min=2 com 1 opcao -> PED73',
    );
    ok((await versionsCount(admin, unitA1)) === 1, '2.1 nenhuma versao parcial criada');
    ok((await currentVersionNumber(admin, unitA1)) === 1, '2.2 versao anterior permanece vigente');
    ok(
      (await snapshotHasProduct(admin, unitA1, obrigatorio2.id, 1)) === 0,
      '2.3 produto problematico ausente do snapshot vigente',
    );

    scenario(3, 'HIGH-1-C/D/E: correcao retoma publicacao; opcional vazio omitido');
    const opcionalVazio = await createProduct(
      ownerAS,
      unitA1,
      categoryA1.id,
      'OpcionalVazio',
      '7.00',
    );
    const grupoOpcional = await createGroup(
      ownerAS,
      unitA1,
      opcionalVazio.id,
      'Opcional',
      'addon',
      'multiple',
      0,
      3,
    );
    await createOption(ownerAS, grupoVazio.id, 'Unico', '0.00');
    await createOption(ownerAS, grupoObrig2.id, 'Opc2', '0.50');
    const pub2 = await publish(ownerAS, unitA1);
    ok(pub2.version_number === 2, '3.0 publicacao retoma em v2 apos correcao');
    const menu2 = await publicMenu(anon, slugA1);
    ok(productByName(menu2, 'Simples') !== null, '3.1 produto simples continua publicando (F)');
    const obrigatorioVazioMenu = productByName(menu2, 'ObrigatorioVazio');
    ok(obrigatorioVazioMenu !== null, '3.2 produto requerido corrigido publicado (D)');
    ok(
      groupByName(obrigatorioVazioMenu, 'Obrigatorio') !== undefined &&
        optionByName(groupByName(obrigatorioVazioMenu, 'Obrigatorio'), 'Unico') !== undefined,
      '3.3 grupo obrigatorio satisfeito presente no snapshot',
    );
    const obrigatorio2Menu = productByName(menu2, 'Obrigatorio2');
    ok(
      groupByName(obrigatorio2Menu, 'Obrigatorio 2')?.options?.length === 2,
      '3.4 grupo min=2 com duas opcoes publicado integralmente',
    );
    const opcionalVazioMenu = productByName(menu2, 'OpcionalVazio');
    ok(
      opcionalVazioMenu !== null &&
        Array.isArray(opcionalVazioMenu.option_groups) &&
        opcionalVazioMenu.option_groups.length === 0,
      '3.5 grupo opcional vazio omitido do snapshot (E)',
    );
    ok(pub2.option_group_count === 6, '3.6 seis grupos congelados (simples mantem-se)');

    scenario(4, 'HIGH-2: lock de estrutura bloqueia todos os writers e a publicacao');
    await ownerAS2.query('begin');
    await ownerAS2.query('select pg_advisory_xact_lock(hashtext($1))', [
      `pedon:catalog:structure:${unitA1}`,
    ]);
    await ownerAS.query(`set lock_timeout = '200ms'`);

    await expectError(
      ownerAS,
      'select * from public.create_catalog_category($1, $2)',
      [unitA1, 'Bloqueada'],
      '55P03',
      '4.0 create categoria aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.update_catalog_category($1, $2)',
      [categoryA1.id, 'Bloqueada Nome'],
      '55P03',
      '4.1 update categoria aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.set_catalog_category_active($1, $2)',
      [categoryA1.id, false],
      '55P03',
      '4.2 toggle categoria aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.create_catalog_product($1, $2, $3, null, $4)',
      [unitA1, categoryA1.id, 'Bloqueado', '5.00'],
      '55P03',
      '4.3 create produto aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.update_catalog_product($1, $2, $3, null, $4)',
      [Simples.id, categoryA1.id, 'Simples', '9.99'],
      '55P03',
      '4.4 update produto aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.set_catalog_product_active($1, $2)',
      [Simples.id, false],
      '55P03',
      '4.5 toggle produto aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, Simples.id, 'Bloqueada', 'addon', 'multiple', 0, 1],
      '55P03',
      '4.6 create grupo aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.update_catalog_product_option_group($1, $2, $3, $4, $5, $6)',
      [grupoOpcional.id, 'Bloqueada', 'addon', 'multiple', 0, 1],
      '55P03',
      '4.7 update grupo aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.set_catalog_product_option_group_active($1, $2)',
      [grupoOpcional.id, false],
      '55P03',
      '4.8 toggle grupo aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.create_catalog_product_option($1, $2, $3)',
      [grupoOpcional.id, 'Bloqueada', '0.00'],
      '55P03',
      '4.9 create opcao aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.update_catalog_product_option($1, $2, $3)',
      [pequeno.id, 'Bloqueada', '0.00'],
      '55P03',
      '4.10 update opcao aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select * from public.set_catalog_product_option_active($1, $2)',
      [pequeno.id, false],
      '55P03',
      '4.11 toggle opcao aguarda lock de estrutura',
    );
    await expectError(
      ownerAS,
      'select public.publish_unit_menu($1)',
      [unitA1],
      '55P03',
      '4.12 publicacao aguarda writer estrutural em andamento',
    );

    await ownerAS2.query('commit');
    await ownerAS.query(`set lock_timeout = '0'`);

    const blockedCategory = await admin.query(
      'select count(*)::int as count from public.catalog_categories where unit_id = $1 and name = $2',
      [unitA1, 'Bloqueada'],
    );
    ok(blockedCategory.rows[0].count === 0, '4.13 create bloqueada nao executou');
    const blockedProduct = await admin.query(
      'select count(*)::int as count from public.catalog_products where unit_id = $1 and name = $2',
      [unitA1, 'Bloqueado'],
    );
    ok(blockedProduct.rows[0].count === 0, '4.14 produto bloqueado nao criado');
    const simplesState = await admin.query(
      'select name, price::text as price, is_active from public.catalog_products where id = $1',
      [Simples.id],
    );
    ok(
      simplesState.rows[0].name === 'Simples' &&
        simplesState.rows[0].price === '4.00' &&
        simplesState.rows[0].is_active === true,
      '4.15 update/toggle bloqueados nao alteraram Simples',
    );

    await updateProduct(ownerAS, Simples.id, categoryA1.id, 'Simples', '4.00');
    const pub3 = await publish(ownerAS, unitA1);
    ok(pub3.version_number === 3, '4.16 apos liberar, writers e publicacao voltam a operar');

    scenario(5, 'HIGH-2: publicacao concorrente com update de preco mantem estado completo');
    const pubS = await sessionFor(ownerA.id);
    openClients.push(pubS);
    const updS = await sessionFor(ownerA.id);
    openClients.push(updS);
    const settledUpdate = await Promise.allSettled([
      pubS.query('select public.publish_unit_menu($1) as out', [unitA1]),
      updS.query('select * from public.update_catalog_product($1, $2, $3, null, $4)', [
        Concorrente.id,
        categoryA1.id,
        'Concorrente',
        '9.99',
      ]),
    ]);
    ok(
      settledUpdate.every((entry) => entry.status === 'fulfilled'),
      '5.0 publish e update cumprem',
    );
    ok((await versionsCount(admin, unitA1)) === 4, '5.1 exatamente uma versao extra criada');
    ok((await currentVersionNumber(admin, unitA1)) === 4, '5.2 publicacao v4 vigente');
    const concPrice = await admin.query(
      `select p.price::text as price
       from public.menu_version_products p
       join public.menu_versions v on v.id = p.menu_version_id
       where v.unit_id = $1 and v.version_number = 4 and p.source_product_id = $2`,
      [unitA1, Concorrente.id],
    );
    ok(
      ['5.00', '9.99'].includes(concPrice.rows[0]?.price),
      '5.3 snapshot v4 com preco completo (antes ou depois do update)',
    );
    const concCatalog = await admin.query(
      'select price::text as price from public.catalog_products where id = $1',
      [Concorrente.id],
    );
    ok(concCatalog.rows[0].price === '9.99', '5.4 catalogo persistiu o update');

    scenario(6, 'HIGH-2: publicacao concorrente com desativacao mantem estado completo');
    const pubS2 = await sessionFor(ownerA.id);
    openClients.push(pubS2);
    const actS = await sessionFor(ownerA.id);
    openClients.push(actS);
    const settledToggle = await Promise.allSettled([
      pubS2.query('select public.publish_unit_menu($1) as out', [unitA1]),
      actS.query('select * from public.set_catalog_product_active($1, $2)', [
        Concorrente2.id,
        false,
      ]),
    ]);
    ok(
      settledToggle.every((entry) => entry.status === 'fulfilled'),
      '6.0 publish e toggle cumprem',
    );
    ok((await versionsCount(admin, unitA1)) === 5, '6.1 exatamente uma versao extra criada');
    ok((await currentVersionNumber(admin, unitA1)) === 5, '6.2 publicacao v5 vigente');
    const conc2State = await admin.query(
      'select is_active from public.catalog_products where id = $1',
      [Concorrente2.id],
    );
    ok(conc2State.rows[0].is_active === false, '6.3 desativacao persistiu');
    const conc2Snap = await snapshotHasProduct(admin, unitA1, Concorrente2.id, 5);
    ok(conc2Snap === 0 || conc2Snap === 1, '6.4 v5 contem ou exclui Concorrente2 por completo');
    const simplesSnap = await snapshotHasProduct(admin, unitA1, Simples.id, 5);
    ok(simplesSnap === 1, '6.5 menu v5 permanece nao vazio (Simples presente)');

    scenario(7, 'MEDIUM: order_item_options vinculada a MESMA linha de order_items');
    const constraints = await admin.query(
      `select conname
       from pg_constraint
       where conrelid = 'public.order_items'::regclass
          or conname in ('order_item_options_item_menu_bind_fk')`,
    );
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));
    ok(
      constraintNames.has('order_items_id_menu_item_bind_key'),
      '7.0 unique (id, menu_version_id, menu_item_id) presente em order_items',
    );
    ok(
      constraintNames.has('order_item_options_item_menu_bind_fk'),
      '7.1 FK de vínculo presente em order_item_options',
    );

    const menu7 = await publicMenu(anon, slugA1);
    const config7 = productByName(menu7, 'Configuravel');
    const configB7 = productByName(menu7, 'ConfiguravelB');
    const itemA = {
      menu_item_id: config7.id,
      quantity: 1,
      note: null,
      options: [
        optionByName(groupByName(config7, 'Tamanho'), 'Grande').id,
        optionByName(groupByName(config7, 'Adicionais'), 'Bacon').id,
      ],
    };
    const itemB = {
      menu_item_id: configB7.id,
      quantity: 1,
      note: null,
      options: [optionByName(groupByName(configB7, 'Tamanho B'), 'GrandeB').id],
    };
    const key7 = randomUUID();
    const creation7 = await checkout(anon, slugA1, key7, makePayload(menu7, [itemA, itemB]));
    ok(creation7.tracking_token !== undefined, '7.2 pedido com duas linhas configuraveis criado');
    const orderId7 = await orderIdForCreation(admin, creation7);
    const itemRows = await admin.query(
      `select id, menu_version_id, menu_item_id
       from public.order_items
       where order_id = $1
       order by menu_item_id`,
      [orderId7],
    );
    ok(itemRows.rows.length === 2, '7.3 duas linhas de item no pedido');
    const itemAId = itemRows.rows.find((row) => row.menu_item_id === config7.id)?.id;
    const itemBId = itemRows.rows.find((row) => row.menu_item_id === configB7.id)?.id;
    ok(itemAId !== undefined && itemBId !== undefined, '7.4 linhas identificadas por menu_item');
    const menuVersionId = itemRows.rows[0].menu_version_id;
    const baconBSnap = optionByName(groupByName(configB7, 'Adicionais B'), 'BaconB');
    const adicionaisBSnap = groupByName(configB7, 'Adicionais B');

    await expectError(
      admin,
      `insert into public.order_item_options
         (organization_id, unit_id, order_id, order_item_id, menu_version_id,
          menu_item_id, menu_group_id, group_name, group_kind,
          menu_option_id, option_name, price_delta)
       select o.organization_id, o.unit_id, o.id, $1, $2,
              $3, $4, 'Adicionais B', 'addon', $5, 'BaconB', '1.50'
       from public.orders o where o.id = $6`,
      [itemAId, menuVersionId, configB7.id, adicionaisBSnap.id, baconBSnap.id, orderId7],
      '23503',
      '7.5 opcao com menu_item de outra linha viola FK de vínculo',
    );

    const controlRow = await admin.query(
      `insert into public.order_item_options
         (organization_id, unit_id, order_id, order_item_id, menu_version_id,
          menu_item_id, menu_group_id, group_name, group_kind,
          menu_option_id, option_name, price_delta)
       select o.organization_id, o.unit_id, o.id, $1, $2,
              $3, $4, 'Adicionais B', 'addon', $5, 'BaconB', '1.50'
       from public.orders o where o.id = $6
       returning id`,
      [itemBId, menuVersionId, configB7.id, adicionaisBSnap.id, baconBSnap.id, orderId7],
    );
    ok(controlRow.rows.length === 1, '7.6 controle com vínculo consistente aceito');
    await admin.query('delete from public.order_item_options where id = $1', [
      controlRow.rows[0].id,
    ]);

    scenario(8, 'regressao: mesma key com opcoes diferentes retorna PED42');
    const menu8 = await publicMenu(anon, slugA1);
    const config8 = productByName(menu8, 'Configuravel');
    const grande8 = optionByName(groupByName(config8, 'Tamanho'), 'Grande').id;
    const pequeno8 = optionByName(groupByName(config8, 'Tamanho'), 'Pequeno').id;
    const key8 = randomUUID();
    const payloadGrande = makePayload(menu8, [
      { menu_item_id: config8.id, quantity: 1, note: null, options: [grande8] },
    ]);
    const first8 = await checkout(anon, slugA1, key8, payloadGrande);
    ok(first8.tracking_token !== undefined, '8.1 primeira criacao com key valida');
    const payloadPequeno = makePayload(menu8, [
      { menu_item_id: config8.id, quantity: 1, note: null, options: [pequeno8] },
    ]);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, key8, JSON.stringify(payloadPequeno)],
      'PED42',
      '8.2 mesma key com opcoes diferentes -> PED42',
    );
    const replay8 = await checkout(anon, slugA1, key8, payloadGrande);
    ok(
      replay8.tracking_token === first8.tracking_token,
      '8.3 replay idempotente com mesmas opcoes retorna a mesma criacao',
    );

    scenario(9, 'regressao: fingerprint canonico por ordem de opcoes (equivalencia)');
    const menu9 = await publicMenu(anon, slugA1);
    const config9 = productByName(menu9, 'Configuravel');
    const grande9 = optionByName(groupByName(config9, 'Tamanho'), 'Grande').id;
    const bacon9 = optionByName(groupByName(config9, 'Adicionais'), 'Bacon').id;
    const hashAB = (
      await admin.query('select public._options_fingerprint($1::uuid[]) as out', [
        [grande9, bacon9],
      ])
    ).rows[0].out;
    const hashBA = (
      await admin.query('select public._options_fingerprint($1::uuid[]) as out', [
        [bacon9, grande9],
      ])
    ).rows[0].out;
    ok(hashAB === hashBA && /^[a-f0-9]{64}$/.test(hashAB), '9.0 fingerprint independe da ordem');
    const hashOnlyA = (
      await admin.query('select public._options_fingerprint($1::uuid[]) as out', [[grande9]])
    ).rows[0].out;
    ok(hashOnlyA !== hashAB, '9.1 fingerprint distingue selecoes diferentes');

    scenario(10, 'regressao: earn de loyalty calculado sobre subtotal autoritativo com opcoes');
    await setProgramEnabled(ownerAS, orgA, true);
    const cpf = '99988877766';
    const fp = sha256(`pedon:cpf:v1:${orgA}:${cpf}`);
    const token = randomToken();
    const enrollment = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fp,
      last2: cpf.slice(-2),
      mode: 'enroll',
      name: '  Cliente Fiel  ',
      tokenHash: sha256(token),
      expiresAt: inTwoHours(),
    });
    ok(enrollment.found === true, '10.0 membro inscrito');

    const menu10 = await publicMenu(anon, slugA1);
    const config10 = productByName(menu10, 'Configuravel');
    const loyaltyItem = {
      menu_item_id: config10.id,
      quantity: 1,
      note: null,
      options: [
        optionByName(groupByName(config10, 'Tamanho'), 'Grande').id,
        optionByName(groupByName(config10, 'Adicionais'), 'Bacon').id,
      ],
    };
    const payload10 = makePayload(menu10, [loyaltyItem], { loyalty_token: token });
    const key10 = randomUUID();
    const creation10 = await checkout(anon, slugA1, key10, payload10);
    const orderId10 = await orderIdForCreation(admin, creation10);
    const subtotal = (
      await admin.query('select subtotal from public.orders where id = $1', [orderId10])
    ).rows[0].subtotal;
    ok(Number(subtotal) === 8.5, '10.1 subtotal autoritativo 8.50 (5.00 + 2.00 + 1.50)');

    await setPayment(ownerAS, orderId10, 'paid');
    await setStatus(ownerAS, orderId10, 'confirmed');
    await setStatus(ownerAS, orderId10, 'preparing');
    await setStatus(ownerAS, orderId10, 'ready');
    await setStatus(ownerAS, orderId10, 'completed');

    const earnAccount = await accountOf(admin, enrollment.membership_id);
    ok(earnAccount.points_balance === 8, '10.2 earn floor(8.50 * 1.00) = 8 pontos com opcoes');
    ok((await ledgerSum(admin, enrollment.membership_id)) === 8, '10.3 ledger soma 8');

    ok(passed + failed >= 60, 'suite planeja ao menos 60 checks executados');
  } finally {
    for (const client of openClients) {
      await client.end().catch(() => {});
    }
    if (createdOrgIds.length > 0) {
      await admin
        .query('delete from public.orders where organization_id = any($1::uuid[])', [createdOrgIds])
        .catch(() => console.warn('cleanup orders warning'));
      await admin
        .query('delete from public.organizations where id = any($1::uuid[])', [createdOrgIds])
        .catch(() => console.warn('cleanup orgs warning'));
    }
    if (createdUsers.length > 0) {
      await admin
        .query('delete from auth.users where id = any($1::uuid[])', [createdUsers])
        .catch(() => console.warn('cleanup users warning'));
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
  console.error(`ERRO NA EXECUCAO: ${error.code ?? 'unexpected'}`);
  process.exitCode = 1;
});
