# PED-ON — Database Schema

> Referência cumulativa do esquema Supabase/PostgreSQL do Ped-On após o Prompt 07.
> Fonte autoritativa: as oito migrations versionadas em `supabase/migrations/`, aplicadas no
> projeto `ped-on` (ref `zmuxkztnilnzjyyojbbr`).

## 1. Estado das migrations

| Ordem | Migration | Escopo |
|---|---|---|
| 1 | `20260809221710_identity_tenant_foundation.sql` | identidade, tenant, unidade e onboarding |
| 2 | `20260810015224_rbac_units_context.sql` | RBAC, vínculos por unidade, contexto e RPCs de unidade |
| 3 | `20260810032804_unit_operational_config.sql` | configurações, horários, pagamentos e RPCs operacionais |
| 4 | `20260810033118_unit_operational_config_hardening.sql` | validação defensiva de ETAs |
| 5 | `20260810120000_unit_operational_config_acceptance_hardening.sql` | aceite seguro de pedidos e contrato `configured` |
| 6 | `20260810122401_catalog_base.sql` | categorias, produtos e gestão administrativa do catálogo |
| 7 | `20260810135051_menu_versioning_publication.sql` | versionamento imutável, publicação e cardápio público |
| 8 | `20260810141000_menu_publication_slug_fix.sql` | correção do slug público (`gen_random_uuid` no lugar de `gen_random_bytes`) |

Checkpoint oficial de 2026-08-10: `supabase migration list` apresenta Local == Remote para as
oito versões; `supabase db lint --linked` retorna `No schema errors found`.

## 2. Convenções

- PostgreSQL 17 no Supabase; objetos de negócio no schema `public`.
- Identificadores em `snake_case`; UUIDs gerados por `gen_random_uuid()`.
- `organization_id` é o tenant e `unit_id` é o escopo operacional.
- Todas as quatorze tabelas `public` possuem RLS habilitado.
- Dinheiro usa `numeric(12,2)`, nunca `float`/`double`; RPCs devolvem valores monetários como
  string decimal.
- Mutações administrativas e de domínio são server-authoritative via RPC; grants diretos são
  mínimos.
- Funções de autorização, validação e RPCs `security definer` usam `set search_path = ''`.
  `set_updated_at()` é a função de trigger comum e não é `security definer`.

## 3. Visão geral das entidades

| Entidade | Papel |
|---|---|
| `profiles` | identidade 1:1 de `auth.users` e estado de onboarding |
| `organizations` | tenant |
| `organization_members` | usuário na organização com role `owner`/`manager`/`operator` |
| `units` | unidade operacional do tenant |
| `membership_units` | autorização explícita de manager/operator por unidade |
| `unit_operational_settings` | configuração operacional 1:1 da unidade |
| `unit_business_hours` | sete horários semanais por unidade |
| `unit_payment_methods` | meios de pagamento externos aceitos pela unidade |
| `catalog_categories` | categorias mutáveis do catálogo de uma unidade |
| `catalog_products` | produtos simples mutáveis de uma categoria/unidade |
| `menu_versions` | snapshots comerciais imutáveis do cardápio de uma unidade |
| `menu_version_categories` | categorias congeladas de uma versão |
| `menu_version_products` | produtos congelados de uma versão |
| `menu_publications` | ponte atual: slug público estável → versão CURRENT |

## 4. Identidade, tenant e RBAC

### 4.1 `public.profiles`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | FK `auth.users(id) ON DELETE CASCADE` |
| `email` | `text` NOT NULL | preenchido por `handle_new_user()` |
| `full_name` | `text` | opcional; única coluna atualizável diretamente pelo usuário |
| `onboarding_status` | `text` NOT NULL default `'pending'` | check em `pending`, `completed` |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_profiles_updated_at` |

### 4.2 `public.organizations`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `name` | `text` NOT NULL | `char_length(btrim(name)) > 0` |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_organizations_updated_at` |

Não há FK direta para `auth.users`; proprietários vivem em `organization_members`.

### 4.3 `public.organization_members`

| Coluna | Tipo | Regras |
|---|---|---|
| `organization_id` | `uuid` NOT NULL | FK `organizations(id) ON DELETE CASCADE` |
| `user_id` | `uuid` NOT NULL | FK `auth.users(id) ON DELETE CASCADE` |
| `role` | `text` NOT NULL | check em `owner`, `manager`, `operator` |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| PK | `(organization_id, user_id)` | |

