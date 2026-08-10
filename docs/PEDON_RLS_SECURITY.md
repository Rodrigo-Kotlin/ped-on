# PED-ON — RLS Security

> Modelo de segurança em Row Level Security (RLS) do Ped-On (Supabase/PostgreSQL).
> Alinhado aos invariantes do `PEDON_PROJECT_BASELINE.md` (RLS nega por padrão;
> nenhum tenant acessa dados de outro; frontend nunca usa `service_role`).

## 1. Princípios aplicados

- RLS habilitado em todas as tabelas de negócio (`public.*`).
- **Negar por padrão**: nenhuma policy de escrita ampla existe; escrita ocorre exclusivamente
  via funções `security definer`.
- Sessão autenticada usa o role `authenticated` (claims JWT em `request.jwt.claims`).
- Acesso a dados de tenant depende de associação em `organization_members`.
- Acesso a **unidades** é por autorização efetiva: owner acessa todas as unidades do tenant;
  manager/operator acessam somente unidades com vínculo explícito em `membership_units`.
- O cliente frontend usa somente a **publishable key** (`anon`/`authenticated`); `service_role`
  jamais é exposta ao navegador.
- Funções críticas são `security definer` com `set search_path = ''` (evita busca de schema).

## 2. Estado do RLS por tabela

| Tabela | RLS | Policies |
|---|---|---|
| `profiles` | ON | `profiles_select_own`, `profiles_update_own` |
| `organizations` | ON | `organizations_select_member` |
| `organization_members` | ON | `organization_members_select_same_org` |
| `units` | ON | `units_select_authorized` |
| `membership_units` | ON | `membership_units_select_own_access` |

## 3. Policies — descrição

### 3.1 `profiles`

- `profiles_select_own` — `FOR SELECT TO authenticated USING (auth.uid() = id)`
  → usuário lê somente o próprio perfil.
- `profiles_update_own` — `FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`
  → usuário atualiza somente o próprio perfil.

Escrita de `email`/`onboarding_status` não é exposta por policy; apenas `full_name` recebe
`GRANT UPDATE`. O `onboarding_status` é transicionado exclusivamente por `complete_onboarding`.

### 3.2 `organizations` / `organization_members`

- Ambas usam `public.is_org_member(...)`:
  `SELECT FOR authenticated USING (public.is_org_member(id | organization_id))`.
- **Cross-tenant negado**: usuário sem vínculo na organização não enxerga a linha.

### 3.3 `units` — autorização efetiva

- `units_select_authorized` — `SELECT FOR authenticated USING (is_org_owner(organization_id) OR can_access_unit(id))`.
  → **owner**: enxerga todas as unidades da própria organização.
  → **manager/operator**: enxerga somente unidades com vínculo em `membership_units`.
- Substitui a policy antiga `units_select_member` (qualquer membro via `is_org_member`).

### 3.4 `membership_units` — vínculo explícito por unidade

- `membership_units_select_own_access` — `SELECT FOR authenticated USING (user_id = auth.uid() OR is_org_owner(organization_id))`.
  → o usuário lê os próprios vínculos; o owner lê os vínculos da organização (base para gestão futura).
- Integridade cross-org garantida pela FK composta `(organization_id, unit_id) →
  units(organization_id, id)` (vínculo com unidade de outra organização é rejeitado).
- Escrita (INSERT/UPDATE/DELETE) não possui policy: gestão via admin/`security definer`
  (fundação criada; UI de gestão ainda não exposta).

### 3.5 Sem policies de escrita

Não existem policies `INSERT`/`UPDATE`/`DELETE` em `organizations`,
`organization_members`, `units` e `membership_units` para `authenticated`. Toda criação de dados
de tenant ocorre dentro de funções `security definer` (`complete_onboarding` e RPCs de unidade).

## 4. Funções e grants

