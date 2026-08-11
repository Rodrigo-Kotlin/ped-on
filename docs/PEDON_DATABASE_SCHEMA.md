# PED-ON — Database Schema

> Referência cumulativa do esquema Supabase/PostgreSQL do Ped-On após o Prompt 08.
> Fonte autoritativa: as dez migrations versionadas em `supabase/migrations/`, aplicadas no
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
| 9 | `20260810144145_orders_checkout.sql` | checkout público idempotente, snapshots, tracking, lifecycle e Realtime |
| 10 | `20260810162508_orders_checkout_lint_hardening.sql` | hardening sem mudança de contrato da RPC `create_public_order` |

Checkpoint oficial de 2026-08-10: `supabase migration list` apresenta Local == Remote para as
dez versões; `supabase db lint --linked` retorna `No schema errors found`.

## 2. Convenções

- PostgreSQL 17 no Supabase; objetos de negócio no schema `public`.
- Identificadores em `snake_case`; UUIDs gerados por `gen_random_uuid()`.
- `organization_id` é o tenant e `unit_id` é o escopo operacional.
- Todas as dezessete tabelas `public` possuem RLS habilitado.
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
| `orders` | pedido, snapshots operacionais/comerciais, PII mínima e estados independentes |
| `order_items` | snapshot imutável dos itens e preços no checkout |
| `order_events` | auditoria append-only de criação, status e pagamento |

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

## 8. Pedidos e checkout (Prompt 08)

### 8.1 `public.orders`

| Grupo | Colunas e regras principais |
|---|---|
| Escopo | `id`; `organization_id`; `unit_id`; FKs compostas para unidade e versão, todas com `ON DELETE RESTRICT` |
| Snapshot do menu | `menu_version_id`, `menu_version_number > 0` |
| Identidade | `order_number bigint > 0` único por unidade; `idempotency_key uuid` único por unidade; `request_hash` SHA-256; `tracking_token` globalmente único, 32 hex |
| Estados | `status`: `new`, `confirmed`, `preparing`, `ready`, `out_for_delivery`, `completed`, `cancelled`; `payment_status`: `pending`, `paid`, `refunded` |
| Checkout | `service_mode` (`pickup`,`delivery`); `payment_method` (`cash`,`pix`,`credit_card`,`debit_card`) |
| Cliente | `customer_name` trimado de 2..120; `customer_phone` com 10/11 dígitos; sem CPF/e-mail/conta |
| Entrega | endereço estruturado em colunas de rua, número, complemento, bairro, cidade, UF, CEP e referência; todos nulos em pickup |
| Dinheiro | `delivery_fee`, `subtotal`, `total`, `cash_change_for` em `numeric(12,2)`; `total = subtotal + delivery_fee` |
| Operação | `estimated_minutes`; `operation_revision` preserva a revisão aceita no checkout |
| Auditoria temporal | `created_at`, `updated_at`, timestamps de status/pagamento e terminais coerentes por constraints |

Índices cobrem leitura por unidade/data e unidade/status/data. O trigger
`set_orders_updated_at` usa `clock_timestamp()`. `out_for_delivery` só é válido para delivery;
`completed_at`/`cancelled_at` e `paid_at`/`refunded_at` são consistentes com seus estados.

### 8.2 `public.order_items`

Cada linha carrega `organization_id`, `unit_id`, `order_id`, `menu_version_id`, `menu_item_id`,
`product_name`, `unit_price numeric(12,2)`, `quantity 1..99`, `line_total numeric(12,2)`, nota
opcional segura e `created_at`. FKs compostas garantem que pedido, versão e item pertençam ao mesmo
tenant/unidade; `(order_id,menu_item_id)` é único e `line_total = unit_price * quantity`.

Nome e preço são copiados de `menu_version_products`, não do payload nem do catálogo mutável.

### 8.3 `public.order_events`

