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

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  try {
    const ownerA = await createTestUser(admin, `p04-owner-a-${suffix}@pedon-test.invalid`);
    const managerA = await createTestUser(admin, `p04-manager-a-${suffix}@pedon-test.invalid`);
    const operatorA = await createTestUser(admin, `p04-operator-a-${suffix}@pedon-test.invalid`);
    const ownerB = await createTestUser(admin, `p04-owner-b-${suffix}@pedon-test.invalid`);
    const ownerC = await createTestUser(admin, `p04-owner-c-${suffix}@pedon-test.invalid`);
    const noOrgUser = await createTestUser(admin, `p04-no-org-${suffix}@pedon-test.invalid`);
    createdUsers.push(ownerA.id, managerA.id, operatorA.id, ownerB.id, ownerC.id, noOrgUser.id);

    const ownerAS = await sessionFor(ownerA.id);
    const managerAS = await sessionFor(managerA.id);
    const operatorAS = await sessionFor(operatorA.id);
    const ownerBS = await sessionFor(ownerB.id);
    const ownerCS = await sessionFor(ownerC.id);
    const noOrgS = await sessionFor(noOrgUser.id);
    openClients.push(ownerAS, managerAS, operatorAS, ownerBS, ownerCS, noOrgS);

    // ---- Setup: proprietários com organização e unidades ----
    const orgA = (await ownerAS.query(`select public.complete_onboarding('Org A Teste') as org`))
      .rows[0].org;
    const unitA1 = (
      await ownerAS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgA],
      )
    ).rows[0].id;
    const unitA2 = (await ownerAS.query('select (public.create_unit($1)).id as u', ['Filial A2']))
      .rows[0].u;
    let unitA3;
    createdOrgIds.push(orgA);

    const orgB = (await ownerBS.query(`select public.complete_onboarding('Org B Teste') as org`))
      .rows[0].org;
    const unitB1 = (
      await ownerBS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgB],
      )
    ).rows[0].id;
    createdOrgIds.push(orgB);

    const orgC = (await ownerCS.query(`select public.complete_onboarding('Org C Teste') as org`))
      .rows[0].org;
    const unitC1 = (
      await ownerCS.query(
        'select id from public.units where organization_id = $1 order by created_at limit 1',
        [orgC],
      )
    ).rows[0].id;
    const unitC2 = (await ownerCS.query('select (public.create_unit($1)).id as u', ['Filial C2']))
      .rows[0].u;
    createdOrgIds.push(orgC);

    // ---- Setup: memberships manager/operator e vínculos por unidade ----
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
    // RBAC / escopo por unidade
    // ============================================================
    {
      console.log('Cenário 1 — owner A lê todas as unidades da própria organização');
      const { rows } = await ownerAS.query(
        'select id from public.units where organization_id = $1 order by name',
        [orgA],
      );
      const ids = rows.map((r) => r.id).sort();
      ok(
        ids.length === 2 && ids.includes(unitA1) && ids.includes(unitA2),
        'owner A vê exatamente as 2 unidades de Org A',
      );
    }

    {
      console.log('Cenário 2 — owner A não lê unidades de outra organização');
      const { rows } = await ownerAS.query(
        'select id from public.units where organization_id = $1',
        [orgB],
      );
      ok(rows.length === 0, 'owner A não vê unidades de Org B');
    }

    {
      console.log('Cenário 3 — manager vinculado a Unit A1 acessa A1');
      const { rows } = await managerAS.query('select id from public.units where id = $1', [unitA1]);
      ok(rows.length === 1 && rows[0].id === unitA1, 'manager A acessa a unidade vinculada');
    }

    {
      console.log('Cenário 4 — manager não acessa unidade sem vínculo');
      const { rows } = await managerAS.query('select id from public.units where id = $1', [unitA2]);
      ok(rows.length === 0, 'manager A não acessa A2 sem vínculo');
    }

    {
      console.log('Cenário 5 — manager não acessa unidades de outra organização');
      const { rows } = await managerAS.query(
        'select id from public.units where organization_id = $1',
        [orgB],
      );
      ok(rows.length === 0, 'manager A não acessa unidades de Org B');
    }

    {
      console.log('Cenário 6 — operator segue escopo membership_units');
      const a1 = await operatorAS.query('select id from public.units where id = $1', [unitA1]);
      const a2 = await operatorAS.query('select id from public.units where id = $1', [unitA2]);
      ok(
        a1.rows.length === 0 && a2.rows.length === 1,
        'operator A acessa apenas a unidade vinculada',
      );
    }

    {
      console.log('Cenário 7 — membership_units cross-org é rejeitado pela FK composta');
      const error = await expectError(
        admin,
        'insert into public.membership_units (organization_id, user_id, unit_id) values ($1, $2, $3)',
        [orgA, managerA.id, unitB1],
        '23503',
        'vínculo com unidade de outra organização falha (FK unit_org)',
      );
      const count = await admin.query('select count(*)::int as n from public.membership_units');
      ok(error !== null && count.rows[0].n === 2, 'nenhum vínculo inválido foi inserido');
    }

    {
      console.log('Cenário 8 — anon não lê membership_units');
      const anon = await anonClient();
      openClients.push(anon);
      try {
        const { rows } = await anon.query('select * from public.membership_units');
        ok(rows.length === 0, 'anon retorna zero linhas de membership_units');
      } catch (error) {
        ok(error.code === '42501', 'anon é bloqueado ao acessar membership_units');
      }
    }

    {
      console.log('Cenário 9 — escrita direta em units continua bloqueada (INSERT)');
      await expectError(
        ownerAS,
        'insert into public.units (organization_id, name) values ($1, $2)',
        [orgA, 'X'],
        '42501',
        'INSERT direto como authenticated é negado',
      );
    }

    {
      console.log('Cenário 10 — escrita direta em units continua bloqueada (UPDATE)');
      const before = (await ownerAS.query('select name from public.units where id = $1', [unitA1]))
        .rows[0].name;
      await ownerAS.query('update public.units set name = $2 where id = $1', [unitA1, 'Hack']);
      const after = (await ownerAS.query('select name from public.units where id = $1', [unitA1]))
        .rows[0].name;
      ok(
        after === before && after !== 'Hack',
        'UPDATE direto é bloqueado e o nome permanece intacto',
      );
    }

    // ============================================================
    // RPCs de unidades (server-authoritative)
    // ============================================================
    {
      console.log('Cenário 11 — create_unit owner: PASS');
      unitA3 = (await ownerAS.query('select (public.create_unit($1)).id as u', ['Filial A3']))
        .rows[0].u;
      const check = await ownerAS.query('select id from public.units where id = $1', [unitA3]);
      ok(check.rows.length === 1, 'owner A cria unidade e consegue lê-la');
    }

    {
      console.log('Cenário 12 — create_unit manager: negado');
      await expectError(
        managerAS,
        "select public.create_unit('Invasao')",
        [],
        'PED01',
        'manager não pode criar unidade (PED01)',
      );
    }

    {
      console.log('Cenário 13 — create_unit com nome vazio: negado');
      await expectError(
        ownerAS,
        "select public.create_unit('   ')",
        [],
        'PED03',
        'nome vazio é rejeitado (PED03)',
      );
    }

    {
      console.log('Cenário 14 — update_unit owner na própria organização: PASS');
      await ownerAS.query('select public.update_unit($1, $2)', [unitA1, 'Unidade A1 Renomeada']);
      const check = await ownerAS.query('select name from public.units where id = $1', [unitA1]);
      ok(check.rows[0].name === 'Unidade A1 Renomeada', 'owner A renomeia unidade própria');
    }

    {
      console.log('Cenário 15 — update_unit owner em unidade de outra organização: negado');
      await expectError(
        ownerAS,
        'select public.update_unit($1, $2)',
        [unitB1, 'Invasao'],
        'PED02',
        'update em unidade de outra org é negado (PED02)',
      );
    }

    {
      console.log('Cenário 16 — set_unit_active owner desativa unidade própria: PASS');
      await ownerAS.query('select public.set_unit_active($1, false)', [unitA2]);
      const check = await ownerAS.query('select is_active from public.units where id = $1', [
        unitA2,
      ]);
      ok(check.rows[0].is_active === false, 'owner A desativa A2');
    }

    {
      console.log('Cenário 17 — set_unit_active: não é possível desativar a última unidade ativa');
      await ownerAS.query('select public.set_unit_active($1, false)', [unitA3]);
      await expectError(
        ownerAS,
        'select public.set_unit_active($1, false)',
        [unitA1],
        'PED04',
        'desativar a última unidade ativa é rejeitado (PED04)',
      );
      const active = await ownerAS.query(
        'select count(*)::int as n from public.units where organization_id = $1 and is_active',
        [orgA],
      );
      ok(active.rows[0].n === 1, 'resta exatamente 1 unidade ativa em Org A');
    }

    {
      console.log('Cenário 18 — set_unit_active owner em unidade de outra organização: negado');
      await expectError(
        ownerAS,
        'select public.set_unit_active($1, false)',
        [unitB1],
        'PED02',
        'set_unit_active em unidade de outra org é negado (PED02)',
      );
    }

    // ============================================================
    // Contexto administrativo
    // ============================================================
    {
      console.log(
        'Cenário 19 — get_my_admin_context do owner inclui perfil, org, role e todas as unidades',
      );
      const ctx = await ownerAS.query('select public.get_my_admin_context() as ctx');
      const data = ctx.rows[0].ctx;
      const unitIds = data.units.map((u) => u.id);
      ok(data.profile?.id === ownerA.id, 'contexto inclui o perfil do usuário');
      ok(
        data.organization?.id === orgA && data.organization?.name === 'Org A Teste',
        'contexto inclui a organização',
      );
      ok(data.role === 'owner', 'contexto inclui o papel owner');
      ok(
        unitIds.length === 3 &&
          unitIds.includes(unitA1) &&
          unitIds.includes(unitA2) &&
          unitIds.includes(unitA3),
        'owner vê todas as unidades (inclusive inativa) no contexto',
      );
    }

    {
      console.log('Cenário 20 — get_my_admin_context do manager limita unidades ao vínculo');
      const ctx = await managerAS.query('select public.get_my_admin_context() as ctx');
      const data = ctx.rows[0].ctx;
      const unitIds = data.units.map((u) => u.id);
      ok(data.role === 'manager', 'contexto do manager tem role manager');
      ok(
        unitIds.length === 1 && unitIds[0] === unitA1,
        'manager vê somente a unidade vinculada no contexto',
      );
    }

    {
      console.log(
        'Cenário 21 — get_my_admin_context sem organização: organização/role nulos e units vazio',
      );
      const ctx = await noOrgS.query('select public.get_my_admin_context() as ctx');
      const data = ctx.rows[0].ctx;
      ok(
        data.organization === null && data.role === null,
        'sem organização o contexto retorna null',
      );
      ok(Array.isArray(data.units) && data.units.length === 0, 'units é array vazio');
    }

    // ============================================================
    // Concorrência: última unidade ativa
    // ============================================================
    {
      console.log('Cenário 22 — desativações concorrentes deixam exatamente uma unidade ativa');
      const c1 = await sessionFor(ownerC.id);
      const c2 = await sessionFor(ownerC.id);
      openClients.push(c1, c2);
      const results = await Promise.allSettled([
        c1.query('select public.set_unit_active($1, false)', [unitC1]),
        c2.query('select public.set_unit_active($1, false)', [unitC2]),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      const rejectedCodes = results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason?.code);
      const active = await ownerCS.query(
        'select count(*)::int as n from public.units where organization_id = $1 and is_active',
        [orgC],
      );
      ok(fulfilled === 1 && rejected === 1, 'exatamente uma desativação teve sucesso');
      ok(
        rejectedCodes.includes('PED04'),
        `falha com PED04 (recebido ${JSON.stringify(rejectedCodes)})`,
      );
      ok(active.rows[0].n === 1, 'Org C permanece com 1 unidade ativa');
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
