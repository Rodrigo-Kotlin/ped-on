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

function defaultConfig(overrides = {}) {
  const config = {
    timezone: 'America/Sao_Paulo',
    pickup_enabled: true,
    delivery_enabled: true,
    delivery_fee: '9.90',
    min_order_value: '25.00',
    estimated_pickup_minutes: 20,
    estimated_delivery_minutes: 45,
    accepting_orders: true,
    business_hours: [
      { weekday: 0, is_open: false, is_24h: false, open_time: null, close_time: null },
      { weekday: 1, is_open: true, is_24h: false, open_time: '09:00', close_time: '18:00' },
      { weekday: 2, is_open: true, is_24h: false, open_time: '09:00', close_time: '18:00' },
      { weekday: 3, is_open: true, is_24h: false, open_time: '09:00', close_time: '18:00' },
      { weekday: 4, is_open: true, is_24h: false, open_time: '09:00', close_time: '18:00' },
      { weekday: 5, is_open: true, is_24h: false, open_time: '18:00', close_time: '03:00' },
      { weekday: 6, is_open: false, is_24h: false, open_time: null, close_time: null },
    ],
    payment_methods: [
      { method: 'cash', is_enabled: true },
      { method: 'pix', is_enabled: true },
      { method: 'credit_card', is_enabled: false },
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

function oneDay(weekday, overrides = {}) {
  return {
    weekday,
    is_open: false,
    is_24h: false,
    open_time: null,
    close_time: null,
    ...overrides,
  };
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  try {
    const ownerA = await createTestUser(admin, `p05-owner-a-${suffix}@pedon-test.invalid`);
    const managerA = await createTestUser(admin, `p05-manager-a-${suffix}@pedon-test.invalid`);
    const operatorA = await createTestUser(admin, `p05-operator-a-${suffix}@pedon-test.invalid`);
    const ownerB = await createTestUser(admin, `p05-owner-b-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, ownerB.id);

    const ownerAS = await sessionFor(ownerA.id);
    const managerAS = await sessionFor(managerA.id);
    const operatorAS = await sessionFor(operatorA.id);
    const ownerBS = await sessionFor(ownerB.id);
    const noSubS = await authedNoSubClient();
    openClients.push(ownerAS, managerAS, operatorAS, ownerBS, noSubS);

    const orgA = (await ownerAS.query(`select public.complete_onboarding('Org A Config') as org`))
      .rows[0].org;
    const unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    const unitA2 = (await ownerAS.query('select (public.create_unit($1)).id as u', ['Filial A2']))
      .rows[0].u;
    createdOrgIds.push(orgA);

    const orgB = (await ownerBS.query(`select public.complete_onboarding('Org B Config') as org`))
      .rows[0].org;
    const unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB],
      )
    ).rows[0].id;
    createdOrgIds.push(orgB);

    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'manager'), ($1, $3, 'operator')`,
      [orgA, managerA.id, operatorA.id],
    );
    await admin.query(
      `insert into public.membership_units (organization_id, user_id, unit_id)
       values ($1, $2, $3), ($1, $4, $5)`,
      [orgA, managerA.id, unitA1, operatorA.id, unitA2],
    );

    // ============================================================
    // Autorização e contrato de acesso
    // ============================================================
    {
      console.log('Cenário 1 — defaults: config completa em unidade nunca configurada');
      const { rows } = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA1,
      ]);
      const cfg = rows[0].cfg;
      ok(cfg.timezone === 'America/Sao_Paulo', 'timezone default America/Sao_Paulo');
      ok(
        cfg.pickup_enabled === true && cfg.delivery_enabled === false,
        'default pickup ativo, delivery inativo',
      );
      ok(
        cfg.delivery_fee === '0.00' && cfg.min_order_value === '0.00',
        'valores default "0.00" como texto (numeric(12,2))',
      );
      ok(cfg.accepting_orders === true, 'accepting_orders default true');
      ok(
        Array.isArray(cfg.business_hours) && cfg.business_hours.length === 7,
        'business_hours tem 7 dias',
      );
      ok(
        cfg.business_hours.every((h) => h.is_open === false),
        'todos os horários default fechados',
      );
      ok(
        Array.isArray(cfg.payment_methods) &&
          cfg.payment_methods.length === 4 &&
          cfg.payment_methods.every((p) => p.is_enabled === false),
        '4 métodos default desativados',
      );
    }

    {
      console.log(
        'Cenário 2 — anon executa a RPC mas é rejeitado com PED10 (padrão do projeto, como create_unit)',
      );
      const anon = await anonClient();
      openClients.push(anon);
      await expectError(
        anon,
        'select public.get_unit_operational_config($1)',
        [unitA1],
        'PED10',
        'anon é rejeitado com PED10 (auth.uid() null)',
      );
      await expectError(
        anon,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig()],
        'PED10',
        'anon é rejeitado no save com PED10',
      );
    }

    {
      console.log('Cenário 3 — usuário authenticated sem sub (não autenticado) recebe PED10');
      await expectError(
        noSubS,
        'select public.get_unit_operational_config($1)',
        [unitA1],
        'PED10',
        'get sem identidade: PED10',
      );
      await expectError(
        noSubS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig()],
        'PED10',
        'save sem identidade: PED10',
      );
    }

    {
      console.log('Cenário 4 — owner lê a própria unidade e unidade inexistente retorna PED12');
      const { rows } = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA1,
      ]);
      ok(rows[0].cfg.unit_id === unitA1, 'owner lê config da própria unidade');
      const missing = '00000000-0000-4000-8000-000000000001';
      await expectError(
        ownerAS,
        'select public.get_unit_operational_config($1)',
        [missing],
        'PED12',
        'unidade inexistente: PED12',
      );
    }

    {
      console.log('Cenário 5 — owner não acessa config de unidade de outra organização');
      await expectError(
        ownerAS,
        'select public.get_unit_operational_config($1)',
        [unitB1],
        'PED11',
        'owner A em unidade de Org B: PED11',
      );
    }

    {
      console.log('Cenário 6 — manager vinculado à unidade consegue ler e salvar');
      const { rows } = await managerAS.query(
        'select public.get_unit_operational_config($1) as cfg',
        [unitA1],
      );
      ok(rows[0].cfg.unit_id === unitA1, 'manager vinculado lê a unidade');
      const saved = await managerAS.query(
        'select public.save_unit_operational_config($1, $2) as cfg',
        [unitA1, defaultConfig()],
      );
      ok(saved.rows[0].cfg.timezone === 'America/Sao_Paulo', 'manager vinculado salva a unidade');
    }

    {
      console.log('Cenário 7 — manager vinculado não acessa unidade sem vínculo');
      await expectError(
        managerAS,
        'select public.get_unit_operational_config($1)',
        [unitA2],
        'PED11',
        'manager sem vínculo em A2: PED11',
      );
    }

    {
      console.log('Cenário 8 — operator não gere configuração operacional');
      await expectError(
        operatorAS,
        'select public.get_unit_operational_config($1)',
        [unitA2],
        'PED11',
        'operator não lê config (PED11)',
      );
      await expectError(
        operatorAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA2, defaultConfig()],
        'PED11',
        'operator não salva config (PED11)',
      );
    }

    {
      console.log('Cenário 9 — escrita direta nas tabelas de configuração continua bloqueada');
      await expectError(
        ownerAS,
        'insert into public.unit_operational_settings (unit_id) values ($1)',
        [unitA1],
        '42501',
        'INSERT direto em settings negado',
      );
      await expectError(
        ownerAS,
        'insert into public.unit_business_hours (unit_id, weekday) values ($1, 0)',
        [unitA1],
        '42501',
        'INSERT direto em business_hours negado',
      );
      await expectError(
        ownerAS,
        'insert into public.unit_payment_methods (unit_id, method) values ($1, $2)',
        [unitA1, 'cash'],
        '42501',
        'INSERT direto em payment_methods negado',
      );
    }

    // ============================================================
    // Validação de configuração (PED14–PED18)
    // ============================================================
    {
      console.log('Cenário 10 — timezone inválida ou vazia: PED14');
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ timezone: 'Mars/Olympus' })],
        'PED14',
        'timezone inexistente: PED14',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ timezone: '   ' })],
        'PED14',
        'timezone vazia: PED14',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ timezone: null })],
        'PED14',
        'timezone null: PED14',
      );
    }

    {
      console.log('Cenário 11 — ao menos uma modalidade é obrigatória: PED15');
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ pickup_enabled: false, delivery_enabled: false })],
        'PED15',
        'sem modalidade ativa: PED15',
      );
    }

    {
      console.log('Cenário 12 — valores monetários inválidos: PED16');
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ delivery_fee: '-1.00' })],
        'PED16',
        'taxa negativa: PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ delivery_fee: '12.345' })],
        'PED16',
        'taxa com 3 casas decimais: PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ min_order_value: 'abc' })],
        'PED16',
        'pedido mínimo não numérico: PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ delivery_fee: '10000000000.00' })],
        'PED16',
        'taxa acima do limite numeric(12,2): PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ delivery_fee: true })],
        'PED16',
        'taxa boolean: PED16',
      );
    }

    {
      console.log('Cenário 13 — ETAs inválidos: PED16');
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ estimated_pickup_minutes: -5 })],
        'PED16',
        'ETA negativo: PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ estimated_delivery_minutes: 1441 })],
        'PED16',
        'ETA acima de 1440: PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ estimated_pickup_minutes: 12.5 })],
        'PED16',
        'ETA fracionário: PED16',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ estimated_delivery_minutes: 'rapido' })],
        'PED16',
        'ETA não numérico: PED16',
      );
    }

    {
      console.log('Cenário 14 — métodos de pagamento inválidos: PED17');
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ payment_methods: [{ method: 'bitcoin', is_enabled: true }] })],
        'PED17',
        'método desconhecido: PED17',
      );
      const duplicated = [
        { method: 'cash', is_enabled: true },
        { method: 'cash', is_enabled: false },
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ payment_methods: duplicated })],
        'PED17',
        'método duplicado: PED17',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ payment_methods: 'cash' })],
        'PED17',
        'payment_methods não-array: PED17',
      );
    }

    {
      console.log('Cenário 15 — horários: quantidade e dias válidos: PED18');
      const onlySix = Array.from({ length: 6 }, (_, i) => oneDay(i));
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: onlySix })],
        'PED18',
        '6 dias apenas: PED18',
      );
      const eightDays = Array.from({ length: 8 }, (_, i) => oneDay(i));
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: eightDays })],
        'PED18',
        '8 dias: PED18',
      );
      const wrongWeekday = [
        oneDay(0),
        oneDay(1),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(9),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: wrongWeekday })],
        'PED18',
        'weekday fora de 0..6: PED18',
      );
      const duplicatedDay = [
        oneDay(0),
        oneDay(0),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: duplicatedDay })],
        'PED18',
        'dia duplicado: PED18',
      );
    }

    {
      console.log('Cenário 16 — horários: regras same-day / virada / 24h');
      const mixed = [
        oneDay(0),
        oneDay(1, { is_open: true, open_time: '09:00', close_time: '18:00' }),
        oneDay(2, { is_open: true, open_time: '18:00', close_time: '03:00' }),
        oneDay(3, { is_open: true, is_24h: true }),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      const saved = await ownerAS.query(
        'select public.save_unit_operational_config($1, $2) as cfg',
        [unitA1, defaultConfig({ business_hours: mixed })],
      );
      const hours = saved.rows[0].cfg.business_hours;
      const day1 = hours.find((h) => h.weekday === 1);
      const day2 = hours.find((h) => h.weekday === 2);
      const day3 = hours.find((h) => h.weekday === 3);
      ok(day1.open_time === '09:00' && day1.close_time === '18:00', 'mesmo dia preservado');
      ok(day2.open_time === '18:00' && day2.close_time === '03:00', 'virada (close < open) aceita');
      ok(day3.is_24h === true && day3.open_time === null, '24h sem horários preservado');
    }

    {
      console.log('Cenário 17 — horários: combinações inválidas: PED18');
      const openWithoutTime = [
        oneDay(0, { is_open: true }),
        oneDay(1),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: openWithoutTime })],
        'PED18',
        'aberto sem horário: PED18',
      );
      const twentyFourWithTime = [
        oneDay(0, { is_open: true, is_24h: true, open_time: '09:00', close_time: '10:00' }),
        oneDay(1),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: twentyFourWithTime })],
        'PED18',
        '24h com horário: PED18',
      );
      const closedWithTime = [
        oneDay(0, { open_time: '09:00', close_time: '10:00' }),
        oneDay(1),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: closedWithTime })],
        'PED18',
        'fechado com horário: PED18',
      );
      const badTime = [
        oneDay(0, { is_open: true, open_time: '25:00', close_time: '18:00' }),
        oneDay(1),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: badTime })],
        'PED18',
        'horário inválido: PED18',
      );
      const missingClose = [
        oneDay(0, { is_open: true, open_time: '09:00', close_time: null }),
        oneDay(1),
        oneDay(2),
        oneDay(3),
        oneDay(4),
        oneDay(5),
        oneDay(6),
      ];
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ business_hours: missingClose })],
        'PED18',
        'fechamento ausente: PED18',
      );
    }

    // ============================================================
    // Precisão monetária (sem ponto flutuante)
    // ============================================================
    {
      console.log('Cenário 18 — valores monetários round-trip exato como texto');
      const moneyCfg = defaultConfig({ delivery_fee: '12.50', min_order_value: '0.05' });
      const saved = await ownerAS.query(
        'select public.save_unit_operational_config($1, $2) as cfg',
        [unitA1, moneyCfg],
      );
      const cfg = saved.rows[0].cfg;
      ok(cfg.delivery_fee === '12.50', 'delivery_fee round-trip "12.50"');
      ok(cfg.min_order_value === '0.05', 'min_order_value round-trip "0.05"');
      ok(typeof cfg.delivery_fee === 'string', 'delivery_fee é string (não float)');
    }

    {
      console.log('Cenário 19 — money aceita número e normaliza para texto');
      const numCfg = defaultConfig({ delivery_fee: 9.5, min_order_value: 25 });
      const saved = await ownerAS.query(
        'select public.save_unit_operational_config($1, $2) as cfg',
        [unitA1, numCfg],
      );
      ok(saved.rows[0].cfg.delivery_fee === '9.50', '9.5 -> "9.50"');
      ok(saved.rows[0].cfg.min_order_value === '25.00', '25 -> "25.00"');
    }

    // ============================================================
    // Atomicidade
    // ============================================================
    {
      console.log('Cenário 20 — save inválido não altera estado persistido (atômico)');
      const base = defaultConfig({ delivery_fee: '7.25', accepting_orders: true });
      await ownerAS.query('select public.save_unit_operational_config($1, $2)', [unitA1, base]);
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig({ delivery_fee: '8.99', timezone: 'Mars/Olympus' })],
        'PED14',
        'save inválido: PED14',
      );
      const after = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA1,
      ]);
      ok(
        after.rows[0].cfg.delivery_fee === '7.25' &&
          after.rows[0].cfg.timezone === 'America/Sao_Paulo',
        'estado anterior preservado após falha',
      );
    }

    // ============================================================
    // Concorrência: saves paralelos na mesma unidade
    // ============================================================
    {
      console.log('Cenário 21 — saves concorrentes são serializados e atômicos');
      const c1 = await sessionFor(ownerA.id);
      const c2 = await sessionFor(ownerA.id);
      openClients.push(c1, c2);
      const results = await Promise.allSettled([
        c1.query('select public.save_unit_operational_config($1, $2)', [
          unitA1,
          defaultConfig({ delivery_fee: '1.11' }),
        ]),
        c2.query('select public.save_unit_operational_config($1, $2)', [
          unitA1,
          defaultConfig({ delivery_fee: '2.22' }),
        ]),
      ]);
      ok(
        results.every((r) => r.status === 'fulfilled'),
        'ambas as escritas concorrentes tiveram sucesso (serializadas)',
      );
      const final = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA1,
      ]);
      ok(
        ['1.11', '2.22'].includes(final.rows[0].cfg.delivery_fee),
        `estado final consistente (fee=${final.rows[0].cfg.delivery_fee})`,
      );
      ok(
        final.rows[0].cfg.business_hours.length === 7 &&
          final.rows[0].cfg.payment_methods.length === 4,
        'estado final completo após concorrência',
      );
    }

    // ============================================================
    // Unidade inativa
    // ============================================================
    {
      console.log('Cenário 22 — save em unidade inativa: PED13');
      await ownerAS.query('select public.set_unit_active($1, false)', [unitA2]);
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA2, defaultConfig()],
        'PED13',
        'save em unidade inativa: PED13',
      );
      const { rows } = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA2,
      ]);
      ok(rows[0].cfg.unit_id === unitA2, 'get em unidade inativa continua permitido ao owner');
    }

    // ============================================================
    // Flag accepting_orders
    // ============================================================
    {
      console.log('Cenário 23 — accepting_orders é gate manual persistido');
      await ownerAS.query('select public.save_unit_operational_config($1, $2)', [
        unitA1,
        defaultConfig({ accepting_orders: false }),
      ]);
      const off = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA1,
      ]);
      ok(off.rows[0].cfg.accepting_orders === false, 'accepting_orders=false persistido');
      await ownerAS.query('select public.save_unit_operational_config($1, $2)', [
        unitA1,
        defaultConfig({ accepting_orders: true }),
      ]);
      const on = await ownerAS.query('select public.get_unit_operational_config($1) as cfg', [
        unitA1,
      ]);
      ok(on.rows[0].cfg.accepting_orders === true, 'accepting_orders=true restaurado');
    }

    // ============================================================
    // Integração com RBAC (cross-org e escopo)
    // ============================================================
    {
      console.log('Cenário 24 — unidade de outra organização nunca é alcançável via save');
      await expectError(
        ownerBS,
        'select public.save_unit_operational_config($1, $2)',
        [unitA1, defaultConfig()],
        'PED11',
        'owner B salvando unidade de Org A: PED11',
      );
      await expectError(
        ownerAS,
        'select public.save_unit_operational_config($1, $2)',
        [unitB1, defaultConfig()],
        'PED11',
        'owner A salvando unidade de Org B: PED11',
      );
    }
  } finally {
    for (const c of openClients) {
      await c.end().catch(() => {});
    }
    if (createdOrgIds.length > 0) {
      await admin
        .query('delete from public.organizations where id = any($1::uuid[])', [createdOrgIds])
        .catch((err) => console.warn('cleanup orgs warning:', err.message));
    }
    if (createdUsers.length > 0) {
      await admin
        .query('delete from auth.users where id = any($1::uuid[])', [createdUsers])
        .catch((err) => console.warn('cleanup users warning:', err.message));
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

run().catch((err) => {
  console.error('ERRO NA EXECUÇÃO:', err.message);
  process.exitCode = 1;
});