Eventos carregam escopo, pedido, `event_type`, `from_value`, `to_value`, nota, `actor_type`,
`actor_user_id` e `created_at`. Tipos permitidos: `created`, `status_changed`, `payment_changed`;
atores: `customer`, `staff`, `system`. O evento inicial é `NULL → new` pelo cliente; mudanças de
estado são geradas pelas RPCs com ator staff. Nenhum cliente recebe escrita direta.

### 8.4 Checkout público e idempotência

`create_public_order(text,uuid,jsonb)` é executável por `anon`/`authenticated` e:

- aceita somente versão/revisão, modalidade, pagamento, cliente, endereço, itens, notas e troco;
- rejeita preço, nome ou total autoritativo enviado pelo navegador;
- valida unidade ativa, aceite, horário, modalidade, pagamento, versão publicada, revisão
  operacional, disponibilidade, mínimo, endereço e troco;
- calcula linhas, subtotal, taxa e total em `numeric(12,2)` e grava pedido, itens e evento inicial
  atomicamente;
- serializa `(unit_id,idempotency_key)` por advisory lock e guarda SHA-256 do payload canônico;
  replay igual retorna a criação original, payload diferente gera `PED42`;
- serializa o número sequencial por unidade; token de tracking tem retry limitado em colisão.

`get_public_order(text)` retorna `found=false` para token inválido/desconhecido. Quando encontrado,
expõe nomes da organização/unidade, número, estados, modalidade, método, totais, ETA, timestamps e
itens; não expõe PII, endereço, token, IDs internos, versão, hash ou chave de idempotência.

### 8.5 Central de Pedidos e máquinas de estado

| RPC | Autorização | Contrato |
|---|---|---|
| `get_unit_orders_admin(uuid,text,integer)` | `can_access_unit` | lista filtrada, contagem e limite 1..200 |
| `get_order_admin(uuid)` | `can_access_unit` | detalhe com PII, itens e eventos; sem hash/chave idempotente |
| `set_order_status(uuid,text,text)` | `can_access_unit` | lock da linha, transição, timestamps e evento |
| `set_order_payment_status(uuid,text)` | `can_access_unit`; refund requer `can_manage_unit` | lock da linha, transição e evento |

Status: `new → confirmed → preparing → ready`; pickup segue para `completed`; delivery segue para
`out_for_delivery → completed`. Cancelamento é permitido antes de completed. `completed` e
`cancelled` são terminais. Pagamento evolui separadamente `pending → paid → refunded`; cancelar não
altera pagamento e refund é somente registro operacional externo.

### 8.6 Realtime e erros

`orders` integra `supabase_realtime` somente com `id`, `unit_id`, `updated_at`, `status` e
`payment_status`; itens, eventos, PII e idempotência não são publicados. O frontend usa o evento
apenas para invalidar/refazer queries.

| SQLSTATE | Mensagem |
|---|---|
| `PED33` | `MENU_NOT_FOUND` |
| `PED34` | `ORDERS_UNAVAILABLE` |
| `PED35` | `MENU_CHANGED` |
| `PED36` | `CHECKOUT_CHANGED` |
| `PED37` | `INVALID_CART` |
| `PED38` | `ITEM_UNAVAILABLE` |
| `PED39` | `INVALID_SERVICE_MODE` |
| `PED40` | `PAYMENT_METHOD_UNAVAILABLE` |
| `PED41` | `MINIMUM_ORDER_NOT_MET` |
| `PED42` | `IDEMPOTENCY_CONFLICT` |
| `PED43` | `INVALID_CUSTOMER` |
| `PED44` | `INVALID_DELIVERY_ADDRESS` |
| `PED45` | `INVALID_CASH_CHANGE` |
| `PED46` | `ORDER_NOT_FOUND` |
| `PED47` | `INVALID_ORDER_TRANSITION` |
| `PED48` | `INVALID_PAYMENT_TRANSITION` |
| `PED49` | `TRACKING_TOKEN_CONFLICT` |
| `PED50` | `ORDER_AMOUNT_OVERFLOW` |

A migration de hardening substitui `create_public_order` para remover uma declaração redundante
apontada pelo lint e reaplica os grants, sem alterar assinatura ou comportamento.