Índice: `organization_members_user_id_idx (user_id)`.

### 4.4 `public.units`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | FK `organizations(id) ON DELETE CASCADE` |
| `name` | `text` NOT NULL | `char_length(btrim(name)) > 0` |
| `is_active` | `boolean` NOT NULL default `true` | |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_units_updated_at` |

Índice `units_organization_id_idx`; unique `units_organization_id_id_key (organization_id, id)`,
alvo das FKs compostas de tabelas escopadas por unidade.

### 4.5 `public.membership_units`

| Coluna | Tipo | Regras |
|---|---|---|
| `organization_id` | `uuid` NOT NULL | parte das duas FKs compostas |
| `user_id` | `uuid` NOT NULL | FK `(organization_id,user_id)` para `organization_members`, cascade |
| `unit_id` | `uuid` NOT NULL | FK `(organization_id,unit_id)` para `units`, cascade |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| PK | `(organization_id, user_id, unit_id)` | |

Índices: `membership_units_user_id_idx`, `membership_units_unit_id_idx`. A FK composta para
`units` impede vínculos cross-tenant/cross-org.

## 5. Configuração operacional da unidade (Prompt 05)

### 5.1 `public.unit_operational_settings`

| Coluna | Tipo | Regras finais |
|---|---|---|
| `unit_id` | `uuid` PK | FK `units(id) ON DELETE CASCADE` |
| `timezone` | `text` NOT NULL default `'America/Sao_Paulo'` | nome IANA validado pela RPC |
| `pickup_enabled` | `boolean` NOT NULL default `true` | ao menos pickup ou delivery ativo |
| `delivery_enabled` | `boolean` NOT NULL default `false` | ao menos pickup ou delivery ativo |
| `delivery_fee` | `numeric(12,2)` NOT NULL default `0` | `>= 0` |
| `min_order_value` | `numeric(12,2)` NOT NULL default `0` | `>= 0` |
| `estimated_pickup_minutes` | `integer` | null ou `0..1440` |
| `estimated_delivery_minutes` | `integer` | null ou `0..1440` |
| `accepting_orders` | `boolean` NOT NULL default `false` | default final definido pela migration 5 |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_unit_operational_settings_updated_at` |

Constraint `unit_settings_service_mode_check`: `pickup_enabled OR delivery_enabled`.

### 5.2 `public.unit_business_hours`

| Coluna | Tipo | Regras |
|---|---|---|
| `unit_id` | `uuid` NOT NULL | FK `units(id) ON DELETE CASCADE` |
| `weekday` | `smallint` NOT NULL | `0..6`, domingo a sábado |
| `is_open` | `boolean` NOT NULL default `false` | |
| `is_24h` | `boolean` NOT NULL default `false` | 24h exige horários nulos |
| `open_time` | `time` | obrigatório em dia aberto não-24h |
| `close_time` | `time` | obrigatório em dia aberto não-24h |
| PK | `(unit_id, weekday)` | exatamente uma linha por dia após save completo |

`close_time < open_time` é aceito e representa virada para o dia seguinte. Dia fechado ignora
horários na leitura, mas a RPC rejeita payload fechado com horários; dia 24h deve ter ambos nulos.

### 5.3 `public.unit_payment_methods`

| Coluna | Tipo | Regras |
|---|---|---|
| `unit_id` | `uuid` NOT NULL | FK `units(id) ON DELETE CASCADE` |
| `method` | `text` NOT NULL | `cash`, `pix`, `credit_card`, `debit_card` |
| `is_enabled` | `boolean` NOT NULL default `true` | |
| PK | `(unit_id, method)` | |

Armazena somente flags de aceitação; não contém credenciais de pagamento.

### 5.4 Contrato operacional e regras de aceite

`get_unit_operational_config(uuid)` devolve sempre sete dias e quatro métodos. Quando não existe
linha de settings, retorna `configured=false`, `accepting_orders=false`, pickup ativo, delivery
inativo, valores `"0.00"`, todos os dias fechados e todos os métodos desabilitados.

`save_unit_operational_config(uuid,jsonb)`:

- exige unidade ativa e `can_manage_unit` (owner da org ou manager vinculado);
- serializa saves por `pg_advisory_xact_lock(hashtext('pedon:unit:' || unit_id))`;
- valida timezone IANA, uma modalidade ativa, dinheiro exato, ETAs inteiros `0..1440`, sete dias
  únicos e métodos válidos sem duplicação;
