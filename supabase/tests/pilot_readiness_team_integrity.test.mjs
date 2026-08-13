import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from './db-test-config.mjs';

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

async function adminClient() {
  const c = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
  await c.connect();
  return c;
}

async function sessionFor(userId) {
  const c = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
  await c.connect();
  await c.query('set role authenticated');
  await c.query(`set request.jwt.claims = '{"sub": "${userId}", "role": "authenticated"}'`);
  await c.query(`set request.jwt.claim.sub = '${userId}'`);
  return c;
}

async function anonClient() {
  const c = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
  await c.connect();
  await c.query('set role anon');
  return c;
}

async function authedNoSubClient() {
  const c = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
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

async function expectDenied(client, sql, params, label) {
  return expectError(client, sql, params, '42501', label);
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

async function checkout(client, slug, key, payload) {
  return (
    await client.query('select public.create_public_order($1, $2, $3::jsonb) as out', [
      slug,
      key,
      JSON.stringify(payload),
    ])
  ).rows[0].out;
}

async function readiness(client, orgId) {
  return (await client.query('select public.get_org_pilot_readiness($1) as out', [orgId])).rows[0]
    .out;
}

async function membersAdmin(client, orgId) {
  return (await client.query('select public.get_org_members_admin($1) as out', [orgId])).rows[0]
    .out;
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

function makePayload(menu, items) {
  return {
    menu_version_id: menu.menu.version_id,
    operation_revision: menu.operation.revision,
    service_mode: 'pickup',
    payment_method: 'pix',
    customer: { ...BASE_CUSTOMER },
    items,
    notes: '  Observacao sintetica  ',
    cash_change_for: null,
  };
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  try {
    const ownerA = await createTestUser(admin, `p11-owner-a-${suffix}@pedon-test.invalid`);
    const managerA = await createTestUser(admin, `p11-manager-a-${suffix}@pedon-test.invalid`);
    const operatorA = await createTestUser(admin, `p11-operator-a-${suffix}@pedon-test.invalid`);
    const ownerB = await createTestUser(admin, `p11-owner-b-${suffix}@pedon-test.invalid`);
    const noOrgUser = await createTestUser(admin, `p11-no-org-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, ownerB.id, noOrgUser.id);

    const ownerAS = await sessionFor(ownerA.id);
    const managerAS = await sessionFor(managerA.id);
    const operatorAS = await sessionFor(operatorA.id);
    const ownerBS = await sessionFor(ownerB.id);
    const noSubS = await authedNoSubClient();
    const anon = await anonClient();
    openClients.push(ownerAS, managerAS, operatorAS, ownerBS, noSubS, anon);

    const orgA = (await ownerAS.query(`select public.complete_onboarding('Org Pilot A') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);
    const unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    const unitA2 = (await ownerAS.query('select (public.create_unit($1)).id as u', ['Filial A2']))
      .rows[0].u;

    const orgB = (await ownerBS.query(`select public.complete_onboarding('Org Pilot B') as org`))
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

    // ============================================================
    // Cenario 1 — autenticacao/autorizacao do readiness
    // ============================================================
    console.log('Cenario 1 — get_org_pilot_readiness: authn e authz');
    await expectError(
      anon,
      'select public.get_org_pilot_readiness($1)',
      [orgA],
      '42501',
      'anon nao executa readiness (revogado)',
    );
    await expectError(
      noSubS,
      'select public.get_org_pilot_readiness($1)',
      [orgA],
      'PED67',
      'autenticado sem sub nao consulta readiness',
    );
    await expectError(
      operatorAS,
      'select public.get_org_pilot_readiness($1)',
      [orgA],
      'PED69',
      'operator nao consulta readiness',
    );
    await expectError(
      ownerBS,
      'select public.get_org_pilot_readiness($1)',
      [orgA],
      'PED69',
      'owner de outro tenant nao consulta readiness alheio',
    );
    await expectError(
      ownerAS,
      'select public.get_org_pilot_readiness(null)',
      [],
      'PED68',
      'organization_id nulo gera ORGANIZATION_REQUIRED',
    );

    const initial = await readiness(ownerAS, orgA);
    ok(initial !== null && typeof initial === 'object', 'owner consulta readiness (object)');
    ok(initial.organization_id === orgA, 'readiness identifica organization_id');
    ok(Array.isArray(initial.checks), 'readiness retorna array de checks');
    ok(typeof initial.checked_at === 'string', 'readiness retorna checked_at');
    ok(Array.isArray(initial.units_summary), 'readiness retorna units_summary');

    const managerReadiness = await readiness(managerAS, orgA);
    ok(managerReadiness.organization_id === orgA, 'manager tambem consulta readiness');

    // ============================================================
    // Cenario 2 — derivacao inicial (estado parcial) e constante
    // ============================================================
    console.log('Cenario 2 — readiness derivado de estado inicial sem configuracao');
    ok(initial.ready === false, 'organizacao crua ainda nao esta pronta');
    ok(initial.blocking_total === 9, 'total de checks bloqueantes e 9');
    ok(initial.blocking_ok === 2, 'estado cru satisfaz somente org_name e active_unit');
    const byCode = Object.fromEntries((initial.checks ?? []).map((c) => [c.code, c]));
    ok(byCode.org_name?.ok === true, 'org_name derivado como ok (nome valido)');
    ok(byCode.active_unit?.ok === true, 'active_unit derivado como ok (unidade ativa)');
    ok(byCode.op_config?.ok === false, 'op_config derivado como pendente');
    ok(byCode.hours?.ok === false, 'hours derivado como pendente');
    ok(byCode.payment?.ok === false, 'payment derivado como pendente');
    ok(byCode.catalog?.ok === false, 'catalog derivado como pendente');
    ok(byCode.menu_published?.ok === false, 'menu_published derivado como pendente');
    ok(byCode.first_order?.ok === false, 'first_order derivado como pendente');
    ok(byCode.loyalty?.ok === false, 'loyalty derivado como pendente (opcional)');
    ok(byCode.loyalty?.blocking === false, 'loyalty marcado como nao bloqueante');
    ok(byCode.pilot_unit?.ok === false, 'pilot_unit exige uma unidade coerentemente preparada');
    ok(byCode.org_name?.blocking === true, 'org_name marcado como bloqueante');

    const summaryA2 = (initial.units_summary ?? []).find((u) => u.unit_id === unitA2);
    ok(summaryA2 !== undefined, 'units_summary inclui a unidade secundaria');
    ok(
      summaryA2 !== undefined &&
        summaryA2.op_configured === false &&
        summaryA2.menu_published === false,
      'unidade sem configuracao deriva flags false',
    );

    // ============================================================
    // Cenario 3 — requisitos distribuídos não formam uma unidade pronta
    // ============================================================
    console.log('Cenario 3 — requisitos distribuídos nao derivam ready=true');
    await saveConfig(ownerAS, unitA1, operationalConfig());
    await saveConfig(ownerAS, unitA2, operationalConfig());
    const splitCategory = await createCategory(ownerAS, unitA2, 'Itens Split');
    await createProduct(ownerAS, unitA2, splitCategory.id, 'Produto Split', '4.50');
    const splitPublication = await publish(ownerAS, unitA2);
    const splitMenu = await publicMenu(anon, splitPublication.public_slug);
    await checkout(
      anon,
      splitPublication.public_slug,
      randomUUID(),
      makePayload(splitMenu, [
        { menu_item_id: productByName(splitMenu, 'Produto Split').id, quantity: 1, note: null },
      ]),
    );
    await admin.query('delete from public.unit_payment_methods where unit_id = $1', [unitA2]);
    await admin.query('delete from public.unit_business_hours where unit_id = $1', [unitA2]);
    await admin.query('delete from public.unit_operational_settings where unit_id = $1', [unitA2]);
    const splitReadiness = await readiness(ownerAS, orgA);
    const splitByCode = Object.fromEntries((splitReadiness.checks ?? []).map((c) => [c.code, c]));
    ok(splitReadiness.ready === false, 'requisitos em unidades diferentes nao habilitam o piloto');
    ok(
      splitReadiness.blocking_ok === 8 && splitReadiness.blocking_total === 9,
      'somente o check de unidade coerente permanece bloqueante',
    );
    ok(splitByCode.pilot_unit?.ok === false, 'pilot_unit detecta prerequisitos fragmentados');

    // ============================================================
    // Cenario 4 — preparo completo leva a ready=true (derivacao)
    // ============================================================
    console.log('Cenario 4 — preparo completo deriva ready=true');
    const category = await createCategory(ownerAS, unitA1, 'Itens Pilot');
    await createProduct(ownerAS, unitA1, category.id, 'Produto Pilot', '8.50');
    await createProduct(ownerAS, unitA1, category.id, 'Produto Pilot 2', '3.25');
    const publication = await publish(ownerAS, unitA1);
    ok(typeof publication.public_slug === 'string', 'cardapio publicado no setup');

    const published = await publicMenu(anon, publication.public_slug);
    const target = productByName(published, 'Produto Pilot');
    ok(target !== null, 'menu publicado contem o produto do setup');
    const order = await checkout(
      anon,
      publication.public_slug,
      randomUUID(),
      makePayload(published, [
        { menu_item_id: productByName(published, 'Produto Pilot').id, quantity: 1, note: null },
      ]),
    );
    ok(typeof order.tracking_token === 'string', 'pedido sintetico criado no setup');

    const configured = await readiness(ownerAS, orgA);
    ok(configured.ready === true, 'ready=true apos preparo completo');
    ok(
      configured.blocking_ok === 9 && configured.blocking_total === 9,
      'todos os 9 checks bloqueantes satisfeitos',
    );
    const confByCode = Object.fromEntries((configured.checks ?? []).map((c) => [c.code, c]));
    for (const code of [
      'op_config',
      'hours',
      'payment',
      'catalog',
      'menu_published',
      'first_order',
    ]) {
      ok(confByCode[code]?.ok === true, `${code} passa a true apos preparo`);
    }
    ok(confByCode.loyalty?.ok === false, 'loyalty continua false (opcional, nao bloqueia)');
    ok(confByCode.pilot_unit?.ok === true, 'pilot_unit passa com uma unidade completa');

    const summaryA1 = (configured.units_summary ?? []).find((u) => u.unit_id === unitA1);
    ok(
      summaryA1 !== undefined &&
        summaryA1.op_configured === true &&
        summaryA1.hours_ok === true &&
        summaryA1.payment_ok === true &&
        summaryA1.catalog_ok === true &&
        summaryA1.menu_published === true,
      'unidade preparada deriva flags true em units_summary',
    );

    // ============================================================
    // Cenario 5 — loyalty ativado entra no check nao bloqueante
    // ============================================================
    console.log('Cenario 5 — loyalty opcional refletido sem quebrar ready');
    const enabledProgram = (
      await ownerAS.query('select public.set_loyalty_program_enabled($1, true) as out', [orgA])
    ).rows[0].out;
    ok(enabledProgram.program?.enabled === true, 'programa de fidelidade habilitado no setup');
    const withLoyalty = await readiness(ownerAS, orgA);
    const loyaltyCheck = (withLoyalty.checks ?? []).find((c) => c.code === 'loyalty');
    ok(loyaltyCheck?.ok === true, 'loyalty derivado como ok apos habilitar programa');
    ok(
      withLoyalty.ready === true && withLoyalty.blocking_ok === 9,
      'ready permanece true com loyalty opcional',
    );

    // ============================================================
    // Cenario 5 — team RPCs: autenticacao e autorizacao (owner-only)
    // ============================================================
    console.log('Cenario 5 — team RPCs exigem owner');
    await expectError(
      anon,
      'select public.get_org_members_admin($1)',
      [orgA],
      '42501',
      'anon nao executa lista de membros (revogado)',
    );
    await expectError(
      noSubS,
      'select public.get_org_members_admin($1)',
      [orgA],
      'PED67',
      'autenticado sem sub nao lista membros',
    );
    await expectError(
      managerAS,
      'select public.get_org_members_admin($1)',
      [orgA],
      'PED69',
      'manager nao lista membros (owner-only)',
    );
    await expectError(
      operatorAS,
      'select public.get_org_members_admin($1)',
      [orgA],
      'PED69',
      'operator nao lista membros',
    );
    await expectError(
      ownerBS,
      'select public.get_org_members_admin($1)',
      [orgA],
      'PED69',
      'owner de outro tenant nao lista membros alheios',
    );

    await expectError(
      anon,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, managerA.id, unitA1],
      '42501',
      'anon nao executa assign (revogado)',
    );
    await expectError(
      managerAS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, operatorA.id, unitA1],
      'PED69',
      'manager nao vincula unidade (owner-only)',
    );
    await expectError(
      operatorAS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, managerA.id, unitA1],
      'PED69',
      'operator nao vincula unidade',
    );
    await expectError(
      ownerBS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, managerA.id, unitA1],
      'PED69',
      'owner de outro tenant nao vincula unidade alheia',
    );

    await expectError(
      managerAS,
      'select public.remove_unit_from_member($1, $2, $3)',
      [orgA, operatorA.id, unitA1],
      'PED69',
      'manager nao remove vinculo (owner-only)',
    );
    await expectError(
      ownerBS,
      'select public.remove_unit_from_member($1, $2, $3)',
      [orgA, managerA.id, unitA1],
      'PED69',
      'owner de outro tenant nao remove vinculo alheio',
    );

    const ownerMembers = await membersAdmin(ownerAS, orgA);
    const managerEntry = (ownerMembers ?? []).find((m) => m.id === managerA.id);
    ok(managerEntry !== undefined, 'owner lista o manager entre os membros');
    ok(
      Array.isArray(managerEntry?.unit_ids) && managerEntry.unit_ids.length === 0,
      'manager começa sem vinculo de unidade',
    );
    ok(
      Object.keys(managerEntry ?? {})
        .sort()
        .join(',') === 'created_at,email,full_name,id,role,unit_ids',
      'get_org_members_admin expoe somente os campos previstos',
    );

    // ============================================================
    // Cenario 6 — atribuir/remover unidade (owner, transacional)
    // ============================================================
    console.log('Cenario 6 — assign/remove de unidade via RPC owner-only');
    const assign1 = (
      await ownerAS.query('select public.assign_unit_to_member($1, $2, $3) as out', [
        orgA,
        managerA.id,
        unitA1,
      ])
    ).rows[0].out;
    ok(assign1.assigned === true && assign1.already_assigned === false, 'primeira atribuicao ok');

    const assign2 = (
      await ownerAS.query('select public.assign_unit_to_member($1, $2, $3) as out', [
        orgA,
        managerA.id,
        unitA1,
      ])
    ).rows[0].out;
    ok(
      assign2.assigned === false && assign2.already_assigned === true,
      'atribuicao repetida e idempotente',
    );

    const memberCount1 = (
      await admin.query(
        'select count(*)::integer as n from public.membership_units where organization_id = $1 and user_id = $2 and unit_id = $3',
        [orgA, managerA.id, unitA1],
      )
    ).rows[0].n;
    ok(memberCount1 === 1, 'exatamente um vinculo persistido');

    const membersAfterAssign = await membersAdmin(ownerAS, orgA);
    const managerLinked = (membersAfterAssign ?? []).find((m) => m.id === managerA.id);
    ok(
      managerLinked?.unit_ids?.length === 1 && managerLinked.unit_ids[0] === unitA1,
      'get_org_members_admin reflete o vinculo recém-criado',
    );

    await expectError(
      ownerAS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, noOrgUser.id, unitA1],
      'PED70',
      'atribuir para quem nao e membro gera MEMBER_NOT_FOUND',
    );
    await expectError(
      ownerAS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, managerA.id, randomUUID()],
      'PED71',
      'atribuir unidade inexistente gera UNIT_NOT_FOUND',
    );
    await expectError(
      ownerAS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, managerA.id, unitB1],
      'PED71',
      'atribuir unidade de outro tenant gera UNIT_NOT_FOUND',
    );

    const inactiveUnit = (
      await admin.query(
        `insert into public.units (organization_id, name, is_active)
         values ($1, 'Inativa Pilot', false) returning id`,
        [orgA],
      )
    ).rows[0].id;
    await expectError(
      ownerAS,
      'select public.assign_unit_to_member($1, $2, $3)',
      [orgA, managerA.id, inactiveUnit],
      'PED71',
      'atribuir unidade inativa gera UNIT_NOT_FOUND',
    );

    const remove1 = (
      await ownerAS.query('select public.remove_unit_from_member($1, $2, $3) as out', [
        orgA,
        managerA.id,
        unitA1,
      ])
    ).rows[0].out;
    ok(remove1.removed === true, 'primeira remocao ok');

    const remove2 = (
      await ownerAS.query('select public.remove_unit_from_member($1, $2, $3) as out', [
        orgA,
        managerA.id,
        unitA1,
      ])
    ).rows[0].out;
    ok(remove2.removed === false, 'remocao repetida reporta removed=false');

    const memberCount2 = (
      await admin.query(
        'select count(*)::integer as n from public.membership_units where organization_id = $1 and user_id = $2 and unit_id = $3',
        [orgA, managerA.id, unitA1],
      )
    ).rows[0].n;
    ok(memberCount2 === 0, 'vinculo fisicamente removido');

    await expectError(
      ownerAS,
      'select public.remove_unit_from_member($1, $2, $3)',
      [orgA, noOrgUser.id, unitA1],
      'PED70',
      'remover de quem nao e membro gera MEMBER_NOT_FOUND',
    );

    // ============================================================
    // Cenario 7 — nenhuma escrita direta em membership_units
    // ============================================================
    console.log('Cenario 7 — membership_units nao aceita escrita direta');
    await expectDenied(
      managerAS,
      'insert into public.membership_units (organization_id, user_id, unit_id) values ($1, $2, $3)',
      [orgA, managerA.id, unitA1],
      'manager nao insere vinculo diretamente',
    );
    await expectDenied(
      operatorAS,
      'insert into public.membership_units (organization_id, user_id, unit_id) values ($1, $2, $3)',
      [orgA, operatorA.id, unitA1],
      'operator nao insere vinculo diretamente',
    );
    await expectDenied(
      ownerAS,
      'insert into public.membership_units (organization_id, user_id, unit_id) values ($1, $2, $3)',
      [orgA, ownerA.id, unitA1],
      'owner tambem nao insere vinculo diretamente (via RPC)',
    );

    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3)`,
      [orgA, operatorA.id, unitA1],
    );
    await expectDenied(
      ownerAS,
      'delete from public.membership_units where organization_id = $1 and user_id = $2 and unit_id = $3',
      [orgA, operatorA.id, unitA1],
      'owner nao remove vinculo direto (somente RPC)',
    );
    const linkStillThere = (
      await admin.query(
        'select count(*)::integer as n from public.membership_units where organization_id = $1 and user_id = $2 and unit_id = $3',
        [orgA, operatorA.id, unitA1],
      )
    ).rows[0].n;
    ok(linkStillThere === 1, 'vinculo direto permanece apos delete do owner (somente RPC remove)');

    // ============================================================
    // Cenario 8 — grants: RPCs somente para authenticated
    // ============================================================
    console.log('Cenario 8 — grants das RPCs novas nao vazam para PUBLIC/anon');
    const rpcGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.routine_privileges
       where specific_schema = 'public'
         and routine_name in ('get_org_pilot_readiness','get_org_members_admin','assign_unit_to_member','remove_unit_from_member')`,
    );
    const leakedToPublic = rpcGrants.rows.some(
      (row) => row.grantee === 'PUBLIC' || row.grantee === 'anon',
    );
    ok(leakedToPublic === false, 'nenhuma das 4 RPCs novas e executavel por PUBLIC/anon');
    const uniqueRoutines = new Set(rpcGrants.rows.map((row) => row.routine_name));
    ok(uniqueRoutines.size === 4, 'todas as 4 RPCs novas possuem grants registrados');

    const rpcSecurity = await admin.query(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('get_org_pilot_readiness','get_org_members_admin','assign_unit_to_member','remove_unit_from_member')`,
    );
    ok(
      rpcSecurity.rows.length === 4 && rpcSecurity.rows.every((row) => row.prosecdef === true),
      'todas as 4 RPCs novas usam SECURITY DEFINER',
    );
    ok(
      rpcSecurity.rows.every(
        (row) => Array.isArray(row.proconfig) && row.proconfig.includes('search_path=""'),
      ),
      'todas as 4 RPCs novas fixam search_path vazio',
    );

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
  console.error(`MENSAGEM: ${error.message ?? error}`);
  console.error(`QUERY: ${error.query ?? '-'}`);
  process.exitCode = 1;
});
