import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Esta suite altera fixtures operacionais e deve rodar isoladamente das
// demais regressoes de banco.
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
  console.error('SUPABASE_DB_PASSWORD nao encontrada em ambiente nem em .env.');
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
  console.log(`Cenario ${number} - ${label}`);
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function exactKeys(value, expected) {
  return JSON.stringify(sortedKeys(value)) === JSON.stringify([...expected].sort());
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

function isTrackingToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

async function adminClient() {
  const client = new Client({
    connectionString: DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function sessionFor(userId) {
  const client = new Client({
    connectionString: DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('set role authenticated');
  await client.query(`set request.jwt.claims = '{"sub": "${userId}", "role": "authenticated"}'`);
  await client.query(`set request.jwt.claim.sub = '${userId}'`);
  return client;
}

async function anonClient() {
  const client = new Client({
    connectionString: DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });
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

async function expectDenied(client, sql, params, label) {
  return expectError(client, sql, params, '42501', label);
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

async function setProductAvailable(client, productId, available) {
  return (
    await client.query('select * from public.set_catalog_product_available($1, $2)', [
      productId,
      available,
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

async function tracking(client, token) {
  return (await client.query('select public.get_public_order($1) as out', [token])).rows[0].out;
}

async function adminDetail(client, orderId) {
  return (await client.query('select public.get_order_admin($1) as out', [orderId])).rows[0].out;
}

async function adminList(client, unitId, status = null, limit = 50) {
  return (
    await client.query('select public.get_unit_orders_admin($1, $2, $3) as out', [
      unitId,
      status,
      limit,
    ])
  ).rows[0].out;
}

async function setStatus(client, orderId, status, note = null) {
  return (
    await client.query('select public.set_order_status($1, $2, $3) as out', [orderId, status, note])
  ).rows[0].out;
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

function allDays24h() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: true,
    is_24h: true,
    open_time: null,
    close_time: null,
  }));
}

function allDaysClosed() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: false,
    is_24h: false,
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

const BASE_CUSTOMER = {
  name: '  Cliente Sintetico  ',
  phone: '(11) 98888-7777',
};

const BASE_DELIVERY_ADDRESS = {
  street: '  Rua de Teste  ',
  number: '  100  ',
  complement: '  Bloco A  ',
  neighborhood: '  Bairro Teste  ',
  city: '  Cidade Teste  ',
  state: 'sp',
  postal_code: '01001-000',
  reference: '  Referencia sintetica  ',
};

function makePayload(menu, items, overrides = {}) {
  const base = {
    menu_version_id: menu.menu.version_id,
    operation_revision: menu.operation.revision,
    service_mode: 'pickup',
    payment_method: 'pix',
    customer: { ...BASE_CUSTOMER },
    items,
    notes: '  Observacao sintetica  ',
    cash_change_for: null,
  };
  return {
    ...base,
    ...overrides,
    customer: overrides.customer === undefined ? base.customer : overrides.customer,
    items: overrides.items === undefined ? base.items : overrides.items,
  };
}

function deliveryPayload(menu, items, overrides = {}) {
  return makePayload(menu, items, {
    service_mode: 'delivery',
    delivery_address: { ...BASE_DELIVERY_ADDRESS },
    ...overrides,
  });
}

async function withTwoAnon(callback) {
  let first;
  let second;
  try {
    first = await anonClient();
    second = await anonClient();
    return await callback(first, second);
  } finally {
    if (first) await first.end().catch(() => {});
    if (second) await second.end().catch(() => {});
  }
}

async function withTwoSessions(userId, callback) {
  let first;
  let second;
  try {
    first = await sessionFor(userId);
    second = await sessionFor(userId);
    return await callback(first, second);
  } finally {
    if (first) await first.end().catch(() => {});
    if (second) await second.end().catch(() => {});
  }
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  let ownerA;
  let managerA;
  let operatorA;
  let managerOther;
  let ownerB;
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
  let slugA1;
  let slugA2;
  let slugB1;
  let categoryA1;
  let exactSource;
  let unavailableSource;
  let missingSource;
  let oldVersionMenu;
  let currentMenu;
  let exactCreation;
  let exactOrderId;

  try {
    scenario(0, 'setup sintetico de tenants, RBAC, catalogo e publicacoes');
    ownerA = await createTestUser(admin, `orders-owner-a-${suffix}@pedon-test.invalid`);
    managerA = await createTestUser(admin, `orders-manager-a-${suffix}@pedon-test.invalid`);
    operatorA = await createTestUser(admin, `orders-operator-a-${suffix}@pedon-test.invalid`);
    managerOther = await createTestUser(admin, `orders-manager-other-${suffix}@pedon-test.invalid`);
    ownerB = await createTestUser(admin, `orders-owner-b-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, managerOther.id, ownerB.id);

    ownerAS = await sessionFor(ownerA.id);
    openClients.push(ownerAS);
    managerAS = await sessionFor(managerA.id);
    openClients.push(managerAS);
    operatorAS = await sessionFor(operatorA.id);
    openClients.push(operatorAS);
    managerOtherS = await sessionFor(managerOther.id);
    openClients.push(managerOtherS);
    ownerBS = await sessionFor(ownerB.id);
    openClients.push(ownerBS);
    anon = await anonClient();
    openClients.push(anon);

    orgA = (await ownerAS.query(`select public.complete_onboarding('Orders Org A') as org`)).rows[0]
      .org;
    createdOrgIds.push(orgA);
    unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    unitA2 = (
      await ownerAS.query('select (public.create_unit($1)).id as id', ['Orders Unidade A2'])
    ).rows[0].id;

    orgB = (await ownerBS.query(`select public.complete_onboarding('Orders Org B') as org`)).rows[0]
      .org;
    createdOrgIds.push(orgB);
    unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB],
      )
    ).rows[0].id;

    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'manager'), ($1, $3, 'operator'), ($1, $4, 'manager')`,
      [orgA, managerA.id, operatorA.id, managerOther.id],
    );
    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3), ($1, $4, $3), ($1, $5, $6)`,
      [orgA, managerA.id, unitA1, operatorA.id, managerOther.id, unitA2],
    );

    categoryA1 = await createCategory(ownerAS, unitA1, 'Pedidos Itens');
    exactSource = await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Exato', '8.10');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Barato', '1.00');
    unavailableSource = await createProduct(
      ownerAS,
      unitA1,
      categoryA1.id,
      'Produto Indisponivel',
      '2.00',
    );
    await setProductAvailable(ownerAS, unavailableSource.id, false);
    missingSource = await createProduct(
      ownerAS,
      unitA1,
      categoryA1.id,
      'Produto Sem Fonte',
      '3.00',
    );
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Overflow', '9999999999.99');
    for (let index = 1; index <= 50; index += 1) {
      await createProduct(
        ownerAS,
        unitA1,
        categoryA1.id,
        `Produto Distinto ${String(index).padStart(2, '0')}`,
        '1.00',
      );
    }

    await saveConfig(ownerAS, unitA1, operationalConfig());
    const publicationV1 = await publish(ownerAS, unitA1);
    slugA1 = publicationV1.public_slug;
    oldVersionMenu = await publicMenu(anon, slugA1);
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Versao Nova', '4.00');
    await publish(ownerAS, unitA1);
    currentMenu = await publicMenu(anon, slugA1);
    await admin.query('delete from public.catalog_products where id = $1', [missingSource.id]);

    const categoryA2 = await createCategory(ownerAS, unitA2, 'Pedidos A2');
    await createProduct(ownerAS, unitA2, categoryA2.id, 'Produto A2', '7.00');
    const publicationA2 = await publish(ownerAS, unitA2);
    slugA2 = publicationA2.public_slug;

    const categoryB1 = await createCategory(ownerBS, unitB1, 'Pedidos B1');
    await createProduct(ownerBS, unitB1, categoryB1.id, 'Produto B1', '6.00');
    await saveConfig(ownerBS, unitB1, operationalConfig());
    const publicationB1 = await publish(ownerBS, unitB1);
    slugB1 = publicationB1.public_slug;
    const setupMenuB1 = await publicMenu(anon, slugB1);
    const setupOrderB1 = await checkout(
      anon,
      slugB1,
      randomUUID(),
      makePayload(setupMenuB1, [
        {
          menu_item_id: productByName(setupMenuB1, 'Produto B1').id,
          quantity: 1,
          note: null,
        },
      ]),
    );

    ok(currentMenu.found === true, '0.1 menu principal publicado');
    ok(currentMenu.operation.can_order_now === true, '0.2 checkout principal habilitado');
    ok(productByName(currentMenu, 'Produto Exato') !== null, '0.3 item principal encontrado');
    ok(productByName(oldVersionMenu, 'Produto Exato') !== null, '0.4 versao anterior preservada');
    ok(isTrackingToken(setupOrderB1.tracking_token), '0.5 pedido sintetico no segundo tenant');

    scenario(1, 'helper de horario normal, 24h, overnight e virada semanal');
    const normalHours = allDaysClosed();
    normalHours[1] = {
      weekday: 1,
      is_open: true,
      is_24h: false,
      open_time: '09:00',
      close_time: '18:00',
    };
    await saveConfig(
      ownerAS,
      unitA2,
      operationalConfig({ accepting_orders: false, business_hours: normalHours }),
    );
    const normalOpen = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-10T13:00:00Z') as value`,
      [unitA2],
    );
    const normalBefore = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-10T11:59:59Z') as value`,
      [unitA2],
    );
    const normalClose = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-10T21:00:00Z') as value`,
      [unitA2],
    );
    ok(normalOpen.rows[0].value === true, '1.1 intervalo normal aberto');
    ok(normalBefore.rows[0].value === false, '1.2 antes da abertura fechado');
    ok(normalClose.rows[0].value === false, '1.3 fechamento exclusivo');

    await saveConfig(
      ownerAS,
      unitA2,
      operationalConfig({ accepting_orders: false, business_hours: allDays24h() }),
    );
    const fullDay = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-11T15:00:00Z') as value`,
      [unitA2],
    );
    ok(fullDay.rows[0].value === true, '1.4 dia 24h aberto');

    const overnightHours = allDaysClosed();
    overnightHours[1] = {
      weekday: 1,
      is_open: true,
      is_24h: false,
      open_time: '18:00',
      close_time: '02:00',
    };
    overnightHours[2] = {
      weekday: 2,
      is_open: true,
      is_24h: false,
      open_time: '10:00',
      close_time: '18:00',
    };
    await saveConfig(
      ownerAS,
      unitA2,
      operationalConfig({ accepting_orders: false, business_hours: overnightHours }),
    );
    const overnightEvening = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-11T01:00:00Z') as value`,
      [unitA2],
    );
    const overnightInherited = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-11T04:00:00Z') as value`,
      [unitA2],
    );
    const overnightClosed = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-11T05:00:00Z') as value`,
      [unitA2],
    );
    ok(overnightEvening.rows[0].value === true, '1.5 trecho noturno do proprio dia');
    ok(overnightInherited.rows[0].value === true, '1.6 madrugada herdada com hoje aberto');
    ok(overnightClosed.rows[0].value === false, '1.7 instante de fechamento overnight');

    const equalHours = allDaysClosed();
    equalHours[1] = {
      weekday: 1,
      is_open: true,
      is_24h: false,
      open_time: '12:00',
      close_time: '12:00',
    };
    await saveConfig(
      ownerAS,
      unitA2,
      operationalConfig({ accepting_orders: false, business_hours: equalHours }),
    );
    const equalClosed = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-10T15:00:00Z') as value`,
      [unitA2],
    );
    ok(equalClosed.rows[0].value === false, '1.8 open igual close permanece fechado');

    const weeklyHours = allDaysClosed();
    weeklyHours[6] = {
      weekday: 6,
      is_open: true,
      is_24h: false,
      open_time: '22:00',
      close_time: '02:00',
    };
    weeklyHours[0] = {
      weekday: 0,
      is_open: true,
      is_24h: false,
      open_time: '10:00',
      close_time: '14:00',
    };
    await saveConfig(
      ownerAS,
      unitA2,
      operationalConfig({ accepting_orders: false, business_hours: weeklyHours }),
    );
    const weeklyInherited = await admin.query(
      `select public._is_unit_open_at($1, '2026-08-09T04:00:00Z') as value`,
      [unitA2],
    );
    ok(weeklyInherited.rows[0].value === true, '1.9 virada semanal herdada');

    scenario(2, 'slug, settings, accepting, horario e unidade ativa');
    const exactItem = productByName(currentMenu, 'Produto Exato');
    const baseItems = [{ menu_item_id: exactItem.id, quantity: 1, note: null }];
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      ['slug-invalido', randomUUID(), JSON.stringify(makePayload(currentMenu, baseItems))],
      'PED33',
      '2.1 slug malformado retorna PED33',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [randomUUID().replaceAll('-', '').slice(0, 24), randomUUID(), JSON.stringify({})],
      'PED33',
      '2.2 slug inexistente retorna PED33',
    );

    await admin.query('delete from public.unit_operational_settings where unit_id = $1', [unitA2]);
    const menuA2WithoutSettings = await publicMenu(anon, slugA2);
    const itemA2WithoutSettings = productByName(menuA2WithoutSettings, 'Produto A2');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA2,
        randomUUID(),
        JSON.stringify(
          makePayload(menuA2WithoutSettings, [
            { menu_item_id: itemA2WithoutSettings.id, quantity: 1, note: null },
          ]),
        ),
      ],
      'PED34',
      '2.3 unidade sem settings retorna PED34',
    );

    await saveConfig(ownerAS, unitA1, operationalConfig({ accepting_orders: false }));
    let gatedMenu = await publicMenu(anon, slugA1);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify(makePayload(gatedMenu, baseItems))],
      'PED34',
      '2.4 accepting desligado retorna PED34',
    );

    await saveConfig(
      ownerAS,
      unitA1,
      operationalConfig({ accepting_orders: false, business_hours: allDaysClosed() }),
    );
    await admin.query(
      'update public.unit_operational_settings set accepting_orders = true where unit_id = $1',
      [unitA1],
    );
    gatedMenu = await publicMenu(anon, slugA1);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify(makePayload(gatedMenu, baseItems))],
      'PED34',
      '2.5 unidade fora do horario retorna PED34',
    );

    await saveConfig(ownerAS, unitA1, operationalConfig());
    await saveConfig(ownerAS, unitA2, operationalConfig());
    let menuA2 = await publicMenu(anon, slugA2);
    await ownerAS.query('select public.set_unit_active($1, false)', [unitA2]);
    menuA2 = await publicMenu(anon, slugA2);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA2,
        randomUUID(),
        JSON.stringify(
          makePayload(menuA2, [
            { menu_item_id: productByName(menuA2, 'Produto A2').id, quantity: 1, note: null },
          ]),
        ),
      ],
      'PED34',
      '2.6 unidade inativa retorna PED34',
    );
    await ownerAS.query('select public.set_unit_active($1, true)', [unitA2]);
    menuA2 = await publicMenu(anon, slugA2);
    const orderA2 = await checkout(
      anon,
      slugA2,
      randomUUID(),
      makePayload(menuA2, [
        { menu_item_id: productByName(menuA2, 'Produto A2').id, quantity: 1, note: null },
      ]),
    );
    ok(isTrackingToken(orderA2.tracking_token), '2.7 pedido valido criado na segunda unidade');
    currentMenu = await publicMenu(anon, slugA1);

    scenario(3, 'MENU_CHANGED e CHECKOUT_CHANGED');
    const oldItem = productByName(oldVersionMenu, 'Produto Exato');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [{ menu_item_id: exactItem.id, quantity: 1, note: null }], {
            menu_version_id: oldVersionMenu.menu.version_id,
          }),
        ),
      ],
      'PED35',
      '3.1 versao antiga retorna PED35',
    );
    for (const invalidVersion of [null, 'invalida']) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(makePayload(currentMenu, baseItems, { menu_version_id: invalidVersion })),
        ],
        'PED35',
        '3.2 menu_version_id invalido retorna PED35',
      );
    }

    const staleRevisionPayload = makePayload(currentMenu, baseItems);
    await saveConfig(ownerAS, unitA1, operationalConfig({ delivery_fee: '6.00' }));
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify(staleRevisionPayload)],
      'PED36',
      '3.3 revision anterior retorna PED36',
    );
    const revisedMenu = await publicMenu(anon, slugA1);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(makePayload(revisedMenu, baseItems, { operation_revision: 'invalida' })),
      ],
      'PED36',
      '3.4 revision malformada retorna PED36',
    );
    await saveConfig(ownerAS, unitA1, operationalConfig());
    currentMenu = await publicMenu(anon, slugA1);

    scenario(4, 'payload estrito e texto simples');
    const strictItem = productByName(currentMenu, 'Produto Exato');
    const strictBase = makePayload(currentMenu, [
      { menu_item_id: strictItem.id, quantity: 1, note: null },
    ]);
    for (const invalidRoot of [null, 'payload', []]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [slugA1, randomUUID(), JSON.stringify(invalidRoot)],
        'PED37',
        '4.0 payload raiz nao objeto retorna PED37',
      );
    }
    for (const [field, value] of [
      ['price', '0.01'],
      ['total', '0.01'],
      ['unknown', true],
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [slugA1, randomUUID(), JSON.stringify({ ...strictBase, [field]: value })],
        'PED37',
        '4.1 campo top-level autoritativo ou desconhecido retorna PED37',
      );
    }
    for (const extra of [
      { price: '0.01' },
      { total: '0.01' },
      { product_name: 'Injetado' },
      { unknown: true },
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(
            makePayload(currentMenu, [
              { menu_item_id: strictItem.id, quantity: 1, note: null, ...extra },
            ]),
          ),
        ],
        'PED37',
        '4.2 campo desconhecido no item retorna PED37',
      );
    }
    for (const notes of ['N'.repeat(501), '<b>texto</b>', 'linha\nseguinte']) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(makePayload(currentMenu, strictBase.items, { notes })),
        ],
        'PED37',
        '4.3 observacao geral insegura ou longa retorna PED37',
      );
    }
    for (const invalidItems of [null, {}, 'items']) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(makePayload(currentMenu, strictBase.items, { items: invalidItems })),
        ],
        'PED37',
        '4.5 items nao array retorna PED37',
      );
    }
    for (const note of ['I'.repeat(301), '<i>texto</i>', 'linha\tseguinte']) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(
            makePayload(currentMenu, [{ menu_item_id: strictItem.id, quantity: 1, note }]),
          ),
        ],
        'PED37',
        '4.4 observacao de item insegura ou longa retorna PED37',
      );
    }

    scenario(5, 'customer, telefone e minimizacao de PII');
    for (const customer of [
      null,
      'customer',
      {},
      { name: 123, phone: '11988887777' },
      { name: 'Cliente', phone: 123 },
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(makePayload(currentMenu, strictBase.items, { customer })),
        ],
        'PED43',
        '5.0 customer com tipo invalido retorna PED43',
      );
    }
    for (const customer of [
      { name: 'A', phone: '11988887777' },
      { name: 'N'.repeat(121), phone: '11988887777' },
      { name: '<b>Nome</b>', phone: '11988887777' },
      { name: 'Nome\nTeste', phone: '11988887777' },
      { name: 'Cliente', phone: '119888877' },
      { name: 'Cliente', phone: '119888877777' },
      { name: 'Cliente', phone: '+5511988887777' },
      { name: 'Cliente', phone: 'abc11988887777' },
      { name: 'Cliente', phone: '11988887777', email: 'extra@pedon-test.invalid' },
      { name: 'Cliente', phone: '11988887777', cpf: '00000000000' },
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(makePayload(currentMenu, strictBase.items, { customer })),
        ],
        'PED43',
        '5.1 customer invalido ou com PII extra retorna PED43',
      );
    }

    for (const [phone, expectedPhone] of [
      ['11988887777', '11988887777'],
      ['(11) 98888-7777', '11988887777'],
      ['11 98888-7777', '11988887777'],
      ['(11) 3888-7777', '1138887777'],
    ]) {
      const creation = await checkout(
        anon,
        slugA1,
        randomUUID(),
        makePayload(currentMenu, strictBase.items, {
          customer: { name: '  Cliente Valido  ', phone },
        }),
      );
      const orderId = await orderIdForCreation(ownerAS, creation);
      const detail = await adminDetail(ownerAS, orderId);
      ok(detail.customer_name === 'Cliente Valido', '5.2 nome normalizado');
      ok(detail.customer_phone === expectedPhone, '5.3 telefone normalizado');
    }

    for (const name of ['AB', 'N'.repeat(120)]) {
      const creation = await checkout(
        anon,
        slugA1,
        randomUUID(),
        makePayload(currentMenu, strictBase.items, {
          customer: { name, phone: '11988887777' },
        }),
      );
      const detail = await adminDetail(ownerAS, await orderIdForCreation(ownerAS, creation));
      ok(detail.customer_name.length === name.length, '5.4 nome no limite aceito');
    }

    scenario(6, 'endereco separado, postal opcional e normalizacoes');
    const deliveryCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      deliveryPayload(currentMenu, strictBase.items),
    );
    const deliveryOrderId = await orderIdForCreation(ownerAS, deliveryCreation);
    const deliveryDetail = await adminDetail(ownerAS, deliveryOrderId);
    ok(deliveryDetail.delivery_address.state === 'SP', '6.1 UF lowercase normalizada');
    ok(deliveryDetail.delivery_address.postal_code === '01001000', '6.2 CEP normalizado');
    ok(deliveryDetail.delivery_address.street === 'Rua de Teste', '6.3 logradouro normalizado');
    ok(deliveryDetail.delivery_address.number === '100', '6.4 numero normalizado');
    ok(deliveryDetail.delivery_address.complement === 'Bloco A', '6.5 complemento normalizado');
    ok(
      deliveryDetail.delivery_address.reference === 'Referencia sintetica',
      '6.6 referencia normalizada',
    );

    const addressWithoutPostal = { ...BASE_DELIVERY_ADDRESS };
    delete addressWithoutPostal.postal_code;
    const noPostalCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      deliveryPayload(currentMenu, strictBase.items, { delivery_address: addressWithoutPostal }),
    );
    const noPostalDetail = await adminDetail(
      ownerAS,
      await orderIdForCreation(ownerAS, noPostalCreation),
    );
    ok(noPostalDetail.delivery_address.postal_code === null, '6.7 CEP opcional persiste null');

    const pickupNullAddress = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, strictBase.items, { delivery_address: null }),
    );
    const pickupNullDetail = await adminDetail(
      ownerAS,
      await orderIdForCreation(ownerAS, pickupNullAddress),
    );
    ok(pickupNullDetail.delivery_address === null, '6.8 pickup aceita endereco null');

    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, strictBase.items, {
            delivery_address: { ...BASE_DELIVERY_ADDRESS },
          }),
        ),
      ],
      'PED44',
      '6.9 pickup com objeto de endereco retorna PED44',
    );

    const invalidAddresses = [
      Object.fromEntries(Object.entries(BASE_DELIVERY_ADDRESS).filter(([key]) => key !== 'street')),
      { ...BASE_DELIVERY_ADDRESS, street: 'A' },
      { ...BASE_DELIVERY_ADDRESS, street: 'S'.repeat(121) },
      { ...BASE_DELIVERY_ADDRESS, number: 'N'.repeat(21) },
      { ...BASE_DELIVERY_ADDRESS, neighborhood: 'B' },
      { ...BASE_DELIVERY_ADDRESS, neighborhood: 'B'.repeat(81) },
      { ...BASE_DELIVERY_ADDRESS, city: 'C' },
      { ...BASE_DELIVERY_ADDRESS, city: 'C'.repeat(81) },
      { ...BASE_DELIVERY_ADDRESS, state: 'S' },
      { ...BASE_DELIVERY_ADDRESS, postal_code: '1234' },
      { ...BASE_DELIVERY_ADDRESS, complement: 'C'.repeat(121) },
      { ...BASE_DELIVERY_ADDRESS, reference: 'R'.repeat(161) },
      { ...BASE_DELIVERY_ADDRESS, unknown: true },
      { ...BASE_DELIVERY_ADDRESS, street: '<b>Rua</b>' },
    ];
    const missingAddressPayload = deliveryPayload(currentMenu, strictBase.items);
    delete missingAddressPayload.delivery_address;
    for (const invalidDeliveryPayload of [
      missingAddressPayload,
      deliveryPayload(currentMenu, strictBase.items, { delivery_address: null }),
      deliveryPayload(currentMenu, strictBase.items, { delivery_address: 'address' }),
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [slugA1, randomUUID(), JSON.stringify(invalidDeliveryPayload)],
        'PED44',
        '6.10 delivery sem objeto completo retorna PED44',
      );
    }
    for (const delivery_address of invalidAddresses) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(deliveryPayload(currentMenu, strictBase.items, { delivery_address })),
        ],
        'PED44',
        '6.10 endereco invalido retorna PED44',
      );
    }

    scenario(7, 'modalidades, pagamentos e troco inclusivo');
    await saveConfig(
      ownerAS,
      unitA1,
      operationalConfig({ pickup_enabled: false, delivery_enabled: true }),
    );
    let modeMenu = await publicMenu(anon, slugA1);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify(makePayload(modeMenu, strictBase.items))],
      'PED39',
      '7.1 pickup desabilitado retorna PED39',
    );
    await saveConfig(
      ownerAS,
      unitA1,
      operationalConfig({ pickup_enabled: true, delivery_enabled: false }),
    );
    modeMenu = await publicMenu(anon, slugA1);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify(deliveryPayload(modeMenu, strictBase.items))],
      'PED39',
      '7.2 delivery desabilitado retorna PED39',
    );
    await saveConfig(ownerAS, unitA1, operationalConfig());
    currentMenu = await publicMenu(anon, slugA1);

    for (const method of ['debit_card', 'bitcoin']) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(makePayload(currentMenu, strictBase.items, { payment_method: method })),
        ],
        'PED40',
        '7.3 pagamento indisponivel retorna PED40',
      );
    }

    const cashBase = makePayload(currentMenu, strictBase.items, { payment_method: 'cash' });
    const cashNoChange = await checkout(anon, slugA1, randomUUID(), cashBase);
    ok(cashNoChange.payment_method === 'cash', '7.4 cash sem troco aceito');
    const cashEqual = await checkout(anon, slugA1, randomUUID(), {
      ...cashBase,
      cash_change_for: '8.10',
    });
    const cashEqualDetail = await adminDetail(
      ownerAS,
      await orderIdForCreation(ownerAS, cashEqual),
    );
    ok(cashEqualDetail.cash_change_for === '8.10', '7.5 troco igual ao total aceito');
    const cashAbove = await checkout(anon, slugA1, randomUUID(), {
      ...cashBase,
      cash_change_for: '10.00',
    });
    ok(cashAbove.payment_method === 'cash', '7.5b troco acima do total aceito');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify({ ...cashBase, cash_change_for: '8.09' })],
      'PED45',
      '7.6 troco abaixo do total retorna PED45',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify({ ...cashBase, cash_change_for: 10 })],
      'PED45',
      '7.7 troco numerico retorna PED45',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(makePayload(currentMenu, strictBase.items, { cash_change_for: '10.00' })),
      ],
      'PED45',
      '7.8 troco com metodo nao cash retorna PED45',
    );
    const creditCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, strictBase.items, { payment_method: 'credit_card' }),
    );
    ok(creditCreation.payment_method === 'credit_card', '7.9 metodo habilitado aceito');

    scenario(8, 'cart, limites, versao, tenant e disponibilidade');
    for (const items of [
      [],
      [{ menu_item_id: strictItem.id, quantity: 0, note: null }],
      [{ menu_item_id: strictItem.id, quantity: 100, note: null }],
      [{ menu_item_id: strictItem.id, quantity: '1', note: null }],
      [{ menu_item_id: strictItem.id, quantity: 1.5, note: null }],
      [{ menu_item_id: 'invalido', quantity: 1, note: null }],
      [{ quantity: 1, note: null }],
      [
        { menu_item_id: strictItem.id, quantity: 1, note: null },
        { menu_item_id: strictItem.id, quantity: 2, note: null },
      ],
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [slugA1, randomUUID(), JSON.stringify(makePayload(currentMenu, items))],
        'PED37',
        '8.1 carrinho estruturalmente invalido retorna PED37',
      );
    }

    const fiftyItems = Array.from({ length: 50 }, (_, index) => ({
      menu_item_id: productByName(
        currentMenu,
        `Produto Distinto ${String(index + 1).padStart(2, '0')}`,
      ).id,
      quantity: 1,
      note: index === 0 ? '  Nota limite valido  ' : null,
    }));
    const fiftyCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, fiftyItems, { notes: 'N'.repeat(500) }),
    );
    const fiftyDetail = await adminDetail(
      ownerAS,
      await orderIdForCreation(ownerAS, fiftyCreation),
    );
    ok(fiftyDetail.item_count === 50, '8.2 cinquenta itens distintos aceitos');
    ok(
      fiftyDetail.items.find((item) => item.note !== null)?.note === 'Nota limite valido',
      '8.3 note de item normalizada',
    );
    ok(fiftyDetail.notes.length === 500, '8.4 note geral no limite aceita');

    const fiftyOneItems = [...fiftyItems, { menu_item_id: strictItem.id, quantity: 1, note: null }];
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, randomUUID(), JSON.stringify(makePayload(currentMenu, fiftyOneItems))],
      'PED37',
      '8.5 cinquenta e um itens retorna PED37',
    );

    const menuA2Current = await publicMenu(anon, slugA2);
    const menuB1Current = await publicMenu(anon, slugB1);
    for (const foreignItemId of [
      oldItem.id,
      productByName(menuA2Current, 'Produto A2').id,
      productByName(menuB1Current, 'Produto B1').id,
    ]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(
            makePayload(currentMenu, [{ menu_item_id: foreignItemId, quantity: 1, note: null }]),
          ),
        ],
        'PED38',
        '8.6 item cross-version, cross-unit ou cross-tenant retorna PED38',
      );
    }

    for (const unavailableName of ['Produto Indisponivel', 'Produto Sem Fonte']) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(
            makePayload(currentMenu, [
              {
                menu_item_id: productByName(currentMenu, unavailableName).id,
                quantity: 1,
                note: null,
              },
            ]),
          ),
        ],
        'PED38',
        '8.7 indisponivel ou sem fonte retorna PED38',
      );
    }

    scenario(9, 'snapshot, dinheiro exato, minimo e fees');
    const exactPayload = makePayload(currentMenu, [
      {
        menu_item_id: productByName(currentMenu, 'Produto Exato').id,
        quantity: 3,
        note: '  Sem item  ',
      },
    ]);
    exactCreation = await checkout(anon, slugA1, randomUUID(), exactPayload);
    exactOrderId = await orderIdForCreation(ownerAS, exactCreation);
    ok(isUuid(exactOrderId), '9.0 pedido persistido com UUID interno');
    ok(
      exactKeys(exactCreation, [
        'order_number',
        'tracking_token',
        'tracking_path',
        'service_mode',
        'payment_method',
        'subtotal',
        'delivery_fee',
        'total',
        'estimated_minutes',
        'created_at',
      ]),
      '9.1 resposta de criacao possui somente campos imutaveis',
    );
    ok(exactCreation.subtotal === '24.30', '9.2 subtotal 8.10 vezes 3 exato');
    ok(exactCreation.delivery_fee === '0.00', '9.3 pickup sem fee');
    ok(exactCreation.total === '24.30', '9.4 total pickup exato');
    ok(exactCreation.estimated_minutes === 20, '9.5 ETA de pickup snapshot');
    ok(isTrackingToken(exactCreation.tracking_token), '9.6 tracking token opaco');
    ok(
      exactCreation.tracking_path.endsWith(exactCreation.tracking_token),
      '9.7 tracking path coerente',
    );
    ok(!('status' in exactCreation), '9.8 resposta de criacao sem estado mutavel');
    ok(!('id' in exactCreation), '9.9 resposta de criacao sem order id');
    ok(!('customer' in exactCreation), '9.10 resposta de criacao sem customer');
    ok(!('items' in exactCreation), '9.11 resposta de criacao sem items');
    ok(
      !JSON.stringify(exactCreation).includes(BASE_CUSTOMER.phone.replace(/\D/g, '')),
      '9.11b resposta de criacao sem PII',
    );

    const authenticatedCreation = await checkout(
      ownerAS,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, [
        { menu_item_id: productByName(currentMenu, 'Produto Barato').id, quantity: 1, note: null },
      ]),
    );
    ok(
      isTrackingToken(authenticatedCreation.tracking_token),
      '9.11c authenticated cria como consumidor',
    );

    let exactDetail = await adminDetail(ownerAS, exactOrderId);
    ok(exactDetail.items[0].unit_price === '8.10', '9.12 snapshot unit_price exato');
    ok(exactDetail.items[0].line_total === '24.30', '9.13 snapshot line_total exato');
    ok(exactDetail.items[0].product_name === 'Produto Exato', '9.14 snapshot product_name');
    ok(exactDetail.items[0].note === 'Sem item', '9.15 snapshot item note normalizada');
    ok(exactDetail.notes === 'Observacao sintetica', '9.16 note geral normalizada');

    await updateProduct(ownerAS, exactSource.id, categoryA1.id, 'Produto Alterado', '9.99');
    exactDetail = await adminDetail(ownerAS, exactOrderId);
    ok(exactDetail.items[0].product_name === 'Produto Exato', '9.17 nome snapshot nao muda');
    ok(exactDetail.items[0].unit_price === '8.10', '9.18 preco snapshot nao muda');
    await setProductAvailable(ownerAS, exactSource.id, false);
    exactDetail = await adminDetail(ownerAS, exactOrderId);
    ok(
      exactDetail.items[0].product_name === 'Produto Exato',
      '9.18b disponibilidade nao muda nome snapshot',
    );
    ok(exactDetail.items[0].unit_price === '8.10', '9.18c disponibilidade nao muda preco snapshot');
    await setProductAvailable(ownerAS, exactSource.id, true);

    const deliveryExact = await checkout(
      anon,
      slugA1,
      randomUUID(),
      deliveryPayload(currentMenu, [
        { menu_item_id: productByName(currentMenu, 'Produto Exato').id, quantity: 3, note: null },
      ]),
    );
    ok(deliveryExact.subtotal === '24.30', '9.19 subtotal delivery nao inclui fee');
    ok(deliveryExact.delivery_fee === '5.50', '9.20 delivery fee fixa');
    ok(deliveryExact.total === '29.80', '9.21 total delivery soma fee');
    ok(deliveryExact.estimated_minutes === 45, '9.22 ETA delivery snapshot');

    await saveConfig(ownerAS, unitA1, operationalConfig({ min_order_value: '24.31' }));
    let minimumMenu = await publicMenu(anon, slugA1);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          deliveryPayload(minimumMenu, [
            {
              menu_item_id: productByName(minimumMenu, 'Produto Exato').id,
              quantity: 3,
              note: null,
            },
          ]),
        ),
      ],
      'PED41',
      '9.23 minimo compara subtotal sem fee',
    );
    await saveConfig(ownerAS, unitA1, operationalConfig({ min_order_value: '24.30' }));
    minimumMenu = await publicMenu(anon, slugA1);
    const minimumEqual = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(minimumMenu, [
        {
          menu_item_id: productByName(minimumMenu, 'Produto Exato').id,
          quantity: 3,
          note: null,
        },
      ]),
    );
    ok(minimumEqual.subtotal === '24.30', '9.24 minimo inclusivo aceito');
    await saveConfig(ownerAS, unitA1, operationalConfig());
    currentMenu = await publicMenu(anon, slugA1);

    const overflowItem = productByName(currentMenu, 'Produto Overflow');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [{ menu_item_id: overflowItem.id, quantity: 2, note: null }]),
        ),
      ],
      'PED50',
      '9.25 line total acima do limite retorna PED50',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          deliveryPayload(currentMenu, [
            { menu_item_id: overflowItem.id, quantity: 1, note: null },
          ]),
        ),
      ],
      'PED50',
      '9.26 subtotal mais fee acima do limite retorna PED50',
    );

    scenario(10, 'idempotencia, concorrencia, numeros e replay apos mudancas');
    const replayKey = randomUUID();
    const replayPayload = makePayload(currentMenu, [
      { menu_item_id: productByName(currentMenu, 'Produto Barato').id, quantity: 1, note: null },
    ]);
    const replayFirst = await checkout(anon, slugA1, replayKey, replayPayload);
    const replaySecond = await checkout(anon, slugA1, replayKey, replayPayload);
    ok(
      JSON.stringify(replaySecond) === JSON.stringify(replayFirst),
      '10.1 replay retorna forma identica',
    );
    const replayCount = await admin.query(
      'select count(*)::int as count from public.orders where unit_id = $1 and idempotency_key = $2',
      [unitA1, replayKey],
    );
    ok(replayCount.rows[0].count === 1, '10.2 replay persiste um pedido');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, replayKey, JSON.stringify({ ...replayPayload, notes: 'Outro valor' })],
      'PED42',
      '10.3 mesma key com hash diferente retorna PED42',
    );

    const concurrentKey = randomUUID();
    const concurrentPayload = makePayload(currentMenu, [
      { menu_item_id: productByName(currentMenu, 'Produto Barato').id, quantity: 2, note: null },
    ]);
    const sameKeyResults = await withTwoAnon((first, second) =>
      Promise.allSettled([
        checkout(first, slugA1, concurrentKey, concurrentPayload),
        checkout(second, slugA1, concurrentKey, concurrentPayload),
      ]),
    );
    ok(
      sameKeyResults.every((result) => result.status === 'fulfilled'),
      '10.4 retries concorrentes concluem',
    );
    ok(
      JSON.stringify(sameKeyResults[0].value) === JSON.stringify(sameKeyResults[1].value),
      '10.5 retries concorrentes retornam objeto identico',
    );
    const concurrentCount = await admin.query(
      'select count(*)::int as count from public.orders where unit_id = $1 and idempotency_key = $2',
      [unitA1, concurrentKey],
    );
    ok(concurrentCount.rows[0].count === 1, '10.6 retries concorrentes persistem um pedido');

    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const twoKeyResults = await withTwoAnon((first, second) =>
      Promise.all([
        checkout(first, slugA1, firstKey, concurrentPayload),
        checkout(second, slugA1, secondKey, concurrentPayload),
      ]),
    );
    ok(
      twoKeyResults[0].tracking_token !== twoKeyResults[1].tracking_token,
      '10.7 duas keys geram tokens distintos',
    );
    ok(
      twoKeyResults[0].order_number !== twoKeyResults[1].order_number,
      '10.8 duas keys geram numeros distintos',
    );
    ok(
      Math.abs(Number(twoKeyResults[0].order_number) - Number(twoKeyResults[1].order_number)) === 1,
      '10.9 duas keys concorrentes recebem numeros sequenciais',
    );

    const durableKey = randomUUID();
    const durablePayload = makePayload(currentMenu, [
      { menu_item_id: productByName(currentMenu, 'Produto Barato').id, quantity: 3, note: null },
    ]);
    const durableFirst = await checkout(anon, slugA1, durableKey, durablePayload);
    await publish(ownerAS, unitA1);
    const durableAfterMenu = await checkout(anon, slugA1, durableKey, durablePayload);
    ok(
      JSON.stringify(durableAfterMenu) === JSON.stringify(durableFirst),
      '10.10 replay precede revalidacao apos republicacao',
    );
    const snapshotAfterPublish = await adminDetail(ownerAS, exactOrderId);
    ok(
      snapshotAfterPublish.items[0].unit_price === '8.10',
      '10.10b republicacao nao muda snapshot',
    );
    await saveConfig(
      ownerAS,
      unitA1,
      operationalConfig({ accepting_orders: false, business_hours: allDaysClosed() }),
    );
    const durableReplay = await checkout(anon, slugA1, durableKey, durablePayload);
    ok(
      JSON.stringify(durableReplay) === JSON.stringify(durableFirst),
      '10.10c replay precede revalidacao apos fechamento',
    );
    await saveConfig(ownerAS, unitA1, operationalConfig());
    currentMenu = await publicMenu(anon, slugA1);

    scenario(11, 'tracking publico sem IDs ou PII');
    const tracked = await tracking(anon, exactCreation.tracking_token);
    ok(tracked.found === true, '11.1 tracking existente encontrado');
    ok(tracked.organization?.name === 'Orders Org A', '11.2 organization name presente');
    ok(tracked.unit?.name === 'Unidade principal', '11.3 unit name presente');
    ok(tracked.order.order_number === exactCreation.order_number, '11.4 numero do pedido presente');
    ok(tracked.order.items[0].name === 'Produto Exato', '11.5 item snapshot presente');
    ok(!('note' in tracked.order.items[0]), '11.6 item note omitida do tracking publico');
    const trackingJson = JSON.stringify(tracked);
    for (const forbidden of [
      'customer_name',
      'customer_phone',
      'delivery_address',
      'tracking_token',
      'request_hash',
      'idempotency_key',
      'menu_item_id',
      exactOrderId,
      BASE_CUSTOMER.phone.replace(/\D/g, ''),
      'Cliente Sintetico',
      'Rua de Teste',
    ]) {
      ok(!trackingJson.includes(forbidden), '11.7 tracking nao contem campo ou valor sensivel');
    }
    const invalidTracking = await tracking(anon, 'invalido');
    const missingTracking = await tracking(anon, randomUUID().replaceAll('-', ''));
    ok(
      exactKeys(invalidTracking, ['found']) && invalidTracking.found === false,
      '11.8 token invalido retorna found false',
    );
    ok(
      exactKeys(missingTracking, ['found']) && missingTracking.found === false,
      '11.9 token ausente retorna found false',
    );

    scenario(12, 'RLS, grants, direct writes e RBAC de leitura');
    for (const table of ['orders', 'order_items', 'order_events']) {
      await expectDenied(
        anon,
        `select * from public.${table} limit 1`,
        [],
        '12.1 anon sem SELECT direto',
      );
    }
    for (const statement of [
      `insert into public.orders
         (organization_id, unit_id, menu_version_id, menu_version_number,
          order_number, idempotency_key, request_hash, tracking_token,
          service_mode, payment_method, customer_name, customer_phone,
          subtotal, total, operation_revision)
       select organization_id, unit_id, menu_version_id, menu_version_number,
              999999, gen_random_uuid(), repeat('a', 64), repeat('b', 32),
              'pickup', 'pix', 'Teste', '11988887777', 1, 1, now()
       from public.orders where id = $1`,
      'update public.orders set status = status where id = $1',
      'delete from public.orders where id = $1',
      'update public.order_items set quantity = quantity where order_id = $1',
      `insert into public.order_items
         (organization_id, unit_id, order_id, menu_version_id, menu_item_id,
          product_name, unit_price, quantity, line_total)
       select organization_id, unit_id, id, menu_version_id, gen_random_uuid(),
              'Direto', 1, 1, 1
       from public.orders where id = $1`,
      'delete from public.order_items where order_id = $1',
      'update public.order_events set note = note where order_id = $1',
      `insert into public.order_events
         (organization_id, unit_id, order_id, event_type, from_value,
          to_value, actor_type)
       select organization_id, unit_id, id, 'status_changed', 'new',
              'confirmed', 'staff'
       from public.orders where id = $1`,
      'delete from public.order_events where order_id = $1',
    ]) {
      await expectDenied(
        ownerAS,
        statement,
        [exactOrderId],
        '12.2 escrita direta authenticated negada',
      );
    }
    await expectDenied(
      anon,
      'select public.get_unit_orders_admin($1, null, 50)',
      [unitA1],
      '12.3 anon sem RPC administrativa',
    );

    const managerRows = await managerAS.query('select distinct unit_id from public.orders');
    const operatorRows = await operatorAS.query('select distinct unit_id from public.orders');
    const managerOtherRows = await managerOtherS.query(
      'select distinct unit_id from public.orders',
    );
    const ownerARows = await ownerAS.query('select distinct unit_id from public.orders');
    const ownerBRows = await ownerBS.query(
      'select id from public.orders where organization_id = $1',
      [orgA],
    );
    const ownerBOwnRows = await ownerBS.query(
      'select id from public.orders where organization_id = $1',
      [orgB],
    );
    ok(
      managerRows.rows.length > 0 && managerRows.rows.every((row) => row.unit_id === unitA1),
      '12.4 manager limitado a unidade vinculada',
    );
    ok(
      operatorRows.rows.length > 0 && operatorRows.rows.every((row) => row.unit_id === unitA1),
      '12.5 operator limitado a unidade vinculada',
    );
    ok(
      managerOtherRows.rows.length > 0 &&
        managerOtherRows.rows.every((row) => row.unit_id === unitA2),
      '12.6 manager de outra unidade isolado',
    );
    ok(ownerBRows.rows.length === 0, '12.7 owner cross-tenant nao le pedidos');
    ok(ownerBOwnRows.rows.length > 0, '12.7b owner le pedidos do proprio tenant');
    ok(
      ownerARows.rows.some((row) => row.unit_id === unitA1) &&
        ownerARows.rows.some((row) => row.unit_id === unitA2),
      '12.7c owner le todas as unidades do proprio tenant',
    );
    for (const table of ['order_items', 'order_events']) {
      const foreignRows = await ownerBS.query(
        `select order_id from public.${table} where order_id = $1`,
        [exactOrderId],
      );
      const crossUnitRows = await managerOtherS.query(
        `select order_id from public.${table} where order_id = $1`,
        [exactOrderId],
      );
      const operatorOwnRows = await operatorAS.query(
        `select order_id from public.${table} where order_id = $1`,
        [exactOrderId],
      );
      ok(foreignRows.rows.length === 0, '12.7d tabela filha isolada cross-tenant');
      ok(crossUnitRows.rows.length === 0, '12.7e tabela filha isolada cross-unit');
      ok(operatorOwnRows.rows.length > 0, '12.7f operator le tabela filha da unidade');
    }

    const ownerList = await adminList(ownerAS, unitA1, null, 20);
    const managerList = await adminList(managerAS, unitA1, null, 20);
    const operatorList = await adminList(operatorAS, unitA1, null, 20);
    ok(ownerList.orders.length > 0, '12.8 owner le Central');
    ok(managerList.orders.length > 0, '12.9 manager le Central');
    ok(operatorList.orders.length > 0, '12.10 operator le Central');
    const managerDetail = await adminDetail(managerAS, exactOrderId);
    const operatorDetail = await adminDetail(operatorAS, exactOrderId);
    ok(managerDetail.id === exactOrderId, '12.10b manager le detail autorizado');
    ok(operatorDetail.id === exactOrderId, '12.10c operator le detail autorizado');
    await expectError(
      managerOtherS,
      'select public.get_unit_orders_admin($1, null, 50)',
      [unitA1],
      'PED11',
      '12.11 cross-unit administrativo retorna PED11',
    );
    await expectError(
      ownerBS,
      'select public.get_order_admin($1)',
      [exactOrderId],
      'PED11',
      '12.12 cross-tenant detail retorna PED11',
    );
    for (const limit of [0, 201, null]) {
      await expectError(
        ownerAS,
        'select public.get_unit_orders_admin($1, null, $2)',
        [unitA1, limit],
        'PED47',
        '12.13 limite administrativo invalido retorna PED47',
      );
    }
    await expectError(
      ownerAS,
      'select public.get_unit_orders_admin($1, $2, 50)',
      [unitA1, 'invalid'],
      'PED47',
      '12.14 filtro administrativo invalido retorna PED47',
    );
    const orderedList = await adminList(ownerAS, unitA1, null, 3);
    const expectedOrder = await ownerAS.query(
      'select id from public.orders where unit_id = $1 order by created_at desc, id desc limit 3',
      [unitA1],
    );
    ok(orderedList.orders.length === 3, '12.15 limite valido aplicado');
    ok(
      orderedList.orders.every(
        (entry) => Number.isInteger(entry.item_count) && entry.item_count > 0,
      ),
      '12.16 item_count derivado presente',
    );
    ok(
      orderedList.orders.every(
        (entry, index) =>
          index === 0 ||
          new Date(orderedList.orders[index - 1].created_at) >= new Date(entry.created_at),
      ),
      '12.17 lista ordenada por created_at desc',
    );
    ok(
      JSON.stringify(orderedList.orders.map((entry) => entry.id)) ===
        JSON.stringify(expectedOrder.rows.map((entry) => entry.id)),
      '12.17b desempate administrativo por id desc',
    );
    const newOnlyList = await adminList(ownerAS, unitA1, 'new', 5);
    ok(
      newOnlyList.orders.every((entry) => entry.status === 'new'),
      '12.17c filtro valido aplicado',
    );
    ok(!JSON.stringify(exactDetail).includes('request_hash'), '12.18 detail omite request_hash');
    ok(
      !JSON.stringify(exactDetail).includes('idempotency_key'),
      '12.19 detail omite idempotency_key',
    );

    scenario(13, 'state machine pickup, timestamps e atores');
    const stateMenu = await publicMenu(anon, slugA1);
    const stateItem = productByName(stateMenu, 'Produto Barato');
    const pickupCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const pickupOrderId = await orderIdForCreation(ownerAS, pickupCreation);
    for (const invalidNote of ['N'.repeat(501), '<b>nota</b>']) {
      await expectError(
        managerAS,
        'select public.set_order_status($1, $2, $3)',
        [pickupOrderId, 'confirmed', invalidNote],
        'PED47',
        '13.0 note administrativa invalida retorna PED47',
      );
    }
    await expectError(
      managerAS,
      'select public.set_order_status($1, null, null)',
      [pickupOrderId],
      'PED47',
      '13.0b proximo status null retorna PED47',
    );
    await expectError(
      managerAS,
      'select public.set_order_status($1, $2, null)',
      [pickupOrderId, 'preparing'],
      'PED47',
      '13.1 pickup nao pula confirmacao',
    );
    let pickupState = await setStatus(managerAS, pickupOrderId, 'confirmed', '  Confirmado  ');
    ok(pickupState.status === 'confirmed', '13.2 manager confirma');
    pickupState = await setStatus(operatorAS, pickupOrderId, 'preparing');
    ok(pickupState.status === 'preparing', '13.3 operator prepara');
    pickupState = await setStatus(ownerAS, pickupOrderId, 'ready');
    ok(pickupState.status === 'ready', '13.4 owner marca pronto');
    await expectError(
      operatorAS,
      'select public.set_order_status($1, $2, null)',
      [pickupOrderId, 'out_for_delivery'],
      'PED47',
      '13.5 pickup nao sai para entrega',
    );
    pickupState = await setStatus(operatorAS, pickupOrderId, 'completed');
    ok(pickupState.status === 'completed', '13.6 pickup concluido');
    ok(
      pickupState.completed_at !== null && pickupState.cancelled_at === null,
      '13.7 timestamps terminais pickup',
    );
    ok(
      new Date(pickupState.status_updated_at) >= new Date(pickupState.created_at),
      '13.8 status_updated_at coerente',
    );
    await expectError(
      ownerAS,
      'select public.set_order_status($1, $2, null)',
      [pickupOrderId, 'cancelled'],
      'PED47',
      '13.9 completed e terminal',
    );
    const pickupEvents = pickupState.events;
    ok(pickupEvents.length === 5, '13.10 created mais quatro eventos de status');
    ok(
      pickupEvents[0].event_type === 'created' &&
        pickupEvents[0].actor_type === 'customer' &&
        pickupEvents[0].actor_user_id === null,
      '13.11 evento created customer sem usuario',
    );
    ok(
      pickupEvents
        .slice(1)
        .every((event) => event.event_type === 'status_changed' && event.actor_type === 'staff'),
      '13.12 eventos de status sao staff',
    );
    ok(pickupEvents[1].actor_user_id === managerA.id, '13.13 ator manager registrado');
    ok(pickupEvents[2].actor_user_id === operatorA.id, '13.14 ator operator registrado');
    ok(pickupEvents[3].actor_user_id === ownerA.id, '13.15 ator owner registrado');
    ok(pickupEvents[1].note === 'Confirmado', '13.16 note de evento normalizada');
    const completedTracking = await tracking(anon, pickupCreation.tracking_token);
    ok(completedTracking.order.status === 'completed', '13.17 tracking reflete status persistido');
    ok(completedTracking.order.completed_at !== null, '13.18 tracking reflete timestamp terminal');

    const preparingCancelCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const preparingCancelId = await orderIdForCreation(ownerAS, preparingCancelCreation);
    await setStatus(operatorAS, preparingCancelId, 'confirmed');
    await setStatus(operatorAS, preparingCancelId, 'preparing');
    const preparingCancelled = await setStatus(operatorAS, preparingCancelId, 'cancelled');
    ok(preparingCancelled.status === 'cancelled', '13.19 preparing pode cancelar');
    ok(preparingCancelled.cancelled_at !== null, '13.20 cancelamento preenche timestamp');

    scenario(14, 'state machine delivery e serializacao terminal');
    const deliveryStateCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      deliveryPayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const deliveryStateId = await orderIdForCreation(ownerAS, deliveryStateCreation);
    await setStatus(operatorAS, deliveryStateId, 'confirmed');
    await setStatus(operatorAS, deliveryStateId, 'preparing');
    await setStatus(operatorAS, deliveryStateId, 'ready');
    await expectError(
      operatorAS,
      'select public.set_order_status($1, $2, null)',
      [deliveryStateId, 'completed'],
      'PED47',
      '14.1 delivery nao conclui antes de sair',
    );
    let deliveryState = await setStatus(operatorAS, deliveryStateId, 'out_for_delivery');
    ok(deliveryState.status === 'out_for_delivery', '14.2 delivery sai para entrega');
    deliveryState = await setStatus(operatorAS, deliveryStateId, 'completed');
    ok(deliveryState.status === 'completed', '14.3 delivery concluido');
    ok(deliveryState.completed_at !== null, '14.4 completed_at preenchido');
    ok(
      deliveryState.events.some(
        (event) => event.from_value === 'ready' && event.to_value === 'out_for_delivery',
      ),
      '14.5 evento ready para out_for_delivery',
    );

    const concurrentStateCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      deliveryPayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const concurrentStateId = await orderIdForCreation(ownerAS, concurrentStateCreation);
    await setStatus(ownerAS, concurrentStateId, 'confirmed');
    await setStatus(ownerAS, concurrentStateId, 'preparing');
    await setStatus(ownerAS, concurrentStateId, 'ready');
    await setStatus(ownerAS, concurrentStateId, 'out_for_delivery');
    const terminalResults = await withTwoSessions(ownerA.id, (first, second) =>
      Promise.allSettled([
        setStatus(first, concurrentStateId, 'completed'),
        setStatus(second, concurrentStateId, 'cancelled'),
      ]),
    );
    ok(
      terminalResults.filter((result) => result.status === 'fulfilled').length === 1,
      '14.6 exatamente uma transicao terminal concorrente vence',
    );
    ok(
      terminalResults.filter((result) => result.status === 'rejected')[0]?.reason?.code === 'PED47',
      '14.7 transicao terminal perdedora retorna PED47',
    );
    const terminalDetail = await adminDetail(ownerAS, concurrentStateId);
    ok(['completed', 'cancelled'].includes(terminalDetail.status), '14.8 estado final e terminal');
    ok(
      !(terminalDetail.completed_at && terminalDetail.cancelled_at),
      '14.9 timestamps terminais mutuamente exclusivos',
    );

    const outCancelCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      deliveryPayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const outCancelId = await orderIdForCreation(ownerAS, outCancelCreation);
    await setStatus(operatorAS, outCancelId, 'confirmed');
    await setStatus(operatorAS, outCancelId, 'preparing');
    await setStatus(operatorAS, outCancelId, 'ready');
    await setStatus(operatorAS, outCancelId, 'out_for_delivery');
    const outCancelled = await setStatus(operatorAS, outCancelId, 'cancelled');
    ok(outCancelled.status === 'cancelled', '14.10 delivery em rota pode cancelar');

    scenario(15, 'payment state, refund restrito e cancel independente');
    const paymentCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const paymentOrderId = await orderIdForCreation(ownerAS, paymentCreation);
    await expectError(
      managerOtherS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'paid'],
      'PED11',
      '15.0 cross-unit nao revela transicao de pagamento',
    );
    await expectError(
      ownerBS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'paid'],
      'PED11',
      '15.0b cross-tenant nao revela transicao de pagamento',
    );
    await expectError(
      operatorAS,
      'select public.set_order_payment_status($1, null)',
      [paymentOrderId],
      'PED48',
      '15.1 payment null retorna PED48',
    );
    await expectError(
      operatorAS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'invalid'],
      'PED48',
      '15.1b payment desconhecido retorna PED48',
    );
    await expectError(
      ownerAS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'refunded'],
      'PED48',
      '15.1c pending nao transiciona direto para refunded',
    );
    let paymentState = await setPayment(operatorAS, paymentOrderId, 'paid');
    ok(paymentState.payment_status === 'paid', '15.2 operator registra paid');
    ok(paymentState.paid_at !== null && paymentState.refunded_at === null, '15.3 paid timestamps');
    ok(
      new Date(paymentState.payment_status_updated_at) >= new Date(paymentState.created_at),
      '15.3b payment_status_updated_at coerente',
    );
    await expectError(
      operatorAS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'paid'],
      'PED48',
      '15.4 paid duplicado retorna PED48',
    );
    await expectError(
      operatorAS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'refunded'],
      'PED11',
      '15.5 operator nao registra refund',
    );
    paymentState = await setPayment(managerAS, paymentOrderId, 'refunded');
    ok(paymentState.payment_status === 'refunded', '15.6 manager registra refund');
    ok(paymentState.refunded_at !== null, '15.7 refunded_at preenchido');
    ok(
      new Date(paymentState.refunded_at) >= new Date(paymentState.paid_at),
      '15.8 refund depois de paid',
    );
    const paymentEvents = paymentState.events.filter(
      (event) => event.event_type === 'payment_changed',
    );
    ok(paymentEvents.length === 2, '15.9 dois eventos de pagamento');
    ok(paymentEvents[0].actor_user_id === operatorA.id, '15.10 ator de paid registrado');
    ok(paymentEvents[1].actor_user_id === managerA.id, '15.11 ator de refund registrado');
    await expectError(
      managerAS,
      'select public.set_order_payment_status($1, $2)',
      [paymentOrderId, 'paid'],
      'PED48',
      '15.12 refunded e terminal',
    );

    const ownerRefundCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const ownerRefundId = await orderIdForCreation(ownerAS, ownerRefundCreation);
    await setPayment(ownerAS, ownerRefundId, 'paid');
    const ownerRefunded = await setPayment(ownerAS, ownerRefundId, 'refunded');
    ok(ownerRefunded.payment_status === 'refunded', '15.12a owner registra refund');

    const concurrentPaymentCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const concurrentPaymentId = await orderIdForCreation(ownerAS, concurrentPaymentCreation);
    const concurrentPaymentResults = await withTwoSessions(operatorA.id, (first, second) =>
      Promise.allSettled([
        setPayment(first, concurrentPaymentId, 'paid'),
        setPayment(second, concurrentPaymentId, 'paid'),
      ]),
    );
    ok(
      concurrentPaymentResults.filter((result) => result.status === 'fulfilled').length === 1,
      '15.12b exatamente um paid concorrente vence',
    );
    ok(
      concurrentPaymentResults.filter((result) => result.status === 'rejected')[0]?.reason?.code ===
        'PED48',
      '15.12c paid concorrente perdedor retorna PED48',
    );
    const concurrentPaymentDetail = await adminDetail(ownerAS, concurrentPaymentId);
    ok(
      concurrentPaymentDetail.events.filter((event) => event.event_type === 'payment_changed')
        .length === 1,
      '15.12d concorrencia gera um evento de pagamento',
    );

    const cancelPaidCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const cancelPaidId = await orderIdForCreation(ownerAS, cancelPaidCreation);
    await setPayment(operatorAS, cancelPaidId, 'paid');
    const cancelPaid = await setStatus(operatorAS, cancelPaidId, 'cancelled');
    ok(cancelPaid.status === 'cancelled', '15.13 pedido cancelado');
    ok(cancelPaid.payment_status === 'paid', '15.14 cancelamento nao altera payment');
    ok(
      cancelPaid.paid_at !== null && cancelPaid.cancelled_at !== null,
      '15.15 timestamps independentes',
    );

    const cancelPendingCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(stateMenu, [{ menu_item_id: stateItem.id, quantity: 1, note: null }]),
    );
    const cancelPendingId = await orderIdForCreation(ownerAS, cancelPendingCreation);
    const cancelPending = await setStatus(ownerAS, cancelPendingId, 'cancelled');
    ok(cancelPending.payment_status === 'pending', '15.16 cancelamento preserva pending');

    scenario(16, 'Realtime, schema e superficie de funcoes');
    const publication = await admin.query(
      `select attnames
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'orders'`,
    );
    ok(publication.rows.length === 1, '16.1 orders presente uma vez no Realtime');
    const publishedColumns = publication.rows[0]?.attnames ?? [];
    ok(
      ['id', 'unit_id', 'updated_at', 'status', 'payment_status'].every((column) =>
        publishedColumns.includes(column),
      ),
      '16.2 colunas de invalidacao publicadas',
    );
    ok(
      ![
        'customer_name',
        'customer_phone',
        'delivery_street',
        'tracking_token',
        'request_hash',
        'idempotency_key',
      ].some((column) => publishedColumns.includes(column)),
      '16.3 Realtime sem colunas de PII ou idempotencia',
    );

    const schemaColumns = await admin.query(
      `select column_name, data_type
       from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'`,
    );
    const columnMap = new Map(schemaColumns.rows.map((row) => [row.column_name, row.data_type]));
    for (const required of [
      'menu_version_number',
      'estimated_minutes',
      'operation_revision',
      'status_updated_at',
      'payment_status_updated_at',
      'completed_at',
      'cancelled_at',
      'paid_at',
      'refunded_at',
      'delivery_street',
      'delivery_number',
      'delivery_complement',
      'delivery_neighborhood',
      'delivery_city',
      'delivery_state',
      'delivery_postal_code',
      'delivery_reference',
    ]) {
      ok(columnMap.has(required), '16.4 coluna obrigatoria presente');
    }
    ok(columnMap.get('order_number') === 'bigint', '16.5 order_number bigint');
    ok(!columnMap.has('delivery_address'), '16.6 sem endereco agregado');
    ok(!columnMap.has('item_count'), '16.7 sem item_count persistido');
    ok(!columnMap.has('email') && !columnMap.has('cpf'), '16.7b sem PII fora do contrato');

    const itemColumns = await admin.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'order_items'`,
    );
    const itemColumnNames = new Set(itemColumns.rows.map((row) => row.column_name));
    ok(
      ['menu_item_id', 'product_name', 'unit_price', 'quantity', 'line_total', 'note'].every(
        (column) => itemColumnNames.has(column),
      ),
      '16.7c colunas de snapshot de item presentes',
    );
    ok(!itemColumnNames.has('menu_version_product_id'), '16.7d nome legado de item ausente');

    const eventColumns = await admin.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'order_events'`,
    );
    const eventColumnNames = new Set(eventColumns.rows.map((row) => row.column_name));
    ok(
      [
        'event_type',
        'from_value',
        'to_value',
        'note',
        'actor_type',
        'actor_user_id',
        'created_at',
      ].every((column) => eventColumnNames.has(column)),
      '16.7e colunas de auditoria presentes',
    );

    const helperGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = any($1::text[])
         and grantee in ('PUBLIC', 'anon', 'authenticated')`,
      [
        [
          '_is_safe_plain_text',
          '_set_orders_updated_at',
          '_is_unit_open_at',
          '_order_creation_json',
          '_order_tracking_json',
          '_order_admin_json',
        ],
      ],
    );
    ok(helperGrants.rows.length === 0, '16.8 helpers internos sem EXECUTE de browser');

    const rpcGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = any($1::text[])`,
      [
        [
          'create_public_order',
          'get_public_order',
          'get_unit_orders_admin',
          'get_order_admin',
          'set_order_status',
          'set_order_payment_status',
        ],
      ],
    );
    ok(
      ['create_public_order', 'get_public_order'].every(
        (name) =>
          rpcGrants.rows.some((row) => row.routine_name === name && row.grantee === 'anon') &&
          rpcGrants.rows.some(
            (row) => row.routine_name === name && row.grantee === 'authenticated',
          ),
      ),
      '16.9 RPCs publicas concedidas a anon e authenticated',
    );
    ok(
      [
        'get_unit_orders_admin',
        'get_order_admin',
        'set_order_status',
        'set_order_payment_status',
      ].every(
        (name) =>
          rpcGrants.rows.some(
            (row) => row.routine_name === name && row.grantee === 'authenticated',
          ) &&
          !rpcGrants.rows.some(
            (row) => row.routine_name === name && ['PUBLIC', 'anon'].includes(row.grantee),
          ),
      ),
      '16.10 RPCs administrativas somente authenticated',
    );

    ok(passed + failed >= 130, '16.11 suite planeja ao menos 130 checks executados');
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
