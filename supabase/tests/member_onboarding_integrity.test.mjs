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

async function invite(owner, email, role) {
  return (await owner.query('select public.invite_org_member($1, $2) as out', [email, role]))
    .rows[0].out;
}

async function revoke(owner, inviteId) {
  return (await owner.query('select public.revoke_org_member_invite($1) as out', [inviteId]))
    .rows[0].out;
}

async function orgInvites(owner, orgId) {
  return (await owner.query('select public.get_org_member_invites($1) as out', [orgId])).rows[0]
    .out;
}

async function myPending(user) {
  return (await user.query('select public.get_my_pending_member_invites() as out')).rows[0].out;
}

async function accept(user, inviteId) {
  return (await user.query('select public.accept_org_member_invite($1) as out', [inviteId])).rows[0]
    .out;
}

async function adminContext(user) {
  return (await user.query('select public.get_my_admin_context() as out')).rows[0].out;
}

async function run() {
  const admin = await adminClient();
  const suffix = Date.now();
  const createdUsers = [];
  const createdOrgIds = [];
  const openClients = [];

  try {
    const ownerA = await createTestUser(admin, `p14-owner-a-${suffix}@pedon-test.invalid`);
    const managerA = await createTestUser(admin, `p14-manager-a-${suffix}@pedon-test.invalid`);
    const operatorA = await createTestUser(admin, `p14-operator-a-${suffix}@pedon-test.invalid`);
    const inviteeA = await createTestUser(admin, `p14-invitee-a-${suffix}@pedon-test.invalid`);
    const inviteeB = await createTestUser(admin, `p14-invitee-b-${suffix}@pedon-test.invalid`);
    const ownerB = await createTestUser(admin, `p14-owner-b-${suffix}@pedon-test.invalid`);
    const noOrgUser = await createTestUser(admin, `p14-no-org-${suffix}@pedon-test.invalid`);
    createdUsers.push(
      ownerA.id,
      managerA.id,
      operatorA.id,
      inviteeA.id,
      inviteeB.id,
      ownerB.id,
      noOrgUser.id,
    );

    const ownerAS = await sessionFor(ownerA.id);
    const managerAS = await sessionFor(managerA.id);
    const operatorAS = await sessionFor(operatorA.id);
    const inviteeAS = await sessionFor(inviteeA.id);
    const inviteeBS = await sessionFor(inviteeB.id);
    const ownerBS = await sessionFor(ownerB.id);
    const noOrgS = await sessionFor(noOrgUser.id);
    const noSubS = await authedNoSubClient();
    const anon = await anonClient();
    openClients.push(
      ownerAS,
      managerAS,
      operatorAS,
      inviteeAS,
      inviteeBS,
      ownerBS,
      noOrgS,
      noSubS,
      anon,
    );

    const orgA = (await ownerAS.query(`select public.complete_onboarding('Org P14 A') as org`))
      .rows[0].org;
    createdOrgIds.push(orgA);

    const orgB = (await ownerBS.query(`select public.complete_onboarding('Org P14 B') as org`))
      .rows[0].org;
    createdOrgIds.push(orgB);

    await admin.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'manager'), ($1, $3, 'operator')`,
      [orgA, managerA.id, operatorA.id],
    );

    // ============================================================
    // Cenario 1 — authn/authz de invite_org_member
    // ============================================================
    console.log('Cenario 1 — invite_org_member: autenticacao e autorizacao');
    await expectDenied(
      anon,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'manager'],
      'anon nao executa invite (revogado)',
    );
    await expectError(
      noSubS,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'manager'],
      'PED80',
      'autenticado sem sub nao convida',
    );
    await expectError(
      managerAS,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'manager'],
      'PED81',
      'manager nao convida (owner-only)',
    );
    await expectError(
      operatorAS,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'manager'],
      'PED81',
      'operator nao convida',
    );
    await expectError(
      noOrgS,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'manager'],
      'PED81',
      'usuario sem organizacao nao convida',
    );
    await expectError(
      ownerAS,
      'select public.invite_org_member($1, $2)',
      [null, 'manager'],
      'PED82',
      'email nulo gera EMAIL_REQUIRED',
    );
    await expectError(
      ownerAS,
      'select public.invite_org_member($1, $2)',
      ['  ', 'manager'],
      'PED82',
      'email em branco gera EMAIL_REQUIRED',
    );
    await expectError(
      ownerAS,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'owner'],
      'PED83',
      'funcao owner e rejeitada no convite',
    );
    await expectError(
      ownerAS,
      'select public.invite_org_member($1, $2)',
      [inviteeA.email, 'cliente'],
      'PED83',
      'funcao inexistente gera INVALID_ROLE',
    );

    // ============================================================
    // Cenario 2 — criar convite, idempotencia e normalizacao
    // ============================================================
    console.log('Cenario 2 — criacao, idempotencia e normalizacao');
    const first = await invite(ownerAS, `  ${inviteeA.email.toUpperCase()}  `, 'manager');
    ok(first.created === true, 'primeiro convite e criado');
    ok(first.status === 'pending', 'convite nasce pendente');
    ok(first.email === inviteeA.email, 'email normalizado (lower/btrim)');
    ok(first.role === 'manager', 'funcao manager preservada');
    ok(
      first.expires_at > new Date(Date.now() + 6 * 86400000).toISOString() &&
        first.expires_at < new Date(Date.now() + 8 * 86400000).toISOString(),
      'expires_at dentro da janela de 7 dias',
    );

    const diagRows = await admin.query(
      `select id, organization_id, email, role, status, expires_at
       from public.organization_member_invites
       where organization_id = $1 order by created_at`,
      [orgA],
    );
    console.log(`DIAG invites rows=${diagRows.rows.length}`);
    for (const r of diagRows.rows) console.log(`DIAG invite row ${JSON.stringify(r)}`);
    const diagFn = await admin.query(
      `select pg_get_functiondef('public.invite_org_member(text,text)'::regprocedure) as def`,
    );
    console.log(`DIAG fnDef:\n${diagFn.rows[0].def}`);
    const diagSession = await ownerAS.query(
      `select auth.uid() as uid, current_user as cu,
              current_setting('request.jwt.claims', true) as claims`,
    );
    console.log(`DIAG session ${JSON.stringify(diagSession.rows[0])}`);
    const diagIdem = await ownerAS.query(
      `select id from public.organization_member_invites
       where organization_id = $1 and email = $2 and status = 'pending' limit 1`,
      [orgA, inviteeA.email],
    );
    console.log(`DIAG idemSelect rows=${diagIdem.rows.length}`);
    const duplicate = await invite(ownerAS, inviteeA.email, 'manager');
    ok(duplicate.created === false, 'convite repetido nao duplica');
    ok(duplicate.renewed === false, 'convite pendente valido nao e renovado');
    ok(duplicate.id === first.id, 'convite repetido retorna o mesmo id');

    await expectError(
      ownerAS,
      'select public.invite_org_member($1, $2)',
      [managerA.email, 'manager'],
      'PED84',
      'email de membro existente gera ALREADY_MEMBER',
    );
    await expectError(
      ownerAS,
      'select public.invite_org_member($1, $2)',
      [operatorA.email, 'operator'],
      'PED84',
      'ALREADY_MEMBER tambem para operator existente',
    );

    try {
      await admin.query(
        `insert into public.organization_member_invites
           (organization_id, email, role, invited_by, expires_at)
         values ($1, $2, 'manager', $3, now() + interval '7 days')`,
        [orgA, inviteeA.email, ownerA.id],
      );
      ok(false, 'indice unico parcial bloqueia segundo convite pendente (23505 esperado)');
    } catch (error) {
      ok(error.code === '23505', `indice unico parcial bloqueia duplicata (code=${error.code})`);
    }

    // ============================================================
    // Cenario 3 — leitura: listas e RLS
    // ============================================================
    console.log('Cenario 3 — listas e RLS de leitura');
    await expectDenied(
      anon,
      'select public.get_org_member_invites($1)',
      [orgA],
      'anon nao lista convites (revogado)',
    );
    await expectError(
      managerAS,
      'select public.get_org_member_invites($1)',
      [orgA],
      'PED81',
      'manager nao lista convites (owner-only)',
    );
    await expectError(
      ownerAS,
      'select public.get_org_member_invites($1)',
      [orgB],
      'PED81',
      'owner nao lista convites de outro tenant',
    );

    const invitesA = await orgInvites(ownerAS, orgA);
    const entry = (invitesA ?? []).find((i) => i.id === first.id);
    ok(Array.isArray(invitesA), 'get_org_member_invites retorna array');
    ok(
      entry !== undefined && entry.status === 'pending' && entry.email === inviteeA.email,
      'owner enxerga o convite pendente',
    );
    ok(
      entry !== undefined &&
        Object.keys(entry).sort().join(',') ===
          'accepted_at,created_at,email,expires_at,id,revoked_at,role,status',
      'get_org_member_invites expoe somente os campos previstos',
    );

    await expectDenied(
      managerAS,
      'select * from public.organization_member_invites where organization_id = $1',
      [orgA],
      'manager nao seleciona a tabela (RLS)',
    );
    const directSelect = await ownerAS.query(
      'select count(*)::integer as n from public.organization_member_invites where organization_id = $1',
      [orgA],
    );
    ok(directSelect.rows[0].n >= 1, 'owner seleciona convites da propria org via RLS');

    const pendingA = await myPending(inviteeAS);
    ok(Array.isArray(pendingA) && pendingA.length === 1, 'convidado enxerga exatamente 1 convite');
    const pendingEntry = pendingA[0];
    ok(
      pendingEntry !== undefined &&
        pendingEntry.organization_name === 'Org P14 A' &&
        pendingEntry.role === 'manager' &&
        pendingEntry.organization_id === orgA,
      'convite pendente expoe org, nome e funcao corretos',
    );
    ok(
      pendingEntry !== undefined &&
        Object.keys(pendingEntry).sort().join(',') ===
          'created_at,expires_at,id,organization_id,organization_name,role',
      'get_my_pending_member_invites expoe somente os campos previstos',
    );
    const pendingB = await myPending(inviteeBS);
    ok(Array.isArray(pendingB) && pendingB.length === 0, 'usuario sem convite nao enxerga nada');

    // ============================================================
    // Cenario 4 — revogacao
    // ============================================================
    console.log('Cenario 4 — revogacao de convite');
    await expectDenied(
      anon,
      'select public.revoke_org_member_invite($1)',
      [first.id],
      'anon nao revoga (revogado)',
    );
    await expectError(
      managerAS,
      'select public.revoke_org_member_invite($1)',
      [first.id],
      'PED81',
      'manager nao revoga (owner-only)',
    );
    await expectError(
      ownerBS,
      'select public.revoke_org_member_invite($1)',
      [first.id],
      'PED81',
      'owner de outro tenant nao revoga',
    );
    await expectError(
      ownerAS,
      'select public.revoke_org_member_invite($1)',
      [randomUUID()],
      'PED86',
      'revogar convite inexistente gera INVITE_NOT_FOUND',
    );

    const operatorInvite = await invite(ownerAS, inviteeB.email, 'operator');
    const revoked = await revoke(ownerAS, operatorInvite.id);
    ok(revoked.revoked === true, 'primeira revogacao ok');
    ok(revoked.status === 'revoked', 'status reflete revoked');
    const revokedAgain = await revoke(ownerAS, operatorInvite.id);
    ok(revokedAgain.revoked === false, 'revogacao repetida e idempotente');

    // ============================================================
    // Cenario 5 — aceite: caminhos negativos
    // ============================================================
    console.log('Cenario 5 — aceite: caminhos negativos');
    await expectDenied(
      anon,
      'select public.accept_org_member_invite($1)',
      [first.id],
      'anon nao aceita (revogado)',
    );
    await expectError(
      inviteeBS,
      'select public.accept_org_member_invite($1)',
      [first.id],
      'PED90',
      'usuario com outro email gera EMAIL_MISMATCH',
    );
    await expectError(
      inviteeAS,
      'select public.accept_org_member_invite($1)',
      [randomUUID()],
      'PED86',
      'aceitar convite inexistente gera INVITE_NOT_FOUND',
    );
    await expectError(
      inviteeBS,
      'select public.accept_org_member_invite($1)',
      [operatorInvite.id],
      'PED88',
      'aceitar convite revogado gera INVITE_REVOKED',
    );

    const expired = await admin.query(
      `insert into public.organization_member_invites
         (organization_id, email, role, invited_by, expires_at)
       values ($1, $2, 'operator', $3, now() - interval '1 day')
       returning id`,
      [orgA, inviteeB.email, ownerA.id],
    );
    await expectError(
      inviteeBS,
      'select public.accept_org_member_invite($1)',
      [expired.rows[0].id],
      'PED87',
      'aceitar convite expirado gera INVITE_EXPIRED',
    );
    const pendingForOwnerB = await invite(ownerBS, ownerA.email, 'manager');
    await expectError(
      ownerAS,
      'select public.accept_org_member_invite($1)',
      [pendingForOwnerB.id],
      'PED85',
      'usuario ja membro de org gera ALREADY_IN_ORGANIZATION',
    );

    // renovacao de convite expirado pelo owner
    const renewEmail = `p14-renew-${suffix}@pedon-test.invalid`;
    await admin.query(
      `insert into public.organization_member_invites
         (organization_id, email, role, invited_by, expires_at)
       values ($1, $2, 'operator', $3, now() - interval '1 day')`,
      [orgA, renewEmail, ownerA.id],
    );
    const renewed = await invite(ownerAS, renewEmail, 'operator');
    ok(renewed.created === false && renewed.renewed === true, 'convite expirado e renovado');
    ok(
      renewed.expires_at > new Date(Date.now() + 6 * 86400000).toISOString(),
      'renovacao estende o prazo para 7 dias',
    );

    // ============================================================
    // Cenario 6 — aceite feliz + efeitos transacionais
    // ============================================================
    console.log('Cenario 6 — aceite feliz e efeitos transacionais');
    const accepted = await accept(inviteeAS, first.id);
    ok(accepted.accepted === true, 'aceite bem-sucedido');
    ok(
      accepted.organization_id === orgA && accepted.role === 'manager',
      'aceite retorna org e funcao',
    );

    const inviteRow = await admin.query(
      `select status, accepted_by, accepted_at from public.organization_member_invites where id = $1`,
      [first.id],
    );
    ok(
      inviteRow.rows[0].status === 'accepted' &&
        inviteRow.rows[0].accepted_by === inviteeA.id &&
        inviteRow.rows[0].accepted_at !== null,
      'convite marcado accepted com autor e data',
    );

    const membership = await admin.query(
      `select role from public.organization_members where organization_id = $1 and user_id = $2`,
      [orgA, inviteeA.id],
    );
    ok(
      membership.rows.length === 1 && membership.rows[0].role === 'manager',
      'membership criada como manager',
    );

    const profile = await admin.query(
      `select onboarding_status from public.profiles where id = $1`,
      [inviteeA.id],
    );
    ok(profile.rows[0].onboarding_status === 'completed', 'onboarding do convidado concluido');

    const autoUnits = await admin.query(
      `select count(*)::integer as n from public.membership_units where user_id = $1`,
      [inviteeA.id],
    );
    ok(autoUnits.rows[0].n === 0, 'nenhuma unidade atribuida automaticamente');

    const pendingAfter = await myPending(inviteeAS);
    ok(
      Array.isArray(pendingAfter) && pendingAfter.length === 0,
      'convite aceito sai da lista pendente',
    );

    await expectError(
      inviteeAS,
      'select public.accept_org_member_invite($1)',
      [first.id],
      'PED89',
      'aceitar de novo gera INVITE_ALREADY_ACCEPTED',
    );
    await expectError(
      ownerAS,
      'select public.revoke_org_member_invite($1)',
      [first.id],
      'PED89',
      'revogar convite aceito gera INVITE_ALREADY_ACCEPTED',
    );

    const inviteeContext = await adminContext(inviteeAS);
    ok(
      inviteeContext.organization !== null && inviteeContext.organization.id === orgA,
      'get_my_admin_context reconhece o convidado como membro',
    );
    ok(inviteeContext.role === 'manager', 'role do convidado e manager no contexto');
    ok(
      Array.isArray(inviteeContext.units) && inviteeContext.units.length === 0,
      'convidado sem unidade ainda',
    );

    // ============================================================
    // Cenario 7 — escrita direta bloqueada + grants/seguranca
    // ============================================================
    console.log('Cenario 7 — escrita direta bloqueada e grants');
    await expectDenied(
      anon,
      'insert into public.organization_member_invites (organization_id, email, role, invited_by, expires_at) values ($1, $2, $3, $4, now())',
      [orgA, 'x@pedon-test.invalid', 'manager', ownerA.id],
      'anon nao insere convite direto',
    );
    await expectDenied(
      ownerAS,
      'insert into public.organization_member_invites (organization_id, email, role, invited_by, expires_at) values ($1, $2, $3, $4, now())',
      [orgA, 'x@pedon-test.invalid', 'manager', ownerA.id],
      'owner nao insere convite direto (somente RPC)',
    );
    await expectDenied(
      ownerAS,
      'update public.organization_member_invites set status = $1 where id = $2',
      ['revoked', first.id],
      'owner nao atualiza convite direto',
    );
    await expectDenied(
      ownerAS,
      'delete from public.organization_member_invites where id = $1',
      [first.id],
      'owner nao exclui convite direto',
    );

    const rpcGrants = await admin.query(
      `select routine_name, grantee
       from information_schema.routine_privileges
       where specific_schema = 'public'
         and routine_name in ('invite_org_member','revoke_org_member_invite','get_org_member_invites','get_my_pending_member_invites','accept_org_member_invite')`,
    );
    const leakedToPublic = rpcGrants.rows.some(
      (row) => row.grantee === 'PUBLIC' || row.grantee === 'anon',
    );
    ok(leakedToPublic === false, 'nenhuma das 5 RPCs novas e executavel por PUBLIC/anon');
    const uniqueRoutines = new Set(rpcGrants.rows.map((row) => row.routine_name));
    ok(uniqueRoutines.size === 5, 'todas as 5 RPCs novas possuem grants registrados');

    const rpcSecurity = await admin.query(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('invite_org_member','revoke_org_member_invite','get_org_member_invites','get_my_pending_member_invites','accept_org_member_invite')`,
    );
    ok(
      rpcSecurity.rows.length === 5 && rpcSecurity.rows.every((row) => row.prosecdef === true),
      'todas as 5 RPCs novas usam SECURITY DEFINER',
    );
    ok(
      rpcSecurity.rows.every(
        (row) => Array.isArray(row.proconfig) && row.proconfig.includes('search_path=""'),
      ),
      'todas as 5 RPCs novas fixam search_path vazio',
    );

    ok(passed + failed >= 60, 'suite planeja ao menos 60 checks executados');
  } finally {
    for (const client of openClients) {
      await client.end().catch(() => {});
    }
    if (createdOrgIds.length > 0) {
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