- substitui atomicamente settings, sete horários e métodos enviados;
- trata `accepting_orders` ausente como `false`;
- para `accepting_orders=true`, exige unidade ativa, modalidade ativa, ao menos um dia aberto e ao
  menos um pagamento habilitado;
- permite dias todos fechados ou pagamentos todos desabilitados quando `accepting_orders=false`.

| SQLSTATE | Mensagem |
|---|---|
| `PED10` | `NOT_AUTHENTICATED` |
| `PED11` | `FORBIDDEN` |
| `PED12` | `UNIT_NOT_FOUND` |
| `PED13` | `UNIT_INACTIVE` |
| `PED14` | `TIMEZONE_INVALID` |
| `PED15` | `NO_SERVICE_MODE` |
| `PED16` | `INVALID_MONEY` (também contrato defensivo de ETA inválido) |
| `PED17` | `INVALID_PAYMENT_METHOD` |
| `PED18` | `INVALID_BUSINESS_HOURS` |

Não há `PED19` no contrato atual.

## 6. Catálogo base por unidade (Prompt 06)

### 6.1 `public.catalog_categories`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | parte da FK composta da unidade |
| `unit_id` | `uuid` NOT NULL | FK `(organization_id,unit_id)` para `units`, cascade |
| `name` | `text` NOT NULL | já trimado; tamanho `1..80` |
| `sort_order` | `integer` NOT NULL | `> 0`, calculado no servidor |
| `is_active` | `boolean` NOT NULL default `true` | desativação lógica |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_catalog_categories_updated_at` |

Constraints/índices:

- unique composto `catalog_categories_organization_unit_id_key (organization_id,unit_id,id)`,
  alvo da FK dos produtos;
- unique funcional `catalog_categories_unit_name_key` em
  `(organization_id,unit_id,lower(btrim(name)))`, impedindo duplicata case-insensitive na unidade;
- índice de leitura `catalog_categories_unit_order_idx
  (organization_id,unit_id,sort_order,id)`.

### 6.2 `public.catalog_products`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | parte das FKs compostas |
| `unit_id` | `uuid` NOT NULL | FK composta para a unidade, cascade |
| `category_id` | `uuid` NOT NULL | FK `(organization_id,unit_id,category_id)` para categoria, cascade |
| `name` | `text` NOT NULL | já trimado; tamanho `1..120` |
| `description` | `text` | null ou já trimada, tamanho `1..500` |
| `price` | `numeric(12,2)` NOT NULL | `> 0` e `<= 9999999999.99` |
| `sort_order` | `integer` NOT NULL | `> 0`, calculado no servidor |
| `is_active` | `boolean` NOT NULL default `true` | estado estrutural |
| `is_available` | `boolean` NOT NULL default `true` | disponibilidade operacional independente |
| `created_at` | `timestamptz` NOT NULL default `now()` | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_catalog_products_updated_at` |

Unique `catalog_products_organization_unit_id_key (organization_id,unit_id,id)` e índice
`catalog_products_category_order_idx (organization_id,unit_id,category_id,sort_order,id)`. A FK
composta da categoria impede IDOR por categoria de outra unidade/organização.

### 6.3 Ordenação, locks e estados

- Nova categoria recebe `max(sort_order)+100`, sob advisory lock por unidade.
- Novo produto recebe `max(sort_order)+100`, sob advisory lock por categoria.
- Produto movido de categoria recebe o próximo `sort_order` da categoria de destino sob lock;
  edição na mesma categoria preserva a ordem.
- Leitura administrativa ordena por `sort_order,id` e inclui registros inativos.
- `is_active` e `is_available` são independentes. Desativar categoria não altera produtos;
  desativar produto não altera disponibilidade.
- Não existe RPC `delete_catalog_*`; desativação é lógica e nenhum `DELETE` físico é exposto.

### 6.4 RPCs do catálogo

