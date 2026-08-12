import pg from 'pg';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { databaseConfig } from './db-test-config.mjs';

// Prompt 10: recompensas, resgates e vouchers. Cobre os cenarios numerados
// 1..118 da spec (secoes 113-129). Altera fixtures operacionais e roda
// isolada das demais regressoes de banco.
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
  console.log(`\nCenario ${number} - ${label}`);
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

async function publicLoyaltyAccount(client, token) {
  return (await client.query('select public.get_public_loyalty_account($1) as out', [token]))
    .rows[0].out;
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

// ---- Helpers do dominio de rewards ----

async function freshToken(admin, orgId, membershipId) {
  const token = randomToken();
  await admin.query(
    `insert into public.loyalty_access_tokens (token_hash, organization_id, membership_id, expires_at)
     values ($1, $2, $3, $4)`,
    [sha256(token), orgId, membershipId, inTwoHours()],
  );
  return token;
}

async function seedEarn(admin, orgId, membershipId, points) {
  await admin.query(
    `insert into public.loyalty_ledger (
       organization_id, membership_id, order_id, entry_type, amount,
       points_delta, recovery_delta, eligible_amount
     ) values ($1, $2, null, 'earn', $3, $3, 0, null)`,
    [orgId, membershipId, points],
  );
  await admin.query(
    `update public.loyalty_accounts
     set points_balance = points_balance + $2, updated_at = now()
     where membership_id = $1`,
    [membershipId, points],
  );
}

async function createReward(client, orgId, payload) {
  return (
    await client.query('select public.create_loyalty_reward($1, $2::jsonb) as out', [
      orgId,
      JSON.stringify(payload),
    ])
  ).rows[0].out;
}

async function updateReward(client, rewardId, payload) {
  return (
    await client.query('select public.update_loyalty_reward($1, $2::jsonb) as out', [
      rewardId,
      JSON.stringify(payload),
    ])
  ).rows[0].out;
}

async function setRewardActive(client, rewardId, active) {
  return (
    await client.query('select public.set_loyalty_reward_active($1, $2) as out', [rewardId, active])
  ).rows[0].out;
}

async function setRewardStock(client, rewardId, stock) {
  return (
    await client.query('select public.set_loyalty_reward_stock($1, $2) as out', [rewardId, stock])
  ).rows[0].out;
}

async function publicRewards(client, slug) {
  return (await client.query('select public.get_public_loyalty_rewards($1) as out', [slug])).rows[0]
    .out;
}

async function redeem(client, slug, key, rewardId, revision, token, secret) {
  return (
    await client.query(
      'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
      [slug, key, rewardId, revision, token, secret],
    )
  ).rows[0].out;
}

async function recoverRedemption(client, slug, key, secret) {
  return (
    await client.query('select public.get_public_redemption_by_attempt($1, $2, $3) as out', [
      slug,
      key,
      secret,
    ])
  ).rows[0].out;
}

async function staffLookup(client, unitId, code) {
  return (
    await client.query('select public.get_loyalty_voucher_staff($1, $2) as out', [unitId, code])
  ).rows[0].out;
}

async function staffConsume(client, unitId, code) {
  return (
    await client.query('select public.consume_loyalty_voucher($1, $2) as out', [unitId, code])
  ).rows[0].out;
}

async function count(client, sql, params) {
  return (await client.query(sql, params)).rows[0].count;
}

async function rewardRow(client, rewardId) {
  const row = (await client.query('select * from public.loyalty_rewards where id = $1', [rewardId]))
    .rows[0];
  if (row) {
    row.stock_quantity = Number(row.stock_quantity);
    row.points_cost = Number(row.points_cost);
  }
  return row;
}

// Revisao calculada no banco a partir da coluna full-precision
// (clock_timestamp guarda microssegundos; round-trip via Date JS
// truncaria e causaria PED56 falso).
async function currentRevision(client, rewardId) {
  return (
    await client.query(
      `select public._loyalty_reward_revision(updated_at) as rev
       from public.loyalty_rewards
       where id = $1`,
      [rewardId],
    )
  ).rows[0].rev;
}

async function stockEvents(client, rewardId) {
  return (
    await client.query(
      `select event_type, delta, balance_after
       from public.loyalty_reward_stock_events
       where reward_id = $1
       order by created_at, id`,
      [rewardId],
    )
  ).rows;
}

async function redemptionByKey(client, orgId, key) {
  return (
    await client.query(
      'select * from public.loyalty_redemptions where organization_id = $1 and idempotency_key = $2',
      [orgId, key],
    )
  ).rows[0];
}

async function voucherForRedemption(client, redemptionId) {
  return (
    await client.query('select * from public.loyalty_vouchers where redemption_id = $1', [
      redemptionId,
    ])
  ).rows[0];
}

async function voucherByCode(client, code) {
  return (
    await client.query('select * from public.loyalty_vouchers where voucher_code = $1', [code])
  ).rows[0];
}

async function voucherEventsFor(client, voucherId) {
  return (
    await client.query(
      `select event_type from public.loyalty_voucher_events
       where voucher_id = $1 order by created_at, id`,
      [voucherId],
    )
  ).rows.map((row) => row.event_type);
}

async function tokenCount(client, rawToken) {
  return count(
    client,
    'select count(*)::integer as count from public.loyalty_access_tokens where token_hash = $1',
    [sha256(rawToken)],
  );
}

function recoverySecret() {
  return sha256(`pedon:recovery:${randomUUID()}`);
}

function rewardPayload(name, cost, stock, description = null) {
  const payload = { name, points_cost: String(cost), initial_stock: String(stock) };
  if (description !== null) payload.description = description;
  return payload;
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
  const openClients = [];

  let ownerA;
  let ownerB;
  let managerA;
  let operatorA;
  let staffU;
  let ownerAS;
  let ownerBS;
  let managerAS;
  let operatorAS;
  let staffUS;
  let anon;
  let anonB;
  let orgA;
  let orgB;
  let unitA1;
  let unitA2;
  let unitA3;
  let unitB1;
  let slugA1;
  let slugA3;
  let slugB1;
  let menuA1;
  let menuB1;
  let fpA;
  let fpB;
  let fpD;
  let fpLeo;
  let fpPi;
  let fpCross;
  let cpfA;
  let maria;
  let bruno;
  let deb;
  let leo;
  let pi;
  let cross;

  // Fixtures de recompensas (populadas no cenario ADMIN AUTHZ).
  let rList1;
  let rList2;
  let rStock;
  let rInact;
  let rMain;
  let rBal;
  let rStock1;
  let rSnap;
  let rConsume;
  let rRec;
  let rLow;
  let rRefund;
  let rHigh;
  let rB1;

  // Vouchers emitidos cedo para cenas posteriores (Maria).
  let vInactiveCode;
  let vProgCode;
  let vConsCode;
  let vStaffCode;

  try {
    scenario(0, 'setup sintetico de tenants, RBAC, catalogo, Clube e publicacoes');
    ownerA = await createTestUser(admin, `reward-owner-a-${suffix}@pedon-test.invalid`);
    ownerB = await createTestUser(admin, `reward-owner-b-${suffix}@pedon-test.invalid`);
    managerA = await createTestUser(admin, `reward-manager-a-${suffix}@pedon-test.invalid`);
    operatorA = await createTestUser(admin, `reward-operator-a-${suffix}@pedon-test.invalid`);
    staffU = await createTestUser(admin, `reward-staff-u-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, ownerB.id, managerA.id, operatorA.id, staffU.id);

    ownerAS = await sessionFor(ownerA.id);
    openClients.push(ownerAS);
    ownerBS = await sessionFor(ownerB.id);
    openClients.push(ownerBS);
    managerAS = await sessionFor(managerA.id);
    openClients.push(managerAS);
    operatorAS = await sessionFor(operatorA.id);
    openClients.push(operatorAS);
    staffUS = await sessionFor(staffU.id);
    openClients.push(staffUS);
    anon = await anonClient();
    openClients.push(anon);
    anonB = await anonClient();
    openClients.push(anonB);

    orgA = (await ownerAS.query(`select public.complete_onboarding('Rewards Org A') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);
    unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;

    orgB = (await ownerBS.query(`select public.complete_onboarding('Rewards Org B') as org`))
      .rows[0].org;
    createdOrgIds.push(orgB);
    unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB],
      )
    ).rows[0].id;

    unitA2 = (
      await admin.query(
        `insert into public.units (organization_id, name)
         values ($1, 'Unidade Inativa Rewards')
         returning id`,
        [orgA],
      )
    ).rows[0].id;

    unitA3 = (
      await admin.query(
        `insert into public.units (organization_id, name)
         values ($1, 'Unidade Concorrencia Rewards')
         returning id`,
        [orgA],
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
    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'operator')`,
      [orgA, operatorA.id],
    );
    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3)`,
      [orgA, operatorA.id, unitA1],
    );
    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'operator')`,
      [orgA, staffU.id],
    );

    const categoryA1 = await createCategory(ownerAS, unitA1, 'Rewards Itens');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Exato', '8.10');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto Barato', '1.00');
    await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto 20', '20.00');
    await saveConfig(ownerAS, unitA1, operationalConfig());
    slugA1 = (await publish(ownerAS, unitA1)).public_slug;
    menuA1 = await publicMenu(anon, slugA1);

    const categoryA3 = await createCategory(ownerAS, unitA3, 'Rewards Concorrencia');
    await createProduct(ownerAS, unitA3, categoryA3.id, 'Produto Concorrencia', '1.00');
    await saveConfig(ownerAS, unitA3, operationalConfig());
    slugA3 = (await publish(ownerAS, unitA3)).public_slug;

    const categoryB1 = await createCategory(ownerBS, unitB1, 'Rewards B1');
    await createProduct(ownerBS, unitB1, categoryB1.id, 'Produto B1', '6.00');
    await saveConfig(ownerBS, unitB1, operationalConfig());
    slugB1 = (await publish(ownerBS, unitB1)).public_slug;
    menuB1 = await publicMenu(anon, slugB1);

    ok(menuA1.found === true && menuA1.operation.can_order_now === true, '0.1 menu A publicado');
    ok(productByName(menuA1, 'Produto 20') !== null, '0.2 item de earn encontrado');
    ok(menuB1.found === true, '0.3 menu B publicado');
    ok(slugA3 !== slugA1, '0.3a segundo slug da org A publicado');

    const enableA = await ownerAS.query(
      'select public.set_loyalty_program_enabled($1, true) as out',
      [orgA],
    );
    ok(enableA.rows[0].out.program.enabled === true, '0.4 programa A habilitado');
    const enableB = await ownerBS.query(
      'select public.set_loyalty_program_enabled($1, true) as out',
      [orgB],
    );
    ok(enableB.rows[0].out.program.enabled === true, '0.5 programa B habilitado');

    async function enroll(orgId, fingerprint, last2, name) {
      const result = await resolveLoyalty(admin, {
        organizationId: orgId,
        fingerprint,
        last2,
        mode: 'enroll',
        name,
        tokenHash: sha256(randomToken()),
        expiresAt: inTwoHours(),
        consentVersion: 'rewards-consent-v1',
      });
      ok(isUuid(result.membership_id), `setup enroll ${name}`);
      return result.membership_id;
    }

    cpfA = '11144477735';
    fpA = sha256(`pedon:cpf:v1:${orgA}:${cpfA}`);
    const cpfB = '52998224725';
    fpB = sha256(`pedon:cpf:v1:${orgA}:${cpfB}`);
    const cpfD = '12345678909';
    fpD = sha256(`pedon:cpf:v1:${orgA}:${cpfD}`);
    fpLeo = sha256(`pedon:cpf:v1:${orgA}:cpf-leo`);
    fpPi = sha256(`pedon:cpf:v1:${orgA}:cpf-pi`);
    fpCross = sha256(`pedon:cpf:v1:${orgB}:cpf-cross`);

    maria = await enroll(orgA, fpA, cpfA.slice(-2), 'Maria Rewards');
    bruno = await enroll(orgA, fpB, cpfB.slice(-2), 'Bruno Rewards');
    deb = await enroll(orgA, fpD, cpfD.slice(-2), 'Debora Rewards');
    leo = await enroll(orgA, fpLeo, '47', 'Leo Rewards');
    pi = await enroll(orgA, fpPi, '51', 'Pipa Rewards');
    cross = await enroll(orgB, fpCross, '25', 'Cross Rewards');
    ok(maria && bruno && deb && leo && pi && cross, '0.6 membros inscritos');

    scenario(1, 'SCHEMA - tabelas, RLS, ledger e tipos (113)');
    const tables = [
      'loyalty_rewards',
      'loyalty_redemptions',
      'loyalty_vouchers',
      'loyalty_reward_stock_events',
      'loyalty_voucher_events',
    ];
    for (const table of tables) {
      const exists = (await admin.query('select to_regclass($1) as reg', [`public.${table}`]))
        .rows[0].reg;
      ok(exists !== null, `1. ${table} existe`);
    }
    const rlsRows = await admin.query(
      `select relname, relrowsecurity
       from pg_class
       where relname = any($1::text[])`,
      [tables],
    );
    ok(
      rlsRows.rows.length === 5 && rlsRows.rows.every((row) => row.relrowsecurity === true),
      '6. RLS ON em todas as tabelas novas',
    );
    const entryTypeDef = (
      await admin.query(
        `select pg_get_constraintdef(c.oid) as def
         from pg_constraint as c
         join pg_class as t on t.oid = c.conrelid
         where t.relname = 'loyalty_ledger'
           and c.conname = 'loyalty_ledger_entry_type_check'`,
      )
    ).rows[0]?.def;
    ok(
      entryTypeDef !== undefined && entryTypeDef.includes('redeem'),
      '7. ledger admite entry_type redeem',
    );
    const costType = (
      await admin.query(
        `select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'loyalty_rewards'
           and column_name = 'points_cost'`,
      )
    ).rows[0];
    ok(costType.data_type === 'bigint', '8. points_cost e bigint');
    const stockCol = (
      await admin.query(
        `select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'loyalty_rewards'
           and column_name = 'stock_quantity'`,
      )
    ).rows[0];
    ok(stockCol.data_type === 'bigint', '9a. stock_quantity e bigint');
    const stockCheck = (
      await admin.query(
        `select count(*)::integer as count from pg_constraint as c
         join pg_class as t on t.oid = c.conrelid
         where t.relname = 'loyalty_rewards'
           and c.conname = 'loyalty_rewards_stock_quantity_check'`,
      )
    ).rows[0];
    ok(stockCheck.count === 1, '9b. stock_quantity tem check de nao-negativo');
    const codeUnique = (
      await admin.query(
        `select count(*)::integer as count from pg_indexes
         where indexname = 'loyalty_vouchers_voucher_code_key'`,
      )
    ).rows[0];
    ok(codeUnique.count === 1, '10. voucher_code unique global');

    scenario(2, 'ACL - browser nao acessa tabelas nem RPCs restritas (114)');
    for (const table of tables) {
      await expectDenied(anon, `select * from public.${table}`, [], `11. anon nao le ${table}`);
      await expectDenied(ownerAS, `select * from public.${table}`, [], `12. auth nao le ${table}`);
      await expectDenied(
        ownerAS,
        `delete from public.${table}`,
        [],
        `12a. auth nao deleta ${table}`,
      );
    }
    await expectDenied(
      anon,
      `insert into public.loyalty_rewards
       (organization_id, name, points_cost, stock_quantity, sort_order)
       values ($1, 'X', 1, 1, 1)`,
      [orgA],
      '12b. anon nao escreve rewards',
    );
    await expectDenied(
      ownerAS,
      `insert into public.loyalty_rewards
       (organization_id, name, points_cost, stock_quantity, sort_order)
       values ($1, 'X', 1, 1, 1)`,
      [orgA],
      '12c. auth nao escreve rewards',
    );
    await expectDenied(
      ownerAS,
      `insert into public.loyalty_redemptions
       (organization_id, membership_id, reward_id, idempotency_key, request_hash,
        recovery_hash, reward_name_snapshot, points_cost, reward_revision)
       values ($1, $2, $3, $4, $5, $5, 'X', 1, '2026-01-01T00:00:00.000000Z')`,
      [orgA, maria, rMain ?? randomUUID(), randomUUID(), sha256('x')],
      '13. auth nao insere redemption',
    );
    await expectDenied(
      ownerAS,
      `insert into public.loyalty_ledger
       (organization_id, membership_id, entry_type, amount, points_delta, recovery_delta)
       values ($1, $2, 'redeem', -1, -1, 0)`,
      [orgA, maria],
      '14. auth nao insere ledger redeem',
    );
    await expectDenied(
      ownerAS,
      'update public.loyalty_rewards set stock_quantity = 5 where id = $1',
      [rStock1 ?? randomUUID()],
      '15. auth nao altera estoque direto',
    );
    await expectDenied(
      ownerAS,
      'update public.loyalty_vouchers set status = $1',
      ['consumed'],
      '16. auth nao altera voucher direto',
    );
    await expectDenied(
      anon,
      'select * from public.loyalty_vouchers',
      [],
      '17. anon nao le vouchers',
    );
    await expectDenied(
      ownerAS,
      'select * from public.loyalty_vouchers',
      [],
      '18. auth nao le vouchers',
    );
    const publicListOk = await publicRewards(anon, slugA1);
    ok(publicListOk.found === true, '19. anon consulta catalogo publico de rewards');
    await expectDenied(
      anon,
      'select public.get_loyalty_rewards_admin($1, $2, $3) as out',
      [orgA, 50, null],
      '20. anon sem execute do admin rewards',
    );

    scenario(3, 'ADMIN AUTHZ - Reward management owner-only (115)');
    rList1 = await createReward(ownerAS, orgA, rewardPayload('Lista Um', 10, 3, 'Lista um desc'));
    ok(rList1.id !== undefined && isUuid(rList1.id), '21. owner cria reward');
    ok(
      rList1.points_cost === '10' && rList1.stock_quantity === '3',
      '21a. custo/estoque como string',
    );
    rList2 = await createReward(ownerAS, orgA, rewardPayload('Lista Dois', 20, 0));
    rStock = await createReward(ownerAS, orgA, rewardPayload('Estoque Admin', 5, 10));
    rInact = await createReward(ownerAS, orgA, rewardPayload('Inativa', 50, 5));
    rMain = await createReward(ownerAS, orgA, rewardPayload('Resgate Principal', 30, 10));
    rBal = await createReward(ownerAS, orgA, rewardPayload('Balanca 100', 100, 5));
    rStock1 = await createReward(ownerAS, orgA, rewardPayload('Estoque Unico', 10, 1));
    rSnap = await createReward(ownerAS, orgA, rewardPayload('Snap A', 100, 5));
    rConsume = await createReward(ownerAS, orgA, rewardPayload('Consumo', 10, 50));
    rRec = await createReward(ownerAS, orgA, rewardPayload('Recupera', 30, 5));
    rLow = await createReward(ownerAS, orgA, rewardPayload('Baixo', 100, 5));
    rRefund = await createReward(ownerAS, orgA, rewardPayload('Estorno', 100, 5));
    rHigh = await createReward(ownerAS, orgA, rewardPayload('Alto', 150, 1));
    const rDup = await createReward(ownerAS, orgA, rewardPayload('Duplicado', 10, 1));
    ok(rDup.id !== undefined, '21b. reward duplicavel em nome unico criado');
    rB1 = await createReward(ownerBS, orgB, rewardPayload('Reward B', 10, 5));

    // Vouchers emitidos cedo (Maria com 500 pts) para cenas posteriores:
    // V_inactive (reward sera desativada), V_prog (programa sera desabilitado),
    // V_cons (consumo), V_staff (operacao de unidade). Todos criados enquanto
    // reward e programa ainda estao ativos.
    await seedEarn(admin, orgA, maria, 500);
    const earlySecret = recoverySecret();
    const earlyRedeems = [
      { rewardId: rInact.id, name: 'inactive' },
      { rewardId: rConsume.id, name: 'prog' },
      { rewardId: rConsume.id, name: 'cons' },
      { rewardId: rConsume.id, name: 'staff' },
    ];
    for (const item of earlyRedeems) {
      const revision = await currentRevision(admin, item.rewardId);
      const key = randomUUID();
      const token = await freshToken(admin, orgA, maria);
      await redeem(anon, slugA1, key, item.rewardId, revision, token, earlySecret);
      const redemption = await redemptionByKey(admin, orgA, key);
      const voucher = redemption ? await voucherForRedemption(admin, redemption.id) : null;
      if (item.name === 'inactive') vInactiveCode = voucher?.voucher_code;
      if (item.name === 'prog') vProgCode = voucher?.voucher_code;
      if (item.name === 'cons') vConsCode = voucher?.voucher_code;
      if (item.name === 'staff') vStaffCode = voucher?.voucher_code;
    }
    ok(
      vInactiveCode && vProgCode && vConsCode && vStaffCode,
      '3b. vouchers de apoio emitidos enquanto reward/programa ativos',
    );

    await expectError(
      managerAS,
      'select public.create_loyalty_reward($1, $2::jsonb) as out',
      [orgA, JSON.stringify(rewardPayload('Manager', 10, 1))],
      'PED11',
      '22. manager nao cria reward',
    );
    await expectError(
      operatorAS,
      'select public.create_loyalty_reward($1, $2::jsonb) as out',
      [orgA, JSON.stringify(rewardPayload('Operator', 10, 1))],
      'PED11',
      '23. operator nao cria reward',
    );
    const updated = await updateReward(ownerAS, rMain.id, { name: 'Resgate Principal v2' });
    ok(updated.name === 'Resgate Principal v2', '24. owner atualiza reward');
    ok(
      updated.revision !== rMain.revision && updated.revision !== undefined,
      '24a. revision muda apos update',
    );
    const toggled = await setRewardActive(ownerAS, rInact.id, false);
    ok(toggled.is_active === false, '25. owner desativa reward');

    // DELETE nao faz parte do contrato. A remocao operacional e exclusivamente
    // set_loyalty_reward_active(false), preservando todos os artefatos historicos.
    await expectDenied(
      anon,
      'delete from public.loyalty_rewards where id = $1',
      [rInact.id],
      '25a. anon DELETE direto em rewards e negado',
    );
    await expectDenied(
      managerAS,
      'delete from public.loyalty_rewards where id = $1',
      [rInact.id],
      '25b. authenticated DELETE direto em rewards e negado',
    );
    await expectDenied(
      ownerAS,
      'delete from public.loyalty_rewards where id = $1',
      [rInact.id],
      '25c. owner DELETE direto em rewards e negado',
    );
    const deleteRewardRpcCount = await count(
      admin,
      `select count(*)::integer as count
       from pg_proc as p
       join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'delete_loyalty_reward'`,
      [],
    );
    ok(deleteRewardRpcCount === 0, '25d. RPC delete_loyalty_reward nao existe');

    const inactiveReward = await rewardRow(admin, rInact.id);
    ok(
      inactiveReward?.id === rInact.id && inactiveReward.is_active === false,
      '25e. reward desativada permanece fisicamente no banco',
    );
    await expectError(
      anon,
      'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
      [
        slugA1,
        randomUUID(),
        rInact.id,
        await currentRevision(admin, rInact.id),
        await freshToken(admin, orgA, maria),
        recoverySecret(),
      ],
      'PED55',
      '25f. reward desativada rejeita novo resgate',
    );

    const inactiveVoucher = await voucherByCode(admin, vInactiveCode);
    const inactiveRedemption = (
      await admin.query('select * from public.loyalty_redemptions where id = $1', [
        inactiveVoucher.redemption_id,
      ])
    ).rows[0];
    ok(
      inactiveRedemption?.reward_id === rInact.id,
      '25g. redemption historico continua apontando para reward',
    );
    const inactiveVoucherLookup = await staffLookup(ownerAS, unitA1, vInactiveCode);
    ok(
      inactiveVoucher.status === 'issued' && inactiveVoucherLookup.found === true,
      '25h. voucher emitido continua valido apos reward inactive',
    );

    const inactiveStockEvents = await stockEvents(admin, rInact.id);
    ok(
      inactiveStockEvents.some((event) => event.event_type === 'initial') &&
        inactiveStockEvents.some((event) => event.event_type === 'redemption') &&
        inactiveStockEvents.reduce((total, event) => total + Number(event.delta), 0) ===
          inactiveReward.stock_quantity,
      '25i. stock events permanecem integros apos desativacao',
    );

    const reactivated = await setRewardActive(ownerAS, rInact.id, true);
    const reactivatedRedemption = (
      await admin.query('select * from public.loyalty_redemptions where id = $1', [
        inactiveRedemption.id,
      ])
    ).rows[0];
    ok(
      reactivated.id === rInact.id &&
        reactivated.is_active === true &&
        reactivatedRedemption.reward_id === rInact.id &&
        (await voucherByCode(admin, vInactiveCode)).reward_id === rInact.id &&
        JSON.stringify(await stockEvents(admin, rInact.id)) === JSON.stringify(inactiveStockEvents),
      '25j. reward reativada preserva identidade e historico',
    );
    await setRewardActive(ownerAS, rInact.id, false);

    const adjusted = await setRewardStock(ownerAS, rStock.id, 20);
    ok(adjusted.stock_quantity === '20', '26. owner ajusta estoque');
    await expectError(
      managerAS,
      'select public.set_loyalty_reward_stock($1, $2) as out',
      [rStock.id, 10],
      'PED11',
      '27. manager nao ajusta estoque',
    );
    for (const [client, role] of [
      [managerAS, 'manager'],
      [operatorAS, 'operator'],
    ]) {
      await expectError(
        client,
        'select public.get_loyalty_rewards_admin($1, $2, $3) as out',
        [orgA, 50, null],
        'PED11',
        `27a. ${role} nao lista rewards admin`,
      );
      await expectError(
        client,
        'select public.update_loyalty_reward($1, $2::jsonb) as out',
        [rMain.id, JSON.stringify({ description: `${role} denied` })],
        'PED11',
        `27b. ${role} nao atualiza reward`,
      );
      await expectError(
        client,
        'select public.set_loyalty_reward_active($1, $2) as out',
        [rMain.id, false],
        'PED11',
        `27c. ${role} nao ativa/desativa reward`,
      );
      await expectError(
        client,
        'select public.set_loyalty_reward_stock($1, $2) as out',
        [rMain.id, 1],
        'PED11',
        `27d. ${role} nao ajusta estoque`,
      );
    }
    await expectError(
      ownerBS,
      'select public.create_loyalty_reward($1, $2::jsonb) as out',
      [orgA, JSON.stringify(rewardPayload('Cross Tenancy', 10, 1))],
      'PED11',
      '28. owner de outro tenant nao cria no orgA',
    );
    await expectError(
      ownerAS,
      'select public.create_loyalty_reward($1, $2::jsonb) as out',
      [orgA, JSON.stringify(rewardPayload('Duplicado', 99, 1))],
      'PED65',
      '29. nome duplicado case-insensitive -> PED65',
    );
    await expectError(
      ownerAS,
      'select public.create_loyalty_reward($1, $2::jsonb) as out',
      [orgA, JSON.stringify(rewardPayload('Custo Ruim', 'abc', 1))],
      'PED63',
      '30. custo invalido -> PED63',
    );
    await expectError(
      ownerAS,
      'select public.create_loyalty_reward($1, $2::jsonb) as out',
      [orgA, JSON.stringify(rewardPayload('Estoque Ruim', 10, '-5'))],
      'PED63',
      '31. estoque invalido no create -> PED63',
    );
    await expectError(
      ownerAS,
      'select public.set_loyalty_reward_stock($1, $2) as out',
      [rStock.id, -1],
      'PED66',
      '31a. estoque negativo no adjust -> PED66',
    );

    scenario(4, 'STOCK AUDIT - trilha append-only de estoque (116)');
    const initialEvents = await stockEvents(admin, rStock.id);
    ok(
      initialEvents.some((event) => event.event_type === 'initial' && Number(event.delta) === 10),
      '32. create stock 10 gera evento +10',
    );
    await setRewardStock(ownerAS, rStock.id, 20);
    await setRewardStock(ownerAS, rStock.id, 5);
    const eventsAfter = await stockEvents(admin, rStock.id);
    const deltas = eventsAfter.map((event) => Number(event.delta));
    ok(deltas.includes(10) && deltas.includes(-15), '33. adjust 10->20 gera +10');
    ok(deltas.filter((delta) => delta === -15).length === 1, '34. adjust 20->5 gera -15');
    await expectError(
      admin,
      'update public.loyalty_rewards set stock_quantity = -1 where id = $1',
      [rStock.id],
      '23514',
      '35. estoque nunca negativo (check)',
    );
    const stockNow = (await rewardRow(admin, rStock.id)).stock_quantity;
    const sumDelta = eventsAfter.reduce((total, event) => total + Number(event.delta), 0);
    ok(sumDelta === stockNow, '36. sum(events.delta) reconcilia com estoque atual');
    const countBeforeNoop = eventsAfter.length;
    await setRewardStock(ownerAS, rStock.id, 5);
    ok(
      (await stockEvents(admin, rStock.id)).length === countBeforeNoop,
      '37. no-op nao duplica evento',
    );
    const stockGrants = await admin.query(
      `select count(*)::integer as count
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = any($1::text[])
         and grantee in ('anon', 'authenticated', 'public')`,
      [tables],
    );
    ok(stockGrants.rows[0].count === 0, '38. tabelas novas sem grants de browser');
    await expectDenied(
      anon,
      'update public.loyalty_reward_stock_events set delta = 0 where reward_id = $1',
      [rStock.id],
      '39. browser nao atualiza evento de estoque',
    );
    await expectDenied(
      anon,
      'delete from public.loyalty_reward_stock_events where reward_id = $1',
      [rStock.id],
      '39a. browser nao apaga evento de estoque',
    );

    scenario(5, 'PUBLIC LIST - catalogo publico (117)');
    const list = await publicRewards(anon, slugA1);
    ok(list.found === true && list.loyalty_enabled === true, '40a. catalogo disponivel');
    const listOne = list.rewards.find((item) => item.id === rList1.id);
    const listTwo = list.rewards.find((item) => item.id === rList2.id);
    ok(
      listOne !== undefined && listOne.available === true,
      '40. ativa + stock>0 -> available true',
    );
    ok(listTwo !== undefined && listTwo.available === false, '41. stock 0 -> available false');
    const inactiveItem = list.rewards.find((item) => item.id === rInact.id);
    ok(inactiveItem === undefined, '42. reward inativa excluida do catalogo');
    ok(
      exactKeys(listOne, ['id', 'name', 'description', 'points_cost', 'available', 'revision']),
      '43. shape publico sem estoque exato',
    );
    ok(
      !('stock_quantity' in listOne) &&
        !('organization_id' in listOne) &&
        !('sort_order' in listOne) &&
        !('updated_at' in listOne) &&
        !('created_at' in listOne),
      '44. org_id / sort / timestamps internos nao expostos',
    );
    const badSlug = await publicRewards(anon, 'f'.repeat(24));
    ok(badSlug.found === false, '45. slug inexistente -> found=false');
    const malformedSlug = await publicRewards(anon, 'short');
    ok(malformedSlug.found === false, '45a. slug malformado -> found=false');
    await ownerBS.query('select public.set_loyalty_program_enabled($1, false) as out', [orgB]);
    const bDisabled = await publicRewards(anon, slugB1);
    ok(
      bDisabled.found === true &&
        bDisabled.loyalty_enabled === false &&
        Array.isArray(bDisabled.rewards) &&
        bDisabled.rewards.length === 0,
      '46. programa disabled -> loyalty_enabled=false e rewards=[]',
    );
    await ownerBS.query('select public.set_loyalty_program_enabled($1, true) as out', [orgB]);
    const revisionFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
    ok(
      listOne.revision !== undefined && revisionFormat.test(listOne.revision),
      '47. reward revision exposta no formato canonico',
    );
    ok(
      list.rewards[0].id === rList1.id && list.rewards[1].id === rList2.id,
      '48. ordenacao deterministica por sort_order',
    );
    const bList = await publicRewards(anon, slugB1);
    ok(
      bList.rewards.some((item) => item.id === rB1.id),
      '48a. tenant B isolado no catalogo',
    );

    scenario(6, 'REDEMPTION BASIC - transacao completa (118)');
    const rMainRevision = await currentRevision(admin, rMain.id);
    const keyBasic = randomUUID();
    const tokenBasic = await freshToken(admin, orgA, maria);
    const secretBasic = recoverySecret();
    const balanceBeforeBasic = (await accountOf(admin, maria)).points_balance;
    const stockBeforeBasic = (await rewardRow(admin, rMain.id)).stock_quantity;
    const basic = await redeem(
      anon,
      slugA1,
      keyBasic,
      rMain.id,
      rMainRevision,
      tokenBasic,
      secretBasic,
    );
    ok(basic.found === true, '49. token + saldo + estoque -> resgate passa');
    const redemptionBasic = await redemptionByKey(admin, orgA, keyBasic);
    ok(isUuid(redemptionBasic?.id), '52. redemption criada');
    const balanceAfterBasic = (await accountOf(admin, maria)).points_balance;
    ok(balanceBeforeBasic - balanceAfterBasic === 30, '50. conta debitada em 30');
    const redeemLedger = await admin.query(
      'select * from public.loyalty_ledger where redemption_id = $1',
      [redemptionBasic.id],
    );
    ok(
      redeemLedger.rows.length === 1 &&
        redeemLedger.rows[0].entry_type === 'redeem' &&
        Number(redeemLedger.rows[0].amount) === -30 &&
        Number(redeemLedger.rows[0].points_delta) === -30 &&
        Number(redeemLedger.rows[0].recovery_delta) === 0,
      '51. ledger redeem -30 sem recovery',
    );
    const stockAfterBasic = (await rewardRow(admin, rMain.id)).stock_quantity;
    ok(stockBeforeBasic - stockAfterBasic === 1, '53. estoque -1');
    const basicEvents = await stockEvents(admin, rMain.id);
    ok(
      basicEvents.some(
        (event) =>
          event.event_type === 'redemption' &&
          Number(event.delta) === -1 &&
          Number(event.balance_after) === stockAfterBasic,
      ),
      '54. stock event -1 com balance_after',
    );
    const voucherBasic = await voucherForRedemption(admin, redemptionBasic.id);
    ok(voucherBasic?.voucher_code !== undefined, '55. voucher criado');
    ok(/^[0-9A-F]{16}$/.test(voucherBasic.voucher_code), '55a. codigo 16 hex uppercase');
    const basicEventsArr = await voucherEventsFor(admin, voucherBasic.id);
    ok(
      JSON.stringify(basicEventsArr) === JSON.stringify(['issued']),
      '56. evento issued registrado',
    );
    const integrityRedemptions = await admin.query(
      `insert into public.loyalty_redemptions (
         organization_id, membership_id, reward_id, idempotency_key,
         request_hash, recovery_hash, reward_name_snapshot, points_cost, reward_revision
       ) values
         ($1, $2, $3, $4, $5, $6, 'Integridade Voucher', 1, $7),
         ($1, $2, $3, $8, $9, $10, 'Integridade Ledger', 1, $7)
       returning id`,
      [
        orgA,
        maria,
        rMain.id,
        randomUUID(),
        sha256(`integrity-voucher-request:${randomUUID()}`),
        sha256(`integrity-voucher-recovery:${randomUUID()}`),
        await currentRevision(admin, rMain.id),
        randomUUID(),
        sha256(`integrity-ledger-request:${randomUUID()}`),
        sha256(`integrity-ledger-recovery:${randomUUID()}`),
      ],
    );
    await expectError(
      admin,
      `insert into public.loyalty_vouchers (
         organization_id, redemption_id, membership_id, reward_id, voucher_code
       ) values ($1, $2, $3, $4, $5)`,
      [
        orgA,
        integrityRedemptions.rows[0].id,
        bruno,
        rMain.id,
        randomBytes(8).toString('hex').toUpperCase(),
      ],
      '23503',
      '56a. voucher nao pode divergir da membership da redemption',
    );
    await expectError(
      admin,
      `insert into public.loyalty_vouchers (
         organization_id, redemption_id, membership_id, reward_id, voucher_code
       ) values ($1, $2, $3, $4, $5)`,
      [
        orgA,
        integrityRedemptions.rows[0].id,
        maria,
        rConsume.id,
        randomBytes(8).toString('hex').toUpperCase(),
      ],
      '23503',
      '56aa. voucher nao pode divergir da reward da redemption',
    );
    await expectError(
      admin,
      `insert into public.loyalty_reward_stock_events (
         organization_id, reward_id, redemption_id, delta, balance_after, event_type
       ) values ($1, $2, $3, -1, 0, 'redemption')`,
      [orgA, rConsume.id, integrityRedemptions.rows[0].id],
      '23503',
      '56b. stock event nao pode divergir da reward da redemption',
    );
    await expectError(
      admin,
      `insert into public.loyalty_ledger (
         organization_id, membership_id, entry_type, amount, points_delta,
         recovery_delta, redemption_id
       ) values ($1, $2, 'redeem', -1, -1, 0, $3)`,
      [orgA, bruno, integrityRedemptions.rows[1].id],
      '23503',
      '56c. ledger redeem nao pode divergir da membership da redemption',
    );
    await expectError(
      admin,
      `insert into public.loyalty_reward_stock_events (
         organization_id, reward_id, redemption_id, delta, balance_after, event_type
       ) values ($1, $2, $3, -1, 0, 'redemption')`,
      [orgA, rMain.id, redemptionBasic.id],
      '23505',
      '56d. uma redemption nao pode gerar segundo stock event',
    );
    ok((await tokenCount(admin, tokenBasic)) === 0, '57. token consumido (deletado)');
    const afterBasicPub = await publicLoyaltyAccount(anon, tokenBasic);
    ok(afterBasicPub.found === false, '57a. token consumido nao consulta mais (P47)');
    ok(
      redemptionBasic.id !== undefined &&
        redeemLedger.rows.length === 1 &&
        voucherBasic.id !== undefined &&
        stockAfterBasic === stockBeforeBasic - 1 &&
        balanceAfterBasic === balanceBeforeBasic - 30,
      '58. tudo na mesma transacao (artefatos consistentes)',
    );
    const programAfterRedeem = (
      await ownerAS.query('select public.get_loyalty_program_admin($1) as out', [orgA])
    ).rows[0].out;
    const membersAfterRedeem = (
      await ownerAS.query('select public.get_loyalty_members_admin($1, $2, $3) as out', [
        orgA,
        200,
        null,
      ])
    ).rows[0].out;
    const mariaAfterRedeem = membersAfterRedeem.members.find((member) => member.id === maria);
    ok(
      BigInt(programAfterRedeem.stats.total_redeemed) >= 30n &&
        programAfterRedeem.stats.total_reversed === '0' &&
        BigInt(mariaAfterRedeem.total_redeemed) >= 30n &&
        mariaAfterRedeem.total_reversed === '0',
      '58aa. redeem nao e contabilizado como reversal administrativo',
    );
    const redemptionRecovered = await recoverRedemption(anon, slugA1, keyBasic, secretBasic);
    ok(redemptionRecovered.found === true, '58a. recovery RPC encontra tentativa');
    ok(
      exactKeys(redemptionRecovered.redemption, ['reward_name', 'points_cost', 'created_at']) &&
        exactKeys(redemptionRecovered.voucher, ['code', 'status', 'issued_at']),
      '58b. shape da resposta de recovery sem IDs internos',
    );
    ok(
      redemptionRecovered.redemption.reward_name === 'Resgate Principal v2' &&
        redemptionRecovered.redemption.points_cost === '30',
      '58c. snapshot do resgate preserva nome/custo',
    );
    const wrongSecret = await recoverRedemption(anon, slugA1, keyBasic, recoverySecret());
    const missingSecret = await recoverRedemption(anon, slugA1, keyBasic, null);
    const wrongKey = await recoverRedemption(anon, slugA1, randomUUID(), secretBasic);
    const wrongSlug = await recoverRedemption(anon, slugB1, keyBasic, secretBasic);
    ok(
      wrongSecret.found === false &&
        missingSecret.found === false &&
        wrongKey.found === false &&
        wrongSlug.found === false &&
        !JSON.stringify([wrongSecret, missingSecret, wrongKey, wrongSlug]).includes(
          redemptionRecovered.voucher.code,
        ),
      '58d. recovery sem secret ou com secret/chave/slug divergente nao revela voucher',
    );
    const redeemStatement =
      afterBasicPub.found === false
        ? await publicLoyaltyAccount(anon, await freshToken(admin, orgA, maria))
        : null;
    if (redeemStatement) {
      const redeemEntry = redeemStatement.statement.find(
        (entry) => entry.entry_type === 'redeem' && entry.points_delta === '-30',
      );
      ok(
        redeemEntry !== undefined &&
          redeemEntry.gross_points === '30' &&
          redeemEntry.recovery_delta === '0' &&
          redeemEntry.eligible_amount === null &&
          redeemEntry.order_number === null,
        '58e. extrato publico exibe redeem com deltas exatos',
      );
    }

    scenario(7, 'ATOMIC FAILURE - falha integral sem efeitos parciais (119)');
    const countRedemptions = await count(
      admin,
      'select count(*)::integer as count from public.loyalty_redemptions where organization_id = $1',
      [orgA],
    );
    const countLedgerMaria = await count(
      admin,
      'select count(*)::integer as count from public.loyalty_ledger where membership_id = $1',
      [maria],
    );
    const countVouchers = await count(
      admin,
      'select count(*)::integer as count from public.loyalty_vouchers where organization_id = $1',
      [orgA],
    );

    async function freshAttempt(token, rewardId) {
      return {
        key: randomUUID(),
        token,
        rewardId,
        revision: await currentRevision(admin, rewardId),
        secret: recoverySecret(),
      };
    }

    async function assertAtomicFailure(params, expectedCode, label) {
      const stockBefore = (await rewardRow(admin, params.rewardId)).stock_quantity;
      const eventsBefore = (await stockEvents(admin, params.rewardId)).length;
      await expectError(
        anon,
        'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
        [slugA1, params.key, params.rewardId, params.revision, params.token, params.secret],
        expectedCode,
        label,
      );
      ok(
        (await count(
          admin,
          'select count(*)::integer as count from public.loyalty_redemptions where organization_id = $1',
          [orgA],
        )) === countRedemptions,
        `${label} (redemption count inalterado)`,
      );
      ok(
        (await count(
          admin,
          'select count(*)::integer as count from public.loyalty_ledger where membership_id = $1',
          [maria],
        )) === countLedgerMaria,
        `${label} (ledger inalterado)`,
      );
      ok(
        (await count(
          admin,
          'select count(*)::integer as count from public.loyalty_vouchers where organization_id = $1',
          [orgA],
        )) === countVouchers,
        `${label} (vouchers inalterados)`,
      );
      ok(
        (await rewardRow(admin, params.rewardId)).stock_quantity === stockBefore &&
          (await stockEvents(admin, params.rewardId)).length === eventsBefore,
        `${label} (estoque e eventos inalterados)`,
      );
      ok(
        (await tokenCount(admin, params.token)) === (params.tokenPresent === false ? 0 : 1),
        `${label} (token preservado/inalterado)`,
      );
    }

    await admin.query(
      'update public.loyalty_accounts set points_balance = 10 where membership_id = $1',
      [maria],
    );
    await assertAtomicFailure(
      await freshAttempt(await freshToken(admin, orgA, maria), rBal.id),
      'PED58',
      '59. saldo insuficiente',
    );
    await admin.query(
      'update public.loyalty_accounts set points_balance = 500 where membership_id = $1',
      [maria],
    );
    await setRewardStock(ownerAS, rStock1.id, 0);
    await assertAtomicFailure(
      await freshAttempt(await freshToken(admin, orgA, maria), rStock1.id),
      'PED57',
      '60. fora de estoque',
    );
    await assertAtomicFailure(
      await freshAttempt(await freshToken(admin, orgA, maria), rInact.id),
      'PED55',
      '61. reward inativa',
    );
    await ownerAS.query('select public.set_loyalty_program_enabled($1, false) as out', [orgA]);
    await assertAtomicFailure(
      await freshAttempt(await freshToken(admin, orgA, maria), rMain.id),
      'PED51',
      '62. programa desabilitado',
    );
    await ownerAS.query('select public.set_loyalty_program_enabled($1, true) as out', [orgA]);
    const invalidAttempt = await freshAttempt(randomToken(), rMain.id);
    invalidAttempt.tokenPresent = false;
    await assertAtomicFailure(invalidAttempt, 'PED52', '63. token invalido');
    const crossToken = await freshToken(admin, orgB, cross);
    await assertAtomicFailure(
      await freshAttempt(crossToken, rMain.id),
      'PED52',
      '64. token de outro tenant',
    );
    const staleRevision = await currentRevision(admin, rMain.id);
    await updateReward(ownerAS, rMain.id, { description: 'muda revisao' });
    const staleAttempt = await freshAttempt(await freshToken(admin, orgA, maria), rMain.id);
    staleAttempt.revision = staleRevision;
    await assertAtomicFailure(staleAttempt, 'PED56', '65. reward changed (revision antiga)');

    scenario(8, 'IDEMPOTENCY - replay resolve antes das validacoes (120)');
    const idemRevision = await currentRevision(admin, rMain.id);
    const keyIdem = randomUUID();
    const tokenIdem = await freshToken(admin, orgA, maria);
    const secretIdem = recoverySecret();
    const stockBeforeIdem = (await rewardRow(admin, rMain.id)).stock_quantity;
    const first = await redeem(
      anon,
      slugA1,
      keyIdem,
      rMain.id,
      idemRevision,
      tokenIdem,
      secretIdem,
    );
    const redemptionIdem = await redemptionByKey(admin, orgA, keyIdem);
    const voucherIdem = await voucherForRedemption(admin, redemptionIdem.id);
    const ledgerIdemCount = await count(
      admin,
      'select count(*)::integer as count from public.loyalty_ledger where redemption_id = $1',
      [redemptionIdem.id],
    );
    const stockEventsIdemCount = (await stockEvents(admin, rMain.id)).length;
    const voucherEventsIdemCount = (await voucherEventsFor(admin, voucherIdem.id)).length;
    const replay = await redeem(
      anon,
      slugA1,
      keyIdem,
      rMain.id,
      idemRevision,
      tokenIdem,
      secretIdem,
    );
    const stockAfterFirstIdem = (await rewardRow(admin, rMain.id)).stock_quantity;
    ok(replay.found === true, '66. mesma key/mesma request -> replay ok');
    ok(replay.voucher.code === first.voucher.code, '67. mesmo voucher retornado');
    ok(
      (await count(
        admin,
        'select count(*)::integer as count from public.loyalty_ledger where redemption_id = $1',
        [redemptionIdem.id],
      )) === ledgerIdemCount,
      '68. sem segundo ledger',
    );
    ok(
      (await rewardRow(admin, rMain.id)).stock_quantity === stockAfterFirstIdem &&
        (await stockEvents(admin, rMain.id)).length === stockEventsIdemCount &&
        stockAfterFirstIdem === stockBeforeIdem - 1,
      '69. sem segundo decremento de estoque',
    );
    ok(
      (await voucherEventsFor(admin, voucherIdem.id)).length === voucherEventsIdemCount,
      '70. sem segundo evento de voucher',
    );
    await expectError(
      anon,
      'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
      [slugA1, keyIdem, rMain.id, idemRevision, tokenIdem, recoverySecret()],
      'PED59',
      '70a. replay com recovery secret divergente nao revela voucher',
    );
    const conflictRevision = await currentRevision(admin, rConsume.id);
    await expectError(
      anon,
      'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
      [slugA1, keyIdem, rConsume.id, conflictRevision, tokenIdem, secretIdem],
      'PED59',
      '71. mesma key/outro reward -> PED59',
    );

    const replayToken = tokenIdem;
    const replayKey = keyIdem;
    const replaySecret = secretIdem;
    const replayRewardId = rMain.id;
    const replayRevision = idemRevision;
    const oldCode = first.voucher.code;

    // 72: o token ja foi consumido no primeiro resgate; o replay ainda
    // resolve antes de qualquer validacao de token/programa/reward.
    let replOut = await redeem(
      anon,
      slugA1,
      replayKey,
      replayRewardId,
      replayRevision,
      replayToken,
      replaySecret,
    );
    ok(
      replOut.found === true && replOut.voucher.code === oldCode,
      '72. replay apos token consumido',
    );

    // 73/74: replay com reward inativa e estoque zero - usamos um segundo
    // resgate (key distinta) cujas condicoes correntes mudam depois do sucesso.
    const altRevision = await currentRevision(admin, rConsume.id);
    const keyAlt = randomUUID();
    const tokenAlt = await freshToken(admin, orgA, maria);
    const secretAlt = recoverySecret();
    const altFirst = await redeem(
      anon,
      slugA1,
      keyAlt,
      rConsume.id,
      altRevision,
      tokenAlt,
      secretAlt,
    );
    ok(altFirst.found === true, '72a. resgate de apoio (keyAlt) criado para 73/74');
    await setRewardActive(ownerAS, rConsume.id, false);
    replOut = await redeem(anon, slugA1, keyAlt, rConsume.id, altRevision, tokenAlt, secretAlt);
    ok(
      replOut.found === true && replOut.voucher.code === altFirst.voucher.code,
      '73. replay apos reward inativa',
    );
    await setRewardActive(ownerAS, rConsume.id, true);
    await setRewardStock(ownerAS, rConsume.id, 0);
    replOut = await redeem(anon, slugA1, keyAlt, rConsume.id, altRevision, tokenAlt, secretAlt);
    ok(
      replOut.found === true && replOut.voucher.code === altFirst.voucher.code,
      '74. replay apos estoque zero',
    );
    await setRewardStock(ownerAS, rConsume.id, 50);

    await ownerAS.query('select public.set_loyalty_program_enabled($1, false) as out', [orgA]);
    replOut = await redeem(
      anon,
      slugA1,
      replayKey,
      replayRewardId,
      replayRevision,
      replayToken,
      replaySecret,
    );
    ok(
      replOut.found === true && replOut.voucher.code === oldCode,
      '75. replay apos programa disabled',
    );
    await ownerAS.query('select public.set_loyalty_program_enabled($1, true) as out', [orgA]);

    await updateReward(ownerAS, rMain.id, { points_cost: '45' });
    replOut = await redeem(
      anon,
      slugA1,
      replayKey,
      replayRewardId,
      replayRevision,
      replayToken,
      replaySecret,
    );
    ok(
      replOut.found === true && replOut.voucher.code === oldCode,
      '76. replay apos mudanca de custo',
    );

    const multiSlugKey = randomUUID();
    const multiSlugToken = await freshToken(admin, orgA, maria);
    const multiSlugSecret = recoverySecret();
    const multiSlugRevision = await currentRevision(admin, rConsume.id);
    const multiSlugResults = await Promise.allSettled([
      redeem(
        anon,
        slugA1,
        multiSlugKey,
        rConsume.id,
        multiSlugRevision,
        multiSlugToken,
        multiSlugSecret,
      ),
      redeem(
        anonB,
        slugA3,
        multiSlugKey,
        rConsume.id,
        multiSlugRevision,
        multiSlugToken,
        multiSlugSecret,
      ),
    ]);
    ok(
      multiSlugResults.every((result) => result.status === 'fulfilled') &&
        multiSlugResults[0].value.voucher.code === multiSlugResults[1].value.voucher.code,
      '76a. mesma key em dois slugs da org serializa e retorna o mesmo voucher',
    );
    const multiSlugRedemption = await redemptionByKey(admin, orgA, multiSlugKey);
    ok(
      (await count(
        admin,
        'select count(*)::integer as count from public.loyalty_ledger where redemption_id = $1',
        [multiSlugRedemption.id],
      )) === 1 &&
        (
          await voucherEventsFor(
            admin,
            (await voucherForRedemption(admin, multiSlugRedemption.id)).id,
          )
        ).length === 1,
      '76b. concorrencia multi-slug nao duplica ledger, voucher ou evento',
    );

    scenario(9, 'CONCURRENCY BALANCE - saldo nao negativo (121)');
    await admin.query(
      'update public.loyalty_accounts set points_balance = 100 where membership_id = $1',
      [maria],
    );
    const balRev = await currentRevision(admin, rBal.id);
    const keyBal1 = randomUUID();
    const keyBal2 = randomUUID();
    const tokenBal1 = await freshToken(admin, orgA, maria);
    const tokenBal2 = await freshToken(admin, orgA, maria);
    const balResults = await Promise.allSettled([
      redeem(anon, slugA1, keyBal1, rBal.id, balRev, tokenBal1, recoverySecret()),
      redeem(anonB, slugA1, keyBal2, rBal.id, balRev, tokenBal2, recoverySecret()),
    ]);
    const balSuccesses = balResults.filter((result) => result.status === 'fulfilled');
    const balRejections = balResults.filter((result) => result.status === 'rejected');
    ok(balSuccesses.length === 1, '77. so um dos dois resgates de 100 passa');
    ok(
      balRejections.length === 1 && balRejections[0].reason?.code === 'PED58',
      '78. perdedor recebe PED58, saldo nunca negativo',
    );
    const balRedemptions = await admin.query(
      'select count(*)::integer as count from public.loyalty_redemptions where idempotency_key = any($1::uuid[])',
      [[keyBal1, keyBal2]],
    );
    ok(balRedemptions.rows[0].count === 1, '79. uma redemption');
    const balVouchers = await admin.query(
      `select count(*)::integer as count
       from public.loyalty_vouchers as v
       join public.loyalty_redemptions as r on r.id = v.redemption_id
       where r.idempotency_key = any($1::uuid[])`,
      [[keyBal1, keyBal2]],
    );
    ok(balVouchers.rows[0].count === 1, '80. um voucher');
    ok((await accountOf(admin, maria)).points_balance === 0, '80a. saldo final 0');

    scenario(10, 'CONCURRENCY STOCK - estoque unitario (122)');
    await setRewardStock(ownerAS, rStock1.id, 1);
    const stkRev = await currentRevision(admin, rStock1.id);
    await seedEarn(admin, orgA, maria, 20);
    await seedEarn(admin, orgA, bruno, 20);
    const keyStk1 = randomUUID();
    const keyStk2 = randomUUID();
    const tokenStk1 = await freshToken(admin, orgA, maria);
    const tokenStk2 = await freshToken(admin, orgA, bruno);
    const secretStk1 = recoverySecret();
    const secretStk2 = recoverySecret();
    const stkResults = await Promise.allSettled([
      redeem(anon, slugA1, keyStk1, rStock1.id, stkRev, tokenStk1, secretStk1),
      redeem(anonB, slugA1, keyStk2, rStock1.id, stkRev, tokenStk2, secretStk2),
    ]);
    const stkSuccesses = stkResults.filter((result) => result.status === 'fulfilled');
    const stkRejections = stkResults.filter((result) => result.status === 'rejected');
    ok(stkSuccesses.length === 1, '81. um membro resgata com estoque=1');
    ok(
      stkRejections.length === 1 && stkRejections[0].reason?.code === 'PED57',
      '81a. outro recebe PED57',
    );
    ok((await rewardRow(admin, rStock1.id)).stock_quantity === 0, '82. estoque final 0');
    const stkRedemptionEvents = (await stockEvents(admin, rStock1.id)).filter(
      (event) => event.event_type === 'redemption',
    );
    ok(
      stkRedemptionEvents.length === 1 &&
        Number(stkRedemptionEvents[0].delta) === -1 &&
        Number(stkRedemptionEvents[0].balance_after) === 0,
      '83. um stock redemption event com delta e saldo finais exatos',
    );
    const stkMutationCounts = await admin.query(
      `select
         count(distinct r.id)::integer as redemptions,
         count(distinct v.id)::integer as vouchers,
         count(distinct l.id)::integer as ledgers
       from public.loyalty_redemptions as r
       left join public.loyalty_vouchers as v on v.redemption_id = r.id
       left join public.loyalty_ledger as l on l.redemption_id = r.id
       where r.idempotency_key = any($1::uuid[])`,
      [[keyStk1, keyStk2]],
    );
    ok(
      stkMutationCounts.rows[0].redemptions === 1 &&
        stkMutationCounts.rows[0].vouchers === 1 &&
        stkMutationCounts.rows[0].ledgers === 1,
      '83a. last stock cria uma redemption, um voucher e um ledger',
    );
    const brunoVoucher = stkSuccesses[0].value;
    const brunoVoucherCode = brunoVoucher.voucher.code.replaceAll('-', '');

    scenario(11, 'SAME TOKEN - uso unico sob concorrencia (123)');
    const sameRev = await currentRevision(admin, rConsume.id);
    const sameToken = await freshToken(admin, orgA, maria);
    const keySame1 = randomUUID();
    const keySame2 = randomUUID();
    const sameSecret1 = recoverySecret();
    const sameSecret2 = recoverySecret();
    const sameStockBefore = (await rewardRow(admin, rConsume.id)).stock_quantity;
    const sameResults = await Promise.allSettled([
      redeem(anon, slugA1, keySame1, rConsume.id, sameRev, sameToken, sameSecret1),
      redeem(anonB, slugA1, keySame2, rConsume.id, sameRev, sameToken, sameSecret2),
    ]);
    const sameSuccesses = sameResults.filter((result) => result.status === 'fulfilled');
    const sameRejections = sameResults.filter((result) => result.status === 'rejected');
    ok(sameSuccesses.length === 1, '84. exatamente uma mutacao com o mesmo token');
    ok(
      sameRejections.length === 1 && sameRejections[0].reason?.code === 'PED52',
      '84a. a outra recebe PED52 (token consumido)',
    );
    ok((await tokenCount(admin, sameToken)) === 0, '84b. token deletado ao final');
    const sameMutationCounts = await admin.query(
      `select
         count(distinct r.id)::integer as redemptions,
         count(distinct v.id)::integer as vouchers,
         count(distinct l.id)::integer as ledgers,
         count(distinct se.id)::integer as stock_events
       from public.loyalty_redemptions as r
       left join public.loyalty_vouchers as v on v.redemption_id = r.id
       left join public.loyalty_ledger as l on l.redemption_id = r.id
       left join public.loyalty_reward_stock_events as se on se.redemption_id = r.id
       where r.idempotency_key = any($1::uuid[])`,
      [[keySame1, keySame2]],
    );
    ok(
      Object.values(sameMutationCounts.rows[0]).every((value) => value === 1) &&
        (await rewardRow(admin, rConsume.id)).stock_quantity === sameStockBefore - 1,
      '84c. same token produz uma unica mutacao completa',
    );

    scenario(12, 'RECOVERY - recovery_points, estorno pos-resgate (124)');
    await admin.query(
      `update public.loyalty_accounts
       set points_balance = 100, recovery_points = 5, updated_at = now()
       where membership_id = $1`,
      [deb],
    );
    const recRev = await currentRevision(admin, rRec.id);
    await expectError(
      anon,
      'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
      [slugA1, randomUUID(), rRec.id, recRev, await freshToken(admin, orgA, deb), recoverySecret()],
      'PED53',
      '85. recovery_points > 0 bloqueia redemption',
    );
    await admin.query(
      `update public.loyalty_accounts
       set points_balance = 5, recovery_points = 0, updated_at = now()
       where membership_id = $1`,
      [deb],
    );
    const lowRev = await currentRevision(admin, rLow.id);
    await expectError(
      anon,
      'select public.redeem_public_loyalty_reward($1, $2, $3, $4, $5, $6) as out',
      [slugA1, randomUUID(), rLow.id, lowRev, await freshToken(admin, orgA, deb), recoverySecret()],
      'PED58',
      '86. saldo insuficiente',
    );
    await admin.query(
      'update public.loyalty_accounts set points_balance = 100 where membership_id = $1',
      [deb],
    );
    const debRedeem = await redeem(
      anon,
      slugA1,
      randomUUID(),
      rRec.id,
      recRev,
      await freshToken(admin, orgA, deb),
      recoverySecret(),
    );
    ok(debRedeem.found === true, '87. resgate limpo passa apos sanar divida');
    const debAfter = await accountOf(admin, deb);
    ok(debAfter.recovery_points === 0, '87a. redemption nunca cria recovery');
    const debRedemption = await admin.query(
      `select recovery_delta from public.loyalty_ledger
       where redemption_id = (
         select id from public.loyalty_redemptions
         where organization_id = $1 and membership_id = $2
         order by created_at desc limit 1
       )`,
      [orgA, deb],
    );
    ok(
      Number(debRedemption.rows[0].recovery_delta) === 0,
      '87b. ledger redeem com recovery_delta 0',
    );

    // 88/89: fluxo organico - earn 100, resgate 100, estorno -> recovery 100.
    // O resolve mint o proprio access token (nao pre-inserir o hash).
    const leoToken = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpLeo,
      last2: '47',
      mode: 'lookup',
      name: null,
      tokenHash: sha256(leoToken),
      expiresAt: inTwoHours(),
    });
    const leoOrder = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(menuA1, singleItem(menuA1, 'Produto 20', 5), { loyalty_token: leoToken }),
    );
    const leoOrderId = await orderIdForCreation(admin, leoOrder);
    await setPayment(ownerAS, leoOrderId, 'paid');
    await setStatus(ownerAS, leoOrderId, 'confirmed');
    await setStatus(ownerAS, leoOrderId, 'preparing');
    await setStatus(ownerAS, leoOrderId, 'ready');
    await setStatus(ownerAS, leoOrderId, 'completed');
    ok((await accountOf(admin, leo)).points_balance === 100, '88a. earn organico de 100');
    const refundRev = await currentRevision(admin, rRefund.id);
    const leoRedeem = await redeem(
      anon,
      slugA1,
      randomUUID(),
      rRefund.id,
      refundRev,
      await freshToken(admin, orgA, leo),
      recoverySecret(),
    );
    ok(leoRedeem.found === true, '88b. resgate de 100 apos earn');
    ok((await accountOf(admin, leo)).points_balance === 0, '88c. saldo zero apos resgate');
    await setPayment(ownerAS, leoOrderId, 'refunded');
    const leoAfterRefund = await accountOf(admin, leo);
    ok(
      leoAfterRefund.points_balance === 0 && leoAfterRefund.recovery_points === 100,
      '88. estorno apos redemption cria recovery de 100',
    );
    const leoVoucher = await voucherByCode(admin, leoRedeem.voucher.code.replaceAll('-', ''));
    ok(leoVoucher.status === 'issued', '89. voucher continua issued apos estorno');
    ok(
      (await ledgerSum(admin, leo)) ===
        leoAfterRefund.points_balance - leoAfterRefund.recovery_points,
      '89a. invariante sum(ledger) = balance - recovery preservada',
    );

    scenario(13, 'SNAPSHOT - imutabilidade da redemption (125)');
    await seedEarn(admin, orgA, maria, 300);
    const snapRev = await currentRevision(admin, rSnap.id);
    const keySnap = randomUUID();
    const snapRedeem = await redeem(
      anon,
      slugA1,
      keySnap,
      rSnap.id,
      snapRev,
      await freshToken(admin, orgA, maria),
      recoverySecret(),
    );
    ok(snapRedeem.found === true, '90. resgate do reward Snap A/100');
    await updateReward(ownerAS, rSnap.id, { name: 'Snap B', points_cost: '200' });
    const snapRedemption = await redemptionByKey(admin, orgA, keySnap);
    ok(
      snapRedemption.reward_name_snapshot === 'Snap A' &&
        Number(snapRedemption.points_cost) === 100,
      '90a. redemption antiga preserva snapshot nome/custo',
    );
    const snapLookup = await staffLookup(ownerAS, unitA1, snapRedeem.voucher.code);
    ok(
      snapLookup.found === true &&
        snapLookup.reward_name === 'Snap A' &&
        snapLookup.points_cost === '100',
      '90b. voucher antigo continua exibindo name A / cost 100',
    );

    scenario(14, 'VOUCHER STAFF - operacao por unidade (126)');
    const staffVoucher = await voucherByCode(admin, vStaffCode);
    const staffLookupOwner = await staffLookup(ownerAS, unitA1, vStaffCode);
    ok(staffLookupOwner.found === true, '91. owner consulta voucher da unidade');
    const staffLookupManager = await staffLookup(managerAS, unitA1, vStaffCode);
    ok(staffLookupManager.found === true, '92. manager vinculado consulta');
    const staffLookupOperator = await staffLookup(operatorAS, unitA1, vStaffCode);
    ok(staffLookupOperator.found === true, '93. operator vinculado consulta');
    await expectError(
      staffUS,
      'select public.get_loyalty_voucher_staff($1, $2) as out',
      [unitA1, vStaffCode],
      'PED11',
      '94. staff sem vinculo nao consulta',
    );
    const crossLookup = await staffLookup(ownerBS, unitB1, vStaffCode);
    ok(crossLookup.found === false, '95. cross-tenant e seguramente desconhecido');
    await admin.query('update public.units set is_active = false where id = $1', [unitA2]);
    await expectError(
      ownerAS,
      'select public.get_loyalty_voucher_staff($1, $2) as out',
      [unitA2, vStaffCode],
      'PED11',
      '96. unidade inativa -> PED11',
    );
    await expectError(
      ownerAS,
      'select public.get_loyalty_voucher_staff($1, $2) as out',
      [unitA1, 'zzz!@'],
      'PED62',
      '97. codigo malformado -> PED62',
    );
    const unknown = await staffLookup(ownerAS, unitA1, 'F'.repeat(16));
    ok(unknown.found === false, '98. codigo desconhecido -> found=false');
    ok(staffVoucher.status === 'issued', '98a. consulta nao muta voucher');
    await expectError(
      staffUS,
      'select public.consume_loyalty_voucher($1, $2) as out',
      [unitA1, vStaffCode],
      'PED11',
      '98b. staff sem vinculo nao consome',
    );
    await expectError(
      ownerBS,
      'select public.consume_loyalty_voucher($1, $2) as out',
      [unitB1, vStaffCode],
      'PED60',
      '98c. cross-tenant nao consome',
    );
    await expectError(
      ownerAS,
      'select public.consume_loyalty_voucher($1, $2) as out',
      [unitA2, vStaffCode],
      'PED11',
      '98d. unidade inativa nao consome',
    );

    scenario(15, 'CONSUMPTION - ciclo de vida do voucher (127)');
    const consumeBeforeStock = (await rewardRow(admin, rConsume.id)).stock_quantity;
    const consumeBeforeLedger = await count(
      admin,
      'select count(*)::integer as count from public.loyalty_ledger where membership_id = $1',
      [maria],
    );
    const concurrentConsumes = await Promise.allSettled([
      staffConsume(ownerAS, unitA1, vConsCode),
      staffConsume(managerAS, unitA1, vConsCode),
    ]);
    const consumeSuccesses = concurrentConsumes.filter((result) => result.status === 'fulfilled');
    const consumeRejections = concurrentConsumes.filter((result) => result.status === 'rejected');
    const consumed = consumeSuccesses[0].value;
    ok(
      consumeSuccesses.length === 1 && consumed.found === true && consumed.status === 'consumed',
      '99. exatamente um consumo concorrente issued -> consumed',
    );
    ok(
      consumeRejections.length === 1 && consumeRejections[0].reason?.code === 'PED61',
      '99a. consumo concorrente perdedor recebe PED61',
    );
    ok(consumed.consumed_at !== null, '100. consumed_at definido');
    const consumedRow = await voucherByCode(admin, vConsCode);
    ok(consumedRow.consumed_unit_id === unitA1, '101. consumed_unit registrada');
    ok(
      consumedRow.consumed_by_user_id === ownerA.id ||
        consumedRow.consumed_by_user_id === managerA.id,
      '102. consumed_by_user registra exatamente o vencedor concorrente',
    );
    const consumeEvents = await voucherEventsFor(admin, consumedRow.id);
    ok(
      JSON.stringify(consumeEvents) === JSON.stringify(['issued', 'consumed']),
      '103. evento consumed anexado',
    );
    ok(
      JSON.stringify(await voucherEventsFor(admin, consumedRow.id)) ===
        JSON.stringify(['issued', 'consumed']),
      '104. consumo concorrente nao cria outro evento',
    );
    const inactiveConsume = await staffConsume(ownerAS, unitA1, vInactiveCode);
    ok(
      inactiveConsume.found === true && inactiveConsume.status === 'consumed',
      '105. reward inativa nao bloqueia consumo',
    );
    await ownerAS.query('select public.set_loyalty_program_enabled($1, false) as out', [orgA]);
    const progConsume = await staffConsume(ownerAS, unitA1, vProgCode);
    ok(
      progConsume.found === true && progConsume.status === 'consumed',
      '106. programa disabled nao bloqueia consumo',
    );
    await ownerAS.query('select public.set_loyalty_program_enabled($1, true) as out', [orgA]);
    ok(
      (await rewardRow(admin, rConsume.id)).stock_quantity === consumeBeforeStock,
      '107. estoque nao muda no consumo',
    );
    ok(
      (await count(
        admin,
        'select count(*)::integer as count from public.loyalty_ledger where membership_id = $1',
        [maria],
      )) === consumeBeforeLedger,
      '108. ledger nao muda no consumo',
    );

    scenario(16, 'PUBLIC VOUCHERS - vouchers na conta publica (128)');
    const mariaAccountToken = await freshToken(admin, orgA, maria);
    const pubVouchers = await publicLoyaltyAccount(anon, mariaAccountToken);
    ok(
      pubVouchers.found === true && Array.isArray(pubVouchers.vouchers),
      '109. conta retorna vouchers do membro',
    );
    const staffEntry = pubVouchers.vouchers.find(
      (entry) => entry.code.replaceAll('-', '') === vStaffCode,
    );
    ok(staffEntry !== undefined, '109a. vouchers emitidos e nao consumidos listados');
    ok(
      staffEntry.reward_name === 'Consumo' &&
        staffEntry.points_cost === '10' &&
        staffEntry.issued_at !== undefined,
      '109b. reward_name/points_cost/issued_at expostos',
    );

    const bulk = await admin.query(
      `with pairs as (
         select g, gen_random_uuid() as redemption_id, gen_random_uuid() as idempotency_key
         from generate_series(1, 25) as g
       ),
       reds as (
         insert into public.loyalty_redemptions (
           organization_id, membership_id, reward_id, idempotency_key,
           request_hash, recovery_hash, reward_name_snapshot, points_cost, reward_revision
         )
         select $1, $2, $3, p.idempotency_key, $4, $5, 'Bulk', 30,
                '2026-08-11T00:00:00.000000Z'
         from pairs as p
         returning id, idempotency_key
       )
       insert into public.loyalty_vouchers (
         organization_id, redemption_id, membership_id, reward_id, voucher_code
       )
       select $1, r.id, $2, $3, upper(lpad(to_hex(p.g), 16, '0'))
       from pairs as p
       join reds as r on r.idempotency_key = p.idempotency_key`,
      [orgA, maria, rMain.id, sha256('bulk-request'), sha256('bulk-recovery')],
    );
    ok(bulk.rowCount === 25, '109c. 25 redemptions/vouchers sinteticos inseridos');

    const mariaAccountToken2 = await freshToken(admin, orgA, maria);
    const pubVouchers20 = await publicLoyaltyAccount(anon, mariaAccountToken2);
    ok(pubVouchers20.vouchers.length === 20, '110. maximo de 20 vouchers emitidos');
    ok(
      pubVouchers20.vouchers.every(
        (entry) =>
          !['id', 'membership_id', 'redemption_id', 'organization_id'].some((key) => key in entry),
      ),
      '111. sem IDs internos nem de outro membro',
    );
    const newestBulk = pubVouchers20.vouchers[0];
    ok(
      exactKeys(newestBulk, ['code', 'reward_name', 'points_cost', 'issued_at']),
      '112. somente campos publicos permitidos',
    );
    const brunoToken = await freshToken(admin, orgA, bruno);
    const brunoAccount = await publicLoyaltyAccount(anon, brunoToken);
    const mariaRawCodes = new Set(
      pubVouchers20.vouchers.map((entry) => entry.code.replaceAll('-', '')),
    );
    ok(
      brunoAccount.found === true &&
        brunoAccount.vouchers.every((entry) => !mariaRawCodes.has(entry.code.replaceAll('-', ''))),
      '113. membro nao ve vouchers de outro membro',
    );
    ok(
      brunoAccount.vouchers.length <= 1 &&
        brunoAccount.vouchers.every((entry) => entry.code.replaceAll('-', '') === brunoVoucherCode),
      '113a. Bruno apenas com voucher proprio (se emitido)',
    );
    ok(
      !JSON.stringify(pubVouchers20.vouchers).includes('fingerprint') &&
        !JSON.stringify(pubVouchers20.vouchers).includes('phone'),
      '114. sem fingerprint/telefone',
    );
    const consumedNewest = await staffConsume(ownerAS, unitA1, newestBulk.code);
    ok(consumedNewest.found === true, '114a. voucher mais recente consumido');
    const afterConsume = await publicLoyaltyAccount(anon, mariaAccountToken2);
    ok(
      afterConsume.vouchers.every((entry) => entry.code !== newestBulk.code) &&
        afterConsume.vouchers.length === 20,
      '115. voucher consumido omitido, limite mantido',
    );
    ok(
      pubVouchers20.vouchers.every((entry) =>
        /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(entry.code),
      ),
      '115. codigo formatado com seguranca',
    );

    scenario(17, 'LEDGER RECONCILIATION - earn + redeem + reversal (129)');
    const piToken = randomToken();
    await resolveLoyalty(admin, {
      organizationId: orgA,
      fingerprint: fpPi,
      last2: '51',
      mode: 'lookup',
      name: null,
      tokenHash: sha256(piToken),
      expiresAt: inTwoHours(),
    });
    const piOrder = await checkout(
      anon,
      slugA1,
      randomUUID(),
      makePayload(menuA1, singleItem(menuA1, 'Produto 20', 10), { loyalty_token: piToken }),
    );
    const piOrderId = await orderIdForCreation(admin, piOrder);
    await setPayment(ownerAS, piOrderId, 'paid');
    await setStatus(ownerAS, piOrderId, 'confirmed');
    await setStatus(ownerAS, piOrderId, 'preparing');
    await setStatus(ownerAS, piOrderId, 'ready');
    await setStatus(ownerAS, piOrderId, 'completed');
    ok((await accountOf(admin, pi)).points_balance === 200, '117. earn +200');
    const highRev = await currentRevision(admin, rHigh.id);
    const piRedeem = await redeem(
      anon,
      slugA1,
      randomUUID(),
      rHigh.id,
      highRev,
      await freshToken(admin, orgA, pi),
      recoverySecret(),
    );
    ok(piRedeem.found === true, '117a. redeem -150');
    ok((await accountOf(admin, pi)).points_balance === 50, '117b. saldo 50 apos redeem');
    await setPayment(ownerAS, piOrderId, 'refunded');
    const piFinal = await accountOf(admin, pi);
    ok(
      piFinal.points_balance === 0 && piFinal.recovery_points === 150,
      '118. saldo 0 e recovery 150 apos estorno',
    );
    ok(
      (await ledgerSum(admin, pi)) === piFinal.points_balance - piFinal.recovery_points,
      '118a. invariante do ledger reconciliada',
    );
    const piLedger = await admin.query(
      `select entry_type, amount, points_delta, recovery_delta
       from public.loyalty_ledger
       where membership_id = $1
       order by created_at, id`,
      [pi],
    );
    const piSums = piLedger.rows.reduce(
      (acc, row) => {
        acc.amount += Number(row.amount);
        acc.points += Number(row.points_delta);
        acc.recovery += Number(row.recovery_delta);
        return acc;
      },
      { amount: 0, points: 0, recovery: 0 },
    );
    ok(
      piLedger.rows.length === 3 &&
        piSums.amount === -150 &&
        piSums.points === 0 &&
        piSums.recovery === 150,
      '118b. earn +200, redeem -150, reversal -200 reconciliados',
    );

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
    if (createdOrgIds.length > 0) {
      const scope = createdOrgIds;
      const sqls = [
        'delete from public.loyalty_voucher_events where organization_id = any($1::uuid[])',
        'delete from public.loyalty_vouchers where organization_id = any($1::uuid[])',
        'delete from public.loyalty_reward_stock_events where organization_id = any($1::uuid[])',
        'delete from public.loyalty_ledger where organization_id = any($1::uuid[])',
        'delete from public.loyalty_redemptions where organization_id = any($1::uuid[])',
        'delete from public.loyalty_rewards where organization_id = any($1::uuid[])',
        'delete from public.loyalty_access_tokens where organization_id = any($1::uuid[])',
        'delete from public.orders where organization_id = any($1::uuid[])',
        'delete from public.organizations where id = any($1::uuid[])',
      ];
      for (const sql of sqls) {
        await admin.query(sql, [scope]).catch(() => console.warn('cleanup warning'));
      }
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
