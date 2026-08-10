# PED-ON — Database Schema

> Referência do esquema de banco do Ped-On (Supabase/PostgreSQL).
> Gerado a partir das migrations em `supabase/migrations/`
> (`20260809221710_identity_tenant_foundation.sql` e
> `20260810015224_rbac_units_context.sql`), aplicadas no projeto Supabase `ped-on`
> (ref `zmuxkztnilnzjyyojbbr`).

## 1. Convenções

- Banco: PostgreSQL 17 (Supabase).
- Identificadores: `snake_case`.
- Todas as tabelas de negócio vivem no schema `public` e possuem RLS habilitado.
- Valores monetários (futuros): `numeric(12,2)` — nunca `float`/`double`.
- `organization_id` é o tenant; `unit_id` é o escopo operacional.
- Migrations versionadas em `supabase/migrations/` seguem `timestamp + descrição`.

## 2. Entidades (visão geral)

| Entidade | Papel |
|---|---|
| `profiles` | Extensão 1:1 de `auth.users` (dados de perfil e estado de onboarding) |
| `organizations` | Tenant — restaurante/hamburgueria estabelecimento |
| `organization_members` | Vínculo usuário ↔ organização com papel (RBAC: `owner`/`manager`/`operator`) |
| `units` | Unidade operacional do tenant (ex.: filiais/pontos de venda) |
| `membership_units` | Autorização explícita de usuário por unidade (manager/operator) |

## 3. `public.profiles`

Espelho de usuário autenticado. Chave primária é o `id` de `auth.users`.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | FK `auth.users(id) ON DELETE CASCADE` |
| `email` | `text` NOT NULL | preenchido pelo trigger em `auth.users` |
| `full_name` | `text` | opcional; única coluna atualizável pelo usuário |
| `onboarding_status` | `text` NOT NULL default `'pending'` | check in (`pending`, `completed`) |
| `created_at` | `timestamptz` default `now()` | |
| `updated_at` | `timestamptz` default `now()` | atualizado por trigger `set_updated_at` |

Triggers: `set_profiles_updated_at` (BEFORE UPDATE).

## 4. `public.organizations`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `name` | `text` NOT NULL | check `char_length(btrim(name)) > 0` |
| `created_at` | `timestamptz` default `now()` | |
| `updated_at` | `timestamptz` default `now()` | atualizado por trigger `set_updated_at` |

Triggers: `set_organizations_updated_at` (BEFORE UPDATE).
Não possui FK direta para `auth.users`; o vínculo de dono vive em `organization_members`.

## 5. `public.organization_members`

| Coluna | Tipo | Regras |
|---|---|---|
| `organization_id` | `uuid` NOT NULL | FK `organizations(id) ON DELETE CASCADE` |
| `user_id` | `uuid` NOT NULL | FK `auth.users(id) ON DELETE CASCADE` |
| `role` | `text` NOT NULL | check in (`owner`, `manager`, `operator`) |
| `created_at` | `timestamptz` default `now()` | |
| PK | (`organization_id`, `user_id`) | |

Índice: `organization_members_user_id_idx` (busca por usuário).

## 6. `public.units`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | FK `organizations(id) ON DELETE CASCADE` |
| `name` | `text` NOT NULL | check `char_length(btrim(name)) > 0` |
| `is_active` | `boolean` default `true` | |
| `created_at` | `timestamptz` default `now()` | |
| `updated_at` | `timestamptz` default `now()` | atualizado por trigger `set_updated_at` |

Triggers: `set_units_updated_at` (BEFORE UPDATE).
Índices: `units_organization_id_idx`; **unique `units_organization_id_id_key`
(`organization_id`, `id`)** — alvo da FK composta em `membership_units`.

## 7. `public.membership_units`

Autorização explícita de acesso por unidade (papéis `manager`/`operator`). O owner acessa todas
as unidades do tenant sem vínculo.

| Coluna | Tipo | Regras |
|---|---|---|
| `organization_id` | `uuid` NOT NULL | FK composta para `units(organization_id, id) ON DELETE CASCADE` |
| `user_id` | `uuid` NOT NULL | FK composta para `organization_members(organization_id, user_id) ON DELETE CASCADE` |
| `unit_id` | `uuid` NOT NULL | (coberto pela FK composta) |
| `created_at` | `timestamptz` default `now()` | |
| PK | (`organization_id`, `user_id`, `unit_id`) | |

Índices: `membership_units_user_id_idx`, `membership_units_unit_id_idx`.
Integridade cross-org: a FK `(organization_id, unit_id) → units(organization_id, id)` impede
vínculo com unidade de outra organização.
RLS: `membership_units_select_own_access` (`SELECT` do próprio vínculo ou owner da organização).
Sem policies de escrita — gestão via admin/`security definer`.

## 8. Funções e triggers

