import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from './db-test-config.mjs';

// Suite do Prompt 12: opcoes de produto (variacao, adicional e remocao).
// Valida contratos do catalogo mutavel, snapshot imutavel de publicacao,
// superficie publica (option_groups / is_configurable), regras de checkout
// (PED72-PED78), fingerprint, snapshot por linha e isolamento RLS.
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

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function exactKeys(value, expected) {
  return JSON.stringify(sortedKeys(value)) === JSON.stringify([...expected].sort());
}

function isHex64(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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

async function updateGroup(client, groupId, name, kind, selectionMode, minSelect, maxSelect) {
  return (
    await client.query(
      `select * from public.update_catalog_product_option_group($1, $2, $3, $4, $5, $6)`,
      [groupId, name, kind, selectionMode, minSelect, maxSelect],
    )
  ).rows[0];
}

async function setGroupActive(client, groupId, isActive) {
  return (
    await client.query('select * from public.set_catalog_product_option_group_active($1, $2)', [
      groupId,
      isActive,
    ])
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

async function updateOption(client, optionId, name, delta) {
  return (
    await client.query('select * from public.update_catalog_product_option($1, $2, $3)', [
      optionId,
      name,
      delta,
    ])
  ).rows[0];
}

async function setOptionActive(client, optionId, isActive) {
  return (
    await client.query('select * from public.set_catalog_product_option_active($1, $2)', [
      optionId,
      isActive,
    ])
  ).rows[0];
}

async function setOptionAvailable(client, optionId, isAvailable) {
  return (
    await client.query('select * from public.set_catalog_product_option_available($1, $2)', [
      optionId,
      isAvailable,
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
  name: '  Cliente Opcoes  ',
  phone: '(11) 97777-6666',
};

function makePayload(menu, items, overrides = {}) {
  const base = {
    menu_version_id: menu.menu.version_id,
    operation_revision: menu.operation.revision,
    service_mode: 'pickup',
    payment_method: 'pix',
    customer: { ...BASE_CUSTOMER },
    items,
    notes: '  Observacao com opcoes  ',
    cash_change_for: null,
  };
  return {
    ...base,
    ...overrides,
    customer: overrides.customer === undefined ? base.customer : overrides.customer,
    items: overrides.items === undefined ? base.items : overrides.items,
  };
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
  let managerOtherS;
  let operatorAS;
  let ownerBS;
  let anon;
  let orgA;
  let orgB;
  let unitA1;
  let unitA2;
  let slugA1;
  let categoryA1;
  let configurable;
  let fritas;
  let requerido;
  let mega;
  let temporario;
  let tamanho;
  let adicionais;
  let extras;
  let remover;
  let opcionalUnico;
  let pequeno;
  let grande;
  let bacon;
  let queijo;
  let alface;
  let rucula;
  let semCebola;
  let semAlface;
  let molho;
  let extraFritas;
  let opcaoA;
  let opcaoB;
  let megaOptions;
  let extraA;
  let extraB;
  let currentMenu;
  let mathCreation;
  let mathOrderId;
  let mathDetail;

  try {
    scenario(0, 'setup sintetico de tenants, RBAC, catalogo e opcoes');
    ownerA = await createTestUser(admin, `options-owner-a-${suffix}@pedon-test.invalid`);
    managerA = await createTestUser(admin, `options-manager-a-${suffix}@pedon-test.invalid`);
    operatorA = await createTestUser(admin, `options-operator-a-${suffix}@pedon-test.invalid`);
    managerOther = await createTestUser(
      admin,
      `options-manager-other-${suffix}@pedon-test.invalid`,
    );
    ownerB = await createTestUser(admin, `options-owner-b-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, managerOther.id, ownerB.id);

    ownerAS = await sessionFor(ownerA.id);
    openClients.push(ownerAS);
    operatorAS = await sessionFor(operatorA.id);
    openClients.push(operatorAS);
    managerOtherS = await sessionFor(managerOther.id);
    openClients.push(managerOtherS);
    ownerBS = await sessionFor(ownerB.id);
    openClients.push(ownerBS);
    anon = await anonClient();
    openClients.push(anon);

    orgA = (await ownerAS.query(`select public.complete_onboarding('Options Org A') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);
    unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    unitA2 = (
      await ownerAS.query('select (public.create_unit($1)).id as id', ['Options Unidade A2'])
    ).rows[0].id;

    orgB = (await ownerBS.query(`select public.complete_onboarding('Options Org B') as org`))
      .rows[0].org;
    createdOrgIds.push(orgB);

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

    categoryA1 = await createCategory(ownerAS, unitA1, 'Opcoes Itens');

    configurable = await createProduct(ownerAS, unitA1, categoryA1.id, 'Configuravel', '5.00');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Simples', '4.00');
    fritas = await createProduct(ownerAS, unitA1, categoryA1.id, 'Fritas', '8.00');
    requerido = await createProduct(ownerAS, unitA1, categoryA1.id, 'Requerido', '6.00');
    mega = await createProduct(ownerAS, unitA1, categoryA1.id, 'Mega', '7.00');
    temporario = await createProduct(ownerAS, unitA1, categoryA1.id, 'Temporario', '9.00');

    tamanho = await createGroup(
      ownerAS,
      unitA1,
      configurable.id,
      'Tamanho',
      'variation',
      'single',
      1,
      1,
    );
    pequeno = await createOption(ownerAS, tamanho.id, 'Pequeno', '0.00');
    grande = await createOption(ownerAS, tamanho.id, 'Grande', '2.00');
    adicionais = await createGroup(
      ownerAS,
      unitA1,
      configurable.id,
      'Adicionais',
      'addon',
      'multiple',
      0,
      1,
    );
    bacon = await createOption(ownerAS, adicionais.id, 'Bacon', '1.50');
    queijo = await createOption(ownerAS, adicionais.id, 'Queijo', '1.00');
    extras = await createGroup(
      ownerAS,
      unitA1,
      configurable.id,
      'Extras',
      'addon',
      'multiple',
      0,
      2,
    );
    alface = await createOption(ownerAS, extras.id, 'Alface', '0.50');
    rucula = await createOption(ownerAS, extras.id, 'Rucula', '0.50');
    remover = await createGroup(
      ownerAS,
      unitA1,
      configurable.id,
      'Remover',
      'removal',
      'multiple',
      0,
      50,
    );
    semCebola = await createOption(ownerAS, remover.id, 'Sem Cebola', '0.00');
    semAlface = await createOption(ownerAS, remover.id, 'Sem Alface', '0.00');
    opcionalUnico = await createGroup(
      ownerAS,
      unitA1,
      configurable.id,
      'Opcional Unico',
      'addon',
      'single',
      0,
      1,
    );
    molho = await createOption(ownerAS, opcionalUnico.id, 'Molho', '0.50');

    const fritasExtras = await createGroup(
      ownerAS,
      unitA1,
      fritas.id,
      'Extras Fritas',
      'addon',
      'multiple',
      0,
      2,
    );
    extraFritas = await createOption(ownerAS, fritasExtras.id, 'Extra Fritas', '1.00');
    const fritasInactive = await createGroup(
      ownerAS,
      unitA1,
      fritas.id,
      'Fritas Desativado',
      'addon',
      'multiple',
      0,
      1,
    );
    await createOption(ownerAS, fritasInactive.id, 'Fritas D', '0.50');

    const saborObrigatorio = await createGroup(
      ownerAS,
      unitA1,
      requerido.id,
      'Sabor Obrigatorio',
      'variation',
      'single',
      1,
      1,
    );
    opcaoA = await createOption(ownerAS, saborObrigatorio.id, 'Opcao A', '0.00');
    opcaoB = await createOption(ownerAS, saborObrigatorio.id, 'Opcao B', '0.00');

    const combos = await createGroup(
      ownerAS,
      unitA1,
      mega.id,
      'Combos',
      'addon',
      'multiple',
      0,
      50,
    );
    megaOptions = [];
    for (let index = 1; index <= 50; index += 1) {
      megaOptions.push(
        await createOption(ownerAS, combos.id, `Opcao ${String(index).padStart(2, '0')}`, '0.10'),
      );
    }

    const temporarioExtras = await createGroup(
      ownerAS,
      unitA1,
      temporario.id,
      'Extras',
      'addon',
      'multiple',
      0,
      3,
    );
    extraA = await createOption(ownerAS, temporarioExtras.id, 'Extra A', '0.00');
    extraB = await createOption(ownerAS, temporarioExtras.id, 'Extra B', '0.00');
    const temporarioExtras2 = await createGroup(
      ownerAS,
      unitA1,
      temporario.id,
      'Extras 2',
      'addon',
      'multiple',
      0,
      3,
    );
    const extraC = await createOption(ownerAS, temporarioExtras2.id, 'Extra C', '0.00');

    ok(pequeno.price_delta === '0.00', '0.4 opcao base com delta zero');
    ok(queijo.price_delta === '1.00', '0.5 adicional com delta textual');
    ok(
      alface.price_delta === '0.50' && rucula.price_delta === '0.50',
      '0.6 extras com delta textual',
    );
    ok(
      semCebola.price_delta === '0.00' && semAlface.price_delta === '0.00',
      '0.7 remocoes com delta zero',
    );
    ok(extraFritas.price_delta === '1.00', '0.8 extra de fritas com delta textual');

    ok(tamanho.sort_order === 100, '0.9 sort_order do primeiro grupo e 100');
    ok(
      adicionais.sort_order === 200 && extras.sort_order === 300,
      '0.10 sort_order incrementa por grupo',
    );
    ok(
      remover.sort_order === 400 && opcionalUnico.sort_order === 500,
      '0.11 sort_order dos demais grupos',
    );

    await saveConfig(ownerAS, unitA1, operationalConfig());

    scenario(1, 'regras de criacao de grupo e RBAC do catalogo');
    await expectDenied(
      anon,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, configurable.id, 'Anon', 'addon', 'multiple', 0, 1],
      '1.0 anon sem criar grupo',
    );
    await expectError(
      operatorAS,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, configurable.id, 'Operator', 'addon', 'multiple', 0, 1],
      'PED11',
      '1.1 operator sem gerenciar estrutura',
    );
    await expectError(
      managerOtherS,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, configurable.id, 'Other', 'addon', 'multiple', 0, 1],
      'PED11',
      '1.2 manager de outra unidade sem criar',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [randomUUID(), configurable.id, 'Sem Unidade', 'addon', 'multiple', 0, 1],
      'PED12',
      '1.3 unidade inexistente retorna PED12',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, randomUUID(), 'Sem Produto', 'addon', 'multiple', 0, 1],
      'PED24',
      '1.4 produto inexistente retorna PED24',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, configurable.id, '   ', 'addon', 'multiple', 0, 1],
      'PED25',
      '1.5 nome vazio retorna PED25',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
      [unitA1, configurable.id, 'N'.repeat(81), 'addon', 'multiple', 0, 1],
      'PED26',
      '1.6 nome longo retorna PED26',
    );
    for (const [kind, mode, minSelect, maxSelect] of [
      ['combo', 'single', 0, 1],
      ['addon', 'multi', 0, 1],
      ['addon', 'multiple', -1, 1],
      ['addon', 'multiple', 0, 51],
      ['addon', 'multiple', 2, 1],
      ['variation', 'multiple', 1, 1],
      ['variation', 'single', 1, 2],
      ['removal', 'single', 0, 1],
      ['removal', 'multiple', 1, 1],
    ]) {
      await expectError(
        ownerAS,
        'select public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)',
        [unitA1, configurable.id, 'Invalido', kind, mode, minSelect, maxSelect],
        'PED73',
        '1.7 combinacao invalida retorna PED73',
      );
    }

    scenario(2, 'opcoes: regras de delta, kind change e publicacao com piso');
    const invalids = ['abc', '1.999', '1e3', '', '--1.00', '1.00.00'];
    for (const delta of invalids) {
      await expectError(
        ownerAS,
        'select public.create_catalog_product_option($1, $2, $3)',
        [tamanho.id, 'Delta Invalido', delta],
        'PED28',
        '2.0 delta malformado retorna PED28',
      );
    }
    await expectError(
      ownerAS,
      'select public.create_catalog_product_option($1, $2, $3)',
      [randomUUID(), 'Grupo Sumido', '1.00'],
      'PED72',
      '2.1 grupo inexistente retorna PED72',
    );
    await expectError(
      operatorAS,
      'select public.create_catalog_product_option($1, $2, $3)',
      [tamanho.id, 'Operator', '1.00'],
      'PED11',
      '2.2 operator sem criar opcao',
    );
    await expectError(
      ownerAS,
      'select public.create_catalog_product_option($1, $2, $3)',
      [adicionais.id, 'Desconto', '-1.00'],
      'PED73',
      '2.3 adicional negativo retorna PED73',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_product_option($1, $2, $3)',
      [bacon.id, 'Bacon', '-0.50'],
      'PED73',
      '2.4 atualizar adicional para negativo retorna PED73',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_product_option($1, $2, $3)',
      [randomUUID(), 'Opcao', '1.00'],
      'PED74',
      '2.5 opcao inexistente retorna PED74',
    );
    const categoryA2 = await createCategory(ownerAS, unitA2, 'Opcoes A2');
    const opcionalNegativo = await createProduct(
      ownerAS,
      unitA2,
      categoryA2.id,
      'Opcional Negativo',
      '10.00',
    );
    const descontoOpcional = await createGroup(
      ownerAS,
      unitA2,
      opcionalNegativo.id,
      'Desconto Opcional',
      'variation',
      'single',
      0,
      1,
    );
    const promoOpcional = await createOption(
      ownerAS,
      descontoOpcional.id,
      'Promo Opcional',
      '-2.00',
    );
    const addonA2 = await createGroup(
      ownerAS,
      unitA2,
      opcionalNegativo.id,
      'Adicionais A2',
      'addon',
      'multiple',
      0,
      2,
    );
    const aditivoA2 = await createOption(ownerAS, addonA2.id, 'Aditivo A2', '1.00');
    const remocaoA2 = await createGroup(
      ownerAS,
      unitA2,
      opcionalNegativo.id,
      'Remocao A2',
      'removal',
      'multiple',
      0,
      50,
    );
    const semItemA2 = await createOption(ownerAS, remocaoA2.id, 'Sem Item A2', '0.00');
    const publicationA2 = await publish(ownerAS, unitA2);
    ok(publicationA2.option_group_count === 3, '2.7 publicacao A2 congela tres grupos');
    ok(publicationA2.option_count === 3, '2.8 publicacao A2 congela tres opcoes');

    await expectError(
      ownerAS,
      'select public.create_catalog_product_option($1, $2, $3)',
      [remocaoA2.id, 'Remover Pago', '1.00'],
      'PED73',
      '2.9 remocao com delta nao zero retorna PED73',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_product_option($1, $2, $3)',
      [semItemA2.id, 'Sem Item A2', '0.01'],
      'PED73',
      '2.10 atualizar remocao para valor retorna PED73',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_product_option($1, $2, $3)',
      [aditivoA2.id, 'Aditivo A2', 'abc'],
      'PED28',
      '2.11 atualizar delta malformado retorna PED28',
    );
    const promoUpdated = await updateOption(ownerAS, promoOpcional.id, 'Promo Opcional', '-3.00');
    ok(promoUpdated.price_delta === '-3.00', '2.12 variacao aceita delta negativo atualizado');
    await updateOption(ownerAS, promoOpcional.id, 'Promo Opcional', '-2.00');

    await expectError(
      ownerAS,
      'select public.update_catalog_product_option_group($1, $2, $3, $4, $5, $6)',
      [addonA2.id, 'Adicionais A2', 'removal', 'multiple', 0, 2],
      'PED73',
      '2.13 mudar addon com filhos para removal retorna PED73',
    );
    await expectError(
      ownerAS,
      'select public.update_catalog_product_option_group($1, $2, $3, $4, $5, $6)',
      [descontoOpcional.id, 'Desconto Opcional', 'removal', 'multiple', 0, 1],
      'PED73',
      '2.14 mudar variacao negativa para removal retorna PED73',
    );
    const addonAsVariation = await updateGroup(
      ownerAS,
      addonA2.id,
      'Adicionais A2',
      'variation',
      'single',
      1,
      1,
    );
    ok(addonAsVariation.kind === 'variation', '2.15 addon sem violacao vira variation');
    await updateGroup(ownerAS, addonA2.id, 'Adicionais A2', 'addon', 'multiple', 0, 2);

    await expectError(
      ownerAS,
      'select public.update_catalog_product_option_group($1, $2, $3, $4, $5, $6)',
      [randomUUID(), 'Grupo', 'addon', 'multiple', 0, 1],
      'PED72',
      '2.16 grupo inexistente no update retorna PED72',
    );
    await expectError(
      operatorAS,
      'select public.set_catalog_product_option_group_active($1, $2)',
      [addonA2.id, false],
      'PED11',
      '2.17 operator sem alternar grupo ativo',
    );
    await expectError(
      managerOtherS,
      'select public.set_catalog_product_option_available($1, $2)',
      [bacon.id, false],
      'PED11',
      '2.18 manager cross-unit sem alternar disponibilidade',
    );

    const pisoNegativo = await createProduct(
      ownerAS,
      unitA2,
      categoryA2.id,
      'Piso Negativo',
      '1.00',
    );
    const obrigatorioA2 = await createGroup(
      ownerAS,
      unitA2,
      pisoNegativo.id,
      'Obrigatorio A2',
      'variation',
      'single',
      1,
      1,
    );
    await createOption(ownerAS, obrigatorioA2.id, 'Desconto Total', '-1.50');
    await expectError(
      ownerAS,
      'select public.publish_unit_menu($1)',
      [unitA2],
      'PED73',
      '2.19 publicacao com piso negativo retorna PED73',
    );

    scenario(3, 'publicacao, snapshot imutavel e exclusao de inativos');
    await publish(ownerAS, unitA1);
    await setGroupActive(ownerAS, fritasInactive.id, false);
    await setOptionActive(ownerAS, extraB.id, false);
    await setOptionActive(ownerAS, extraC.id, false);
    const publicationV2 = await publish(ownerAS, unitA1);
    slugA1 = publicationV2.public_slug;
    ok(publicationV2.option_group_count === 9, '3.0 publicacao v2 congela nove grupos');
    ok(publicationV2.option_count === 63, '3.1 publicacao v2 congela sessenta e tres opcoes');
    currentMenu = await publicMenu(anon, slugA1);
    ok(currentMenu.found === true, '3.2 menu principal publicado');

    const fritasMenu = productByName(currentMenu, 'Fritas');
    ok(fritasMenu.option_groups.length === 1, '3.3 grupo inativo excluido do snapshot');
    ok(
      groupByName(fritasMenu, 'Extras Fritas') !== undefined &&
        groupByName(fritasMenu, 'Fritas Desativado') === undefined,
      '3.4 grupo desativado nao aparece',
    );
    const temporarioMenu = productByName(currentMenu, 'Temporario');
    ok(temporarioMenu.option_groups.length === 1, '3.5 grupo sem opcao ativa excluido');
    ok(
      optionByName(groupByName(temporarioMenu, 'Extras'), 'Extra A') !== undefined &&
        optionByName(groupByName(temporarioMenu, 'Extras'), 'Extra B') === undefined,
      '3.6 opcao desativada nao aparece',
    );

    const snapshotGroups = await ownerAS.query(
      `select count(*)::int as count
       from public.menu_version_option_groups
       where menu_version_id = $1`,
      [publicationV2.version_id],
    );
    const snapshotOptions = await ownerAS.query(
      `select count(*)::int as count
       from public.menu_version_options
       where menu_version_id = $1`,
      [publicationV2.version_id],
    );
    ok(snapshotGroups.rows[0].count === 9, '3.7 snapshot de grupos persiste nove');
    ok(snapshotOptions.rows[0].count === 63, '3.8 snapshot de opcoes persiste sessenta e tres');

    scenario(4, 'contrato do cardapio publico');
    const configuravelMenu = productByName(currentMenu, 'Configuravel');
    ok(
      Array.isArray(configuravelMenu.option_groups) && configuravelMenu.option_groups.length === 5,
      '4.0 option_groups presente',
    );
    const tamanhoMenu = groupByName(configuravelMenu, 'Tamanho');
    ok(
      exactKeys(tamanhoMenu, [
        'id',
        'name',
        'kind',
        'selection_mode',
        'min_select',
        'max_select',
        'options',
      ]),
      '4.1 chaves do grupo publico exatas',
    );
    ok(
      tamanhoMenu.kind === 'variation' &&
        tamanhoMenu.selection_mode === 'single' &&
        tamanhoMenu.min_select === 1 &&
        tamanhoMenu.max_select === 1,
      '4.2 regras do grupo publicas',
    );
    const pequenoMenu = optionByName(tamanhoMenu, 'Pequeno');
    ok(
      exactKeys(pequenoMenu, ['id', 'name', 'price_delta', 'is_available']),
      '4.3 chaves da opcao publica exatas',
    );
    ok(
      pequenoMenu.price_delta === '0.00' && pequenoMenu.is_available === true,
      '4.4 delta textual e disponibilidade',
    );
    const grandeMenu = optionByName(tamanhoMenu, 'Grande');
    ok(grandeMenu.price_delta === '2.00', '4.5 delta positivo textual');
    const menuJson = JSON.stringify(currentMenu);
    ok(!menuJson.includes('source_'), '4.6 cardapio sem source ids');
    ok(configuravelMenu.is_configurable === true, '4.7 configuravel marcado como configurable');
    const simpplesMenu = productByName(currentMenu, 'Simples');
    ok(
      Array.isArray(simpplesMenu.option_groups) && simpplesMenu.option_groups.length === 0,
      '4.8 produto sem grupos exposto vazio',
    );
    ok(simpplesMenu.is_configurable === true, '4.9 produto sem grupos configuravel');
    const requeridoMenu = productByName(currentMenu, 'Requerido');
    ok(
      requeridoMenu.is_configurable === true,
      '4.10 obrigatorio com opcoes disponiveis configuravel',
    );
    await setOptionAvailable(operatorAS, opcaoA.id, false);
    await setOptionAvailable(operatorAS, opcaoB.id, false);
    currentMenu = await publicMenu(anon, slugA1);
    ok(
      productByName(currentMenu, 'Requerido').is_configurable === false,
      '4.11 sem opcoes disponiveis nao configuravel',
    );
    await setOptionAvailable(operatorAS, opcaoA.id, true);
    await setOptionAvailable(operatorAS, opcaoB.id, true);
    currentMenu = await publicMenu(anon, slugA1);
    ok(
      productByName(currentMenu, 'Requerido').is_configurable === true,
      '4.12 restaurado configuravel',
    );

    scenario(5, 'checkout com opcoes: regras e preco');
    const configurableCurrent = productByName(currentMenu, 'Configuravel');
    const grandCurrent = optionByName(groupByName(configurableCurrent, 'Tamanho'), 'Grande');
    const baconCurrent = optionByName(groupByName(configurableCurrent, 'Adicionais'), 'Bacon');
    const queijoCurrent = optionByName(groupByName(configurableCurrent, 'Adicionais'), 'Queijo');
    const alfaceCurrent = optionByName(groupByName(configurableCurrent, 'Extras'), 'Alface');
    const ruculaCurrent = optionByName(groupByName(configurableCurrent, 'Extras'), 'Rucula');
    const semCebolaCurrent = optionByName(
      groupByName(configurableCurrent, 'Remover'),
      'Sem Cebola',
    );
    const semAlfaceCurrent = optionByName(
      groupByName(configurableCurrent, 'Remover'),
      'Sem Alface',
    );
    const molhoCurrent = optionByName(groupByName(configurableCurrent, 'Opcional Unico'), 'Molho');

    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            { menu_item_id: configurableCurrent.id, quantity: 1, note: null },
          ]),
        ),
      ],
      'PED76',
      '5.0 sem grupo obrigatorio retorna PED76',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [baconCurrent.id],
            },
          ]),
        ),
      ],
      'PED76',
      '5.1 obrigatorio incompleto retorna PED76',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [grandCurrent.id, baconCurrent.id, queijoCurrent.id],
            },
          ]),
        ),
      ],
      'PED77',
      '5.2 grupo acima do max retorna PED77',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [grandCurrent.id, grandCurrent.id],
            },
          ]),
        ),
      ],
      'PED77',
      '5.3 opcao duplicada retorna PED77',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: Array.from({ length: 51 }, () => grandCurrent.id),
            },
          ]),
        ),
      ],
      'PED77',
      '5.4 mais de cinquenta opcoes retorna PED77',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [randomUUID()],
            },
          ]),
        ),
      ],
      'PED74',
      '5.5 opcao inexistente retorna PED74',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [
                optionByName(
                  groupByName(productByName(currentMenu, 'Fritas'), 'Extras Fritas'),
                  'Extra Fritas',
                ).id,
              ],
            },
          ]),
        ),
      ],
      'PED78',
      '5.6 opcao de outro produto retorna PED78',
    );
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [extraB.id],
            },
          ]),
        ),
      ],
      'PED74',
      '5.7 opcao ausente da versao atual retorna PED74',
    );
    for (const options of ['nao-array', 123]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(
            makePayload(currentMenu, [
              { menu_item_id: configurableCurrent.id, quantity: 1, note: null, options },
            ]),
          ),
        ],
        'PED37',
        '5.8 options fora do tipo retorna PED37',
      );
    }
    for (const options of [[123], ['nao-uuid'], [null]]) {
      await expectError(
        anon,
        'select public.create_public_order($1, $2, $3::jsonb)',
        [
          slugA1,
          randomUUID(),
          JSON.stringify(
            makePayload(currentMenu, [
              { menu_item_id: configurableCurrent.id, quantity: 1, note: null, options },
            ]),
          ),
        ],
        'PED37',
        '5.9 elemento invalido em options retorna PED37',
      );
    }
    await setOptionAvailable(operatorAS, bacon.id, false);
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [grandCurrent.id, baconCurrent.id],
            },
          ]),
        ),
      ],
      'PED75',
      '5.10 opcao indisponivel retorna PED75',
    );
    await setOptionAvailable(operatorAS, bacon.id, true);

    const megaCurrent = productByName(currentMenu, 'Mega');
    const megaFiftyIds = groupByName(megaCurrent, 'Combos').options.map((entry) => entry.id);
    const megaCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, [
        { menu_item_id: megaCurrent.id, quantity: 1, note: null, options: megaFiftyIds },
      ]),
    );
    ok(megaCreation.subtotal === '12.00', '5.11 cinquenta opcoes aceitas com soma de deltas');

    const simpleCurrent = productByName(currentMenu, 'Simples');
    const simpleCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, [{ menu_item_id: simpleCurrent.id, quantity: 1, note: null }]),
    );
    const simpleOrderId = await orderIdForCreation(ownerAS, simpleCreation);
    const simpleDetail = await adminDetail(ownerAS, simpleOrderId);
    ok(
      Array.isArray(simpleDetail.items[0].options) && simpleDetail.items[0].options.length === 0,
      '5.12 pedido sem opcoes retrocompativel',
    );

    mathCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, [
        {
          menu_item_id: configurableCurrent.id,
          quantity: 2,
          note: '  Pedido matematico  ',
          options: [
            grandCurrent.id,
            baconCurrent.id,
            alfaceCurrent.id,
            ruculaCurrent.id,
            semCebolaCurrent.id,
            semAlfaceCurrent.id,
            molhoCurrent.id,
          ],
        },
      ]),
    );
    mathOrderId = await orderIdForCreation(ownerAS, mathCreation);
    ok(mathCreation.subtotal === '20.00', '5.13 subtotal soma base e deltas');
    ok(mathCreation.total === '20.00', '5.14 total pickup sem fee');
    mathDetail = await adminDetail(ownerAS, mathOrderId);
    ok(mathDetail.items[0].unit_price === '10.00', '5.15 unit_price final com deltas');
    ok(mathDetail.items[0].line_total === '20.00', '5.16 line_total com deltas');
    ok(mathDetail.items[0].options.length === 7, '5.17 snapshot por linha com sete opcoes');
    const firstOption = mathDetail.items[0].options[0];
    ok(
      exactKeys(firstOption, [
        'id',
        'group_id',
        'group_name',
        'group_kind',
        'option_id',
        'option_name',
        'price_delta',
      ]),
      '5.18 chaves administrativas da opcao exatas',
    );
    ok(
      mathDetail.items[0].options.some(
        (entry) =>
          entry.group_name === 'Tamanho' &&
          entry.group_kind === 'variation' &&
          entry.option_name === 'Grande' &&
          entry.price_delta === '2.00',
      ),
      '5.19 snapshot administrativo coerente',
    );

    const distinctLines = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(currentMenu, [
        {
          menu_item_id: configurableCurrent.id,
          quantity: 1,
          note: null,
          options: [grandCurrent.id],
        },
        {
          menu_item_id: configurableCurrent.id,
          quantity: 1,
          note: null,
          options: [optionByName(groupByName(configurableCurrent, 'Tamanho'), 'Pequeno').id],
        },
      ]),
    );
    ok(distinctLines.subtotal === '12.00', '5.20 linhas distintas do mesmo produto somam');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [grandCurrent.id],
            },
            {
              menu_item_id: configurableCurrent.id,
              quantity: 1,
              note: null,
              options: [grandCurrent.id],
            },
          ]),
        ),
      ],
      'PED37',
      '5.21 linhas identicas com mesmas opcoes retornam PED37',
    );

    const tracked = await tracking(anon, mathCreation.tracking_token);
    const trackedItem = tracked.order.items.find((entry) => entry.name === 'Configuravel');
    ok(trackedItem.options.length === 7, '5.22 tracking expoe opcoes por linha');
    const trackedOption = trackedItem.options[0];
    ok(
      exactKeys(trackedOption, ['group_name', 'group_kind', 'option_name', 'price_delta']),
      '5.23 tracking sem identificadores tecnicos',
    );
    const trackingJson = JSON.stringify(tracked);
    ok(
      !trackingJson.includes('menu_option_id') && !trackingJson.includes('"group_id"'),
      '5.24 tracking sem ids de opcoes',
    );

    scenario(6, 'imutabilidade do snapshot de pedido');
    await updateOption(ownerAS, bacon.id, 'Bacon Especial', '9.99');
    await updateProduct(ownerAS, configurable.id, categoryA1.id, 'Configuravel Alterado', '11.00');
    mathDetail = await adminDetail(ownerAS, mathOrderId);
    ok(mathDetail.items[0].product_name === 'Configuravel', '6.0 nome snapshot nao muda');
    ok(mathDetail.items[0].unit_price === '10.00', '6.1 preco snapshot nao muda');
    ok(
      mathDetail.items[0].options.find((entry) => entry.option_name === 'Bacon')?.price_delta ===
        '1.50',
      '6.2 delta da opcao snapshot nao muda',
    );
    const trackedAfter = await tracking(anon, mathCreation.tracking_token);
    ok(
      trackedAfter.order.items.find((entry) => entry.name === 'Configuravel').options.length === 7,
      '6.3 tracking snapshot estavel',
    );

    scenario(7, 'fingerprint, idempotencia e concorrencia');
    const emptyHash = (
      await admin.query('select public._options_fingerprint(array[]::uuid[]) as out')
    ).rows[0].out;
    ok(isHex64(emptyHash), '7.0 fingerprint vazio hex');
    const hashOne = (
      await admin.query('select public._options_fingerprint($1::uuid[]) as out', [[grande.id]])
    ).rows[0].out;
    const hashTwo = (
      await admin.query('select public._options_fingerprint($1::uuid[]) as out', [
        [grande.id, molho.id],
      ])
    ).rows[0].out;
    const hashSwap = (
      await admin.query('select public._options_fingerprint($1::uuid[]) as out', [
        [molho.id, grande.id],
      ])
    ).rows[0].out;
    ok(hashTwo === hashSwap && isHex64(hashTwo), '7.1 fingerprint canonico por ordem');
    ok(hashOne !== hashTwo, '7.2 fingerprint distingue selecoes');
    ok(
      (await admin.query('select public._options_fingerprint(array[]::uuid[]) as out')).rows[0]
        .out === emptyHash,
      '7.3 fingerprint vazio determinístico',
    );

    const replayKey = randomUUID();
    const replayPayload = makePayload(currentMenu, [
      {
        menu_item_id: configurableCurrent.id,
        quantity: 1,
        note: null,
        options: [grandCurrent.id, baconCurrent.id, molhoCurrent.id],
      },
    ]);
    const replayFirst = await checkout(anon, slugA1, replayKey, replayPayload);
    const replaySecond = await checkout(anon, slugA1, replayKey, replayPayload);
    ok(
      JSON.stringify(replaySecond) === JSON.stringify(replayFirst),
      '7.4 replay com opcoes identico',
    );
    const replayCount = await admin.query(
      'select count(*)::int as count from public.orders where unit_id = $1 and idempotency_key = $2',
      [unitA1, replayKey],
    );
    ok(replayCount.rows[0].count === 1, '7.5 replay persiste um pedido');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [slugA1, replayKey, JSON.stringify({ ...replayPayload, notes: 'Outra observacao' })],
      'PED42',
      '7.6 mesma key com hash diferente retorna PED42',
    );

    const concurrentKey = randomUUID();
    const concurrentPayload = makePayload(currentMenu, [
      {
        menu_item_id: configurableCurrent.id,
        quantity: 1,
        note: null,
        options: [grandCurrent.id, molhoCurrent.id],
      },
    ]);
    const concurrentResults = await withTwoAnon((first, second) =>
      Promise.allSettled([
        checkout(first, slugA1, concurrentKey, concurrentPayload),
        checkout(second, slugA1, concurrentKey, concurrentPayload),
      ]),
    );
    ok(
      concurrentResults.every((result) => result.status === 'fulfilled'),
      '7.7 retries concorrentes com opcoes concluem',
    );
    ok(
      JSON.stringify(concurrentResults[0].value) === JSON.stringify(concurrentResults[1].value),
      '7.8 retries concorrentes retornam objeto identico',
    );

    const durableKey = randomUUID();
    const durablePayload = makePayload(currentMenu, [
      { menu_item_id: simpleCurrent.id, quantity: 1, note: null },
    ]);
    const durableFirst = await checkout(anon, slugA1, durableKey, durablePayload);
    await publish(ownerAS, unitA1);
    const durableAfter = await checkout(anon, slugA1, durableKey, durablePayload);
    ok(
      JSON.stringify(durableAfter) === JSON.stringify(durableFirst),
      '7.9 replay precede revalidacao apos republicacao',
    );

    scenario(8, 'RLS, grants e escrita direta');
    for (const table of [
      'catalog_product_option_groups',
      'catalog_product_options',
      'menu_version_option_groups',
      'menu_version_options',
      'order_item_options',
    ]) {
      await expectDenied(
        anon,
        `select * from public.${table} limit 1`,
        [],
        '8.0 anon sem SELECT direto',
      );
    }
    for (const statement of [
      `insert into public.catalog_product_option_groups
         (organization_id, unit_id, product_id, name, kind, selection_mode,
          min_select, max_select, sort_order)
       select organization_id, unit_id, id, 'Direto', 'addon', 'multiple', 0, 1, 100
       from public.catalog_products where id = $1`,
      `insert into public.catalog_product_options
         (organization_id, unit_id, product_id, group_id, name, price_delta, sort_order)
       select organization_id, unit_id, product_id, id, 'Direto', 1, 100
       from public.catalog_product_option_groups where product_id = $1 limit 1`,
      'update public.catalog_product_option_groups set name = name where product_id = $1',
      'delete from public.catalog_product_options where product_id = $1',
    ]) {
      await expectDenied(
        ownerAS,
        statement,
        [configurable.id],
        '8.1 escrita direta authenticated negada',
      );
    }
    for (const table of ['catalog_product_option_groups', 'catalog_product_options']) {
      const ownRows = await operatorAS.query(`select id from public.${table} where unit_id = $1`, [
        unitA1,
      ]);
      const crossRows = await managerOtherS.query(
        `select id from public.${table} where unit_id = $1`,
        [unitA1],
      );
      const foreignRows = await ownerBS.query(`select id from public.${table} where unit_id = $1`, [
        unitA1,
      ]);
      ok(ownRows.rows.length > 0, '8.2 operator le catalogo da unidade');
      ok(crossRows.rows.length === 0, '8.3 manager cross-unit isolado');
      ok(foreignRows.rows.length === 0, '8.4 owner cross-tenant isolado');
    }
    const ownItemOptions = await operatorAS.query(
      'select id from public.order_item_options where unit_id = $1 limit 5',
      [unitA1],
    );
    const crossItemOptions = await managerOtherS.query(
      'select id from public.order_item_options where unit_id = $1 limit 5',
      [unitA1],
    );
    const foreignItemOptions = await ownerBS.query(
      'select id from public.order_item_options where unit_id = $1 limit 5',
      [unitA1],
    );
    ok(ownItemOptions.rows.length > 0, '8.5 operator le opcoes de pedido da unidade');
    ok(crossItemOptions.rows.length === 0, '8.6 opcoes de pedido cross-unit isoladas');
    ok(foreignItemOptions.rows.length === 0, '8.7 opcoes de pedido cross-tenant isoladas');
    await expectDenied(
      ownerAS,
      `insert into public.order_item_options
         (organization_id, unit_id, order_id, order_item_id, menu_version_id,
          menu_item_id, menu_group_id, group_name, group_kind,
          menu_option_id, option_name, price_delta)
       select o.organization_id, o.unit_id, o.id, oi.id, o.menu_version_id,
              oi.menu_item_id, gen_random_uuid(), 'Direto', 'addon',
              gen_random_uuid(), 'Direto', 1
       from public.orders o join public.order_items oi on oi.order_id = o.id
       where o.id = $1`,
      [mathOrderId],
      '8.8 escrita direta em order_item_options negada',
    );

    scenario(9, 'schema, constraints e superficie de funcoes');
    const newTables = await admin.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])`,
      [
        [
          'catalog_product_option_groups',
          'catalog_product_options',
          'menu_version_option_groups',
          'menu_version_options',
          'order_item_options',
        ],
      ],
    );
    ok(newTables.rows.length === 5, '9.0 cinco tabelas novas presentes');

    const itemColumns = await admin.query(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = 'public' and table_name = 'order_items'`,
    );
    const itemColumnMap = new Map(
      itemColumns.rows.map((row) => [row.column_name, row.is_nullable]),
    );
    ok(
      itemColumnMap.has('options_fingerprint') && itemColumnMap.get('options_fingerprint') === 'NO',
      '9.1 options_fingerprint not null',
    );

    const constraints = await admin.query(
      `select conname
       from pg_constraint
       where conrelid = 'public.order_items'::regclass`,
    );
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));
    ok(
      constraintNames.has('order_items_order_menu_item_options_key'),
      '9.2 unicidade por fingerprint presente',
    );
    ok(
      constraintNames.has('order_items_organization_unit_order_id_key'),
      '9.3 unicidade organizacional presente',
    );
    ok(!constraintNames.has('order_items_order_menu_item_key'), '9.4 unicidade legada removida');

    const helperGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = any($1::text[])
         and grantee in ('PUBLIC', 'anon', 'authenticated')`,
      [
        [
          '_validate_option_delta',
          '_options_fingerprint',
          '_validate_option_delta_by_kind',
          '_guard_option_group_kind_change',
          '_order_tracking_json',
          '_order_admin_json',
        ],
      ],
    );
    ok(helperGrants.rows.length === 0, '9.5 helpers internos sem EXECUTE de browser');

    const newRpcNames = [
      'create_catalog_product_option_group',
      'update_catalog_product_option_group',
      'set_catalog_product_option_group_active',
      'create_catalog_product_option',
      'update_catalog_product_option',
      'set_catalog_product_option_active',
      'set_catalog_product_option_available',
    ];
    const rpcGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = any($1::text[])
         and grantee in ('PUBLIC', 'anon', 'authenticated')`,
      [newRpcNames],
    );
    for (const name of newRpcNames) {
      const rows = rpcGrants.rows.filter((row) => row.routine_name === name);
      ok(
        rows.some((row) => row.grantee === 'authenticated') &&
          !rows.some((row) => ['PUBLIC', 'anon'].includes(row.grantee)),
        '9.6 RPC de catalogo somente authenticated',
      );
    }

    const publicRpcGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = 'create_public_order'
         and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    ok(
      publicRpcGrants.rows.some((row) => row.grantee === 'anon') &&
        publicRpcGrants.rows.some((row) => row.grantee === 'authenticated'),
      '9.7 create_public_order concedida a anon e authenticated',
    );

    const fingerprintCount = (
      await admin.query(
        `select count(*)::int as count
         from public.orders o
         join public.order_items oi on oi.order_id = o.id
         where o.id = $1`,
        [simpleOrderId],
      )
    ).rows[0].count;
    ok(fingerprintCount === 1, '9.8 pedido simples mantido');

    scenario(10, 'exclusao de fonte operacional sem quebrar snapshot');
    await admin.query('delete from public.catalog_product_options where id = $1', [extraA.id]);
    currentMenu = await publicMenu(anon, slugA1);
    const extraAMenu = optionByName(
      groupByName(productByName(currentMenu, 'Temporario'), 'Extras'),
      'Extra A',
    );
    ok(extraAMenu.is_available === false, '10.0 fonte removida reflete indisponivel');
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb)',
      [
        slugA1,
        randomUUID(),
        JSON.stringify(
          makePayload(currentMenu, [
            {
              menu_item_id: productByName(currentMenu, 'Temporario').id,
              quantity: 1,
              note: null,
              options: [extraAMenu.id],
            },
          ]),
        ),
      ],
      'PED75',
      '10.1 fonte removida retorna PED75 no checkout',
    );
    const remainingOptions = (
      await admin.query(
        `select count(*)::int as count
         from public.menu_version_options o
         join public.menu_version_option_groups g on g.id = o.menu_group_id
         where g.menu_product_id = (
           select id from public.menu_version_products
           where name = 'Temporario'
           order by created_at desc limit 1
         )`,
      )
    ).rows[0].count;
    ok(remainingOptions > 0, '10.2 snapshot preserva historico mesmo com fonte removida');

    ok(passed + failed >= 100, '11.0 suite planeja ao menos 100 checks executados');
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