| RPC | Autorização | Efeito |
|---|---|---|
| `get_unit_catalog_admin(uuid)` | owner/manager/operator com acesso | unidade, role, `can_manage`, categorias e produtos completos |
| `create_catalog_category(uuid,text)` | owner/manager da unidade | cria categoria e ordem server-side |
| `update_catalog_category(uuid,text)` | owner/manager da unidade | renomeia categoria |
| `set_catalog_category_active(uuid,boolean)` | owner/manager da unidade | altera estado estrutural |
| `create_catalog_product(uuid,uuid,text,text,text)` | owner/manager da unidade | cria produto simples; preço entra como texto |
| `update_catalog_product(uuid,uuid,text,text,text)` | owner/manager da unidade | edita/move produto |
| `set_catalog_product_active(uuid,boolean)` | owner/manager da unidade | altera estado estrutural |
| `set_catalog_product_available(uuid,boolean)` | owner/manager/operator com acesso | altera somente disponibilidade |

`_validate_catalog_price(text)` aceita somente decimal textual positivo, sem sinal, vírgula,
expoente, `NaN` ou `Infinity`, com até dez dígitos inteiros e duas casas. O retorno administrativo
converte `price` para texto, preservando, por exemplo, `8.10`.

| SQLSTATE | Mensagem |
|---|---|
| `PED20` | `CATEGORY_NOT_FOUND` |
| `PED21` | `CATEGORY_NAME_REQUIRED` |
| `PED22` | `CATEGORY_NAME_TOO_LONG` |
| `PED23` | `CATEGORY_NAME_CONFLICT` |
| `PED24` | `PRODUCT_NOT_FOUND` |
| `PED25` | `PRODUCT_NAME_REQUIRED` |
| `PED26` | `PRODUCT_NAME_TOO_LONG` |
| `PED27` | `DESCRIPTION_TOO_LONG` |
| `PED28` | `INVALID_PRICE` |
| `PED29` | `CATEGORY_UNIT_MISMATCH` |
| `PED30` | `INVALID_CATALOG_FLAG` |

As RPCs reutilizam `PED10`, `PED11` e `PED12` para autenticação, autorização e unidade ausente.

## 7. Cardápio publicado (Prompt 07)

### 7.1 `public.menu_versions`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | parte da FK composta da unidade |
| `unit_id` | `uuid` NOT NULL | FK `(organization_id,unit_id)` para `units`, cascade |
| `version_number` | `integer` NOT NULL | `> 0`, derivado no servidor (`max+1`) |
| `created_by` | `uuid` | FK `auth.users(id) ON DELETE SET NULL` |
| `created_at` | `timestamptz` NOT NULL default `now()` | |

Unique `menu_versions_unit_number_key (unit_id,version_number)`, unique
`menu_versions_organization_unit_id_key (organization_id,unit_id,id)` e índice
`menu_versions_unit_number_idx (unit_id,version_number desc)`.

### 7.2 `public.menu_version_categories`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | |
| `unit_id` | `uuid` NOT NULL | |
| `menu_version_id` | `uuid` NOT NULL | FK `(organization_id,unit_id,menu_version_id)` para a versão, cascade |
| `source_category_id` | `uuid` | metadado interno de rastreabilidade; nunca exposto publicamente |
| `name` | `text` NOT NULL | trimada; `1..80` |
| `sort_order` | `integer` NOT NULL | `> 0` |
| `created_at` | `timestamptz` NOT NULL default `now()` | |

Unique `menu_version_categories_organization_version_id_key (organization_id,unit_id,menu_version_id,id)`
e índice `menu_version_categories_order_idx (menu_version_id,sort_order,id)`.

### 7.3 `public.menu_version_products`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `organization_id` | `uuid` NOT NULL | |
| `unit_id` | `uuid` NOT NULL | |
| `menu_version_id` | `uuid` NOT NULL | FK composta para a versão, cascade |
| `menu_category_id` | `uuid` NOT NULL | FK `(organization_id,unit_id,menu_version_id,id)` para a categoria do snapshot, cascade |
| `source_product_id` | `uuid` | vínculo interno para o overlay de disponibilidade; nunca exposto |
| `name` | `text` NOT NULL | trimada; `1..120` |
| `description` | `text` | null ou trimada, `1..500` |
| `price` | `numeric(12,2)` NOT NULL | `> 0` e `<= 9999999999.99` |
| `sort_order` | `integer` NOT NULL | `> 0` |
| `created_at` | `timestamptz` NOT NULL default `now()` | |

Índice `menu_version_products_order_idx (menu_version_id,menu_category_id,sort_order,id)`.

### 7.4 `public.menu_publications`

