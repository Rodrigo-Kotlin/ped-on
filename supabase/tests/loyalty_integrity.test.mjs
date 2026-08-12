import pg from 'pg';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { databaseConfig } from './db-test-config.mjs';

// Esta suite altera fixtures operacionais e deve rodar isoladamente das
// demais regressoes de banco.
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

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

function randomToken() {
  return randomBytes(32).toString('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inTwoHours() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

async function adminClient() {
  const client = new Client({
    connectionString: DIRECT_URL,
    ssl: DB_SSL,
  });
  await client.connect();
  return client;
}

async function sessionFor(userId) {
  const client = new Client({
    connectionString: DIRECT_URL,
    ssl: DB_SSL,
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
    ssl: DB_SSL,
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

async function checkoutV2(client, slug, key, payload, attemptHash) {
  return (
    await client.query('select public.create_public_order_v2($1, $2, $3::jsonb, $4) as out', [
      slug,
      key,
      JSON.stringify(payload),
      attemptHash,
    ])
  ).rows[0].out;
}

async function recoverCheckout(client, slug, key, attemptHash) {
  return (
    await client.query('select public.get_public_order_by_attempt($1, $2, $3) as out', [
      slug,
      key,
      attemptHash,
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

async function getLoyaltyContext(client, slug) {
  return (
    await client.query('select public.get_loyalty_public_context_internal($1) as out', [slug])
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

async function consumeRateLimit(client, scopeHash, windowSeconds, maxAttempts) {
  return (
    await client.query('select public.consume_loyalty_rate_limit_internal($1, $2, $3) as out', [
      scopeHash,
      windowSeconds,
      maxAttempts,
    ])
  ).rows[0].out;
}

async function publicLoyaltyAccount(client, token) {
  return (await client.query('select public.get_public_loyalty_account($1) as out', [token]))
    .rows[0].out;
}

async function getProgramAdmin(client, organizationId) {
  return (
    await client.query('select public.get_loyalty_program_admin($1) as out', [organizationId])
  ).rows[0].out;
}

async function setProgramEnabled(client, organizationId, enabled) {
  return (
    await client.query('select public.set_loyalty_program_enabled($1, $2) as out', [
      organizationId,
      enabled,
    ])
  ).rows[0].out;
}

async function getMembersAdmin(client, organizationId, limit = 50, cursor = null) {
  return (
    await client.query('select public.get_loyalty_members_admin($1, $2, $3) as out', [
      organizationId,
      limit,
      cursor,
    ])
  ).rows[0].out;
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

function allDays24h() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: true,
    is_24h: true,
    open_time: null,
    close_time: null,
  }));
}

function operationalConfig() {
  return {
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
}

const BASE_CUSTOMER = {
  name: '  Cliente Sintetico  ',
  phone: '(11) 98888-7777',
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

function productByName(menu, name) {
  for (const category of menu.categories ?? []) {
    const product = (category.products ?? []).find((entry) => entry.name === name);
    if (product) return product;
  }
  return null;
}

function singleItem(menu, name, quantity = 1) {
  return [{ menu_item_id: productByName(menu, name).id, quantity, note: null }];
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const rateScopeHashes = [];
  const openClients = [];

  let ownerA;
  let ownerB;
  let managerA;
  let ownerAS;
  let ownerBS;
  let managerAS;
  let anon;
  let orgA;
  let orgB;
  let unitA1;
  let unitB1;
  let slugA1;
  let slugB1;
  let menuA1;
  let menuB1;
  let enrollmentA;
  let fpA;
  let phoneFpA;
  let cpfA;
  let legacyCustomerId;

  try {
    scenario(0, 'setup sintetico de tenants, RBAC, catalogo e publicacoes');
    ownerA = await createTestUser(admin, `loyalty-owner-a-${suffix}@pedon-test.invalid`);
    ownerB = await createTestUser(admin, `loyalty-owner-b-${suffix}@pedon-test.invalid`);
    managerA = await createTestUser(admin, `loyalty-manager-a-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, ownerB.id, managerA.id);

    ownerAS = await sessionFor(ownerA.id);
    openClients.push(ownerAS);
    ownerBS = await sessionFor(ownerB.id);
    openClients.push(ownerBS);
    managerAS = await sessionFor(managerA.id);
    openClients.push(managerAS);
    anon = await anonClient();
    openClients.push(anon);

    orgA = (await ownerAS.query(`select public.complete_onboarding('Loyalty Org A') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);
    unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;

    orgB = (await ownerBS.query(`select public.complete_onboarding('Loyalty Org B') as org`))
      .rows[0].org;
    createdOrgIds.push(orgB);
    unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB],
      )
    ).rows[0].id;

    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'manager')`,
      [orgA, managerA.id],
    );
    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3)`,
      [orgA, managerA.id, unitA1],
    );

    const categoryA1 = await createCategory(ownerAS, unitA1, 'Loyalty Itens');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Exato', '8.10');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Barato', '1.00');
    await saveConfig(ownerAS, unitA1, operationalConfig());
    slugA1 = (await publish(ownerAS, unitA1)).public_slug;
    menuA1 = await publicMenu(anon, slugA1);

    const categoryB1 = await createCategory(ownerBS, unitB1, 'Loyalty B1');
    await createProduct(ownerBS, unitB1, categoryB1.id, 'Produto B1', '6.00');
    await saveConfig(ownerBS, unitB1, operationalConfig());
    slugB1 = (await publish(ownerBS, unitB1)).public_slug;
    menuB1 = await publicMenu(anon, slugB1);

    ok(menuA1.found === true, '0.1 menu principal publicado');
    ok(menuA1.operation.can_order_now === true, '0.2 checkout principal habilitado');
    ok(productByName(menuA1, 'Produto Exato') !== null, '0.3 item principal encontrado');
    ok(menuB1.found === true, '0.4 menu do segundo tenant publicado');

    scenario(1, 'ciclo de vida do programa (owner-only)');
    let programA = await getProgramAdmin(ownerAS, orgA);
    ok(exactKeys(programA, ['organization_id', 'program', 'stats']), '1.1 shape do programa admin');
    ok(programA.program === null, '1.2 programa inexistente por padrao');
    ok(programA.stats.members_count === 0, '1.3 zero membros por padrao');

    const disabled = await setProgramEnabled(ownerAS, orgA, false);
    ok(disabled.program.enabled === false, '1.4 ativacao false cria programa desabilitado');
    programA = await getProgramAdmin(ownerAS, orgA);
    ok(
      programA.program.exists === true && programA.program.enabled === false,
      '1.5 programa persiste',
    );

    const enabled = await setProgramEnabled(ownerAS, orgA, true);
    ok(enabled.program.enabled === true, '1.6 ativacao true habilita programa');
    programA = await getProgramAdmin(ownerAS, orgA);
    ok(programA.program.enabled === true, '1.7 estado refletido na consulta');

    await expectError(
      managerAS,
      'select public.set_loyalty_program_enabled($1, $2) as out',
      [orgA, true],
      'PED11',
      '1.8 manager nao ativa programa',
    );
    await expectError(
      managerAS,
      'select public.get_loyalty_program_admin($1) as out',
      [orgA],
      'PED11',
      '1.9 manager nao le programa',
    );
    await expectDenied(
      anon,
      'select public.get_loyalty_program_admin($1) as out',
      [orgA],
      '1.10 anon sem execute do programa admin',
    );
    await expectError(
      ownerAS,
      'select public.set_loyalty_program_enabled($1, $2) as out',
      [null, true],
      'PED11',
      '1.11 org nula tratada como forbidden',
    );

    const menuEnabledA = await publicMenu(anon, slugA1);
    ok(menuEnabledA.loyalty.enabled === true, '1.12 menu expoe loyalty do tenant A');
    const menuB = await publicMenu(anon, slugB1);
    ok(menuB.loyalty.enabled === false, '1.13 tenant B sem programa desabilitado');

    scenario(2, 'resolucao de identidade (enroll/lookup) via service_role');
    const ctxA = await getLoyaltyContext(admin, slugA1);
    ok(ctxA.found === true, '2.1 contexto resolve slug');
    ok(ctxA.organization_id === orgA, '2.2 contexto retorna organization_id');
    ok(
      ctxA.program.exists === true && ctxA.program.enabled === true,
      '2.3 contexto programa habilitado',
    );
    const ctxUnknown = await getLoyaltyContext(admin, 'f'.repeat(24));
    ok(ctxUnknown.found === false, '2.4 contexto de slug inexistente nao encontrado');

    cpfA = '11144477735';
    fpA = sha256(`pedon:cpf:v1:${orgA}:${cpfA}`);
    phoneFpA = sha256(`pedon:phone:v1:${orgA}:${fpA}`);
    const tokenA = randomToken();
    enrollmentA = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'enroll',
      name: '  Maria Clube  ',
      tokenHash: sha256(tokenA),
      expiresAt: inTwoHours(),
    });
    ok(enrollmentA.found === true, '2.5 enroll cria membro');
    ok(isUuid(enrollmentA.membership_id), '2.6 membership_id uuid');
    ok(enrollmentA.customer.cpf_last2 === '35', '2.7 cpf_last2 preservado');
    ok(enrollmentA.customer.name === 'Maria Clube', '2.8 nome normalizado');
    ok(enrollmentA.account.points_balance === 0, '2.9 saldo inicial zero');

    const customerRows = await admin.query(
      'select * from public.customers where organization_id = $1',
      [orgA],
    );
    ok(customerRows.rows.length === 1, '2.10 exatamente um cliente');
    ok(
      customerRows.rows[0].cpf_fingerprint === fpA &&
        !String(customerRows.rows[0].cpf_fingerprint).includes(cpfA),
      '2.11 fingerprint armazenada, CPF nunca persistido',
    );
    const cpfColumns = await admin.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'customers'`,
    );
    ok(
      !cpfColumns.rows.some((row) => ['cpf', 'cpf_number', 'cpf_digito'].includes(row.column_name)),
      '2.12 nenhuma coluna de CPF em claro',
    );

    const account1 = await accountOf(admin, enrollmentA.membership_id);
    ok(account1.points_balance === 0 && account1.recovery_points === 0, '2.13 conta criada zerada');

    const tokenA2 = randomToken();
    const enrollAgain = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'enroll',
      name: 'Nome Nao Sobrescrito',
      tokenHash: sha256(tokenA2),
      expiresAt: inTwoHours(),
      consentVersion: 'test-consent-v2',
    });
    ok(
      enrollAgain.membership_id === enrollmentA.membership_id,
      '2.14 enroll idempotente reutiliza membro',
    );
    const customersAfter = await admin.query(
      'select count(*)::integer as count from public.customers where organization_id = $1',
      [orgA],
    );
    ok(customersAfter.rows[0].count === 1, '2.15 sem cliente duplicado');

    const cpfB = '52998224725';
    const fpB = sha256(`pedon:cpf:v1:${orgA}:${cpfB}`);
    const lookupMissing = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpB,
      last2: cpfB.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    ok(lookupMissing.found === false, '2.16 lookup de desconhecido retorna found=false');

    const tokenB = randomToken();
    const lookupFound = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(tokenB),
      expiresAt: inTwoHours(),
    });
    ok(
      lookupFound.found === true && lookupFound.membership_id === enrollmentA.membership_id,
      '2.17 lookup existente retorna membro',
    );

    await expectError(
      admin,
      `select public.resolve_loyalty_identity_internal($1, $2, $3, $4, $5, $6, $7) as out`,
      [orgA, 'abc', '35', 'enroll', 'Nome', sha256(randomToken()), inTwoHours()],
      'PED53',
      '2.18 fingerprint malformada -> PED53',
    );
    await expectError(
      admin,
      `select public.resolve_loyalty_identity_internal($1, $2, $3, $4, $5, $6, $7) as out`,
      [orgA, fpA, '35', 'teleport', 'Nome', sha256(randomToken()), inTwoHours()],
      'PED53',
      '2.19 modo invalido -> PED53',
    );
    await expectError(
      admin,
      `select public.resolve_loyalty_identity_internal($1, $2, $3, $4, $5, $6, $7) as out`,
      [orgA, fpA, '35', 'enroll', '   ', sha256(randomToken()), inTwoHours()],
      'PED43',
      '2.20 enroll sem nome -> PED43',
    );
    await expectError(
      admin,
      `select public.resolve_loyalty_identity_internal($1, $2, $3, $4, $5, $6, $7) as out`,
      [orgA, fpA, '35', 'enroll', 'Nome', sha256(randomToken()), new Date(Date.now() - 60000)],
      'PED53',
      '2.21 token expirado no pedido -> PED53',
    );
    const fpC = sha256(`pedon:cpf:v1:${orgB}:${cpfB}`);
    await expectError(
      admin,
      `select public.resolve_loyalty_identity_internal($1, $2, $3, $4, $5, $6, $7) as out`,
      [orgB, fpC, cpfB.slice(-2), 'enroll', 'Nome', sha256(randomToken()), inTwoHours()],
      'PED51',
      '2.22 programa desabilitado -> PED51',
    );
    await expectDenied(
      anon,
      `select public.resolve_loyalty_identity_internal($1, $2, $3, $4, $5, $6, $7) as out`,
      [orgA, fpA, '35', 'lookup', null, sha256(randomToken()), inTwoHours()],
      '2.23 RPC interna sem execute de anon',
    );
    await expectDenied(
      anon,
      'select public.get_loyalty_public_context_internal($1) as out',
      [slugA1],
      '2.24 contexto sem execute de anon',
    );

    const hardenedCustomer = (
      await admin.query(
        `select phone_fingerprint, name
         from public.customers
         where organization_id = $1 and cpf_fingerprint = $2`,
        [orgA, fpA],
      )
    ).rows[0];
    ok(hardenedCustomer.phone_fingerprint === phoneFpA, '2.25 telefone protegido persistido');
    ok(hardenedCustomer.name === 'Maria Clube', '2.26 reenroll nao sobrescreve nome existente');
    const consent = (
      await admin.query(
        `select consented_at, consent_version
         from public.loyalty_memberships
         where id = $1`,
        [enrollmentA.membership_id],
      )
    ).rows[0];
    ok(
      consent.consented_at instanceof Date && consent.consent_version === 'test-consent-v2',
      '2.27 reenroll atualiza consentimento explicito',
    );
    const consentEvents = await admin.query(
      `select consent_version
       from public.loyalty_consent_events
       where organization_id = $1 and membership_id = $2
       order by created_at, id`,
      [orgA, enrollmentA.membership_id],
    );
    ok(
      consentEvents.rows.map((row) => row.consent_version).join(',') ===
        'test-consent-v1,test-consent-v2',
      '2.27a reenroll preserva historico append-only de consentimento',
    );
    await expectDenied(
      anon,
      'select * from public.loyalty_consent_events where organization_id = $1',
      [orgA],
      '2.27b anon nao le evidencias de consentimento',
    );

    const wrongPhoneFingerprint = sha256(`pedon:phone:wrong:${orgA}:${fpA}`);
    const wrongPhoneLookup = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      phoneFingerprint: wrongPhoneFingerprint,
      last2: cpfA.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    ok(
      exactKeys(wrongPhoneLookup, ['found']) && wrongPhoneLookup.found === false,
      '2.28 lookup com telefone divergente e uniformemente desconhecido',
    );
    const wrongPhoneEnroll = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      phoneFingerprint: wrongPhoneFingerprint,
      last2: cpfA.slice(-2),
      mode: 'enroll',
      name: 'Tentativa Divergente',
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    ok(
      exactKeys(wrongPhoneEnroll, ['found']) && wrongPhoneEnroll.found === false,
      '2.29 enroll existente com telefone divergente nao reivindica CPF',
    );
    const customerAfterWrongPhone = (
      await admin.query(
        `select phone_fingerprint, name
         from public.customers
         where organization_id = $1 and cpf_fingerprint = $2`,
        [orgA, fpA],
      )
    ).rows[0];
    ok(
      customerAfterWrongPhone.phone_fingerprint === phoneFpA &&
        customerAfterWrongPhone.name === 'Maria Clube',
      '2.29a telefone divergente nao altera nome nem telefone protegido',
    );
    const missingIdentity = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: sha256(`pedon:cpf:missing:${orgA}`),
      last2: '00',
      mode: 'lookup',
      name: null,
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    ok(
      JSON.stringify(missingIdentity) === JSON.stringify(wrongPhoneLookup),
      '2.30 CPF ausente e telefone incorreto possuem resposta uniforme',
    );
    await expectError(
      admin,
      `select public.resolve_loyalty_identity_internal_v2(
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       ) as out`,
      [
        orgA,
        fpA,
        phoneFpA,
        cpfA.slice(-2),
        'enroll',
        'Maria Clube',
        sha256(randomToken()),
        inTwoHours(),
        null,
      ],
      'PED53',
      '2.31 enroll v2 exige versao de consentimento',
    );

    const legacyFingerprint = sha256(`pedon:cpf:legacy:${orgA}`);
    legacyCustomerId = (
      await admin.query(
        `insert into public.customers
           (organization_id, cpf_fingerprint, cpf_last2, name)
         values ($1, $2, $3, $4)
         returning id`,
        [orgA, legacyFingerprint, '90', 'Cliente Legado'],
      )
    ).rows[0].id;
    const legacyLookup = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: legacyFingerprint,
      phoneFingerprint: sha256(`pedon:phone:legacy:${orgA}`),
      last2: '90',
      mode: 'lookup',
      name: null,
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    const legacyEnroll = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: legacyFingerprint,
      phoneFingerprint: sha256(`pedon:phone:legacy:${orgA}`),
      last2: '90',
      mode: 'enroll',
      name: 'Cliente Legado',
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    ok(
      legacyLookup.found === false && legacyEnroll.found === false,
      '2.32 identidade legada sem telefone nao confirma nem pode ser reivindicada',
    );
    await expectDenied(
      anon,
      `select public.resolve_loyalty_identity_internal_v2(
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       ) as out`,
      [
        orgA,
        fpA,
        phoneFpA,
        cpfA.slice(-2),
        'lookup',
        null,
        sha256(randomToken()),
        inTwoHours(),
        null,
      ],
      '2.33 resolver v2 sem execute de anon',
    );
    const resolverPrivileges = (
      await admin.query(
        `select
           has_function_privilege(
             'service_role',
             'public.resolve_loyalty_identity_internal(uuid,text,text,text,text,text,timestamptz)',
             'EXECUTE'
           ) as legacy,
           has_function_privilege(
             'service_role',
             'public.resolve_loyalty_identity_internal_v2(uuid,text,text,text,text,text,text,timestamptz,text)',
             'EXECUTE'
           ) as current`,
      )
    ).rows[0];
    ok(
      resolverPrivileges.legacy === false && resolverPrivileges.current === true,
      '2.34 service_role executa somente o resolver v2',
    );

    scenario(3, 'consulta publica por token efemero');
    const pubA = await publicLoyaltyAccount(anon, tokenA);
    ok(pubA.found === true, '3.1 token valido encontra conta');
    ok(pubA.organization.name === 'Loyalty Org A', '3.2 nome da organizacao');
    ok(
      pubA.customer.name === 'Maria Clube' && pubA.customer.cpf_last2 === '35',
      '3.3 cliente mascarado',
    );
    ok(
      pubA.account.points_balance === '0' && pubA.account.recovery_points === '0',
      '3.4 saldo zero como texto decimal exato',
    );
    ok(Array.isArray(pubA.statement) && pubA.statement.length === 0, '3.9 extrato inicial vazio');
    const pubARepeat = await publicLoyaltyAccount(anon, tokenA);
    ok(
      pubARepeat.found === true && pubARepeat.statement.length === 0,
      '3.10 token permanece repetivel antes do checkout',
    );

    const pubMissing = await publicLoyaltyAccount(anon, randomToken());
    ok(pubMissing.found === false, '3.5 token desconhecido -> found=false');
    const pubMalformed = await publicLoyaltyAccount(anon, 'ab');
    ok(pubMalformed.found === false, '3.6 token malformado -> found=false');

    const expiredToken = randomToken();
    await admin.query(
      `insert into public.loyalty_access_tokens
        (token_hash, organization_id, membership_id, expires_at, created_at)
        values ($1, $2, $3, $4, now() - interval '2 hours')`,
      [sha256(expiredToken), orgA, enrollmentA.membership_id, new Date(Date.now() - 60000)],
    );
    const pubExpired = await publicLoyaltyAccount(anon, expiredToken);
    ok(pubExpired.found === false, '3.7 token expirado -> found=false');

    await expectError(
      admin,
      `insert into public.loyalty_access_tokens
         (token_hash, organization_id, membership_id, expires_at)
       values ($1, $2, $3, now() + interval '3 hours')`,
      [sha256(randomToken()), orgA, enrollmentA.membership_id],
      '23514',
      '3.7a token nao pode exceder TTL maximo',
    );

    const pubAuth = await publicLoyaltyAccount(ownerAS, tokenB);
    ok(pubAuth.found === true, '3.8 authenticated tambem consulta');

    scenario(4, 'checkout com Clube (token unico e retry)');
    const guestCreation = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(menuA1, singleItem(menuA1, 'Produto Barato', 1)),
    );
    const guestOrderId = await orderIdForCreation(admin, guestCreation);
    const guestOrder = (
      await admin.query('select loyalty_membership_id from public.orders where id = $1', [
        guestOrderId,
      ])
    ).rows[0];
    ok(guestOrder.loyalty_membership_id === null, '4.1 pedido guest sem vinculo Clube');

    const tokenOrder = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(tokenOrder),
      expiresAt: inTwoHours(),
    });

    const clubPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 4), {
      loyalty_token: tokenOrder,
    });
    const clubKey = randomUUID();
    const clubCreation = await checkout(anon, slugA1, clubKey, clubPayload);
    ok(clubCreation.tracking_token !== undefined, '4.2 pedido club criado');
    const clubOrderId = await orderIdForCreation(admin, clubCreation);
    const clubOrder = (
      await admin.query('select loyalty_membership_id from public.orders where id = $1', [
        clubOrderId,
      ])
    ).rows[0];
    ok(
      clubOrder.loyalty_membership_id === enrollmentA.membership_id,
      '4.3 pedido vinculado ao membro',
    );

    const tokenRowsAfter = await admin.query(
      'select count(*)::integer as count from public.loyalty_access_tokens where token_hash = $1',
      [sha256(tokenOrder)],
    );
    ok(tokenRowsAfter.rows[0].count === 0, '4.4 token consumido (uso unico)');

    const replay = await checkout(anon, slugA1, clubKey, clubPayload);
    ok(
      replay.tracking_token === clubCreation.tracking_token,
      '4.5 retry idempotente retorna a mesma criacao sem revalidar token',
    );

    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb) as out',
      [slugA1, randomUUID(), JSON.stringify(clubPayload)],
      'PED52',
      '4.6 reuso do token consumido -> PED52',
    );

    const badTokenPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 1), {
      loyalty_token: 'z'.repeat(64),
    });
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb) as out',
      [slugA1, randomUUID(), JSON.stringify(badTokenPayload)],
      'PED52',
      '4.7 token de formato invalido -> PED52',
    );

    const unknownTokenPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 1), {
      loyalty_token: randomToken(),
    });
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb) as out',
      [slugA1, randomUUID(), JSON.stringify(unknownTokenPayload)],
      'PED52',
      '4.8 token desconhecido -> PED52',
    );

    const crossTenantToken = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpB,
      last2: cpfB.slice(-2),
      mode: 'enroll',
      name: 'Cliente B',
      tokenHash: sha256(crossTenantToken),
      expiresAt: inTwoHours(),
    });
    const crossPayload = makePayload(menuB1, singleItem(menuB1, 'Produto B1', 1), {
      loyalty_token: crossTenantToken,
    });
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb) as out',
      [slugB1, randomUUID(), JSON.stringify(crossPayload)],
      'PED51',
      '4.9 programa do tenant B desabilitado -> PED51',
    );
    await setProgramEnabled(ownerBS, orgB, true);
    const orgBToken = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgB,
      fingerprint: fpC,
      last2: cpfB.slice(-2),
      mode: 'enroll',
      name: 'Cliente B2',
      tokenHash: sha256(orgBToken),
      expiresAt: inTwoHours(),
    });
    const orgBTokenPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 1), {
      loyalty_token: orgBToken,
    });
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb) as out',
      [slugA1, randomUUID(), JSON.stringify(orgBTokenPayload)],
      'PED52',
      '4.10 token de outro tenant -> PED52',
    );
    await setProgramEnabled(ownerBS, orgB, false);

    const rollbackToken = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(rollbackToken),
      expiresAt: inTwoHours(),
    });
    const invalidPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 1), {
      loyalty_token: rollbackToken,
      campo_desconhecido: true,
    });
    await expectError(
      anon,
      'select public.create_public_order($1, $2, $3::jsonb) as out',
      [slugA1, randomUUID(), JSON.stringify(invalidPayload)],
      'PED37',
      '4.11 payload estrito continua rejeitando campos desconhecidos',
    );
    const rollbackStillThere = await admin.query(
      'select count(*)::integer as count from public.loyalty_access_tokens where token_hash = $1',
      [sha256(rollbackToken)],
    );
    ok(rollbackStillThere.rows[0].count === 1, '4.12 token devolvido quando a transacao falha');
    const rollbackRetry = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 1), {
        loyalty_token: rollbackToken,
      }),
    );
    ok(rollbackRetry.tracking_token !== undefined, '4.13 token reutilizavel apos falha');

    const concurrencyToken = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(concurrencyToken),
      expiresAt: inTwoHours(),
    });
    const concurrentPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 1), {
      loyalty_token: concurrencyToken,
    });
    const concurrencyResults = await Promise.allSettled([
      checkout(anon, slugA1, randomUUID(), concurrentPayload),
      checkout(anon, slugA1, randomUUID(), concurrentPayload),
    ]);
    const successes = concurrencyResults.filter((result) => result.status === 'fulfilled');
    const rejections = concurrencyResults.filter((result) => result.status === 'rejected');
    ok(successes.length === 1, '4.14 concorrencia: exatamente um pedido usa o token');
    ok(
      rejections.length === 1 && rejections[0].reason?.code === 'PED52',
      '4.15 concorrencia: o outro consumidor recebe PED52',
    );

    // ---------------- Parte 2: earn, estorno, recovery e admin ----------------

    async function linkedOrder(fingerprint, last2, itemName, qty) {
      const token = randomToken();
      await resolveLoyalty(admin, {
        organizationId: orgA,
        fingerprint,
        last2,
        mode: 'lookup',
        name: null,
        tokenHash: sha256(token),
        expiresAt: inTwoHours(),
      });
      const payload = makePayload(menuA1, singleItem(menuA1, itemName, qty), {
        loyalty_token: token,
      });
      const creation = await checkout(anon, slugA1, randomUUID(), payload);
      return {
        token,
        creation,
        orderId: await orderIdForCreation(admin, creation),
        payload,
      };
    }

    async function payAndComplete(orderId) {
      await setPayment(ownerAS, orderId, 'paid');
      await setStatus(ownerAS, orderId, 'confirmed');
      await setStatus(ownerAS, orderId, 'preparing');
      await setStatus(ownerAS, orderId, 'ready');
      await setStatus(ownerAS, orderId, 'completed');
    }

    async function ledgerCountForOrder(orderId) {
      return (
        await admin.query(
          'select count(*)::integer as count from public.loyalty_ledger where order_id = $1',
          [orderId],
        )
      ).rows[0].count;
    }

    scenario(5, 'earn de pontos ao concluir pedido (DEC-090/DEC-091)');
    const earnOrder = await linkedOrder(fpA, cpfA.slice(-2), 'Produto Exato', 4);
    ok(earnOrder.orderId !== undefined, '5.1 pedido do Clube criado para earn');
    await payAndComplete(earnOrder.orderId);
    let earnAccount = await accountOf(admin, enrollmentA.membership_id);
    ok(earnAccount.points_balance === 32, '5.2 earn floor(32.40) = 32 pontos');
    ok((await ledgerSum(admin, enrollmentA.membership_id)) === 32, '5.3 ledger soma 32');
    const earnRows = await admin.query(
      'select entry_type, amount from public.loyalty_ledger where order_id = $1',
      [earnOrder.orderId],
    );
    ok(
      earnRows.rows.length === 1 &&
        earnRows.rows[0].entry_type === 'earn' &&
        Number(earnRows.rows[0].amount) === 32,
      '5.4 exatamente uma entrada earn de 32',
    );

    const guestComplete = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(menuA1, singleItem(menuA1, 'Produto Exato', 2)),
    );
    const guestCompleteId = await orderIdForCreation(admin, guestComplete);
    await payAndComplete(guestCompleteId);
    ok((await ledgerCountForOrder(guestCompleteId)) === 0, '5.5 guest completo nao gera ledger');

    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Promo', '0.50');
    slugA1 = (await publish(ownerAS, unitA1)).public_slug;
    menuA1 = await publicMenu(anon, slugA1);
    ok(productByName(menuA1, 'Produto Promo') !== null, '5.6 produto promo republicado');
    const promoOrder = await linkedOrder(fpA, cpfA.slice(-2), 'Produto Promo', 1);
    await payAndComplete(promoOrder.orderId);
    ok(
      (await ledgerCountForOrder(promoOrder.orderId)) === 0,
      '5.7 pedido abaixo de R$1 nao pontua',
    );
    ok(
      (await accountOf(admin, enrollmentA.membership_id)).points_balance === 32,
      '5.8 saldo inalterado pelo pedido abaixo de R$1',
    );

    const disabledOrder = await linkedOrder(fpA, cpfA.slice(-2), 'Produto Exato', 2);
    await setProgramEnabled(ownerAS, orgA, false);
    await payAndComplete(disabledOrder.orderId);
    ok(
      (await ledgerCountForOrder(disabledOrder.orderId)) === 0,
      '5.9 programa desabilitado na conclusao nao acumula',
    );
    await setProgramEnabled(ownerAS, orgA, true);
    ok(
      (await getProgramAdmin(ownerAS, orgA)).program.enabled === true,
      '5.10 programa reabilitado',
    );

    const refundedBeforeComplete = await linkedOrder(fpA, cpfA.slice(-2), 'Produto Exato', 2);
    await setPayment(ownerAS, refundedBeforeComplete.orderId, 'paid');
    await setPayment(ownerAS, refundedBeforeComplete.orderId, 'refunded');
    await setStatus(ownerAS, refundedBeforeComplete.orderId, 'confirmed');
    await setStatus(ownerAS, refundedBeforeComplete.orderId, 'preparing');
    await setStatus(ownerAS, refundedBeforeComplete.orderId, 'ready');
    await setStatus(ownerAS, refundedBeforeComplete.orderId, 'completed');
    ok(
      (await ledgerCountForOrder(refundedBeforeComplete.orderId)) === 0,
      '5.11 estornado antes de concluir nao acumula (DEC-091)',
    );
    ok(
      (await accountOf(admin, enrollmentA.membership_id)).points_balance === 32,
      '5.12 saldo segue 32',
    );

    scenario(6, 'estorno de pagamento reverte earn (DEC-091/DEC-092)');
    await setPayment(ownerAS, earnOrder.orderId, 'refunded');
    let reversalAccount = await accountOf(admin, enrollmentA.membership_id);
    ok(reversalAccount.points_balance === 0, '6.1 estorno zera o saldo');
    ok(
      (await ledgerSum(admin, enrollmentA.membership_id)) === 0,
      '6.2 ledger soma zero apos reversao',
    );
    const reversalRows = await admin.query(
      'select entry_type, amount from public.loyalty_ledger where order_id = $1 and entry_type = $2',
      [earnOrder.orderId, 'reversal'],
    );
    ok(
      reversalRows.rows.length === 1 && Number(reversalRows.rows[0].amount) === -32,
      '6.3 reversal unica de -32',
    );
    await expectError(
      ownerAS,
      'select public.set_order_payment_status($1, $2) as out',
      [earnOrder.orderId, 'refunded'],
      'PED48',
      '6.4 segundo estorno rejeitado pelo estado',
    );
    const paidOnly = await linkedOrder(fpA, cpfA.slice(-2), 'Produto Exato', 1);
    await setPayment(ownerAS, paidOnly.orderId, 'paid');
    await setPayment(ownerAS, paidOnly.orderId, 'refunded');
    ok(
      (await ledgerCountForOrder(paidOnly.orderId)) === 0,
      '6.5 estorno sem earn anterior e no-op',
    );

    scenario(7, 'recovery quita divida antes do saldo (DEC-092)');
    const cpfD = '12345678909';
    const fpD = sha256(`pedon:cpf:v1:${orgA}:${cpfD}`);
    const enrollmentD = await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpD,
      last2: cpfD.slice(-2),
      mode: 'enroll',
      name: 'Debora Divida',
      tokenHash: sha256(randomToken()),
      expiresAt: inTwoHours(),
    });
    ok(isUuid(enrollmentD.membership_id), '7.1 membro da divida criado');
    await admin.query(
      `update public.loyalty_accounts
       set points_balance = 0, recovery_points = 5, updated_at = now()
       where membership_id = $1`,
      [enrollmentD.membership_id],
    );
    const repairAccount = await accountOf(admin, enrollmentD.membership_id);
    ok(
      repairAccount.points_balance === 0 && repairAccount.recovery_points === 5,
      '7.2 divida de 5 pontos simulada via reparo',
    );
    const recoveryOrder = await linkedOrder(fpD, cpfD.slice(-2), 'Produto Exato', 1);
    await payAndComplete(recoveryOrder.orderId);
    const repaidAccount = await accountOf(admin, enrollmentD.membership_id);
    ok(
      repaidAccount.recovery_points === 0 && repaidAccount.points_balance === 3,
      '7.3 earn 8 quita a divida de 5 e compoe 3 de saldo',
    );
    const recoveryOrder2 = await linkedOrder(fpD, cpfD.slice(-2), 'Produto Exato', 1);
    await payAndComplete(recoveryOrder2.orderId);
    const afterDebt = await accountOf(admin, enrollmentD.membership_id);
    ok(
      afterDebt.points_balance === 11 && afterDebt.recovery_points === 0,
      '7.4 saldo acumula apos divida quitada',
    );
    ok(
      (await ledgerSum(admin, enrollmentD.membership_id)) === 16,
      '7.5 ledger registra os dois earns',
    );

    scenario(8, 'administracao do Clube, invariantes e RLS');
    const keepEarn = await linkedOrder(fpA, cpfA.slice(-2), 'Produto Exato', 1);
    await payAndComplete(keepEarn.orderId);
    const finalAccount = await accountOf(admin, enrollmentA.membership_id);
    ok(finalAccount.points_balance === 8, '8.1 saldo organico apos novo earn');
    const sumA = await ledgerSum(admin, enrollmentA.membership_id);
    ok(
      sumA === finalAccount.points_balance - finalAccount.recovery_points,
      '8.2 invariante sum(ledger) = balance - recovery',
    );
    const members = await getMembersAdmin(ownerAS, orgA);
    ok(members.count === 3, '8.3 tres membros listados');
    ok(members.members.length === 3, '8.4 payload sem paginacao traz todos');
    const maria = members.members.find((member) => member.cpf_last2 === '35');
    ok(maria !== undefined, '8.5 membro Maria listado');
    ok(
      exactKeys(maria, [
        'id',
        'cpf_last2',
        'name',
        'points_balance',
        'recovery_points',
        'total_earned',
        'total_redeemed',
        'total_reversed',
        'member_since',
      ]),
      '8.6 shape do membro no admin',
    );
    ok(maria.name === 'Maria Clube' && maria.cpf_last2 === '35', '8.7 nome e mascara cpf visiveis');
    ok(maria.points_balance === '8', '8.8 saldo exibido no admin como texto decimal');
    ok(
      maria.total_earned === '40' && maria.total_redeemed === '0' && maria.total_reversed === '32',
      '8.9 totais distintos de earn/redeem/reverse',
    );
    await expectError(
      managerAS,
      'select public.get_loyalty_members_admin($1, $2, $3) as out',
      [orgA, 50, null],
      'PED11',
      '8.10 manager nao lista membros',
    );
    await expectError(
      ownerAS,
      'select public.get_loyalty_members_admin($1, $2, $3) as out',
      [orgA, 0, null],
      'PED53',
      '8.11 limite zero -> PED53',
    );
    await expectError(
      ownerAS,
      'select public.get_loyalty_members_admin($1, $2, $3) as out',
      [orgA, 201, null],
      'PED53',
      '8.12 limite acima de 200 -> PED53',
    );
    const page = await getMembersAdmin(ownerAS, orgA, 2);
    ok(page.has_more === true && page.members.length === 2, '8.13 paginacao has_more');
    ok(isUuid(page.next_cursor), '8.14 next_cursor uuid');
    const page2 = await getMembersAdmin(ownerAS, orgA, 2, page.next_cursor);
    ok(page2.has_more === false && page2.members.length === 1, '8.15 paginacao completa');
    await expectDenied(
      anon,
      `insert into public.loyalty_ledger
       (organization_id, membership_id, entry_type, amount)
       values ($1, $2, $3, $4)`,
      [orgA, enrollmentA.membership_id, 'earn', 1],
      '8.16 anon nao escreve ledger',
    );
    await expectDenied(
      managerAS,
      `insert into public.customers
       (organization_id, cpf_fingerprint, cpf_last2, name)
       values ($1, $2, $3, $4)`,
      [orgA, fpD, '09', 'Invasor'],
      '8.17 staff nao escreve customers',
    );
    const grants = await admin.query(
      `select count(*)::integer as count
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = any($1::text[])
         and grantee in ('anon', 'authenticated', 'public')`,
      [
        [
          'loyalty_programs',
          'customers',
          'loyalty_memberships',
          'loyalty_accounts',
          'loyalty_ledger',
          'loyalty_access_tokens',
          'loyalty_rate_limits',
        ],
      ],
    );
    ok(grants.rows[0].count === 0, '8.18 nenhum grant de navegador nas tabelas do Clube');
    await expectError(
      admin,
      'update public.loyalty_accounts set points_balance = -1 where membership_id = $1',
      [enrollmentA.membership_id],
      '23514',
      '8.19 saldo nunca negativo (check)',
    );
    const keepDetail = (
      await ownerAS.query('select public.get_order_admin($1) as out', [keepEarn.orderId])
    ).rows[0].out;
    ok(keepDetail.loyalty?.linked === true, '8.20 admin do pedido vincula Clube');
    ok(keepDetail.loyalty?.cpf_masked === '***.***.***-35', '8.21 cpf mascarado no pedido');
    const guestDetail = (
      await ownerAS.query('select public.get_order_admin($1) as out', [guestOrderId])
    ).rows[0].out;
    ok(guestDetail.loyalty === null, '8.22 pedido guest sem bloco loyalty');

    scenario(9, 'rate limit opaco, atomico e com expiracao curta');
    const rateScope = sha256(`pedon:rate:test:${orgA}:${suffix}`);
    rateScopeHashes.push(rateScope);
    const rateBurst = (
      await admin.query(
        `select public.consume_loyalty_rate_limit_internal($1, 3, 2) as out
         from generate_series(1, 3) as attempt
         order by attempt`,
        [rateScope],
      )
    ).rows.map((row) => row.out);
    ok(
      rateBurst[0].allowed === true &&
        rateBurst[1].allowed === true &&
        rateBurst[2].allowed === false,
      '9.1 janela fixa permite ate o limite e bloqueia o excesso',
    );
    ok(
      rateBurst.map((entry) => entry.attempts).join(',') === '1,2,3' &&
        rateBurst[2].retry_after > 0,
      '9.2 contador atomico e retry_after informado',
    );
    await admin.query('select pg_sleep(3.1)');
    const rateAfterExpiry = await consumeRateLimit(admin, rateScope, 3, 2);
    ok(
      rateAfterExpiry.allowed === true && rateAfterExpiry.attempts === 1,
      '9.3 nova janela volta a permitir apos expiracao',
    );
    const expiredTokenRows = await admin.query(
      'select count(*)::integer as count from public.loyalty_access_tokens where token_hash = $1',
      [sha256(expiredToken)],
    );
    ok(expiredTokenRows.rows[0].count === 0, '9.3a rate limit coleta tokens expirados');
    const rateColumns = (
      await admin.query(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'loyalty_rate_limits'
         order by ordinal_position`,
      )
    ).rows.map((row) => row.column_name);
    ok(
      rateColumns.join(',') === 'scope_hash,bucket_start,attempts,expires_at',
      '9.4 rate limit nao armazena IP, slug, modo ou CPF',
    );
    await expectDenied(
      anon,
      'select public.consume_loyalty_rate_limit_internal($1, 3, 2) as out',
      [rateScope],
      '9.5 consumidor de rate limit e somente service_role',
    );
    await expectError(
      admin,
      'select public.consume_loyalty_rate_limit_internal($1, 0, 2) as out',
      [rateScope],
      'PED53',
      '9.6 janela invalida -> PED53',
    );

    scenario(10, 'checkout v2 e recuperacao por tentativa do cliente');
    const attemptKey = randomUUID();
    const attemptHash = sha256(`pedon:checkout:attempt:${orgA}:${suffix}`);
    const attemptPayload = makePayload(menuA1, singleItem(menuA1, 'Produto Barato', 1));
    const attemptCreation = await checkoutV2(anon, slugA1, attemptKey, attemptPayload, attemptHash);
    const recoveredAttempt = await recoverCheckout(anon, slugA1, attemptKey, attemptHash);
    const { found: attemptFound, ...recoveredCreation } = recoveredAttempt;
    ok(
      attemptFound === true &&
        JSON.stringify(recoveredCreation) === JSON.stringify(attemptCreation),
      '10.1 recuperacao retorna exatamente a resposta de criacao',
    );
    ok(
      !('id' in recoveredAttempt) &&
        !('customer_name' in recoveredAttempt) &&
        !('customer_phone' in recoveredAttempt),
      '10.2 recuperacao nao expoe IDs internos nem PII',
    );
    const wrongAttempt = await recoverCheckout(
      anon,
      slugA1,
      attemptKey,
      sha256(`pedon:checkout:wrong:${orgA}:${suffix}`),
    );
    const wrongAttemptKey = await recoverCheckout(anon, slugA1, randomUUID(), attemptHash);
    const wrongAttemptUnit = await recoverCheckout(anon, slugB1, attemptKey, attemptHash);
    ok(
      wrongAttempt.found === false &&
        wrongAttemptKey.found === false &&
        wrongAttemptUnit.found === false,
      '10.3 hash, chave ou unidade divergente retornam found=false',
    );
    const attemptReplay = await checkoutV2(anon, slugA1, attemptKey, attemptPayload, attemptHash);
    ok(
      attemptReplay.tracking_token === attemptCreation.tracking_token,
      '10.4 retry v2 preserva idempotencia do checkout existente',
    );
    await expectError(
      anon,
      'select public.create_public_order_v2($1, $2, $3::jsonb, $4) as out',
      [
        slugA1,
        attemptKey,
        JSON.stringify(attemptPayload),
        sha256(`pedon:checkout:conflict:${orgA}:${suffix}`),
      ],
      'PED42',
      '10.5 mesma criacao nao aceita outro hash de tentativa',
    );
    await expectError(
      anon,
      'select public.create_public_order_v2($1, $2, $3::jsonb, $4) as out',
      [slugA1, randomUUID(), JSON.stringify(attemptPayload), 'invalid'],
      'PED37',
      '10.6 hash de tentativa invalido -> PED37',
    );
    const malformedRecovery = await recoverCheckout(anon, slugA1, attemptKey, 'invalid');
    ok(malformedRecovery.found === false, '10.7 recovery malformado nao revela pedido');

    scenario(11, 'extrato publico limitado e deltas exatos');
    const statementTokenA = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpA,
      last2: cpfA.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(statementTokenA),
      expiresAt: inTwoHours(),
    });
    const statementA = await publicLoyaltyAccount(anon, statementTokenA);
    const earnStatement = statementA.statement.find(
      (entry) =>
        entry.order_number === earnOrder.creation.order_number && entry.entry_type === 'earn',
    );
    const reversalStatement = statementA.statement.find(
      (entry) =>
        entry.order_number === earnOrder.creation.order_number && entry.entry_type === 'reversal',
    );
    ok(
      earnStatement.gross_points === '32' &&
        earnStatement.points_delta === '32' &&
        earnStatement.recovery_delta === '0' &&
        Number(earnStatement.eligible_amount) === 32.4,
      '11.1 earn informa bruto, saldo, recovery e valor elegivel exatos',
    );
    ok(
      reversalStatement.gross_points === '32' &&
        reversalStatement.points_delta === '-32' &&
        reversalStatement.recovery_delta === '0' &&
        Number(reversalStatement.eligible_amount) === 32.4,
      '11.2 reversal informa deltas exatos e pontos brutos absolutos',
    );
    ok(
      exactKeys(earnStatement, [
        'entry_type',
        'gross_points',
        'points_delta',
        'recovery_delta',
        'eligible_amount',
        'order_number',
        'created_at',
      ]),
      '11.3 item do extrato contem somente campos publicos permitidos',
    );

    const statementTokenD = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpD,
      last2: cpfD.slice(-2),
      mode: 'lookup',
      name: null,
      tokenHash: sha256(statementTokenD),
      expiresAt: inTwoHours(),
    });
    const statementD = await publicLoyaltyAccount(anon, statementTokenD);
    const recoveryStatement = statementD.statement.find(
      (entry) => entry.order_number === recoveryOrder.creation.order_number,
    );
    ok(
      recoveryStatement.gross_points === '8' &&
        recoveryStatement.points_delta === '3' &&
        recoveryStatement.recovery_delta === '-5' &&
        Number(recoveryStatement.eligible_amount) === 8.1,
      '11.4 earn com recovery separa quitacao de divida e saldo',
    );
    ok(
      statementD.statement.every(
        (entry, index, entries) =>
          index === 0 || Date.parse(entries[index - 1].created_at) >= Date.parse(entry.created_at),
      ),
      '11.5 extrato ordenado por created_at decrescente',
    );

    await admin.query(
      `insert into public.loyalty_ledger (
         organization_id, membership_id, entry_type, amount,
         points_delta, recovery_delta, eligible_amount, created_at
       )
       select $1, $2, 'earn', 1, 1, 0, null,
              clock_timestamp() + make_interval(secs => g)
       from generate_series(1, 55) as g`,
      [orgA, enrollmentA.membership_id],
    );
    const limitedStatement = await publicLoyaltyAccount(anon, statementTokenA);
    ok(limitedStatement.statement.length === 50, '11.6 extrato limitado aos 50 mais recentes');
    ok(
      limitedStatement.statement.every(
        (entry) =>
          exactKeys(entry, [
            'entry_type',
            'gross_points',
            'points_delta',
            'recovery_delta',
            'eligible_amount',
            'order_number',
            'created_at',
          ]) &&
          !('id' in entry) &&
          !('membership_id' in entry) &&
          !('order_id' in entry),
      ),
      '11.7 limite mantem shape sem identificadores internos',
    );

    scenario(12, 'leitura desabilitada e falhas de integridade explicitas');
    const disabledReadable = await publicLoyaltyAccount(anon, orgBToken);
    ok(
      disabledReadable.found === true && Array.isArray(disabledReadable.statement),
      '12.1 token existente continua legivel com programa desabilitado',
    );
    const orgBMembershipId = (
      await admin.query(
        `delete from public.loyalty_accounts
         where membership_id = (
           select m.id
           from public.loyalty_memberships as m
           join public.customers as c
             on c.id = m.customer_id
            and c.organization_id = m.organization_id
           where m.organization_id = $1
             and c.cpf_fingerprint = $2
         )
         returning membership_id`,
        [orgB, fpC],
      )
    ).rows[0].membership_id;
    await expectError(
      anon,
      'select public.get_public_loyalty_account($1) as out',
      [orgBToken],
      'PED53',
      '12.2 token valido com conta ausente -> PED53',
    );
    await admin.query(
      `insert into public.loyalty_accounts (organization_id, membership_id)
       values ($1, $2)`,
      [orgB, orgBMembershipId],
    );

    const brokenMembershipId = (
      await admin.query(
        `insert into public.loyalty_memberships (organization_id, customer_id)
         values ($1, $2)
         returning id`,
        [orgA, legacyCustomerId],
      )
    ).rows[0].id;
    await expectError(
      ownerAS,
      'select public.get_loyalty_members_admin($1, $2, $3) as out',
      [orgA, 50, null],
      'PED53',
      '12.3 listagem admin detecta membership sem conta antes de contar',
    );
    await admin.query('delete from public.loyalty_memberships where id = $1', [brokenMembershipId]);

    console.log('');
    console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
    if (failed > 0) {
      console.log('Falhas:', failures);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERRO NA EXECUCAO: ${error.code ?? 'unexpected'}`);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    for (const client of openClients) {
      await client.end().catch(() => {});
    }
    if (rateScopeHashes.length > 0) {
      await admin
        .query('delete from public.loyalty_rate_limits where scope_hash = any($1::text[])', [
          rateScopeHashes,
        ])
        .catch(() => console.warn('cleanup rate limit warning'));
    }
    if (createdOrgIds.length > 0) {
      await admin
        .query('delete from public.loyalty_ledger where organization_id = any($1::uuid[])', [
          createdOrgIds,
        ])
        .catch(() => console.warn('cleanup ledger warning'));
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
}

run().catch((error) => {
  console.error(`ERRO NA EXECUCAO: ${error.code ?? 'unexpected'}`);
  process.exitCode = 1;
});