| Função | Grants |
|---|---|
| `is_org_member(uuid)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `complete_onboarding(text)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `is_org_owner(uuid)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `can_access_unit(uuid)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `get_my_admin_context()` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `create_unit(text)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `update_unit(uuid, text)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `set_unit_active(uuid, boolean)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |

Tabelas: `SELECT` concedido a `authenticated`; `UPDATE (full_name)` em `profiles`.

### 4.1 Contrato de erro das RPCs de unidade (SQLSTATE próprio)

| SQLSTATE | Mensagem | Quando |
|---|---|---|
| `PED00` | `NOT_AUTHENTICATED` | `auth.uid()` nulo |
| `PED01` | `FORBIDDEN` | chamador não é owner da organização |
| `PED02` | `UNIT_NOT_FOUND` | unidade inexistente na organização do chamador |
| `PED03` | `UNIT_NAME_REQUIRED` | nome em branco |
| `PED04` | `LAST_ACTIVE_UNIT` | tentativa de desativar a última unidade ativa |
| `PED05` | `UNIT_NAME_TOO_LONG` | nome acima de 200 caracteres |

## 5. Ataques/desvios cobertos (mapeamento p/ testes)

| Cenário | Proteção | Teste |
|---|---|---|
| Anon lê perfis | RLS nega (`anon` sem policy) | rls_integrity cenário 2 |
| Anon executa onboarding | `EXECUTE` só p/ `authenticated` | rls_integrity cenário 3 |
| Usuário lê perfil alheio | `profiles_select_own` | rls_integrity cenário 5 |
| Usuário lê org/unidade de outro tenant | `is_org_member` | rls_integrity cenário 8 |
| Dupla execução de onboarding | `advisory lock` + guard em `complete_onboarding` | rls_integrity cenário 10 |
| Corrida (concorrência) cria 2 orgs | `pg_advisory_xact_lock` transacional | rls_integrity cenário 11 |
| Insert direto em `organizations` | ausência de policy de escrita | rls_integrity cenário 12 |
| Manager acessa unidade sem vínculo | `units_select_authorized` + `can_access_unit` | rbac_units cenário 4 |
| Operator restrito ao vínculo | `membership_units` no escopo | rbac_units cenário 6 |
| Vínculo cross-org de unidade | FK composta `units(organization_id, id)` | rbac_units cenário 7 |
| Anon lê `membership_units` | RLS/grants negam | rbac_units cenário 8 |
| INSERT/UPDATE direto em `units` | ausência de policy de escrita | rbac_units cenários 9/10 |
| `create_unit` por manager | RPC exige role owner (`PED01`) | rbac_units cenário 12 |
| `update_unit` em unidade de outra org | RPC valida org do chamador (`PED02`) | rbac_units cenários 15/18 |
| Desativar última unidade ativa | `pg_advisory_xact_lock` + contagem (`PED04`) | rbac_units cenário 17 |
| Corrida desativando unidades | lock transacional por organização | rbac_units cenário 22 |

## 6. Identidade e onboarding

- Criação de usuário: trigger `handle_new_user` (AFTER INSERT em `auth.users`,
  `security definer`) cria o `profile` automaticamente com `onboarding_status = 'pending'`.
- Onboarding: `complete_onboarding` cria org + membro `owner` + unidade principal e marca
  `completed`; é transacional, idempotente e serializado por usuário.
- E-mail de confirmação ativado no Supabase: o fluxo de criação de usuário exige e-mail
  confirmado (afeta testes de signup via API; testes de banco usam conexão direta).

## 7. RBAC administrativo e contexto

- Papéis: `owner` (acesso total ao tenant e à gestão de unidades), `manager`/`operator`
  (acesso restrito às unidades com vínculo explícito em `membership_units`).
- Escrita de unidades (criar/renomear/ativar-desativar) é exclusiva do `owner` via RPCs
  server-authoritative; nunca por `INSERT`/`UPDATE` direto.
- `get_my_admin_context()` retorna em uma única chamada: perfil, organização, papel e unidades
  acessíveis — a fonte única do frontend administrativo.

## 8. Validação executada (checkpoint 2026-08-10)

Testes de integração em `supabase/tests/` (Node + `pg`, conexão direta como `postgres` para
setup/cleanup; sessões simuladas com `SET ROLE authenticated` + `SET request.jwt.claims`):

- `rls_integrity.test.mjs` — **22 checks / 12 cenários PASS** (regressão pós-Prompt 04).
- `rbac_units_integrity.test.mjs` — **31 checks / 22 cenários PASS** (RBAC, escopo por unidade,
  cross-tenant, RPCs, última unidade ativa, concorrência).

Cleanup verificado (banco sem dados sintéticos residuais). `supabase db lint --linked`:
`No schema errors found`.

### 8.1 Como rodar

```bash
# requer conexão com o banco do projeto Supabase
# (a senha também pode ser lida diretamente do .env pelo teste)
node supabase/tests/rls_integrity.test.mjs
node supabase/tests/rbac_units_integrity.test.mjs
```

## 9. Regras de manutenção

- Nenhuma policy de escrita ampla para `authenticated` deve ser adicionada sem decisão
  registrada em `PEDON_DECISION_REGISTER.md`.
- Novas tabelas de domínio devem habilitar RLS e seguir o padrão de policy seletora via
  `is_org_member` (ou helper equivalente).
- Toda tabela escopada por unidade deve usar `can_access_unit` (ou derivar dele) — nunca
  expor dados de uma unidade sem autorização explícita.
- Alterações de segurança devem passar por nova execução dos testes de integração RLS/RBAC.
- Em caso de regressão: verificar migração correspondente e revalidar com
  `supabase db lint --linked` + testes de integração.