## 9. Cliente e Clube Ped-On (Prompt 09 — core DB)

O escopo fiel do Prompt 09 no banco (checkpoint `DB/ledger core completed`): programa por
organização, identidade de consumidor por fingerprint HMAC de CPF, membership, projeção de saldo e
ledger append-only. **Nenhum CPF em claro** é persistido. A Edge Function `loyalty-cpf` (HMAC,
validação de CPF, token efêmero) está deployada e validada (Seção 9.11); as UIs pública e
administrativa ainda não existem nesta etapa.

### 9.1 `public.loyalty_programs`

Programa de fidelidade por organização. Inexistente ou `enabled=false` ⇒ Clube indisponível
(`PED51`). Só passa a existir quando o owner ativa via `set_loyalty_program_enabled`.

| Coluna | Tipo | Regras |
|---|---|---|
| `organization_id` | `uuid` PK | FK `organizations(id)` ON DELETE CASCADE |
| `enabled` | `boolean` | default `false` |
| `points_per_real` | `numeric(12,2)` | default `1.00`; `> 0` e `<= 9999999999.99` |
| `created_at` / `updated_at` | `timestamptz` | default `now()` |

### 9.2 `public.customers`

Cliente por organização; identidade **derivada de CPF**, nunca o CPF em si.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `organization_id` | `uuid` | FK `organizations(id)` CASCADE |
| `cpf_fingerprint` | `text` | `~ '^[a-f0-9]{64}$'`; HMAC-SHA-256 keyed por tenant: `HMAC(secret, 'pedon:cpf:v1:' \|\| org_id \|\| ':' \|\| cpf)` |
| `cpf_last2` | `text` | `~ '^[0-9]{2}$'`; exibição mascarada |
| `name` | `text` | nullable; `btrim` 2..120 e `_is_safe_plain_text` |
| `created_at` | `timestamptz` | default `now()` |

`UNIQUE (organization_id, cpf_fingerprint)` impede duplicidade por tenant. Nenhuma coluna de CPF em
claro existe (validado em teste).

### 9.3 `public.loyalty_memberships`

Vínculo cliente/organização; é o escopo de pontos. `UNIQUE (organization_id, customer_id)`.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `organization_id` | `uuid` | FK `organizations(id)` CASCADE |
| `customer_id` | `uuid` | FK composta `(organization_id, customer_id)` → `customers` CASCADE |
| `created_at` | `timestamptz` | default `now()` |

### 9.4 `public.loyalty_accounts`

Projeção derivada do ledger (não é fonte de verdade). Invariante orgânico:
`sum(loyalty_ledger.amount) = points_balance - recovery_points`.

| Coluna | Tipo | Regras |
|---|---|---|
| `membership_id` | `uuid` PK | FK composta `(organization_id, membership_id)` → memberships CASCADE |
| `organization_id` | `uuid` | — |
| `points_balance` | `bigint` | default `0`; `CHECK (points_balance >= 0)` |
| `recovery_points` | `bigint` | default `0`; `CHECK (recovery_points >= 0)`; dívida quando estorno excede saldo |
| `updated_at` | `timestamptz` | default `now()` |

`recovery_points` só é alcançável por reparo/manutenção no fluxo atual (todo reversal é pareado com
o próprio earn); o comportamento de quitação por novas aquisições já está implementado e testado,
preparando o Prompt 10 (redemption). Não existem colunas `lifetime_*`, `gross_points`,
`points_delta`, `recovery_delta` nem `eligible_amount`: `total_earned`/`total_reversed` são
**calculados** na leitura administrativa, não armazenados.

### 9.5 `public.loyalty_ledger`

