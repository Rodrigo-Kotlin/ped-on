# PED-ON — Database Schema

> Referência do esquema de banco do Ped-On (Supabase/PostgreSQL).
> Gerado a partir da migration `supabase/migrations/20260809221710_identity_tenant_foundation.sql`,
> aplicada no projeto Supabase `ped-on` (ref `zmuxkztnilnzjyyojbbr`).

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
| `organization_members` | Vínculo usuário ↔ organização com papel (RBAC mínimo) |
| `units` | Unidade operacional do tenant (ex.: filiais/pontos de venda) |

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
| `role` | `text` NOT NULL | check in (`owner`, `member`) |
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
Índice: `units_organization_id_idx`.

## 7. Funções e triggers

| Objeto | Tipo | Descrição |
|---|---|---|
| `public.handle_new_user()` | trigger (AFTER INSERT `auth.users`) | cria `profiles` 1:1, `security definer`, `search_path=''`; idempotente (`ON CONFLICT DO NOTHING`) |
| `public.set_updated_at()` | trigger function | atualiza `updated_at = now()` |
| `public.is_org_member(uuid)` | SQL function | `stable`, `security definer`; checa se `auth.uid()` é membro da org; `search_path=''` |
| `public.complete_onboarding(text)` | PL/pgSQL function | cria org + owner + unidade + marca `completed`; transacional e idempotente; `security definer`; `search_path=''` |

### 7.1 `complete_onboarding(p_organization_name)`

Fluxo (executa como `security definer` — owner `postgres`):

1. Valida `auth.uid()` não nulo (senão: `Usuário não autenticado`).
2. Valida nome da organização não vazio (senão: `Nome da organização é obrigatório`).
3. Toma `pg_advisory_xact_lock(hashtext(user_id))` — serializa onboarding do usuário.
4. Se o usuário já é membro de alguma org: `Usuário já possui uma organização`.
5. Insere `organizations`, `organization_members` (role `owner`) e `units` (Unidade principal).
6. Atualiza `profiles.onboarding_status = 'completed'`.
7. Retorna `uuid` da organização criada.

## 8. Extensões

| Extensão | Uso |
|---|---|
| `pgcrypto` | `gen_random_uuid()` |

## 9. Estado de produção (checkpoint)

Verificado em 2026-08-09 (conexão direta `postgres`, RLS ativo):

- `migration list`: `Local = Remote = 20260809221710` (única migration).
- `supabase db lint --linked`: `No schema errors found`.
- Tabelas: `profiles`, `organizations`, `organization_members`, `units` (0 linhas — base limpa).
- Extensão `pgcrypto` presente.

## 10. Evolução futura (não implementada)

Fases seguintes adicionam (via migrations versionadas): catálogo (categorias/produtos),
menus versionados/publicação, pedidos idempotentes, clientes, clube Ped-On (ledger de pontos),
recompensas/vouchers e auditoria.
