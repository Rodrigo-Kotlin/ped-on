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

async function createTestUser(admin, email) {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
     values ($1, $2, crypt('TestPassw0rd!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now())`,
    [id, email],
  );
  return { id, email };
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  try {
    const alice = await createTestUser(admin, `rls-alice-${suffix}@pedon-test.invalid`);
    const bob = await createTestUser(admin, `rls-bob-${suffix}@pedon-test.invalid`);
    createdUsers.push(alice.id, bob.id);

    console.log('Cenário 1 — trigger cria profile automaticamente após criação de auth.users');
    const p1 = await admin.query(
      'select id, email, onboarding_status from public.profiles where id = any($1::uuid[]) order by email',
      [[alice.id, bob.id]],
    );
    const aliceProfile = p1.rows.find((r) => r.id === alice.id);
    const bobProfile = p1.rows.find((r) => r.id === bob.id);
    ok(aliceProfile?.email === alice.email, 'alice possui profile com e-mail correto');
    ok(bobProfile?.email === bob.email, 'bob possui profile com e-mail correto');
    ok(
      aliceProfile?.onboarding_status === 'pending',
      'alice inicia com onboarding_status = pending',
    );

    console.log('Cenário 2 — anon não lê dados de profiles (RLS nega por padrão)');
    const anon = new Client({ connectionString: DIRECT_URL, ssl: DB_SSL });
    await anon.connect();
    openClients.push(anon);
    await anon.query('set role anon');
    let anonProfilesDenied = false;
    try {
      const p2 = await anon.query('select * from public.profiles');
      anonProfilesDenied = p2.rows.length === 0;
    } catch (error) {
      anonProfilesDenied = error.code === '42501';
    }
    ok(anonProfilesDenied, 'anon não acessa nenhum profile');

    console.log('Cenário 3 — anon não consegue executar complete_onboarding');
    let anonRpcError = null;
    try {
      await anon.query("select public.complete_onboarding('Org Anon')");
    } catch (err) {
      anonRpcError = err;
    }
    ok(anonRpcError !== null, 'complete_onboarding é negado para anon');

    console.log('Cenário 4 — usuário autenticado lê apenas o próprio profile');
    const aliceS = await sessionFor(alice.id);
    openClients.push(aliceS);
    const p4 = await aliceS.query('select id from public.profiles');
    ok(p4.rows.length === 1 && p4.rows[0].id === alice.id, 'alice vê somente o próprio profile');

    console.log('Cenário 5 — usuário não lê o profile de outro usuário');
    const p5 = await aliceS.query('select * from public.profiles where id = $1', [bob.id]);
    ok(p5.rows.length === 0, 'alice não consegue ler o profile de bob');

    console.log('Cenário 6 — usuário autenticado sem organização não vê organizações');
    const p6 = await aliceS.query('select * from public.organizations');
    ok(p6.rows.length === 0, 'alice não vê organizações antes do onboarding');

    console.log(
      'Cenário 7 — complete_onboarding cria organização + membro owner + unidade + marca completed (transacional)',
    );
    const p7 = await aliceS.query(
      "select public.complete_onboarding('Cantina da Alice') as org_id",
    );
    const orgIdAlice = p7.rows[0].org_id;
    createdOrgIds.push(orgIdAlice);
    const orgs = await aliceS.query('select * from public.organizations');
    const members = await aliceS.query('select * from public.organization_members');
    const units = await aliceS.query('select * from public.units');
    const profileAfter = await aliceS.query(
      'select onboarding_status from public.profiles where id = $1',
      [alice.id],
    );
    ok(
      orgs.rows.length === 1 && orgs.rows[0].name === 'Cantina da Alice',
      'organização criada com nome correto',
    );
    ok(
      members.rows.length === 1 &&
        members.rows[0].user_id === alice.id &&
        members.rows[0].role === 'owner',
      'alice é membro owner da organização',
    );
    ok(
      units.rows.length === 1 && units.rows[0].organization_id === orgIdAlice,
      'unidade inicial criada',
    );
    ok(profileAfter.rows[0].onboarding_status === 'completed', 'onboarding marcado como completed');

    console.log('Cenário 8 — cross-tenant: bob não vê a organização de alice');
    const bobS = await sessionFor(bob.id);
    openClients.push(bobS);
    const p8 = await bobS.query('select * from public.organizations');
    const p8u = await bobS.query('select * from public.units');
    ok(p8.rows.length === 0, 'bob não vê a organização de alice');
    ok(p8u.rows.length === 0, 'bob não vê as unidades de alice');

    console.log('Cenário 9 — bob consegue fazer o próprio onboarding sem conflito com alice');
    await bobS.query("select public.complete_onboarding('Hamburgueria do Bob')");
    createdOrgIds.push((await bobS.query('select id from public.organizations')).rows[0].id);
    const bobOrgs = await bobS.query('select name from public.organizations');
    ok(
      bobOrgs.rows.length === 1 && bobOrgs.rows[0].name === 'Hamburgueria do Bob',
      'bob criou a própria organização',
    );
    const aliceStillOne = await aliceS.query('select count(*)::int as n from public.organizations');
    ok(aliceStillOne.rows[0].n === 1, 'alice continua vendo somente a própria organização');

    console.log('Cenário 10 — idempotência: segunda chamada de complete_onboarding é recusada');
    let dupError = null;
    try {
      await aliceS.query("select public.complete_onboarding('Segunda Organização')");
    } catch (err) {
      dupError = err;
    }
    const aliceOrgsCount = await aliceS.query(
      'select count(*)::int as n from public.organizations',
    );
    ok(dupError !== null, 'segunda chamada lançou erro');
    ok(aliceOrgsCount.rows[0].n === 1, 'nenhuma organização duplicada foi criada');

    console.log('Cenário 11 — concorrência: duas chamadas paralelas criam apenas UMA organização');
    const carol = await createTestUser(admin, `rls-carol-${suffix}@pedon-test.invalid`);
    createdUsers.push(carol.id);
    const c1 = await sessionFor(carol.id);
    const c2 = await sessionFor(carol.id);
    openClients.push(c1, c2);
    const results = await Promise.allSettled([
      c1.query("select public.complete_onboarding('Org Concorrente')"),
      c2.query("select public.complete_onboarding('Org Concorrente')"),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    const carolOrgs = await c1.query('select count(*)::int as n from public.organizations');
    ok(
      fulfilled === 1 && rejected === 1,
      'exatamente uma chamada teve sucesso e uma foi rejeitada',
    );
    ok(carolOrgs.rows[0].n === 1, 'apenas uma organização criada sob concorrência');
    const carolOrgId = (await c1.query('select id from public.organizations')).rows[0].id;
    createdOrgIds.push(carolOrgId);

    console.log(
      'Cenário 12 — escrita direta é bloqueada: authenticated não insere em organizations',
    );
    let insertError = null;
    try {
      await aliceS.query("insert into public.organizations (name) values ('Hack Direto')");
    } catch (err) {
      insertError = err;
    }
    const orgCountAfter = await aliceS.query('select count(*)::int as n from public.organizations');
    ok(insertError !== null, 'insert direto em organizations é bloqueado');
    ok(orgCountAfter.rows[0].n === 1, 'nenhuma organização inserida diretamente');
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