Ledger append-only (sem UPDATE/DELETE por RPC ou navegador). `earn` sempre `amount > 0`; `reversal`
sempre `amount < 0`.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `organization_id` | `uuid` | FK composta orders `(organization_id, order_id)` ON DELETE RESTRICT |
| `membership_id` | `uuid` | FK composta memberships `(organization_id, membership_id)` ON DELETE RESTRICT |
| `order_id` | `uuid` | nullable (pedidos sem Clube nunca geram entrada) |
| `entry_type` | `text` | `CHECK (entry_type in ('earn','reversal'))` |
| `amount` | `bigint` | `CHECK` de forma: earn positivo, reversal negativo |
| `created_at` | `timestamptz` | default `clock_timestamp()` |

Índice único parcial `(order_id, entry_type) WHERE order_id IS NOT NULL` ⇒ no máximo um earn e uma
reversal por pedido (idempotência sob lock de linha do pedido). `orders` ganhou
`UNIQUE (organization_id, id)` para suportar a FK composta do ledger.

### 9.6 `public.loyalty_access_tokens`

Token efêmero de acesso/sessão do consumidor. Apenas `SHA-256(token)` é persistido.

| Coluna | Tipo | Regras |
|---|---|---|
| `token_hash` | `text` PK | `~ '^[a-f0-9]{64}$'` |
| `organization_id` | `uuid` | FK composta memberships `(organization_id, membership_id)` CASCADE |
| `membership_id` | `uuid` | — |
| `expires_at` | `timestamptz` | `CHECK (expires_at > created_at)`; janela de 2h gerada pela Edge |
| `created_at` | `timestamptz` | default `now()` |

Índice `(organization_id, membership_id, expires_at)`.

### 9.7 Integração com pedidos

- `orders.loyalty_membership_id` (`uuid`, nullable) com FK composta
  `(organization_id, loyalty_membership_id) → loyalty_memberships(organization_id, id)`
  ON DELETE RESTRICT + índice — garante mesmo tenant entre pedido e membership.
- `orders.organization_id` ganhou `UNIQUE (organization_id, id)` (insumo da FK do ledger).
- `create_public_order` aceita `loyalty_token` opcional (64 hex): programa desabilitado ⇒ `PED51`;
  token ausente/expirado/inválido/outro tenant ⇒ `PED52`; consumo único via DELETE na mesma
  transação (falha posterior devolve o token). Retry idempotente ocorre antes da validação
  (DEC-100), então replay nunca reconsome.
- `set_order_status` chama `_loyalty_earn_order` na transição para `completed`.
- `set_order_payment_status` chama `_loyalty_reverse_order` na transição para `refunded`.
- `get_public_menu` expõe apenas `loyalty.enabled`; `_order_admin_json` expõe
  `loyalty.linked` + `cpf_masked` para o staff.

### 9.8 RPCs internas e públicas

| Objeto | Acesso | Contrato |
|---|---|---|
| `get_loyalty_public_context_internal(text)` | `service_role` | slug → `organization_id` + estado do programa (insumo do HMAC) |
| `resolve_loyalty_identity_internal(uuid,text,text,text,text,text,timestamptz)` | `service_role` | `enroll`/`lookup` por fingerprint + `cpf_last2`; cria customer/membership/account/token; `enroll` idempotente |
| `get_public_loyalty_account(text)` | `anon`/`authenticated` | única leitura pública; só aceita o access token; dados mascarados + saldo |
| `get_loyalty_program_admin(uuid)` | owner | programa + `stats.members_count` |
| `set_loyalty_program_enabled(uuid,boolean)` | owner | ativa/desativa o programa (cria a linha no primeiro enable) |
| `get_loyalty_members_admin(uuid,integer,uuid)` | owner | lista paginada (`limit` 1..200) com `cpf_last2`, nome, saldo, `recovery_points`, `total_earned`/`total_reversed` calculados e `member_since` |
| `_loyalty_earn_order(orders)` | interno (revogado de navegador) | earn idempotente: membership presente, `payment_status <> 'refunded'` (guard de hardening), programa habilitado, `points = floor(subtotal * points_per_real) > 0`; paga `recovery_points` antes de compor saldo |
| `_loyalty_reverse_order(orders)` | interno (revogado de navegador) | reversal idempotente: devolve o earn do pedido; se exceder saldo, cria `recovery_points` |