| Coluna | Tipo | Regras |
|---|---|---|
| `organization_id` | `uuid` NOT NULL | |
| `unit_id` | `uuid` PK | FK `(organization_id,unit_id)` para `units`, cascade |
| `public_slug` | `text` NOT NULL | único; 24 hex opacos, estável desde a primeira publicação |
| `current_menu_version_id` | `uuid` NOT NULL | FK `(organization_id,unit_id,current_menu_version_id)` para a versão CURRENT |
| `published_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_menu_publications_updated_at` |

No máximo uma linha por unidade. O slug nunca é rejeitado em republicação: reutilizado sempre.

### 7.5 Publicação server-authoritative

`publish_unit_menu(uuid)` (owner/manager da unidade, `can_manage_unit`):

- adquire advisory locks `pedon:catalog:categories:unit:<unit>` e `pedon:menu:publish:<unit>`,
  além do lock de produtos de cada categoria ativa (`pedon:catalog:products:category:<id>`);
- captura somente o catálogo estruturalmente ativo (`is_active=true`); categorias sem ao menos um
  produto ativo são omitidas; menu vazio falha com `PED31` sem criar versão;
- cria a versão com `max(version_number)+1`, copia categorias/produtos elegíveis e atualiza a ponte
  (insere com slug novo ou reutiliza o existente);
- gera slug de 24 hex via `left(replace(gen_random_uuid()::text,'-',''),24)` com retry em
  `unique_violation` (10 tentativas) e `PED32` se esgotar;
- retorna `version_id`, `version_number`, `published_at`, `public_slug`, `public_path`,
  `category_count`, `product_count`.

`get_unit_menu_publication_admin(uuid)` (`can_access_unit`): devolve unidade, publicação atual,
versão corrente e histórico (até 50 versões, ordem decrescente), somente leitura — sem rollback
nesta fase.

### 7.6 Leitura pública: `get_public_menu(text)`

`security definer stable`, executável por `anon` e `authenticated`, somente via slug opaco
(`^[a-f0-9]{24}$`); slug ausente/inválido retorna `{"found":false}`, sem erro. Devolve:

- `organization.name`; `unit.name`, `unit.is_active`;
- `menu.version_id`, `menu.version_number`, `menu.published_at`;
- `operation.configured`, `operation.accepting_orders`, `operation.pickup_enabled`,
  `operation.delivery_enabled`, `operation.delivery_fee`, `operation.minimum_order_amount`
  (texto), `operation.estimated_pickup_minutes`, `operation.estimated_delivery_minutes`,
  `operation.payment_methods` (4, com `is_enabled`), `operation.business_hours` (7 dias);
- `categories[]` com `id`, `name`, `sort_order` e `products[]` com `id`, `name`, `description`,
  `price` (texto), `sort_order`, `is_available`.

IDs e preços vêm exclusivamente do snapshot; `is_available` é overlay dinâmico de
`catalog_products.is_available` via `source_product_id` (fonte ausente/deletada ⇒ `false`).
`anon` nunca lê as tabelas de menu/catálogo diretamente.

### 7.7 Erros do cardápio publicado

| SQLSTATE | Mensagem |
|---|---|
| `PED31` | `MENU_EMPTY` |
| `PED32` | `PUBLICATION_CONFLICT` |

`PED31`/`PED32` são exclusivos da publicação; `get_public_menu` não lança erros (retorna
`found=false`).

## 8. Funções e triggers atuais

| Objeto | Contrato |
|---|---|
| `handle_new_user()` | trigger `security definer`; cria profile idempotente após insert em `auth.users` |
| `set_updated_at()` | trigger comum; define `updated_at=now()` |
| `is_org_member(uuid)` | membro da organização |
| `is_org_owner(uuid)` | owner da organização |
| `can_access_unit(uuid)` | owner da org ou vínculo em `membership_units` |
| `can_manage_unit(uuid)` | owner da org ou manager vinculado à unidade |
| `complete_onboarding(text)` | cria organização, owner, unidade principal e completa perfil atomicamente |
| `get_my_admin_context()` | perfil, primeira organização, role e unidades autorizadas |
| `create_unit(text)` / `update_unit(uuid,text)` | criação/renomeação exclusiva de owner |
| `set_unit_active(uuid,boolean)` | ativação de owner com proteção da última unidade ativa |
| `_validate_money(jsonb)` / `_validate_minutes(jsonb)` | validadores internos operacionais |
| `get_unit_operational_config(uuid)` / `save_unit_operational_config(uuid,jsonb)` | contrato operacional completo |
| `_validate_catalog_price(text)` | validador interno de preço do catálogo |
| oito RPCs da Seção 6.4 | leitura e mutações server-authoritative do catálogo |
| `publish_unit_menu(uuid)` | publicação imutável do cardápio (owner/manager) |
| `get_unit_menu_publication_admin(uuid)` | leitura administrativa da publicação e histórico |
| `get_public_menu(text)` | cardápio público anônimo via slug (anon) |

