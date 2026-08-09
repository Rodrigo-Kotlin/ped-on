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
- O cliente frontend usa somente a **publishable key** (`anon`/`authenticated`); `service_role`
  jamais é exposta ao navegador.
- Funções críticas são `security definer` com `set search_path = ''` (evita busca de schema).

## 2. Estado do RLS por tabela

| Tabela | RLS | Policies |
|---|---|---|
| `profiles` | ON | `profiles_select_own`, `profiles_update_own` |
| `organizations` | ON | `organizations_select_member` |
| `organization_members` | ON | `organization_members_select_same_org` |
| `units` | ON | `units_select_member` |

## 3. Policies — descrição

### 3.1 `profiles`

- `profiles_select_own` — `FOR SELECT TO authenticated USING (auth.uid() = id)`
  → usuário lê somente o próprio perfil.
- `profiles_update_own` — `FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`
  → usuário atualiza somente o próprio perfil.

Escrita de `email`/`onboarding_status` não é exposta por policy; apenas `full_name` recebe
`GRANT UPDATE`. O `onboarding_status` é transicionado exclusivamente por `complete_onboarding`.

### 3.2 `organizations` / `organization_members` / `units`

- Todas usam `public.is_org_member(organization_id)`:
  `SELECT FOR authenticated USING (public.is_org_member(id | organization_id))`.
- **Cross-tenant negado**: usuário sem vínculo na organização não enxerga a linha.

### 3.3 Sem policies de escrita

Não existem policies `INSERT`/`UPDATE`/`DELETE` em `organizations`,
`organization_members` e `units` para `authenticated`. Toda criação de dados de tenant ocorre
dentro de `complete_onboarding` (função `security definer` que roda como owner).

## 4. Funções e grants

| Função | Grants |
|---|---|
| `is_org_member(uuid)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |
| `complete_onboarding(text)` | `EXECUTE` apenas para `authenticated` (revogado de `public`) |

Tabelas: `SELECT` concedido a `authenticated`; `UPDATE (full_name)` em `profiles`.

## 5. Ataques/desvios cobertos (mapeamento p/ testes)

| Cenário | Proteção | Teste |
|---|---|---|
| Anon lê perfis | RLS nega (`anon` sem policy) | cenário 2 |
| Anon executa onboarding | `EXECUTE` só p/ `authenticated` | cenário 3 |
| Usuário lê perfil alheio | `profiles_select_own` | cenário 5 |
| Usuário lê org/unidade de outro tenant | `is_org_member` | cenário 8 |
| Dupla execução de onboarding | `advisory lock` + guard em `complete_onboarding` | cenário 10 |
| Corrida (concorrência) cria 2 orgs | `pg_advisory_xact_lock` transacional | cenário 11 |
| Insert direto em `organizations` | ausência de policy de escrita | cenário 12 |

## 6. Identidade e onboarding

- Criação de usuário: trigger `handle_new_user` (AFTER INSERT em `auth.users`,
  `security definer`) cria o `profile` automaticamente com `onboarding_status = 'pending'`.
- Onboarding: `complete_onboarding` cria org + membro `owner` + unidade principal e marca
  `completed`; é transacional, idempotente e serializado por usuário.
- E-mail de confirmação ativado no Supabase: o fluxo de criação de usuário exige e-mail
  confirmado (afeta testes de signup via API; testes de banco usam conexão direta).

## 7. Validação executada (checkpoint 2026-08-09)

Teste de integração: `supabase/tests/rls_integrity.test.mjs` (Node + `pg`, conexão direta
como `postgres` para setup/cleanup; sessões simuladas com `SET ROLE authenticated` +
`SET request.jwt.claims`).

Resultado: **22 checks passando / 0 falhas** nos 12 cenários (ver mapa acima) + cleanup
verificado (banco sem dados sintéticos residuais).

### 7.1 Como rodar

```bash
# requer conexão com o banco do projeto Supabase
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'   # PowerShell (Windows)
node supabase/tests/rls_integrity.test.mjs
```

## 8. Regras de manutenção

- Nenhuma policy de escrita ampla para `authenticated` deve ser adicionada sem decisão
  registrada em `PEDON_DECISION_REGISTER.md`.
- Novas tabelas de domínio devem habilitar RLS e seguir o padrão de policy seletora via
  `is_org_member` (ou helper equivalente).
- Alterações de segurança devem passar por nova execução do teste de integração RLS.
- Em caso de regressão: verificar migração correspondente e revalidar com
  `supabase db lint --linked` + teste de integração.