### 9.9 Regra de pontos (DEC-090)

`points = floor(orders.subtotal * points_per_real)` (1 ponto por R$ 1,00 elegível com
`points_per_real = 1.00`). `delivery_fee` e centavos não geram pontos; pedido `< R$ 1,00` gera 0
pontos e nenhuma entrada de ledger. Earn acontece somente na 1ª transição `status → completed` com
`payment_status <> 'refunded'`; `payment_status → refunded` após o earn gera reversal completo.

### 9.10 Erros do Prompt 09

| SQLSTATE | Mensagem |
|---|---|
| `PED51` | `LOYALTY_UNAVAILABLE` (programa ausente/desabilitado) |
| `PED52` | `INVALID_LOYALTY_TOKEN` (token ausente/expirado/inválido/outro tenant/formato) |
| `PED53` | `LOYALTY_INTEGRITY` (inconsistência interna; também `limit` fora de 1..200) |

### 9.11 Edge Function `loyalty-cpf`

Única porta de resolução/inscrição do Clube (`supabase/functions/loyalty-cpf/index.ts`). Roda no
Edge Runtime do Supabase, usa `service_role` apenas internamente e lê o secret backend-only
`LOYALTY_CPF_HMAC_KEY` (32 bytes hex; nunca no repo — ver `.env.example`). O CPF bruto existe só em
memória de request: nunca é persistido, logado nem retornado.

Contrato HTTP `POST <project-ref>.supabase.co/functions/v1/loyalty-cpf` (JWT da plataforma ativo —
o navegador envia a anon key via `supabase.functions.invoke`):

| Campo | Tipo | Regras |
|---|---|---|
| `public_slug` | string | slug 24 hex do cardápio; formato inválido ⇒ 404 `INVALID_SLUG` |
| `mode` | string | `lookup` \| `enroll`; outro valor ⇒ 400 `INVALID_MODE` |
| `cpf` | string | dígitos verificadores validados; inválido ⇒ 422 `INVALID_CPF` |
| `name` | string | obrigatório em `enroll`; `btrim` 2..120 sem `< >`/controle; senão 422 `INVALID_NAME` |

- `200 { found: true, membership_id, customer: { name, cpf_last2 }, account: { points_balance,
  recovery_points }, token: { access_token, expires_at } }` — `access_token` é 64 hex opaco de 2h
  (DEC-093), devolvido uma única vez; só `SHA-256(token)` é persistido.
- `200 { found: false }` em `lookup` sem cadastro (mismatch genérico, sem vazar existência).
- `403 LOYALTY_UNAVAILABLE` (PED51), `500 LOYALTY_INTEGRITY` (PED53)/`SERVER_CONFIG`/`UPSTREAM_ERROR`.
- Fluxo: `get_loyalty_public_context_internal(slug)` → `HMAC(secret,'pedon:cpf:v1:'||org_id||':'||cpf)`
  → `resolve_loyalty_identity_internal(...)`. `enroll` e `lookup` emitem um novo token a cada chamada.
- Respostas com `Cache-Control: no-store`; CORS habilitado (`*`); payload limitado a 4 KB.
- Bugfix de deploy: resposta `OPTIONS` 204 deve ter corpo nulo (corpo não-nulo em 204 derruba o
  runtime Deno com `EDGE_FUNCTION_ERROR`).

## 10. Funções e triggers atuais

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
| helpers `_is_safe_plain_text`, `_is_unit_open_at` e serializadores `_order_*_json` | validação e respostas minimizadas de pedidos |
| `create_public_order(text,uuid,jsonb)` / `get_public_order(text)` | checkout idempotente e tracking público (aceita `loyalty_token` opcional) |
| quatro RPCs administrativas da Seção 8.5 | lista, detalhe e transições server-authoritative |
| seis RPCs e helpers da Seção 9.8 | programa, identidade do consumidor, conta pública e membros do Clube |
| `_loyalty_earn_order(orders)` / `_loyalty_reverse_order(orders)` | earn/reversal internos do ledger (revogados de navegador) |

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