Todas as funções desta tabela, exceto `set_updated_at()`, são `security definer` com
`search_path=''`; `get_my_admin_context`, helpers de acesso e getters são `stable` quando aplicável,
e validadores puros são `immutable`.

`complete_onboarding` serializa pelo usuário. `set_unit_active` serializa a contagem pelo tenant
com `pg_advisory_xact_lock(hashtext('pedon:org:' || organization_id))`, garantindo pelo menos uma
unidade ativa. RPCs de unidade usam o contrato histórico `PED00..PED05`:

| SQLSTATE | Mensagem |
|---|---|
| `PED00` | `NOT_AUTHENTICATED` |
| `PED01` | `FORBIDDEN` |
| `PED02` | `UNIT_NOT_FOUND` |
| `PED03` | `UNIT_NAME_REQUIRED` |
| `PED04` | `LAST_ACTIVE_UNIT` |
| `PED05` | `UNIT_NAME_TOO_LONG` |

## 9. RLS e ACLs

| Tabela | SELECT autenticado | Escrita direta |
|---|---|---|
| `profiles` | próprio perfil | somente `UPDATE(full_name)` no próprio perfil |
| `organizations` | membro do tenant | sem grant/policy |
| `organization_members` | membro do tenant | sem grant/policy |
| `units` | `is_org_owner` ou `can_access_unit` | sem grant/policy |
| `membership_units` | próprio vínculo ou owner | sem grant/policy |
| três tabelas operacionais | sem policy seletora; acesso via RPC | sem grant/policy |
| `catalog_categories` | policy `can_access_unit(unit_id)` | I/U/D revogados |
| `catalog_products` | policy `can_access_unit(unit_id)` | I/U/D revogados |
| `menu_versions` | policy `can_access_unit(unit_id)` | sem grant/policy |
| `menu_version_categories` | policy `can_access_unit(unit_id)` | sem grant/policy |
| `menu_version_products` | policy `can_access_unit(unit_id)` | sem grant/policy |
| `menu_publications` | policy `can_access_unit(unit_id)` | sem grant/policy |

Nas tabelas do catálogo e do cardápio publicado, `SELECT` foi concedido a `authenticated` (e a
`anon` somente nas duas tabelas do catálogo mutável), mas só existe policy `TO authenticated`.
Portanto `anon` pode emitir a consulta e recebe zero linhas; não existe acesso público efetivo
direto. As RPCs do catálogo, a publicação e a leitura administrativa tiveram `EXECUTE`
explicitamente revogado de `PUBLIC` e `anon` e concedido somente a `authenticated`; o helper
`_validate_catalog_price` também é revogado de `authenticated`. `get_public_menu` é a única
superfície pública de leitura do cardápio.

## 10. Produção e validação

Checkpoint do Prompt 07:

- migrations `20260810135051_menu_versioning_publication.sql` e
  `20260810141000_menu_publication_slug_fix.sql` aplicadas oficialmente; oito migrations Local ==
  Remote;
- `supabase db lint --linked`: sem erros;
- banco: publicação 121/121, catálogo 123/123, operacional 80/80, RBAC 31/31 e RLS 22/22 PASS;
- testes cobrem grants, RLS, direct writes, cross-unit/cross-tenant, FKs compostas, preço decimal,
  flags independentes, atomicidade e concorrência de `sort_order`, menu vazio, snapshot imutável,
  slug estável/opaco, overlay de disponibilidade, isolamento e publicações concorrentes;
- cleanup automático remove organizações e usuários sintéticos, sem dados residuais esperados.

## 11. Ainda não implementado

O catálogo atual é administrativo e mutável; o cardápio publicado é um snapshot imutável com
leitura anônima via RPC. Imagens, carrinho, pedidos e snapshots comerciais dos pedidos ainda não
fazem parte deste schema.
