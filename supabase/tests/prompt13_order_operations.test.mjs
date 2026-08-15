import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from './db-test-config.mjs';

// Suite Prompt 13 - Backend Operational Core.
//
// Cobre:
//   - Auth/ACL da v2 e do KDS.
//   - Filtros server-side da v2 (view, statuses, service_mode,
//     payment_status, payment_method, order_number, date_from,
//     date_to).
//   - Validacao do contrato de filtro (PED79).
//   - Active urgency server-authoritative e snapshot_at congelado.
//   - History keyset pagination.
//   - KDS minimizado (PII ausente, statuses restritos, ordenacao).
//   - NEW-MEDIUM-1: publish || create_catalog_product_option_group
//     e publish || create_catalog_product_option nao devem gerar
//     40P01 (deadlock detectado) apos o fix Alternative B.
//   - Cross-tenant isolamento.

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
    ok(error.code === expectedCode, `${label} (codigo esperado ${expectedCode})`);
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

async function adminV2(client, unitId, filters = {}) {
  return (
    await client.query('select public.get_unit_orders_admin_v2($1, $2::jsonb) as out', [
      unitId,
      JSON.stringify(filters),
    ])
  ).rows[0].out;
}

async function kds(client, unitId) {
  return (await client.query('select public.get_kds_orders_minimal($1) as out', [unitId])).rows[0]
    .out;
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
      { method: 'debit_card', is_enabled: true },
    ],
  };
}

const BASE_CUSTOMER = {
  name: 'Cliente Prompt13',
  phone: '11988887777',
};

const BASE_DELIVERY_ADDRESS = {
  street: 'Rua de Teste',
  number: '100',
  neighborhood: 'Bairro Teste',
  city: 'Cidade Teste',
  state: 'SP',
  postal_code: '01001000',
};