## 11. RLS e ACLs

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
| `orders` | policy `can_access_unit(unit_id)` | I/U/D revogados; escrita por RPC |
| `order_items` | policy `can_access_unit(unit_id)` | I/U/D revogados; escrita por RPC |
| `order_events` | policy `can_access_unit(unit_id)` | I/U/D revogados; append-only por RPC |
| seis tabelas do Clube (9.1–9.6) | sem policy seletora; acesso via RPC `security definer` ou `service_role` | grants de `public`/`anon`/`authenticated` revogados (zero) |

Nas tabelas do catálogo e do cardápio publicado, `SELECT` foi concedido a `authenticated` (e a
`anon` somente nas duas tabelas do catálogo mutável), mas só existe policy `TO authenticated`.
Portanto `anon` pode emitir a consulta e recebe zero linhas; não existe acesso público efetivo
direto. As RPCs do catálogo, a publicação e a leitura administrativa tiveram `EXECUTE`
explicitamente revogado de `PUBLIC` e `anon` e concedido somente a `authenticated`; o helper
`_validate_catalog_price` também é revogado de `authenticated`. `get_public_menu` é a única
superfície pública de leitura do cardápio. As tabelas de pedidos não possuem grants para `anon`;
checkout e tracking públicos passam exclusivamente pelas RPCs minimizadas.

## 12. Produção e validação

Checkpoint do Prompt 09 (DB/ledger core):

- migrations `20260810170000_loyalty_customers_ledger.sql` e
  `20260811080000_loyalty_earn_refunded_guard.sql` aplicadas oficialmente; **12 migrations Local ==
  Remote**;
- `supabase db lint --linked`: sem erros;
- loyalty `loyalty_integrity.test.mjs` **108/108 PASS** cobrindo: ciclo do programa owner-only,
  resolução de identidade por fingerprint (sem CPF em claro), consulta pública por token efêmero,
  checkout com token de uso único + retry idempotente + concorrência, earn em `completed`
  (`floor(subtotal)`), guest sem earn, pedido `< R$ 1,00` sem earn, programa desabilitado na
  conclusão sem earn, **estornado antes de `completed` sem earn (hardening DEC-091)**, reversal de
  earn, `recovery_points` quitando dívida antes do saldo, invariante `sum(ledger) =
  balance - recovery`, admin de membros owner-only com máscara de CPF, e RLS sem grants de navegador;
- regressões anteriores permanecem verdes (ver Seção 12.1 e runbook Seção 6).

Checkpoint do Prompt 08:

- migrations `20260810144145_orders_checkout.sql` e
  `20260810162508_orders_checkout_lint_hardening.sql` aplicadas oficialmente; dez migrations Local
  == Remote;
- `supabase db lint --linked`: sem erros;
- banco: pedidos 318/318, publicação 121/121, catálogo 123/123, operacional 80/80, RBAC 31/31 e RLS
  22/22 PASS;
- testes cobrem grants, RLS, direct writes, cross-unit/cross-tenant, FKs compostas, preço decimal,
  flags independentes, atomicidade e concorrência de `sort_order`, menu vazio, snapshot imutável,
  slug estável/opaco, overlay de disponibilidade, checkout estrito, snapshots de pedidos,
  idempotência/replay, máquinas de estado, PII minimizada, Realtime e concorrência;
- cleanup automático remove organizações e usuários sintéticos, sem dados residuais esperados.

## 13. Ainda não implementado

O core DB do Clube (9.1–9.10) existe e está validado. Ainda fora deste schema: Edge Function
`loyalty-cpf` (validação de CPF, HMAC keyed, geração/consumo do token efêmero), secret
`LOYALTY_CPF_HMAC_KEY` no backend, UIs pública `/clube/:publicSlug` e administrativa `/app/clube`,
e integração de checkout no frontend. Imagens, recompensas/resgate/vouchers (Prompt 10), gateway,
pagamento online e logística avançada também não fazem parte deste schema.
