import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Smoke integrado da Edge Function loyalty-cpf contra o projeto
// remoto (zmuxkztnilnzjyyojbbr). Requer a funcao deployada e o
// secret LOYALTY_CPF_HMAC_KEY setado. Cria fixtures sinteticas de
// tenant/cardapio, exercita o contrato HTTP real e faz cleanup.
const { Client } = pg;

const envText = await readFile(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
function envValue(name) {
  return envText
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? envValue('SUPABASE_DB_PASSWORD');
const supabaseUrl = envValue('VITE_SUPABASE_URL');
const anonKey = envValue('VITE_SUPABASE_PUBLISHABLE_KEY');
if (!dbPassword || !supabaseUrl || !anonKey) {
  console.error(
    'Faltam SUPABASE_DB_PASSWORD/VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY no .env.',
  );
  process.exit(2);
}

const password = encodeURIComponent(dbPassword);
const EDGE_URL = `${supabaseUrl}/functions/v1/loyalty-cpf`;

// Fallback de conexao: incidentes recorrentes de DNS no host direto
// (`db.<ref>.supabase.co` fica momentaneamente apenas AAAA) foram
// observados neste ambiente. O session pooler resolve via IPv4 e
// preserva SET ROLE/claims (mesmo padrao das suiten de banco).
let ACTIVE_URL = `postgresql://postgres:${password}@db.zmuxkztnilnzjyyojbbr.supabase.co:5432/postgres`;
const POOLER_URL = `postgresql://postgres.zmuxkztnilnzjyyojbbr:${password}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;

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

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

async function adminClient() {
  const client = new Client({
    connectionString: ACTIVE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function sessionFor(userId) {
  const client = new Client({
    connectionString: ACTIVE_URL,
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
    connectionString: ACTIVE_URL,
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

async function setProgramEnabled(client, organizationId, enabled) {
  return (
    await client.query('select public.set_loyalty_program_enabled($1, $2) as out', [
      organizationId,
      enabled,
    ])
  ).rows[0].out;
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

async function edgeCall(payload, tokenOverride = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (tokenOverride !== null) {
    headers.Authorization = `Bearer ${tokenOverride}`;
  }
  const response = await fetch(EDGE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body, cacheControl: response.headers.get('cache-control') };
}

const VALID_CPF = '529.982.247-25';
const VALID_CPF_DIGITS = '52998224725';
const OTHER_VALID_CPF = '11144477735';
const INVALID_CPF = '111.111.111-11';

async function run() {
  // Incidentes intermitentes de DNS do host direto do Supabase ja
  // foram observados neste ambiente; tenta direto e cai no session
  // pooler em falha persistente.
  let admin = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (attempt === 4) {
      ACTIVE_URL = POOLER_URL;
      console.log('  host direto indisponivel; usando session pooler');
    }
    try {
      admin = await adminClient();
      await admin.query('select 1');
      break;
    } catch (error) {
      console.log(`  conexao tentativa ${attempt}/8: ${error.message}`);
      await admin?.end().catch(() => {});
      admin = null;
      if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 20000));
    }
  }
  if (!admin) {
    console.error('Sem conexao direta com o banco remoto (DNS/incidente). Abortando.');
    process.exit(2);
  }
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  let owner;
  let ownerS;
  let anon;
  let orgId;
  let unitId;
  let slug;

  try {
    scenario(0, 'setup sintetico de tenant, cardapio e programa');
    owner = await createTestUser(admin, `loyalty-edge-${suffix}@pedon-test.invalid`);
    createdUsers.push(owner.id);
    ownerS = await sessionFor(owner.id);
    openClients.push(ownerS);
    anon = await anonClient();
    openClients.push(anon);

    orgId = (await ownerS.query(`select public.complete_onboarding('Loyalty Edge Org') as org`))
      .rows[0].org;
    createdOrgIds.push(orgId);
    unitId = (
      await ownerS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgId],
      )
    ).rows[0].id;

    const category = await createCategory(ownerS, unitId, 'Edge Itens');
    await createProduct(ownerS, unitId, category.id, 'Produto Edge', '8.10');
    await saveConfig(ownerS, unitId, operationalConfig());
    slug = (await publish(ownerS, unitId)).public_slug;
    await setProgramEnabled(ownerS, orgId, true);

    ok(typeof slug === 'string' && /^[a-f0-9]{24}$/.test(slug), '0.1 cardapio publicado com slug');

    scenario(1, 'enroll via Edge (CPF sintetico valido)');
    const enroll = await edgeCall(
      { public_slug: slug, mode: 'enroll', cpf: VALID_CPF, name: '  Cliente Edge Sintetico  ' },
      anonKey,
    );
    ok(enroll.status === 200, '1.1 enroll retorna 200');
    ok(enroll.body?.found === true, '1.2 found true no enroll');
    ok(isUuid(enroll.body?.membership_id), '1.3 membership_id uuid');
    ok(
      typeof enroll.body?.token?.access_token === 'string' &&
        /^[a-f0-9]{64}$/.test(enroll.body.token.access_token),
      '1.4 access token 64 hex',
    );
    ok(
      enroll.body?.token?.expires_at &&
        new Date(enroll.body.token.expires_at).getTime() > Date.now(),
      '1.5 expires_at futuro',
    );
    ok(enroll.body?.customer?.cpf_last2 === '25', '1.6 cpf_last2 mascarado correto');
    ok(enroll.body?.customer?.name === 'Cliente Edge Sintetico', '1.7 nome btrim aplicado');
    ok(enroll.body?.account?.points_balance === 0, '1.8 saldo inicial zero');
    ok(
      typeof enroll.body?.token === 'object' && enroll.body?.token !== null,
      '1.9 shape token presente',
    );
    ok(enroll.cacheControl?.includes('no-store') === true, '1.10 Cache-Control no-store');
    const edgeToken = enroll.body.token.access_token;

    scenario(2, 'consulta publica de saldo com o token emitido pela Edge');
    const account = (
      await anon.query('select public.get_public_loyalty_account($1) as out', [edgeToken])
    ).rows[0].out;
    ok(account.found === true, '2.1 conta resolvida pelo token');
    ok(account.customer?.cpf_last2 === '25', '2.2 cpf_last2 pela consulta publica');
    ok(account.organization?.name === 'Loyalty Edge Org', '2.3 org do tenant correta');
    ok(
      !JSON.stringify(account).includes(VALID_CPF_DIGITS) &&
        !JSON.stringify(account).includes(VALID_CPF),
      '2.4 nenhum CPF em claro na resposta',
    );

    scenario(3, 'lookup do mesmo CPF (novo token, mesma membership)');
    const lookup = await edgeCall({ public_slug: slug, mode: 'lookup', cpf: VALID_CPF }, anonKey);
    ok(lookup.status === 200 && lookup.body?.found === true, '3.1 lookup encontra cadastro');
    ok(lookup.body?.membership_id === enroll.body.membership_id, '3.2 mesma membership no lookup');
    ok(lookup.body?.customer?.cpf_last2 === '25', '3.3 cpf_last2 consistente');

    scenario(4, 'CPF valido porem nao cadastrado (mismatch generico)');
    const miss = await edgeCall(
      { public_slug: slug, mode: 'lookup', cpf: OTHER_VALID_CPF },
      anonKey,
    );
    ok(miss.status === 200 && miss.body?.found === false, '4.1 found false sem vazar dados');

    scenario(5, 'erros de contrato');
    const invalidCpf = await edgeCall(
      { public_slug: slug, mode: 'lookup', cpf: INVALID_CPF },
      anonKey,
    );
    ok(
      invalidCpf.status === 422 && invalidCpf.body?.error?.code === 'INVALID_CPF',
      '5.1 CPF com digitos invalidos rejeitado 422',
    );
    const badMode = await edgeCall({ public_slug: slug, mode: 'reset', cpf: VALID_CPF }, anonKey);
    ok(
      badMode.status === 400 && badMode.body?.error?.code === 'INVALID_MODE',
      '5.2 mode invalido rejeitado 400',
    );
    const badSlug = await edgeCall(
      { public_slug: '0'.repeat(24), mode: 'lookup', cpf: VALID_CPF },
      anonKey,
    );
    ok(
      badSlug.status === 404 && badSlug.body?.error?.code === 'INVALID_SLUG',
      '5.3 slug inexistente 404',
    );
    const badName = await edgeCall(
      { public_slug: slug, mode: 'enroll', cpf: OTHER_VALID_CPF, name: 'A' },
      anonKey,
    );
    ok(
      badName.status === 422 && badName.body?.error?.code === 'INVALID_NAME',
      '5.4 nome curto rejeitado 422',
    );
    const htmlName = await edgeCall(
      { public_slug: slug, mode: 'enroll', cpf: OTHER_VALID_CPF, name: '<b>X</b>' },
      anonKey,
    );
    ok(
      htmlName.status === 422 && htmlName.body?.error?.code === 'INVALID_NAME',
      '5.5 nome com marcacao rejeitado 422',
    );

    scenario(6, 'programa desabilitado => LOYALTY_UNAVAILABLE');
    await setProgramEnabled(ownerS, orgId, false);
    const disabled = await edgeCall({ public_slug: slug, mode: 'lookup', cpf: VALID_CPF }, anonKey);
    ok(
      disabled.status === 403 && disabled.body?.error?.code === 'LOYALTY_UNAVAILABLE',
      '6.1 programa off bloqueia 403',
    );
    await setProgramEnabled(ownerS, orgId, true);

    scenario(7, 'sem header de autenticacao (verify_jwt)');
    const noAuth = await edgeCall({ public_slug: slug, mode: 'lookup', cpf: VALID_CPF });
    ok(noAuth.status === 401, '7.1 chamada sem token JWT negada');
  } finally {
    for (const client of openClients) await client.end().catch(() => {});
    for (const org of createdOrgIds) {
      await admin
        .query('delete from public.loyalty_ledger where organization_id = $1', [org])
        .catch(() => {});
      await admin
        .query('delete from public.orders where organization_id = $1', [org])
        .catch(() => {});
      await admin.query('delete from public.organizations where id = $1', [org]).catch(() => {});
    }
    for (const user of createdUsers) {
      await admin.query('delete from auth.users where id = $1', [user]).catch(() => {});
    }
    await admin.end().catch(() => {});
  }

  console.log(`\nResumo: ${passed} PASS, ${failed} FAIL.`);
  if (failures.length > 0) {
    console.error('Falhas:', failures.join(' | '));
    process.exit(1);
  }
}

await run();