| Objeto | Tipo | Descrição |
|---|---|---|
| `public.handle_new_user()` | trigger (AFTER INSERT `auth.users`) | cria `profiles` 1:1, `security definer`, `search_path=''`; idempotente (`ON CONFLICT DO NOTHING`) |
| `public.set_updated_at()` | trigger function | atualiza `updated_at = now()` |
| `public.is_org_member(uuid)` | SQL function | `stable`, `security definer`; checa se `auth.uid()` é membro da org; `search_path=''` |
| `public.complete_onboarding(text)` | PL/pgSQL function | cria org + owner + unidade + marca `completed`; transacional e idempotente; `security definer`; `search_path=''` |
| `public.is_org_owner(uuid)` | SQL function | `stable`, `security definer`; checa se `auth.uid()` é owner da org; `search_path=''` |
| `public.can_access_unit(uuid)` | SQL function | `stable`, `security definer`; owner da org da unidade OU vínculo em `membership_units`; `search_path=''` |
| `public.get_my_admin_context()` | PL/pgSQL function | retorna `jsonb` com perfil, organização, papel e unidades acessíveis; `security definer`; `search_path=''` |
| `public.create_unit(text)` | PL/pgSQL function | cria unidade na org do owner; retorna `units`; contrato de erro `PEDxx`; `security definer`; `search_path=''` |
| `public.update_unit(uuid, text)` | PL/pgSQL function | renomeia unidade da própria org; retorna `units`; contrato de erro `PEDxx`; `security definer`; `search_path=''` |
| `public.set_unit_active(uuid, boolean)` | PL/pgSQL function | ativa/desativa unidade; protege a última unidade ativa; retorna `units`; contrato de erro `PEDxx`; `security definer`; `search_path=''` |

### 8.1 `complete_onboarding(p_organization_name)`

Fluxo (executa como `security definer` — owner `postgres`):

1. Valida `auth.uid()` não nulo (senão: `Usuário não autenticado`).
2. Valida nome da organização não vazio (senão: `Nome da organização é obrigatório`).
3. Toma `pg_advisory_xact_lock(hashtext(user_id))` — serializa onboarding do usuário.
4. Se o usuário já é membro de alguma org: `Usuário já possui uma organização`.
5. Insere `organizations`, `organization_members` (role `owner`) e `units` (Unidade principal).
6. Atualiza `profiles.onboarding_status = 'completed'`.
7. Retorna `uuid` da organização criada.

### 8.2 RPCs de unidade (contrato de erro `PEDxx`)

| SQLSTATE | Mensagem | Quando |
|---|---|---|
| `PED00` | `NOT_AUTHENTICATED` | `auth.uid()` nulo |
| `PED01` | `FORBIDDEN` | chamador não é owner da organização |
| `PED02` | `UNIT_NOT_FOUND` | unidade inexistente na organização do chamador |
| `PED03` | `UNIT_NAME_REQUIRED` | nome em branco |
| `PED04` | `LAST_ACTIVE_UNIT` | tentativa de desativar a última unidade ativa |
| `PED05` | `UNIT_NAME_TOO_LONG` | nome acima de 200 caracteres |

A desativação serializa por organização via `pg_advisory_xact_lock(hashtext('pedon:org:' || org_id))`
antes de contar as unidades ativas (impede corrida).

### 8.3 `get_my_admin_context()`

Retorna `jsonb` com:
- `profile` — `{ id, full_name, email }`;
- `organization` — `{ id, name }` (ou `null` se não houver vínculo);
- `role` — papel na organização (ou `null`);
- `units` — unidades acessíveis (owner: todas; manager/operator: apenas as vinculadas).

## 9. RLS (resumo)

| Tabela | Policy | Semântica |
|---|---|---|
| `profiles` | `profiles_select_own` / `profiles_update_own` | próprio perfil |
| `organizations` | `organizations_select_member` | membro do tenant |
| `organization_members` | `organization_members_select_same_org` | membro do tenant |
| `units` | `units_select_authorized` | owner → todas; demais → vinculadas |
| `membership_units` | `membership_units_select_own_access` | próprio vínculo ou owner |

Sem policies de escrita — toda mutação via funções `security definer`.

## 10. Extensões

| Extensão | Uso |
|---|---|
| `pgcrypto` | `gen_random_uuid()` |

## 11. Estado de produção (checkpoint 2026-08-10)

Verificado (conexão direta `postgres`, RLS ativo):

- `migration list`: `Local = Remote = 20260809221710, 20260810015224`.
- `supabase db lint --linked`: `No schema errors found`.
- Tabelas: `profiles`, `organizations`, `organization_members`, `units`, `membership_units`.
- `units` com policy única `units_select_authorized`; `membership_units` com RLS ativo e
  FKs compostas presentes.

## 12. Evolução futura (não implementada)

Fases seguintes adicionam (via migrations versionadas): catálogo (categorias/produtos),
menus versionados/publicação, pedidos idempotentes, clientes, clube Ped-On (ledger de pontos),
recompensas/vouchers e auditoria.