function makePayload(menu, items, overrides = {}) {
  const base = {
    menu_version_id: menu.menu.version_id,
    operation_revision: menu.operation.revision,
    service_mode: 'pickup',
    payment_method: 'pix',
    customer: { ...BASE_CUSTOMER },
    items,
    notes: null,
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

function productByName(menu, name) {
  for (const category of menu.categories ?? []) {
    const product = (category.products ?? []).find((entry) => entry.name === name);
    if (product) return product;
  }
  return null;
}

async function withTwoSessions(userId, callback) {
  const first = await sessionFor(userId);
  const second = await sessionFor(userId);
  try {
    return await callback(first, second);
  } finally {
    await first.end().catch(() => {});
    await second.end().catch(() => {});
  }
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
  let ownerAS;
  let managerAS;
  let operatorAS;
  let ownerBS;
  let anon;
  let orgA;
  let orgB;
  let unitA1;
  let unitB1;
  let slugA1;
  let categoryA1;
  let productA1;
  let createdOrders = [];

  try {
    scenario(0, 'setup sintetico de tenants, RBAC, catalogo e publicacao');
    ownerA = await createTestUser(admin, `p13-owner-a-${suffix}@pedon-test.invalid`);
    managerA = await createTestUser(admin, `p13-manager-a-${suffix}@pedon-test.invalid`);
    operatorA = await createTestUser(admin, `p13-operator-a-${suffix}@pedon-test.invalid`);
    ownerB = await createTestUser(admin, `p13-owner-b-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, ownerB.id);

    ownerAS = await sessionFor(ownerA.id);
    managerAS = await sessionFor(managerA.id);
    operatorAS = await sessionFor(operatorA.id);
    ownerBS = await sessionFor(ownerB.id);
    anon = await anonClient();
    openClients.push(ownerAS, managerAS, operatorAS, ownerBS, anon);

    orgA = (
      await ownerAS.query(`select public.complete_onboarding($1) as org`, [
        `Organizacao P13 A ${suffix}`,
      ])
    ).rows[0].org;
    createdOrgIds.push(orgA);
    orgB = (
      await ownerBS.query(`select public.complete_onboarding($1) as org`, [
        `Organizacao P13 B ${suffix}`,
      ])
    ).rows[0].org;
    createdOrgIds.push(orgB);

    unitA1 = (
      await admin.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    unitB1 = (
      await admin.query(
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

    await saveConfig(ownerAS, unitA1, operationalConfig());
    await saveConfig(ownerBS, unitB1, operationalConfig());

    categoryA1 = await createCategory(ownerAS, unitA1, `Categoria P13 ${suffix}`);
    productA1 = await createProduct(ownerAS, unitA1, categoryA1.id, 'Produto P13', '10.00');

    const categoryB1 = await createCategory(ownerBS, unitB1, `Categoria P13 B ${suffix}`);
    await createProduct(ownerBS, unitB1, categoryB1.id, 'Produto P13 B', '11.00');

    const pubA1 = await publish(ownerAS, unitA1);
    slugA1 = pubA1.public_slug;
    await publish(ownerBS, unitB1);

    const menuA1 = await publicMenu(anon, slugA1);
    const productA1Menu = productByName(menuA1, 'Produto P13');

    // Criar 24 pedidos variando service_mode e payment_method.
    const serviceModes = ['pickup', 'delivery'];
    const paymentMethods = ['cash', 'pix', 'credit_card', 'debit_card'];
    for (let i = 0; i < 24; i++) {
      const key = randomUUID();
      const serviceMode = serviceModes[i % serviceModes.length];
      const paymentMethod = paymentMethods[i % paymentMethods.length];
      const payload =
        serviceMode === 'pickup'
          ? makePayload(menuA1, [{ menu_item_id: productA1Menu.id, quantity: 1, note: null }], {
              payment_method: paymentMethod,
            })
          : deliveryPayload(menuA1, [{ menu_item_id: productA1Menu.id, quantity: 1, note: null }], {
              payment_method: paymentMethod,
            });
      const creation = await checkout(anon, slugA1, key, payload);
      const orderId = await orderIdForCreation(ownerAS, creation);
      createdOrders.push({ id: orderId, service_mode: serviceMode, payment_method: paymentMethod });
    }

    // Distribuir transicoes para criar variacao de status. Mapeamento
    // deterministico por indice para garantir distribuicao.
    for (let i = 0; i < createdOrders.length; i++) {
      const order = createdOrders[i];
      const client = i % 2 === 0 ? ownerAS : operatorAS;
      const slot = i % 6;
      if (slot === 1) {
        await setStatus(client, order.id, 'confirmed');
      } else if (slot === 2) {
        await setStatus(client, order.id, 'confirmed');
        await setStatus(client, order.id, 'preparing');
      } else if (slot === 3) {
        if (order.service_mode === 'delivery') {
          await setStatus(client, order.id, 'confirmed');
          await setStatus(client, order.id, 'preparing');
          await setStatus(client, order.id, 'ready');
          await setStatus(client, order.id, 'out_for_delivery');
          await setPayment(client, order.id, 'paid');
          await setStatus(client, order.id, 'completed');
        } else {
          await setStatus(client, order.id, 'confirmed');
          await setStatus(client, order.id, 'preparing');
          await setStatus(client, order.id, 'ready');
          await setPayment(client, order.id, 'paid');
          await setStatus(client, order.id, 'completed');
        }
      } else if (slot === 4) {
        await setStatus(client, order.id, 'cancelled');
      } else if (slot === 5) {
        await setStatus(client, order.id, 'confirmed');
        await setStatus(client, order.id, 'preparing');
        await setStatus(client, order.id, 'ready');
      }
    }

    // Re-fetch orders com timestamps e status atual.
    const ordersRows = await admin.query(
      `select id, order_number, status, payment_status, service_mode, payment_method,
              created_at, status_updated_at, estimated_minutes
         from public.orders where unit_id = $1
        order by created_at asc, id asc`,
      [unitA1],
    );
    createdOrders = ordersRows.rows;

    scenario(1, 'v2: auth e ACL');
    await expectDenied(
      anon,
      'select public.get_unit_orders_admin_v2($1, $2::jsonb)',
      [unitA1, '{}'],
      '1.0 anon bloqueado',
    );
    await expectError(
      ownerBS,
      'select public.get_unit_orders_admin_v2($1, $2::jsonb)',
      [unitA1, '{}'],
      'PED11',
      '1.1 cross-tenant retorna PED11',
    );
    await expectError(
      ownerAS,
      'select public.get_unit_orders_admin_v2($1, $2::jsonb)',
      [randomUUID(), '{}'],
      'PED12',
      '1.2 unit inexistente retorna PED12',
    );

    scenario(2, 'v2: view default active e total_count respeita filtros');
    const v2ActiveDefault = await adminV2(ownerAS, unitA1);
    ok(v2ActiveDefault.view === 'active', '2.0 default view=active');
    ok(v2ActiveDefault.snapshot_at !== null, '2.1 active carrega snapshot_at');
    ok(
      v2ActiveDefault.total_count >= 0 &&
        Array.isArray(v2ActiveDefault.orders) &&
        v2ActiveDefault.orders.length <= v2ActiveDefault.total_count,
      '2.2 total_count coerente',
    );
    const allActive = v2ActiveDefault.orders.every((entry) =>
      ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(entry.status),
    );
    ok(allActive, '2.3 default active exclui terminais');

    const v2HistoryDefault = await adminV2(ownerAS, unitA1, { view: 'history' });
    ok(v2HistoryDefault.view === 'history', '2.4 view=history aceito');
    ok(v2HistoryDefault.snapshot_at === null, '2.5 history carrega snapshot_at null');
    const allHistory = v2HistoryDefault.orders.every((entry) =>
      ['completed', 'cancelled'].includes(entry.status),
    );
    ok(allHistory, '2.6 history exclui ativos');

    scenario(3, 'v2: filtros server-side por status/payment/service/method/date/order_number');
    const v2Ready = await adminV2(ownerAS, unitA1, { view: 'active', statuses: ['ready'] });
    ok(
      v2Ready.orders.every((entry) => entry.status === 'ready'),
      '3.0 filtro status=ready aplicado',
    );
    const v2Delivery = await adminV2(ownerAS, unitA1, {
      view: 'active',
      service_mode: 'delivery',
    });
    ok(
      v2Delivery.orders.every((entry) => entry.service_mode === 'delivery'),
      '3.1 filtro service_mode=delivery aplicado',
    );
    const v2Pix = await adminV2(ownerAS, unitA1, {
      view: 'active',
      payment_method: 'pix',
    });
    ok(
      v2Pix.orders.every((entry) => entry.payment_method === 'pix'),
      '3.2 filtro payment_method=pix aplicado',
    );
    const v2Pending = await adminV2(ownerAS, unitA1, {
      view: 'active',
      payment_status: 'pending',
    });
    ok(
      v2Pending.orders.every((entry) => entry.payment_status === 'pending'),
      '3.3 filtro payment_status=pending aplicado',
    );
    const historyOrder = createdOrders.find((entry) =>
      ['completed', 'cancelled'].includes(entry.status),
    );
    const v2ByNumber = await adminV2(ownerAS, unitA1, {
      view: 'history',
      order_number: historyOrder?.order_number,
    });
    ok(
      v2ByNumber.total_count === 1 &&
        String(v2ByNumber.orders[0]?.order_number) === String(historyOrder?.order_number),
      '3.4 filtro order_number aplicado',
    );
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const v2ByFutureDate = await adminV2(ownerAS, unitA1, { date_from: futureDate });
    ok(v2ByFutureDate.total_count === 0, '3.5 filtro date_from futuro retorna 0');
    await expectError(
      ownerAS,
      'select public.get_unit_orders_admin_v2($1, $2::jsonb)',
      [unitA1, JSON.stringify({ date_from: futureDate, date_to: new Date().toISOString() })],
      'PED79',
      '3.6 date_from > date_to retorna PED79',
    );

    scenario(4, 'v2: contrato de filtro retorna PED79');
    const cases = [
      { name: 'unknown_key', value: { foo: 'bar' } },
      { name: 'bad_view', value: { view: 'unknown' } },
      { name: 'bad_service_mode', value: { service_mode: 'drone' } },
      { name: 'bad_payment_status', value: { payment_status: 'partial' } },
      { name: 'bad_payment_method', value: { payment_method: 'crypto' } },
      { name: 'bad_order_number_zero', value: { order_number: 0 } },
      { name: 'bad_order_number_negative', value: { order_number: -1 } },
      { name: 'bad_date_from', value: { date_from: 'ontem' } },
      { name: 'bad_date_to', value: { date_to: 'amanha' } },
      { name: 'limit_zero', value: { limit: 0 } },
      { name: 'limit_too_high', value: { limit: 101 } },
      { name: 'limit_negative', value: { limit: -1 } },
      { name: 'limit_non_integer', value: { limit: 'dez' } },
      {
        name: 'bad_cursor_b64',
        value: { cursor: 'not-base64!!!' },
      },
      {
        name: 'bad_cursor_view_mismatch',
        value: {
          cursor: Buffer.from(
            JSON.stringify({
              v: 'history',
              c: new Date().toISOString(),
              id: randomUUID(),
            }),
          ).toString('base64'),
        },
      },
      {
        name: 'bad_cursor_id',
        value: {
          cursor: Buffer.from(
            JSON.stringify({
              v: 'active',
              snap: new Date().toISOString(),
              or: 0,
              sb: 0,
              su: new Date().toISOString(),
              c: new Date().toISOString(),
              id: 'not-a-uuid',
            }),
          ).toString('base64'),
        },
      },
      {
        name: 'bad_cursor_missing_fields',
        value: {
          cursor: Buffer.from(
            JSON.stringify({
              v: 'active',
              snap: new Date().toISOString(),
              c: new Date().toISOString(),
              id: randomUUID(),
            }),
          ).toString('base64'),
        },
      },
      {
        name: 'view_active_with_completed_status',
        value: { view: 'active', statuses: ['completed'] },
      },
      {
        name: 'view_history_with_new_status',
        value: { view: 'history', statuses: ['new'] },
      },
    ];
    for (const caseEntry of cases) {
      await expectError(
        ownerAS,
        'select public.get_unit_orders_admin_v2($1, $2::jsonb)',
        [unitA1, JSON.stringify(caseEntry.value)],
        'PED79',
        `4.x filtro invalido (${caseEntry.name}) retorna PED79`,
      );
    }

    scenario(5, 'v2: active urgency server-authoritative e snapshot_at congelado');
    // Forcar oldest active como overdue.
    const oldestActive = createdOrders
      .filter((entry) =>
        ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(entry.status),
      )
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    if (oldestActive) {
      await admin.query(
        `update public.orders
            set created_at = now() - interval '2 hours',
                estimated_minutes = 5
          where id = $1`,
        [oldestActive.id],
      );
    }
    const v2First = await adminV2(ownerAS, unitA1, { view: 'active', limit: 100 });
    if (oldestActive) {
      const present = v2First.orders.find((entry) => entry.id === oldestActive.id);
      ok(present !== undefined, '5.0 pedido forcado como overdue presente');
      if (present && v2First.orders.length >= 2) {
        ok(v2First.orders[0].id === oldestActive.id, '5.1 pedido priorizado na ordenacao');
      }
    } else {
      ok(true, '5.0 sem pedidos ativos suficientes');
    }

    if (v2First.orders.length > 5 && v2First.page_info.next_cursor) {
      const firstSnapshot = v2First.snapshot_at;
      const v2Second = await adminV2(ownerAS, unitA1, {
        view: 'active',
        limit: 5,
        cursor: v2First.page_info.next_cursor,
      });
      ok(v2Second.snapshot_at === firstSnapshot, '5.2 snapshot_at preservado entre paginas');
      const idsFirst = new Set(v2First.orders.map((entry) => entry.id));
      const dup = v2Second.orders.find((entry) => idsFirst.has(entry.id));
      ok(!dup, '5.3 segunda pagina nao duplica pedidos');
    } else {
      ok(true, '5.2 sem paginacao para validar (dataset pequeno)');
    }

    scenario(6, 'v2: history keyset pagination');
    const historyCount = createdOrders.filter((entry) =>
      ['completed', 'cancelled'].includes(entry.status),
    ).length;
    if (historyCount >= 6) {
      const v2HistFirst = await adminV2(ownerAS, unitA1, { view: 'history', limit: 5 });
      ok(v2HistFirst.orders.length <= 5, '6.0 history limit respeitado');
      ok(v2HistFirst.page_info.has_more === true, '6.1 history has_more=true quando > limit');
      if (v2HistFirst.page_info.next_cursor) {
        const cursorValue = v2HistFirst.page_info.next_cursor;
        const v2HistSecond = await adminV2(ownerAS, unitA1, {
          view: 'history',
          limit: 5,
          cursor: cursorValue,
        }).catch((e) => {
          let decoded = 'n/a';
          try {
            decoded = Buffer.from(
              cursorValue.replace(/-/g, '+').replace(/_/g, '/'),
              'base64',
            ).toString('utf8');
          } catch {
            /* ignore */
          }
          console.log(`    DIAG history cursor=${cursorValue}`);
          console.log(`    DIAG history cursor decoded=${decoded}`);
          console.log(`    DIAG history cursor error code=${e.code} msg=${e.message}`);
          throw e;
        });
        const idsFirst = new Set(v2HistFirst.orders.map((entry) => entry.id));
        const dup = v2HistSecond.orders.find((entry) => idsFirst.has(entry.id));
        ok(!dup, '6.2 history sem duplicacao entre paginas');
        let cursor = v2HistSecond.page_info.next_cursor;
        const seen = new Set([...idsFirst, ...v2HistSecond.orders.map((e) => e.id)]);
        for (let pageCount = 0; pageCount < 20 && cursor; pageCount += 1) {
          const next = await adminV2(ownerAS, unitA1, { view: 'history', limit: 5, cursor });
          for (const entry of next.orders) seen.add(entry.id);
          cursor = next.page_info.next_cursor;
          if (!next.page_info.has_more) break;
        }
        const expected = new Set(
          createdOrders
            .filter((entry) => ['completed', 'cancelled'].includes(entry.status))
            .map((entry) => entry.id),
        );
        const missing = [...expected].filter((id) => !seen.has(id));
        const extra = [...seen].filter((id) => !expected.has(id));
        ok(
          missing.length === 0,
          `6.3 history cobriu todos os terminais (faltando ${missing.length})`,
        );
        ok(extra.length === 0, `6.4 history sem pedidos nao-terminais (extras ${extra.length})`);
      }
    } else {
      ok(true, '6.0 sem pedidos suficientes para history');
    }

    scenario(
      7,
      'v2: lista nao retorna PII sensivel (telefone/endereco/notes/tracking/idempotency)',
    );
    const sample = v2First.orders[0];
    if (sample) {
      ok(!('customer_phone' in sample), '7.0 customer_phone ausente');
      ok(!('delivery_address' in sample), '7.1 delivery_address ausente');
      ok(!('notes' in sample), '7.2 notes ausente');
      ok(!('tracking_token' in sample), '7.3 tracking_token ausente');
      ok(!('idempotency_key' in sample), '7.4 idempotency_key ausente');
      ok(!('request_hash' in sample), '7.5 request_hash ausente');
      ok(!('loyalty_membership_id' in sample), '7.6 loyalty_membership_id ausente');
    } else {
      ok(true, '7.0 sem pedidos para inspecionar');
    }

    scenario(8, 'KDS: auth e ACL');
    await expectDenied(
      anon,
      'select public.get_kds_orders_minimal($1)',
      [unitA1],
      '8.0 anon bloqueado',
    );
    await expectError(
      ownerBS,
      'select public.get_kds_orders_minimal($1)',
      [unitA1],
      'PED11',
      '8.1 cross-tenant retorna PED11',
    );
    await expectError(
      ownerAS,
      'select public.get_kds_orders_minimal($1)',
      [randomUUID()],
      'PED12',
      '8.2 unit inexistente retorna PED12',
    );

    scenario(9, 'KDS: operator autorizado para leitura');
    const kdsOperator = await kds(operatorAS, unitA1);
    ok(kdsOperator.unit?.id === unitA1, '9.0 operator le KDS');

    scenario(10, 'KDS: somente statuses new/confirmed/preparing/ready; minimizado');
    const kdsPayload = await kds(ownerAS, unitA1);
    const statusValues = kdsPayload.orders.map((entry) => entry.status);
    const onlyKitchen = statusValues.every((entry) =>
      ['new', 'confirmed', 'preparing', 'ready'].includes(entry),
    );
    ok(onlyKitchen, '10.0 somente statuses de cozinha');
    if (kdsPayload.orders.length > 0) {
      const firstOrder = kdsPayload.orders[0];
      const forbidden = [
        'customer_name',
        'customer_phone',
        'delivery_address',
        'delivery_street',
        'delivery_number',
        'delivery_neighborhood',
        'delivery_city',
        'delivery_state',
        'delivery_postal_code',
        'delivery_reference',
        'payment_method',
        'payment_status',
        'subtotal',
        'delivery_fee',
        'total',
        'cash_change_for',
        'tracking_token',
        'idempotency_key',
        'request_hash',
        'loyalty_membership_id',
      ];
      const json = JSON.stringify(firstOrder);
      for (const field of forbidden) {
        ok(!json.includes(field), `10.x KDS sem ${field}`);
      }
      ok(typeof firstOrder.expected_at !== 'undefined', '10.4 expected_at presente');
      ok(typeof firstOrder.items !== 'undefined', '10.5 items presente');
      for (const item of firstOrder.items ?? []) {
        const itemJson = JSON.stringify(item);
        ok(!itemJson.includes('price_delta'), '10.x item sem price_delta');
      }
    } else {
      ok(true, '10.1 KDS sem pedidos neste momento');
    }

    scenario(11, 'KDS: ordenacao deterministica');
    if (kdsPayload.orders.length >= 2) {
      const bucket = (status) =>
        status === 'new' ? 0 : status === 'confirmed' ? 1 : status === 'preparing' ? 2 : 3;
      let monotonic = true;
      for (let i = 1; i < kdsPayload.orders.length; i++) {
        const prev = kdsPayload.orders[i - 1];
        const curr = kdsPayload.orders[i];
        if (bucket(prev.status) > bucket(curr.status)) {
          monotonic = false;
          break;
        }
      }
      ok(monotonic, '11.0 KDS ordenado por bucket operacional ascendente');
    } else {
      ok(true, '11.0 sem pedidos suficientes para KDS');
    }

    scenario(12, 'KDS: snapshots imutaveis');
    const kdsBefore = await kds(ownerAS, unitA1);
    if (kdsBefore.orders.length > 0) {
      const firstKds = kdsBefore.orders[0];
      await admin.query(
        `update public.catalog_products set name = 'Produto Renomeado P13' where id = $1`,
        [productA1.id],
      );
      const kdsAfter = await kds(ownerAS, unitA1);
      const sameOrder = kdsAfter.orders.find((entry) => entry.id === firstKds.id);
      if (sameOrder) {
        const productInKds = sameOrder.items[0]?.product_name;
        ok(
          productInKds === 'Produto P13',
          '12.0 KDS continua retornando nome snapshot apos renomeacao',
        );
      } else {
        ok(true, '12.0 pedido nao esta no KDS apos alteracao');
      }
      // Restaurar para proximos testes.
      await admin.query(`update public.catalog_products set name = 'Produto P13' where id = $1`, [
        productA1.id,
      ]);
    } else {
      ok(true, '12.0 sem pedidos para testar snapshot');
    }

    scenario(13, 'NEW-MEDIUM-1: publish || create_catalog_product_option_group nao gera 40P01');
    const createGroupResult = await withTwoSessions(ownerA.id, async (s1, s2) => {
      const results = await Promise.allSettled([
        s1.query('select public.publish_unit_menu($1) as out', [unitA1]),
        s2.query(
          `select * from public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)`,
          [unitA1, productA1.id, `Grupo Concorrente ${suffix}`, 'addon', 'multiple', 0, 5],
        ),
      ]);
      return results;
    });
    const allFulfilled = createGroupResult.every((entry) => entry.status === 'fulfilled');
    ok(allFulfilled, '13.0 publish + create group cumprem');
    const deadlock = createGroupResult.find(
      (entry) => entry.status === 'rejected' && entry.reason?.code === '40P01',
    );
    ok(!deadlock, '13.1 zero 40P01 em publish || create group');

    scenario(14, 'NEW-MEDIUM-1: publish || create_catalog_product_option nao gera 40P01');
    const groupRow = await admin.query(
      `select id from public.catalog_product_option_groups
        where unit_id = $1 and name = $2 limit 1`,
      [unitA1, `Grupo Concorrente ${suffix}`],
    );
    const groupId = groupRow.rows[0]?.id;
    if (groupId) {
      const createOptionResult = await withTwoSessions(ownerA.id, async (s1, s2) => {
        const results = await Promise.allSettled([
          s1.query('select public.publish_unit_menu($1) as out', [unitA1]),
          s2.query('select * from public.create_catalog_product_option($1, $2, $3)', [
            groupId,
            `Opcao Concorrente ${suffix}`,
            '1.50',
          ]),
        ]);
        return results;
      });
      const allFulfilled2 = createOptionResult.every((entry) => entry.status === 'fulfilled');
      ok(allFulfilled2, '14.0 publish + create option cumprem');
      const deadlock2 = createOptionResult.find(
        (entry) => entry.status === 'rejected' && entry.reason?.code === '40P01',
      );
      ok(!deadlock2, '14.1 zero 40P01 em publish || create option');
    } else {
      ok(false, '14.0 grupo nao foi criado para teste');
    }

    scenario(15, 'NEW-MEDIUM-1: duas criacoes simultaneas no mesmo produto preservam sort_order');
    const product2 = await createProduct(
      ownerAS,
      unitA1,
      categoryA1.id,
      'Produto Concorrente',
      '20.00',
    );
    const s1 = await sessionFor(ownerA.id);
    const s2 = await sessionFor(ownerA.id);
    try {
      const parallel = await Promise.allSettled([
        s1.query(
          `select * from public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)`,
          [unitA1, product2.id, `Grupo Concorrente A ${suffix}`, 'variation', 'single', 1, 1],
        ),
        s2.query(
          `select * from public.create_catalog_product_option_group($1, $2, $3, $4, $5, $6, $7)`,
          [unitA1, product2.id, `Grupo Concorrente B ${suffix}`, 'addon', 'multiple', 0, 5],
        ),
      ]);
      ok(
        parallel.every((entry) => entry.status === 'fulfilled'),
        '15.0 ambas as criacoes cumprem',
      );
      const sorted = await admin.query(
        `select sort_order, name from public.catalog_product_option_groups
          where product_id = $1 order by sort_order asc`,
        [product2.id],
      );
      const sortOrders = sorted.rows.map((row) => row.sort_order);
      const uniqueSorts = new Set(sortOrders);
      ok(sortOrders.length === uniqueSorts.size, '15.1 sort_order unico (sem colisao logica)');
      ok(
        sortOrders.every((value) => value > 0 && value % 100 === 0),
        '15.2 sort_order mantem grade de 100',
      );
    } finally {
      await s1.end().catch(() => {});
      await s2.end().catch(() => {});
    }

    scenario(16, 'Regressao minima: get_order_admin ainda responde');
    const sampleOrderId = createdOrders.find(
      (entry) => entry.status === 'new' || entry.status === 'confirmed',
    )?.id;
    if (sampleOrderId) {
      const probe = await ownerAS.query('select public.get_order_admin($1) as out', [
        sampleOrderId,
      ]);
      ok(probe.rows[0].out?.id === sampleOrderId, '16.0 get_order_admin retorna pedido');
    } else {
      ok(true, '16.0 sem pedido ativo para probe');
    }
  } catch (error) {
    failed += 1;
    failures.push(`uncaught: ${error.message}`);
    console.log(`  FAIL  uncaught: ${error.message}`);
    console.log(error.stack);
  } finally {
    for (const client of openClients) {
      await client.end().catch(() => {});
    }
    if (createdUsers.length > 0) {
      await admin.query(`delete from auth.users where id = any($1::uuid[])`, [createdUsers]);
    }
    await admin.end().catch(() => {});
  }

  console.log('');
  console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
  if (failed > 0) {
    console.log('Falhas:', failures);
    process.exit(1);
  }
}

await run();
