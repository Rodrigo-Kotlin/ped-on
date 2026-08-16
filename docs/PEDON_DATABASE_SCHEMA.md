# PED-ON — Database Schema

> Referência cumulativa da Fase 4A — Prompt 13 `COMPLETED`, checkpoint
> `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED`, hotfix P1 (DEC-127) `COMPLETED`.
> Fonte autoritativa: 24 migrations versionadas; hotfix validado no CI `31962585865` (fresh rebuild,
> alinhamento, DB lint, 13 suítes DB, Edge 15/15); base anterior 23/23/23 com drift remoto `NONE`.

## 1. Estado das migrations

| Ordem | Migration                                                         | Escopo                                                                                  |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1     | `20260809221710_identity_tenant_foundation.sql`                   | identidade, tenant, unidade e onboarding                                                |
| 2     | `20260810015224_rbac_units_context.sql`                           | RBAC, vínculos por unidade, contexto e RPCs de unidade                                  |
| 3     | `20260810032804_unit_operational_config.sql`                      | configurações, horários, pagamentos e RPCs operacionais                                 |
| 4     | `20260810033118_unit_operational_config_hardening.sql`            | validação defensiva de ETAs                                                             |
| 5     | `20260810120000_unit_operational_config_acceptance_hardening.sql` | aceite seguro de pedidos e contrato `configured`                                        |
| 6     | `20260810122401_catalog_base.sql`                                 | categorias, produtos e gestão administrativa do catálogo                                |
| 7     | `20260810135051_menu_versioning_publication.sql`                  | versionamento imutável, publicação e cardápio público                                   |
| 8     | `20260810141000_menu_publication_slug_fix.sql`                    | correção do slug público (`gen_random_uuid` no lugar de `gen_random_bytes`)             |
| 9     | `20260810144145_orders_checkout.sql`                              | checkout público idempotente, snapshots, tracking, lifecycle e Realtime                 |
| 10    | `20260810162508_orders_checkout_lint_hardening.sql`               | hardening sem mudança de contrato da RPC `create_public_order`                          |
| 11    | `20260810170000_loyalty_customers_ledger.sql`                     | clientes protegidos, programa, membership, conta, ledger e token do Clube               |
| 12    | `20260811080000_loyalty_earn_refunded_guard.sql`                  | impede earn de pedido já reembolsado                                                    |
| 13    | `20260811130000_prompt09_release_hardening.sql`                   | identidade CPF + telefone, consentimento, rate limit, extrato e recuperação de checkout |
| 14    | `20260811170000_prompt09_reaudit_hardening.sql`                   | ACL legado, consentimento append-only, TTL e cleanup incremental                         |
| 15    | `20260811200418_loyalty_rewards_redemptions_vouchers.sql`         | rewards, resgate atômico, estoque auditável e vouchers                                   |
| 16    | `20260812030000_prompt10_release_hardening.sql`                    | replay autenticado por recovery secret, FKs relacionais e métricas corretas               |
| 17    | `20260812090000_prompt10_final_integrity_hardening.sql`            | BigInt como texto decimal, stock único por redemption e consumo auditável                 |
| 18    | `20260812120000_prompt11_pilot_readiness_team.sql`                  | readiness derivada, listagem de equipe e gestão owner-only dos vínculos por unidade        |
| 19    | `20260813120000_prompt11_readiness_unit_coherence.sql`              | exige uma mesma unidade com todos os pré-requisitos de piloto                               |
| 20    | `20260814000000_prompt12_product_options.sql`                       | grupos de opções (variações/adicionais/remoções) e opções por produto no catálogo mutável  |
| 21    | `20260814010000_prompt12_final_hardening.sql`                       | regra `single`, locks de publicação/mutação e disponibilidade atômica no checkout           |
| 22    | `20260814020000_prompt12_remediation_a_hardening.sql`               | lock estrutural unit-scoped, publicação PED73 sem versão parcial e vínculo relacional de `order_item_options` |
| 23    | `20260814100000_prompt13_backend_operational_core.sql`               | NEW-MEDIUM-1, orders admin v2 keyset, KDS minimizado, PED79, índice active urgency e grants/revokes |
| 24    | `20260816120000_pilot_finding_member_onboarding.sql`                 | hotfix P1: `organization_member_invites`, 5 RPCs de convite/aceite (VERIFIED-EMAIL) e PED80–PED90 |

Estado reconciliado de 2026-08-15: DB push PASS; Git/filesystem/remoto em 23/23/23; post-push dry-run
PASS/up to date; linked DB lint PASS com zero erros; drift remoto `NONE`. Remote smokes limitados
passaram para os casos executados, sem alegação de paginação com massa real no remoto. O CI isolado
`31859960640` aprovou fresh rebuild das 23 migrations, alinhamento, DB lint, 12 suítes DB 1494/1494 e
Edge 15/15. `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`; `LOCAL DB TESTS: NOT RUN — BY
DESIGN / NO LOCAL DOCKER`.

Hotfix P1 (DEC-127, migration 24): a partir de `0753c18`, o CI isolado `31962585865` aprovou fresh
rebuild das **24** migrations, alinhamento, DB lint, as 13 suítes DB (incluindo
`member_onboarding_integrity` 7 cenários) e Edge 15/15. `LOCAL DB REBUILD/TESTS` permanecem
`NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

## 2. Convenções

- PostgreSQL 17 no Supabase; objetos de negócio no schema `public`.
- Identificadores em `snake_case`; UUIDs gerados por `gen_random_uuid()`.
- `organization_id` é o tenant e `unit_id` é o escopo operacional.
- Todas as 36 tabelas `public` possuem RLS habilitado (migration 24 adiciona `organization_member_invites`).
- Dinheiro usa `numeric(12,2)`, nunca `float`/`double`; RPCs devolvem valores monetários como
  string decimal.
- Mutações administrativas e de domínio são server-authoritative via RPC; grants diretos são
  mínimos.
- Funções de autorização, validação e RPCs `security definer` usam `set search_path = ''`.
  `set_updated_at()` é a função de trigger comum e não é `security definer`.

## 3. Visão geral das entidades

| Entidade                    | Papel                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| `profiles`                  | identidade 1:1 de `auth.users` e estado de onboarding                         |
| `organizations`             | tenant                                                                        |
| `organization_members`      | usuário na organização com role `owner`/`manager`/`operator`                  |
| `units`                     | unidade operacional do tenant                                                 |
| `membership_units`          | autorização explícita de manager/operator por unidade                         |
| `organization_member_invites` | convite pendente/aceito/revogado por e-mail verificado (migration 24)        |
| `unit_operational_settings` | configuração operacional 1:1 da unidade                                       |
| `unit_business_hours`       | sete horários semanais por unidade                                            |
| `unit_payment_methods`      | meios de pagamento externos aceitos pela unidade                              |
| `catalog_categories`        | categorias mutáveis do catálogo de uma unidade                                |
| `catalog_products`          | produtos simples mutáveis de uma categoria/unidade                            |
| `catalog_product_option_groups` | grupos de opções (variação, adicional, remoção) de um produto             |
| `catalog_product_options`   | opções de um grupo com `price_delta` exato                                    |
| `menu_versions`             | snapshots comerciais imutáveis do cardápio de uma unidade                     |
| `menu_version_categories`   | categorias congeladas de uma versão                                           |
| `menu_version_products`     | produtos congelados de uma versão                                             |
| `menu_version_option_groups` | grupos de opções congelados de uma versão publicada                         |
| `menu_version_options`      | opções congeladas de um grupo da versão                                       |
| `menu_publications`         | ponte atual: slug público estável → versão CURRENT                            |
| `orders`                    | pedido, snapshots operacionais/comerciais, PII mínima e estados independentes |
| `order_items`               | snapshot imutável dos itens e preços no checkout                              |
| `order_item_options`        | snapshot append-only das opções selecionadas por linha do pedido             |
| `order_events`              | auditoria append-only de criação, status e pagamento                          |
| `loyalty_programs`          | programa de fidelidade por organização                                        |
| `customers`                 | identidade protegida por fingerprints HMAC de CPF + telefone                  |
| `loyalty_memberships`       | adesão do cliente com consentimento auditável                                 |
| `loyalty_consent_events`    | evidência append-only de cada consentimento explícito                         |
| `loyalty_accounts`          | projeção de saldo e pontos em recuperação                                     |
| `loyalty_ledger`            | fonte append-only de earns/reversals e deltas do extrato                      |
| `loyalty_access_tokens`     | hash dos tokens públicos efêmeros de 2 horas                                  |
| `loyalty_rate_limits`       | contadores fixed-window por escopo HMAC opaco                                 |
| `loyalty_rewards`           | catálogo de recompensas por organização e saldo atual do estoque              |
| `loyalty_redemptions`       | resgates imutáveis, idempotentes e recuperáveis                               |
| `loyalty_vouchers`          | vouchers bearer emitidos ou consumidos                                        |
| `loyalty_reward_stock_events` | auditoria append-only dos movimentos de estoque                             |
| `loyalty_voucher_events`    | auditoria append-only da emissão e do consumo                                 |

## 4. Identidade, tenant e RBAC

### 4.1 `public.profiles`

| Coluna              | Tipo                                   | Regras                                                      |
| ------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `id`                | `uuid` PK                              | FK `auth.users(id) ON DELETE CASCADE`                       |
| `email`             | `text` NOT NULL                        | preenchido por `handle_new_user()`                          |
| `full_name`         | `text`                                 | opcional; única coluna atualizável diretamente pelo usuário |
| `onboarding_status` | `text` NOT NULL default `'pending'`    | check em `pending`, `completed`                             |
| `created_at`        | `timestamptz` NOT NULL default `now()` |                                                             |
| `updated_at`        | `timestamptz` NOT NULL default `now()` | trigger `set_profiles_updated_at`                           |

### 4.2 `public.organizations`

| Coluna       | Tipo                                   | Regras                                 |
| ------------ | -------------------------------------- | -------------------------------------- |
| `id`         | `uuid` PK default `gen_random_uuid()`  |                                        |
| `name`       | `text` NOT NULL                        | `char_length(btrim(name)) > 0`         |
| `created_at` | `timestamptz` NOT NULL default `now()` |                                        |
| `updated_at` | `timestamptz` NOT NULL default `now()` | trigger `set_organizations_updated_at` |

Não há FK direta para `auth.users`; proprietários vivem em `organization_members`.

### 4.3 `public.organization_members`

| Coluna            | Tipo                                   | Regras                                   |
| ----------------- | -------------------------------------- | ---------------------------------------- |
| `organization_id` | `uuid` NOT NULL                        | FK `organizations(id) ON DELETE CASCADE` |
| `user_id`         | `uuid` NOT NULL                        | FK `auth.users(id) ON DELETE CASCADE`    |
| `role`            | `text` NOT NULL                        | check em `owner`, `manager`, `operator`  |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                          |
| PK                | `(organization_id, user_id)`           |                                          |

Índice: `organization_members_user_id_idx (user_id)`.

### 4.4 `public.units`

| Coluna            | Tipo                                   | Regras                                   |
| ----------------- | -------------------------------------- | ---------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                          |
| `organization_id` | `uuid` NOT NULL                        | FK `organizations(id) ON DELETE CASCADE` |
| `name`            | `text` NOT NULL                        | `char_length(btrim(name)) > 0`           |
| `is_active`       | `boolean` NOT NULL default `true`      |                                          |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                          |
| `updated_at`      | `timestamptz` NOT NULL default `now()` | trigger `set_units_updated_at`           |

Índice `units_organization_id_idx`; unique `units_organization_id_id_key (organization_id, id)`,
alvo das FKs compostas de tabelas escopadas por unidade.

### 4.5 `public.membership_units`

| Coluna            | Tipo                                   | Regras                                                              |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `organization_id` | `uuid` NOT NULL                        | parte das duas FKs compostas                                        |
| `user_id`         | `uuid` NOT NULL                        | FK `(organization_id,user_id)` para `organization_members`, cascade |
| `unit_id`         | `uuid` NOT NULL                        | FK `(organization_id,unit_id)` para `units`, cascade                |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                                     |
| PK                | `(organization_id, user_id, unit_id)`  |                                                                     |

Índices: `membership_units_user_id_idx`, `membership_units_unit_id_idx`. A FK composta para
`units` impede vínculos cross-tenant/cross-org.

### 4.6 `public.organization_member_invites` (migration 24 — DEC-127)

| Coluna            | Tipo                                   | Regras                                                                  |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                                                         |
| `organization_id` | `uuid` NOT NULL                        | FK `organizations(id) ON DELETE CASCADE`                                |
| `email`           | `text` NOT NULL                        | e-mail de destino, normalizado por `lower(btrim(...))`                  |
| `role`            | `text` NOT NULL                        | check em `manager`, `operator` (owner nunca é convidado)                |
| `status`          | `text` NOT NULL default `'pending'`    | check em `pending`, `accepted`, `revoked`                               |
| `created_by`      | `uuid` NOT NULL                        | FK `auth.users(id) ON DELETE CASCADE` (owner autenticado)               |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                                         |
| `expires_at`      | `timestamptz` NOT NULL default `now()+interval '7 days'` | `expires_at > created_at`                                     |
| `accepted_at`     | `timestamptz`                          | preenchido no aceite                                                    |
| `accepted_user_id`| `uuid`                                 | FK `auth.users(id) ON DELETE CASCADE`; o usuário que aceitou            |

- Índice único parcial `organization_member_invites_org_email_pending_key
  (organization_id, email) where status = 'pending'` — no máximo um convite pendente por
  (organização, e-mail); `create_org_member_invite` é idempotente e nunca colide nele.
- RLS habilitada com policy `organization_member_invites_select_owner` (`TO authenticated`
  `using is_org_owner(organization_id)`). Sem policies/grant de INSERT/UPDATE/DELETE diretos;
  escrita exclusivamente pelas RPCs da subseção 4.7.
- Modelo VERIFIED-EMAIL: **nenhum token/segredo**; o aceite autentica o destinatário pelo e-mail do
  `profiles` vinculado a `auth.uid()`.

### 4.7 RPCs de convite e aceite (migration 24)

| RPC                                          | Semântica                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `create_org_member_invite(uuid,text,text)`   | owner convida `email` para `manager`/`operator`; idempotente (retorna o pendente existente); `PED80`–`PED85` |
| `list_org_member_invites(uuid)`              | owner lista convites da organização (sem token); `PED80`/`PED81`          |
| `revoke_org_member_invite(uuid,uuid)`        | owner revoga convite pendente; `PED80`/`PED81`/`PED86`/`PED87`/`PED88`    |
| `get_my_pending_member_invites()`            | usuário autenticado consulta os próprios convites pendentes por e-mail verificado |
| `accept_org_member_invite(uuid)`             | aceita pelo e-mail autenticado; cria `organization_members` + atualiza convite e perfil atomicamente; `PED80`–`PED90` |

Semânticas de aceite: e-mail divergente `PED90`; usuário já membro da org `PED84`; usuário já em
outra organização `PED85` (ONE USER → AT MOST ONE ORGANIZATION); expirado `PED87`; revogado `PED88`;
já aceito `PED89`. **Nenhuma `membership_units` é criada automaticamente** — o owner atribui unidade
depois via `assign_unit_to_member`. Locking: advisory lock `(org, email)` na criação e
`hashtext(v_user_id::text)` + `hashtext('pedon:invite:' || id)` no aceite (impede duplo aceite/reuso).

## 5. Configuração operacional da unidade (Prompt 05)

### 5.1 `public.unit_operational_settings`

| Coluna                       | Tipo                                          | Regras finais                                      |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `unit_id`                    | `uuid` PK                                     | FK `units(id) ON DELETE CASCADE`                   |
| `timezone`                   | `text` NOT NULL default `'America/Sao_Paulo'` | nome IANA validado pela RPC                        |
| `pickup_enabled`             | `boolean` NOT NULL default `true`             | ao menos pickup ou delivery ativo                  |
| `delivery_enabled`           | `boolean` NOT NULL default `false`            | ao menos pickup ou delivery ativo                  |
| `delivery_fee`               | `numeric(12,2)` NOT NULL default `0`          | `>= 0`                                             |
| `min_order_value`            | `numeric(12,2)` NOT NULL default `0`          | `>= 0`                                             |
| `estimated_pickup_minutes`   | `integer`                                     | null ou `0..1440`                                  |
| `estimated_delivery_minutes` | `integer`                                     | null ou `0..1440`                                  |
| `accepting_orders`           | `boolean` NOT NULL default `false`            | default final definido pela migration 5            |
| `created_at`                 | `timestamptz` NOT NULL default `now()`        |                                                    |
| `updated_at`                 | `timestamptz` NOT NULL default `now()`        | trigger `set_unit_operational_settings_updated_at` |

Constraint `unit_settings_service_mode_check`: `pickup_enabled OR delivery_enabled`.

### 5.2 `public.unit_business_hours`

| Coluna       | Tipo                               | Regras                                          |
| ------------ | ---------------------------------- | ----------------------------------------------- |
| `unit_id`    | `uuid` NOT NULL                    | FK `units(id) ON DELETE CASCADE`                |
| `weekday`    | `smallint` NOT NULL                | `0..6`, domingo a sábado                        |
| `is_open`    | `boolean` NOT NULL default `false` |                                                 |
| `is_24h`     | `boolean` NOT NULL default `false` | 24h exige horários nulos                        |
| `open_time`  | `time`                             | obrigatório em dia aberto não-24h               |
| `close_time` | `time`                             | obrigatório em dia aberto não-24h               |
| PK           | `(unit_id, weekday)`               | exatamente uma linha por dia após save completo |

`close_time < open_time` é aceito e representa virada para o dia seguinte. Dia fechado ignora
horários na leitura, mas a RPC rejeita payload fechado com horários; dia 24h deve ter ambos nulos.

### 5.3 `public.unit_payment_methods`

| Coluna       | Tipo                              | Regras                                     |
| ------------ | --------------------------------- | ------------------------------------------ |
| `unit_id`    | `uuid` NOT NULL                   | FK `units(id) ON DELETE CASCADE`           |
| `method`     | `text` NOT NULL                   | `cash`, `pix`, `credit_card`, `debit_card` |
| `is_enabled` | `boolean` NOT NULL default `true` |                                            |
| PK           | `(unit_id, method)`               |                                            |

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

| SQLSTATE | Mensagem                                                    |
| -------- | ----------------------------------------------------------- |
| `PED10`  | `NOT_AUTHENTICATED`                                         |
| `PED11`  | `FORBIDDEN`                                                 |
| `PED12`  | `UNIT_NOT_FOUND`                                            |
| `PED13`  | `UNIT_INACTIVE`                                             |
| `PED14`  | `TIMEZONE_INVALID`                                          |
| `PED15`  | `NO_SERVICE_MODE`                                           |
| `PED16`  | `INVALID_MONEY` (também contrato defensivo de ETA inválido) |
| `PED17`  | `INVALID_PAYMENT_METHOD`                                    |
| `PED18`  | `INVALID_BUSINESS_HOURS`                                    |

Não há `PED19` no contrato atual.

## 6. Catálogo base por unidade (Prompt 06)

### 6.1 `public.catalog_categories`

| Coluna            | Tipo                                   | Regras                                               |
| ----------------- | -------------------------------------- | ---------------------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                                      |
| `organization_id` | `uuid` NOT NULL                        | parte da FK composta da unidade                      |
| `unit_id`         | `uuid` NOT NULL                        | FK `(organization_id,unit_id)` para `units`, cascade |
| `name`            | `text` NOT NULL                        | já trimado; tamanho `1..80`                          |
| `sort_order`      | `integer` NOT NULL                     | `> 0`, calculado no servidor                         |
| `is_active`       | `boolean` NOT NULL default `true`      | desativação lógica                                   |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                      |
| `updated_at`      | `timestamptz` NOT NULL default `now()` | trigger `set_catalog_categories_updated_at`          |

Constraints/índices:

- unique composto `catalog_categories_organization_unit_id_key (organization_id,unit_id,id)`,
  alvo da FK dos produtos;
- unique funcional `catalog_categories_unit_name_key` em
  `(organization_id,unit_id,lower(btrim(name)))`, impedindo duplicata case-insensitive na unidade;
- índice de leitura `catalog_categories_unit_order_idx
(organization_id,unit_id,sort_order,id)`.

### 6.2 `public.catalog_products`

| Coluna            | Tipo                                   | Regras                                                             |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                                                    |
| `organization_id` | `uuid` NOT NULL                        | parte das FKs compostas                                            |
| `unit_id`         | `uuid` NOT NULL                        | FK composta para a unidade, cascade                                |
| `category_id`     | `uuid` NOT NULL                        | FK `(organization_id,unit_id,category_id)` para categoria, cascade |
| `name`            | `text` NOT NULL                        | já trimado; tamanho `1..120`                                       |
| `description`     | `text`                                 | null ou já trimada, tamanho `1..500`                               |
| `price`           | `numeric(12,2)` NOT NULL               | `> 0` e `<= 9999999999.99`                                         |
| `sort_order`      | `integer` NOT NULL                     | `> 0`, calculado no servidor                                       |
| `is_active`       | `boolean` NOT NULL default `true`      | estado estrutural                                                  |
| `is_available`    | `boolean` NOT NULL default `true`      | disponibilidade operacional independente                           |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                                    |
| `updated_at`      | `timestamptz` NOT NULL default `now()` | trigger `set_catalog_products_updated_at`                          |

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

| RPC                                                | Autorização                       | Efeito                                                       |
| -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `get_unit_catalog_admin(uuid)`                     | owner/manager/operator com acesso | unidade, role, `can_manage`, categorias e produtos completos |
| `create_catalog_category(uuid,text)`               | owner/manager da unidade          | cria categoria e ordem server-side                           |
| `update_catalog_category(uuid,text)`               | owner/manager da unidade          | renomeia categoria                                           |
| `set_catalog_category_active(uuid,boolean)`        | owner/manager da unidade          | altera estado estrutural                                     |
| `create_catalog_product(uuid,uuid,text,text,text)` | owner/manager da unidade          | cria produto simples; preço entra como texto                 |
| `update_catalog_product(uuid,uuid,text,text,text)` | owner/manager da unidade          | edita/move produto                                           |
| `set_catalog_product_active(uuid,boolean)`         | owner/manager da unidade          | altera estado estrutural                                     |
| `set_catalog_product_available(uuid,boolean)`      | owner/manager/operator com acesso | altera somente disponibilidade                               |

`_validate_catalog_price(text)` aceita somente decimal textual positivo, sem sinal, vírgula,
expoente, `NaN` ou `Infinity`, com até dez dígitos inteiros e duas casas. O retorno administrativo
converte `price` para texto, preservando, por exemplo, `8.10`.

| SQLSTATE | Mensagem                 |
| -------- | ------------------------ |
| `PED20`  | `CATEGORY_NOT_FOUND`     |
| `PED21`  | `CATEGORY_NAME_REQUIRED` |
| `PED22`  | `CATEGORY_NAME_TOO_LONG` |
| `PED23`  | `CATEGORY_NAME_CONFLICT` |
| `PED24`  | `PRODUCT_NOT_FOUND`      |
| `PED25`  | `PRODUCT_NAME_REQUIRED`  |
| `PED26`  | `PRODUCT_NAME_TOO_LONG`  |
| `PED27`  | `DESCRIPTION_TOO_LONG`   |
| `PED28`  | `INVALID_PRICE`          |
| `PED29`  | `CATEGORY_UNIT_MISMATCH` |
| `PED30`  | `INVALID_CATALOG_FLAG`   |

As RPCs reutilizam `PED10`, `PED11` e `PED12` para autenticação, autorização e unidade ausente.

### 6.5 `public.catalog_product_option_groups`

| Coluna            | Tipo                                   | Regras                                                              |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                                                     |
| `organization_id` | `uuid` NOT NULL                        | parte da FK composta da unidade                                     |
| `unit_id`         | `uuid` NOT NULL                        | FK `(organization_id,unit_id)` para `units`, cascade                |
| `product_id`      | `uuid` NOT NULL                        | FK `(organization_id,unit_id,product_id)` para produto, cascade     |
| `name`            | `text` NOT NULL                        | já trimado; tamanho `1..80`                                         |
| `kind`            | `text` NOT NULL                        | `variation`, `addon` ou `removal`                                   |
| `selection_mode`  | `text` NOT NULL                        | `single` ou `multiple`                                              |
| `min_select`      | `integer` NOT NULL                     | `>= 0`; limite superior em `max_select`                             |
| `max_select`      | `integer` NOT NULL                     | `<= 50`; `min_select <= max_select`                                 |
| `is_active`       | `boolean` NOT NULL default `true`      | desativação lógica                                                  |
| `sort_order`      | `integer` NOT NULL                     | `> 0`, calculado no servidor                                        |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                                     |
| `updated_at`      | `timestamptz` NOT NULL default `now()` | trigger `set_catalog_product_option_groups_updated_at`              |

Regras estruturais (CHECK + triggers):

- `variation` exige `selection_mode = 'single'` e `max_select = 1`.
- Todo `selection_mode = 'single'` exige `max_select = 1`, independentemente do `kind`.
- `removal` exige `selection_mode = 'multiple'` e `min_select = 0`.
- unique composto `catalog_product_option_groups_organization_unit_product_id_key
  (organization_id,unit_id,product_id,id)`, alvo da FK das opções;
- índice `catalog_product_option_groups_product_order_idx
  (organization_id,unit_id,product_id,sort_order,id)`;
- trigger `catalog_product_option_groups_kind_guard` rejeita mudança de `kind` que deixaria opções
  existentes em violação (sem correção silenciosa).
- triggers de grupos e opções adquirem
  `pedon:catalog:option-groups:product:<product_id>`, o mesmo advisory lock usado na publicação.

### 6.6 `public.catalog_product_options`

| Coluna            | Tipo                                   | Regras                                                              |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                                                     |
| `organization_id` | `uuid` NOT NULL                        | parte da FK composta                                                |
| `unit_id`         | `uuid` NOT NULL                        | FK composta para a unidade, cascade                                 |
| `product_id`      | `uuid` NOT NULL                        | parte da FK composta do grupo                                       |
| `group_id`        | `uuid` NOT NULL                        | FK `(organization_id,unit_id,product_id,group_id)` para o grupo     |
| `name`            | `text` NOT NULL                        | já trimado; tamanho `1..80`                                         |
| `price_delta`     | `numeric(12,2)` NOT NULL               | `-9999999999.99..9999999999.99`; exato, nunca float                 |
| `is_active`       | `boolean` NOT NULL default `true`      | estado estrutural                                                   |
| `is_available`    | `boolean` NOT NULL default `true`      | disponibilidade operacional independente                            |
| `sort_order`      | `integer` NOT NULL                     | `> 0`, calculado no servidor                                        |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                                     |
| `updated_at`      | `timestamptz` NOT NULL default `now()` | trigger `set_catalog_product_options_updated_at`                    |

unique `catalog_product_options_organization_unit_product_group_id_key
(organization_id,unit_id,product_id,group_id,id)` e índice
`catalog_product_options_group_order_idx (organization_id,unit_id,group_id,sort_order,id)`. A FK
composta do grupo impede IDOR de opção de outro grupo/unidade/organização.

Regra de `price_delta` por `kind` (trigger `catalog_product_options_delta_by_kind`):

- `addon` exige `price_delta >= 0`; `variation` aceita delta assinado, inclusive desconto.
- `removal` exige `price_delta = 0` (remoção nunca altera o preço).
- A mudança de `kind` do grupo é validada contra as opções existentes.

### 6.7 RPCs de grupos e opções (Prompt 12)

| RPC                                                        | Autorização              | Efeito                                              |
| ---------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| `create_catalog_product_option_group(uuid,uuid,text,text,text,int,int)` | owner/manager da unidade | cria grupo; valida regras e calcula `sort_order`    |
| `update_catalog_product_option_group(uuid,text,text,text,int,int)`      | owner/manager da unidade | edita nome/kind/modo/min/max; valida contra opções  |
| `set_catalog_product_option_group_active(uuid,boolean)`    | owner/manager da unidade | desativação lógica do grupo                         |
| `create_catalog_product_option(uuid,text,text)`            | owner/manager da unidade | cria opção; `price_delta` entra como texto          |
| `update_catalog_product_option(uuid,text,text)`            | owner/manager da unidade | edita nome e `price_delta`                          |
| `set_catalog_product_option_active(uuid,boolean)`          | owner/manager da unidade | estado estrutural da opção                          |
| `set_catalog_product_option_available(uuid,boolean)`       | owner/manager/operator   | altera somente disponibilidade                      |

Desde a migration 23, os dois CREATE seguem a ordem
`_lock_unit_structure(unit)` → advisory lock de produto → `max(sort_order)+100` → `INSERT`. O lock
de produto foi preservado para serializar o cálculo de `sort_order`; a inversão conhecida
`NEW-MEDIUM-1` foi eliminada sem afirmar impossibilidade matemática de todo deadlock do sistema.

`_validate_option_delta(text,text)` aceita somente decimal textual válido (até dez dígitos inteiros
e duas casas, sem expoente/`NaN`/`Infinity`); opções usam `price_delta` decimal e `_options_fingerprint`
interna para ordenação/validação. A leitura administrativa das opções é feita por SELECT direto via
política RLS (grants de escrita inexistem; mutações exclusivamente pelas RPCs acima).

| SQLSTATE | Mensagem                   |
| -------- | -------------------------- |
| `PED72`  | `INVALID_OPTION_GROUP`     |
| `PED73`  | `INVALID_SELECTION_RULE`   |
| `PED74`  | `OPTION_NOT_FOUND`         |
| `PED75`  | `OPTION_UNAVAILABLE`       |
| `PED76`  | `SELECTION_REQUIRED`       |
| `PED77`  | `SELECTION_LIMIT_EXCEEDED` |
| `PED78`  | `SELECTION_MENU_MISMATCH`  |

Reutilizam `PED10`, `PED11`, `PED12` (auth/RBAC/unidade), `PED24` (produto ausente), `PED25`/`PED26`
(nome do grupo/opção) e `PED28` (preço inválido).

## 7. Cardápio publicado (Prompt 07)

### 7.1 `public.menu_versions`

| Coluna            | Tipo                                   | Regras                                               |
| ----------------- | -------------------------------------- | ---------------------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`  |                                                      |
| `organization_id` | `uuid` NOT NULL                        | parte da FK composta da unidade                      |
| `unit_id`         | `uuid` NOT NULL                        | FK `(organization_id,unit_id)` para `units`, cascade |
| `version_number`  | `integer` NOT NULL                     | `> 0`, derivado no servidor (`max+1`)                |
| `created_by`      | `uuid`                                 | FK `auth.users(id) ON DELETE SET NULL`               |
| `created_at`      | `timestamptz` NOT NULL default `now()` |                                                      |

Unique `menu_versions_unit_number_key (unit_id,version_number)`, unique
`menu_versions_organization_unit_id_key (organization_id,unit_id,id)` e índice
`menu_versions_unit_number_idx (unit_id,version_number desc)`.

### 7.2 `public.menu_version_categories`

| Coluna               | Tipo                                   | Regras                                                                |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `id`                 | `uuid` PK default `gen_random_uuid()`  |                                                                       |
| `organization_id`    | `uuid` NOT NULL                        |                                                                       |
| `unit_id`            | `uuid` NOT NULL                        |                                                                       |
| `menu_version_id`    | `uuid` NOT NULL                        | FK `(organization_id,unit_id,menu_version_id)` para a versão, cascade |
| `source_category_id` | `uuid`                                 | metadado interno de rastreabilidade; nunca exposto publicamente       |
| `name`               | `text` NOT NULL                        | trimada; `1..80`                                                      |
| `sort_order`         | `integer` NOT NULL                     | `> 0`                                                                 |
| `created_at`         | `timestamptz` NOT NULL default `now()` |                                                                       |

Unique `menu_version_categories_organization_version_id_key (organization_id,unit_id,menu_version_id,id)`
e índice `menu_version_categories_order_idx (menu_version_id,sort_order,id)`.

### 7.3 `public.menu_version_products`

| Coluna              | Tipo                                   | Regras                                                                                  |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                | `uuid` PK default `gen_random_uuid()`  |                                                                                         |
| `organization_id`   | `uuid` NOT NULL                        |                                                                                         |
| `unit_id`           | `uuid` NOT NULL                        |                                                                                         |
| `menu_version_id`   | `uuid` NOT NULL                        | FK composta para a versão, cascade                                                      |
| `menu_category_id`  | `uuid` NOT NULL                        | FK `(organization_id,unit_id,menu_version_id,id)` para a categoria do snapshot, cascade |
| `source_product_id` | `uuid`                                 | vínculo interno para o overlay de disponibilidade; nunca exposto                        |
| `name`              | `text` NOT NULL                        | trimada; `1..120`                                                                       |
| `description`       | `text`                                 | null ou trimada, `1..500`                                                               |
| `price`             | `numeric(12,2)` NOT NULL               | `> 0` e `<= 9999999999.99`                                                              |
| `sort_order`        | `integer` NOT NULL                     | `> 0`                                                                                   |
| `created_at`        | `timestamptz` NOT NULL default `now()` |                                                                                         |

Índice `menu_version_products_order_idx (menu_version_id,menu_category_id,sort_order,id)`.

### 7.4 `public.menu_publications`

| Coluna                    | Tipo                                   | Regras                                                                       |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `organization_id`         | `uuid` NOT NULL                        |                                                                              |
| `unit_id`                 | `uuid` PK                              | FK `(organization_id,unit_id)` para `units`, cascade                         |
| `public_slug`             | `text` NOT NULL                        | único; 24 hex opacos, estável desde a primeira publicação                    |
| `current_menu_version_id` | `uuid` NOT NULL                        | FK `(organization_id,unit_id,current_menu_version_id)` para a versão CURRENT |
| `published_at`            | `timestamptz` NOT NULL                 |                                                                              |
| `updated_at`              | `timestamptz` NOT NULL default `now()` | trigger `set_menu_publications_updated_at`                                   |

No máximo uma linha por unidade. O slug nunca é rejeitado em republicação: reutilizado sempre.

### 7.5 Publicação server-authoritative

`publish_unit_menu(uuid)` (owner/manager da unidade, `can_manage_unit`):

- adquire advisory locks `pedon:catalog:categories:unit:<unit>` e `pedon:menu:publish:<unit>`,
  além do lock de produtos de cada categoria ativa (`pedon:catalog:products:category:<id>`);
- captura somente o catálogo estruturalmente ativo (`is_active=true`); categorias sem ao menos um
  produto ativo são omitidas; menu vazio falha com `PED31` sem criar versão;
- congela também os grupos de opções ativos e suas opções ativas por produto
  (`menu_version_option_groups` / `menu_version_options`, com `source_group_id`/`source_option_id`
  para o overlay de disponibilidade);
- valida o piso de preço final (`base +` menor combinação de deltas entre grupos `variation`)
  usando o estado ativo, sem relaxar por disponibilidade atual das opções;
- cria a versão com `max(version_number)+1`, copia categorias/produtos elegíveis e atualiza a ponte
  (insere com slug novo ou reutiliza o existente);
- gera slug de 24 hex via `left(replace(gen_random_uuid()::text,'-',''),24)` com retry em
  `unique_violation` (10 tentativas) e `PED32` se esgotar;
- retorna `version_id`, `version_number`, `published_at`, `public_slug`, `public_path`,
  `category_count`, `product_count`, `group_count`, `option_count`.

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
  `price` (texto), `sort_order`, `is_available`, `is_configurable` e `option_groups[]`.

IDs e preços vêm exclusivamente do snapshot; `is_available` é overlay dinâmico de
`catalog_products.is_available` via `source_product_id` (fonte ausente/deletada ⇒ `false`).
`option_groups[]` traz `id`, `name`, `kind`, `selection_mode`, `min_select`, `max_select` e
`options[]` com `id`, `name`, `price_delta` (texto) e `is_available` (overlay via
`source_option_id`). `is_configurable` é `true` quando não existe grupo obrigatório insatisfazível,
isto é, nenhum grupo com `min_select > 0` possui menos opções disponíveis que o mínimo. Por esse
contrato, produtos sem grupos e produtos com somente grupos opcionais também retornam `true`.
`anon` nunca lê as tabelas de menu/catálogo diretamente.

### 7.7 Erros do cardápio publicado

| SQLSTATE | Mensagem               |
| -------- | ---------------------- |
| `PED31`  | `MENU_EMPTY`           |
| `PED32`  | `PUBLICATION_CONFLICT` |

`PED31`/`PED32` são exclusivos da publicação; `get_public_menu` não lança erros (retorna
`found=false`).

## 8. Pedidos e checkout (Prompt 08)

### 8.1 `public.orders`

| Grupo              | Colunas e regras principais                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escopo             | `id`; `organization_id`; `unit_id`; FKs compostas para unidade e versão, todas com `ON DELETE RESTRICT`                                                                                           |
| Snapshot do menu   | `menu_version_id`, `menu_version_number > 0`                                                                                                                                                      |
| Identidade         | `order_number bigint > 0` único por unidade; `idempotency_key uuid` único por unidade; `request_hash` SHA-256; `client_attempt_hash` SHA-256 nullable; `tracking_token` globalmente único, 32 hex |
| Estados            | `status`: `new`, `confirmed`, `preparing`, `ready`, `out_for_delivery`, `completed`, `cancelled`; `payment_status`: `pending`, `paid`, `refunded`                                                 |
| Checkout           | `service_mode` (`pickup`,`delivery`); `payment_method` (`cash`,`pix`,`credit_card`,`debit_card`)                                                                                                  |
| Cliente            | `customer_name` trimado de 2..120; `customer_phone` com 10/11 dígitos; sem CPF/e-mail/conta                                                                                                       |
| Entrega            | endereço estruturado em colunas de rua, número, complemento, bairro, cidade, UF, CEP e referência; todos nulos em pickup                                                                          |
| Dinheiro           | `delivery_fee`, `subtotal`, `total`, `cash_change_for` em `numeric(12,2)`; `total = subtotal + delivery_fee`                                                                                      |
| Operação           | `estimated_minutes`; `operation_revision` preserva a revisão aceita no checkout                                                                                                                   |
| Auditoria temporal | `created_at`, `updated_at`, timestamps de status/pagamento e terminais coerentes por constraints                                                                                                  |

Índices cobrem leitura por unidade/data e unidade/status/data. A migration 23 adiciona somente
`orders_unit_active_urgency_idx (unit_id, status_updated_at, created_at, id)`, parcial para
`status IN ('new','confirmed','preparing','ready','out_for_delivery')`. Índices candidatos adicionais
para payment status, service mode, payment method e eventos foram rejeitados por falta de evidência
de necessidade. O trigger
`set_orders_updated_at` usa `clock_timestamp()`. `out_for_delivery` só é válido para delivery;
`completed_at`/`cancelled_at` e `paid_at`/`refunded_at` são consistentes com seus estados.

### 8.2 `public.order_items`

Cada linha carrega `organization_id`, `unit_id`, `order_id`, `menu_version_id`, `menu_item_id`,
`product_name`, `unit_price numeric(12,2)`, `quantity 1..99`, `line_total numeric(12,2)`, nota
opcional segura, `options_fingerprint` e `created_at`. FKs compostas garantem que pedido, versão e
item pertençam ao mesmo tenant/unidade; `(order_id,menu_item_id,options_fingerprint)` é único e
`line_total = unit_price * quantity`.

Nome e preço são copiados de `menu_version_products`, não do payload nem do catálogo mutável. O
preço unitário final (`unit_price`) passa a incluir a soma dos `price_delta` das opções selecionadas
(`base + SUM(delta)`), calculado no servidor no checkout do Prompt 12.

### 8.2a `public.order_item_options`

Snapshot append-only das opções escolhidas por linha: `order_item_id` (FK composta para
`order_items`), `menu_group_id`/`menu_option_id` (FKs do snapshot com `ON DELETE RESTRICT`),
`group_name`, `group_kind`, `option_name` e `price_delta numeric(12,2)`. Índices cobrem pedido,
item e unidade; única escrita é o checkout transacional, preservando nome, tipo e delta no momento
da compra — o catálogo mutável pode mudar depois sem afetar o pedido. O trigger
`order_item_options_live_selection_guard` bloqueia a opção de catálogo disponível antes do insert,
linearizando checkout contra toggle/delete e protegendo grupos `single` contra segunda seleção.

### 8.3 `public.order_events`

Eventos carregam escopo, pedido, `event_type`, `from_value`, `to_value`, nota, `actor_type`,
`actor_user_id` e `created_at`. Tipos permitidos: `created`, `status_changed`, `payment_changed`;
atores: `customer`, `staff`, `system`. O evento inicial é `NULL → new` pelo cliente; mudanças de
estado são geradas pelas RPCs com ator staff. Nenhum cliente recebe escrita direta.

### 8.4 Checkout público e idempotência

`create_public_order(text,uuid,jsonb)` é executável por `anon`/`authenticated` e:

- aceita somente versão/revisão, modalidade, pagamento, cliente, endereço, itens, notas e troco;
  cada item pode carregar `options` (IDs do snapshot `menu_version_options`);
- rejeita preço, nome ou total autoritativo enviado pelo navegador;
- valida unidade ativa, aceite, horário, modalidade, pagamento, versão publicada, revisão
  operacional, disponibilidade, mínimo, endereço e troco;
- valida as seleções no servidor: opções existentes no snapshot, pertencentes ao mesmo produto,
  disponíveis via overlay, dentro do `min_select`/`max_select` de cada grupo e do `kind`
  (`PED72`–`PED78`); grupo obrigatório de variação sem seleção gera `PED76`;
- calcula `unit_price = base + SUM(price_delta)` por linha, depois linhas, subtotal, taxa e total
  em `numeric(12,2)` e grava pedido, itens, `order_item_options` e evento inicial atomicamente;
- serializa `(unit_id,idempotency_key)` por advisory lock e guarda SHA-256 do payload canônico;
  replay igual retorna a criação original, payload diferente gera `PED42`;
- serializa o número sequencial por unidade; token de tracking tem retry limitado em colisão.

`get_public_order(text)` retorna `found=false` para token inválido/desconhecido. Quando encontrado,
expõe nomes da organização/unidade, número, estados, modalidade, método, totais, ETA, timestamps e
itens; cada item expõe `options[]` com `group_name`, `group_kind`, `option_name` e `price_delta`
(sem IDs técnicos); não expõe PII, endereço, token, IDs internos, versão, hash, chave de idempotência
nem a nota livre do item. A nota permanece disponível somente no detalhe administrativo.

`create_public_order_v2(text,uuid,jsonb,text)` envolve o checkout original e vincula um attempt hash
de 64 hex à criação. `get_public_order_by_attempt(text,uuid,text)` recupera exatamente a resposta
pública por slug + UUID de idempotência + attempt hash, ou retorna `found=false`; divergências não
expõem PII nem IDs internos.

### 8.5 Central de Pedidos e máquinas de estado

| RPC                                        | Autorização                                        | Contrato                                                     |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| `get_unit_orders_admin(uuid,text,integer)` | `can_access_unit`                                  | lista filtrada, contagem e limite 1..200                     |
| `get_order_admin(uuid)`                    | `can_access_unit`                                  | detalhe com PII, itens e eventos; sem hash/chave idempotente |
| `set_order_status(uuid,text,text)`         | `can_access_unit`                                  | lock da linha, transição, timestamps e evento                |
| `set_order_payment_status(uuid,text)`      | `can_access_unit`; refund requer `can_manage_unit` | lock da linha, transição e evento                            |

#### 8.5a Central de Pedidos v2

`get_unit_orders_admin_v2(uuid,jsonb)` preserva a RPC v1 e separa `active` de `history`. Não há busca
por cliente nesta etapa. Os filtros são aplicados no servidor: `view`, `statuses`, `service_mode`,
`payment_status`, `payment_method`, `order_number`, `date_from`, `date_to`, `cursor` e `limit`.
Qualquer key desconhecida ou filtro estruturalmente inválido retorna `PED79 INVALID_ORDER_FILTER`.
O limite default é 50 e o máximo é 100; a paginação é keyset e não usa `OFFSET`.

- `view=active` permite somente `new`, `confirmed`, `preparing`, `ready`, `out_for_delivery` e ordena
  por `overdue_rank`, `status_bucket`, `status_updated_at`, `created_at`, `id`, todos ascendentes.
- `view=history` permite somente `completed`, `cancelled` e ordena por `created_at DESC, id DESC`.
- `statuses` incompatível com a view retorna `PED79`; não é convertido em lista vazia.

O cursor é server-generated, base64url, single-line, opaco, sem PII e sem segredo. PostgreSQL
`encode(...,'base64')` pode inserir whitespace/newline; migration 23 remove `\s` no encode e no
decode com `regexp_replace(..., '\s', '', 'g')`. Active carrega `view`, `snapshot_at`, overdue rank,
status bucket, `status_updated_at`, `created_at`, `id`; history carrega `view`, `created_at`, `id`.

A primeira página active fixa `snapshot_at` e páginas seguintes reutilizam `cursor.snap`. Esse valor
congela somente a referência temporal da classificação overdue; não oferece snapshot isolation nem
snapshot transacional do dataset. Mudanças reais de status entre páginas podem alterar os
resultados. Realtime/refetch futuro deve reiniciar a paginação desde a primeira página.

#### 8.5b KDS minimizado

`get_kds_orders_minimal(uuid)` é uma superfície separada da Central, autorizada por
`can_access_unit` para owner, manager e operator. Retorna no máximo 200 pedidos nos status `new`,
`confirmed`, `preparing`, `ready`; `truncated=true` indica que existem mais de 200 resultados. Não retorna
`out_for_delivery`, `completed` ou `cancelled` e reutiliza a mesma order state machine.

O contrato pode retornar ID do pedido para mutation, número, status, service mode, timestamps,
`estimated_minutes`, `expected_at`, itens, quantidade, nota do item e nomes/tipos de opções. Omite
`customer_name`, `customer_phone`, endereço, dados de pagamento, dinheiro/totais, loyalty, tracking
token, idempotência e IDs técnicos de menu/catálogo. A resposta administrativa ampla não é
reutilizada pelo KDS: a separação é privacy-by-contract.

Status: `new → confirmed → preparing → ready`; pickup segue para `completed`; delivery segue para
`out_for_delivery → completed`. Cancelamento é permitido antes de completed. `completed` e
`cancelled` são terminais. Pagamento evolui separadamente `pending → paid → refunded`; cancelar não
altera pagamento e refund é somente registro operacional externo.

### 8.6 Realtime e erros

`orders` integra `supabase_realtime` somente com `id`, `unit_id`, `updated_at`, `status` e
`payment_status`; itens, eventos, PII e idempotência não são publicados. O frontend usa o evento
apenas para invalidar/refazer queries.

| SQLSTATE | Mensagem                     |
| -------- | ---------------------------- |
| `PED33`  | `MENU_NOT_FOUND`             |
| `PED34`  | `ORDERS_UNAVAILABLE`         |
| `PED35`  | `MENU_CHANGED`               |
| `PED36`  | `CHECKOUT_CHANGED`           |
| `PED37`  | `INVALID_CART`               |
| `PED38`  | `ITEM_UNAVAILABLE`           |
| `PED39`  | `INVALID_SERVICE_MODE`       |
| `PED40`  | `PAYMENT_METHOD_UNAVAILABLE` |
| `PED41`  | `MINIMUM_ORDER_NOT_MET`      |
| `PED42`  | `IDEMPOTENCY_CONFLICT`       |
| `PED43`  | `INVALID_CUSTOMER`           |
| `PED44`  | `INVALID_DELIVERY_ADDRESS`   |
| `PED45`  | `INVALID_CASH_CHANGE`        |
| `PED46`  | `ORDER_NOT_FOUND`            |
| `PED47`  | `INVALID_ORDER_TRANSITION`   |
| `PED48`  | `INVALID_PAYMENT_TRANSITION` |
| `PED49`  | `TRACKING_TOKEN_CONFLICT`    |
| `PED50`  | `ORDER_AMOUNT_OVERFLOW`      |
| `PED79`  | `INVALID_ORDER_FILTER`       |

Erros de seleção de opções (Prompt 12): `PED72` `INVALID_OPTION_GROUP`, `PED73`
`INVALID_SELECTION_RULE`, `PED74` `OPTION_NOT_FOUND`, `PED75` `OPTION_UNAVAILABLE`, `PED76`
`SELECTION_REQUIRED`, `PED77` `SELECTION_LIMIT_EXCEEDED` e `PED78` `SELECTION_MENU_MISMATCH`.

`PED79` pertence exclusivamente ao contrato administrativo orders v2 e cobre key desconhecida,
enum inválido, limit, timestamp, cursor, view/status incompatível e filtro estruturalmente inválido.
Não é erro do checkout público.

A migration de hardening substitui `create_public_order` para remover uma declaração redundante
apontada pelo lint e reaplica os grants, sem alterar assinatura ou comportamento.

## 9. Cliente e Clube Ped-On (Prompt 09)

O Clube está implementado no PostgreSQL, na Edge Function deployada e nas UIs pública e
administrativa. A identidade v2 usa o par CPF + telefone protegido por fingerprints HMAC
tenant-bound. **Nenhum CPF ou telefone completo é persistido** nas tabelas do Clube.

### 9.1 `public.loyalty_programs`

Programa de fidelidade por organização. Inexistente ou `enabled=false` ⇒ Clube indisponível
(`PED51`). Só passa a existir quando o owner ativa via `set_loyalty_program_enabled`.

| Coluna                      | Tipo            | Regras                                     |
| --------------------------- | --------------- | ------------------------------------------ |
| `organization_id`           | `uuid` PK       | FK `organizations(id)` ON DELETE CASCADE   |
| `enabled`                   | `boolean`       | default `false`                            |
| `points_per_real`           | `numeric(12,2)` | default `1.00`; `> 0` e `<= 9999999999.99` |
| `created_at` / `updated_at` | `timestamptz`   | default `now()`                            |

### 9.2 `public.customers`

Cliente por organização; identidade v2 derivada do par CPF + telefone, nunca dos valores em claro.

| Coluna              | Tipo          | Regras                                                                                                             |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                | `uuid` PK     | `gen_random_uuid()`                                                                                                |
| `organization_id`   | `uuid`        | FK `organizations(id)` CASCADE                                                                                     |
| `cpf_fingerprint`   | `text`        | `~ '^[a-f0-9]{64}$'`; HMAC-SHA-256 keyed por tenant: `HMAC(secret, 'pedon:cpf:v1:' \|\| org_id \|\| ':' \|\| cpf)` |
| `phone_fingerprint` | `text`        | 64 hex; HMAC tenant-bound no domínio `pedon:phone:v1`; nullable apenas para legado anterior ao v2                  |
| `cpf_last2`         | `text`        | `~ '^[0-9]{2}$'`; exibição mascarada                                                                               |
| `name`              | `text`        | nullable; `btrim` 2..120 e `_is_safe_plain_text`                                                                   |
| `created_at`        | `timestamptz` | default `now()`                                                                                                    |

`UNIQUE (organization_id, cpf_fingerprint)` impede duplicidade por tenant. O índice
`(organization_id, cpf_fingerprint, phone_fingerprint)` atende a identidade v2. Nenhuma coluna de
CPF/telefone em claro existe.

### 9.3 `public.loyalty_memberships`

Vínculo cliente/organização; é o escopo de pontos. `UNIQUE (organization_id, customer_id)`.

| Coluna            | Tipo          | Regras                                                             |
| ----------------- | ------------- | ------------------------------------------------------------------ |
| `id`              | `uuid` PK     | `gen_random_uuid()`                                                |
| `organization_id` | `uuid`        | FK `organizations(id)` CASCADE                                     |
| `customer_id`     | `uuid`        | FK composta `(organization_id, customer_id)` → `customers` CASCADE |
| `consented_at`    | `timestamptz` | obrigatório em par com `consent_version` para enroll v2            |
| `consent_version` | `text`        | texto seguro 1..64; versão atual da Edge: `pedon-clube-v1`         |
| `created_at`      | `timestamptz` | default `now()`                                                    |

`enroll` exige `consent === true` na Edge e versão não nula no resolver v2. Reenroll atualiza o par
`consented_at`/`consent_version` atual e acrescenta uma evidência imutável em
`loyalty_consent_events`.

### 9.3a `public.loyalty_consent_events`

Histórico append-only interno de consentimento, sem grants ou policies de navegador. Cada evento
registra `organization_id`, `membership_id`, `consent_version`, `consented_at` e `created_at`; uma FK
composta garante que a evidência pertence à membership do mesmo tenant.

### 9.4 `public.loyalty_accounts`

Projeção derivada do ledger (não é fonte de verdade). Invariante orgânico:
`sum(loyalty_ledger.amount) = points_balance - recovery_points`.

| Coluna            | Tipo          | Regras                                                                          |
| ----------------- | ------------- | ------------------------------------------------------------------------------- |
| `membership_id`   | `uuid` PK     | FK composta `(organization_id, membership_id)` → memberships CASCADE            |
| `organization_id` | `uuid`        | —                                                                               |
| `points_balance`  | `bigint`      | default `0`; `CHECK (points_balance >= 0)`                                      |
| `recovery_points` | `bigint`      | default `0`; `CHECK (recovery_points >= 0)`; dívida quando estorno excede saldo |
| `updated_at`      | `timestamptz` | default `now()`                                                                 |

`recovery_points` representa dívida de pontos quando uma reversão excede o saldo disponível. Novos
earns quitam a dívida antes de compor saldo. `total_earned`/`total_reversed` continuam calculados na
leitura administrativa. Resgate é bloqueado quando existe dívida de recuperação e, no sucesso,
debita `points_balance` pelo custo server-authoritative da recompensa.

### 9.5 `public.loyalty_ledger`

Ledger append-only (sem UPDATE/DELETE por RPC ou navegador). `earn` sempre `amount > 0`; `reversal`
sempre `amount < 0`.

| Coluna            | Tipo            | Regras                                                                        |
| ----------------- | --------------- | ----------------------------------------------------------------------------- |
| `id`              | `uuid` PK       | `gen_random_uuid()`                                                           |
| `organization_id` | `uuid`          | FK composta orders `(organization_id, order_id)` ON DELETE RESTRICT           |
| `membership_id`   | `uuid`          | FK composta memberships `(organization_id, membership_id)` ON DELETE RESTRICT |
| `order_id`        | `uuid`          | presente em earn/reversal; nulo em redeem                                     |
| `redemption_id`   | `uuid`          | presente somente em redeem; FK composta com `ON DELETE RESTRICT`              |
| `entry_type`      | `text`          | `CHECK (entry_type in ('earn','reversal','redeem'))`                          |
| `amount`          | `bigint`        | `CHECK` de forma: earn positivo, reversal negativo                            |
| `points_delta`    | `bigint`        | alteração exata do saldo disponível                                           |
| `recovery_delta`  | `bigint`        | alteração exata da dívida; `points_delta - recovery_delta = amount`           |
| `eligible_amount` | `numeric(12,2)` | subtotal elegível nullable, nunca negativo                                    |
| `created_at`      | `timestamptz`   | default `clock_timestamp()`                                                   |

Índices únicos parciais garantem no máximo um earn/reversal por pedido e uma entrada `redeem` por
redemption. Para `redeem`, `amount = points_delta = -points_cost`, `recovery_delta = 0`,
`eligible_amount` e `order_id` são nulos. `orders` ganhou `UNIQUE (organization_id, id)` para
suportar a FK composta do ledger.

### 9.6 `public.loyalty_access_tokens`

Token efêmero de acesso/sessão do consumidor. Apenas `SHA-256(token)` é persistido. O token é
repetível para conta/extrato durante 2 horas até ser removido atomicamente pelo checkout; depois a
consulta retorna `found=false`.

| Coluna            | Tipo          | Regras                                                             |
| ----------------- | ------------- | ------------------------------------------------------------------ |
| `token_hash`      | `text` PK     | `~ '^[a-f0-9]{64}$'`                                               |
| `organization_id` | `uuid`        | FK composta memberships `(organization_id, membership_id)` CASCADE |
| `membership_id`   | `uuid`        | —                                                                  |
| `expires_at`      | `timestamptz` | posterior à criação e no máximo 2h05 após ela                      |
| `created_at`      | `timestamptz` | default `now()`                                                    |

Índices `(organization_id, membership_id, expires_at)` e `(expires_at)`. A RPC de rate limit remove
até 100 tokens expirados por chamada.

### 9.7 `public.loyalty_rate_limits`

Fixed-window persistente usado pela Edge. A chave é
`HMAC(secret, 'pedon:rate:v1:' || ip || ':' || slug || ':' || mode)`; usa somente
`CF-Connecting-IP`, e slugs inexistentes são reduzidos ao escopo canônico `invalid`. IP, slug, modo,
CPF e telefone não são armazenados em claro.

| Coluna         | Tipo          | Regras                                   |
| -------------- | ------------- | ---------------------------------------- |
| `scope_hash`   | `text`        | 64 hex; parte da PK                      |
| `bucket_start` | `timestamptz` | parte da PK                              |
| `attempts`     | `integer`     | `> 0`, incremento atômico                |
| `expires_at`   | `timestamptz` | posterior ao início; índice para cleanup |

Lookup permite 10 e enroll 5 tentativas por 60 segundos. Excesso retorna HTTP 429 com
`Retry-After`. Tabela e RPC consumidora não têm grants de navegador.

### 9.8 Conta e extrato públicos

`get_public_loyalty_account` retorna organização, cliente mascarado, conta e no máximo as 50 entradas
mais recentes do extrato, ordenadas por `created_at DESC, id DESC`. Cada entrada contém somente
`entry_type`, `gross_points`, `points_delta`, `recovery_delta`, `eligible_amount`, `order_number` e
`created_at`; IDs internos de ledger, membership, customer e order não são expostos.

### 9.9 Integração com pedidos

- `orders.loyalty_membership_id` (`uuid`, nullable) com FK composta
  `(organization_id, loyalty_membership_id) → loyalty_memberships(organization_id, id)`
  ON DELETE RESTRICT + índice — garante mesmo tenant entre pedido e membership.
- `orders.organization_id` ganhou `UNIQUE (organization_id, id)` (insumo da FK do ledger).
- `orders.client_attempt_hash` aceita 64 hex nullable; índice parcial por unidade + idempotência +
  hash suporta recuperação pública sem persistir o payload.
- `create_public_order` aceita `loyalty_token` opcional (64 hex): programa desabilitado ⇒ `PED51`;
  token ausente/expirado/inválido/outro tenant ⇒ `PED52`; consumo único via DELETE na mesma
  transação (falha posterior devolve o token). Retry idempotente ocorre antes da validação
  (DEC-100), então replay nunca reconsome.
- Programa desabilitado não revoga leitura de token já emitido, mas bloqueia nova identificação,
  novo checkout com Clube e earn na conclusão.
- `create_public_order_v2` associa attempt hash; `get_public_order_by_attempt` recupera a resposta de
  criação sem PII/IDs internos. O frontend persiste somente UUID de idempotência, hash, slug e
  timestamp por no máximo 24 horas.
- `set_order_status` chama `_loyalty_earn_order` na transição para `completed`.
- `set_order_payment_status` chama `_loyalty_reverse_order` na transição para `refunded`.
- `get_public_menu` expõe apenas `loyalty.enabled`; `_order_admin_json` expõe
  `loyalty.linked` + `cpf_masked` para o staff.

### 9.10 RPCs internas e públicas

| Objeto                                                                         | Acesso                          | Contrato                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_loyalty_public_context_internal(text)`                                    | `service_role`                  | slug → `organization_id` + estado do programa (insumo do HMAC)                                                                                                                                                  |
| `resolve_loyalty_identity_internal(uuid,text,text,text,text,text,timestamptz)` | revogado/depreciado             | resolver legado preservado apenas como objeto histórico; não executável por `service_role`                                                                                                                      |
| `resolve_loyalty_identity_internal_v2(...)`                                    | `service_role`                  | CPF + telefone HMAC tenant-bound; consentimento obrigatório no enroll                                                                                                                                           |
| `consume_loyalty_rate_limit_internal(text,integer,integer)`                    | `service_role`                  | fixed-window persistente e atômico por escopo opaco                                                                                                                                                             |
| `get_public_loyalty_account(text)`                                             | `anon`/`authenticated`          | token repetível válido; dados mascarados, saldo, até 50 entradas de extrato e até 20 vouchers `issued`                                                                                                           |
| `get_loyalty_program_admin(uuid)`                                              | owner                           | programa + `stats.members_count`                                                                                                                                                                                |
| `set_loyalty_program_enabled(uuid,boolean)`                                    | owner                           | ativa/desativa o programa (cria a linha no primeiro enable)                                                                                                                                                     |
| `get_loyalty_members_admin(uuid,integer,uuid)`                                 | owner                           | lista paginada (`limit` 1..200) com pontos em texto decimal e totais `earn`/`redeem`/`reversal` independentes                                                                                                 |
| `create_public_order_v2(text,uuid,jsonb,text)`                                 | `anon`/`authenticated`          | checkout idempotente com attempt hash                                                                                                                                                                           |
| `get_public_order_by_attempt(text,uuid,text)`                                  | `anon`/`authenticated`          | recovery minimizado ou `found=false`                                                                                                                                                                            |
| `_loyalty_earn_order(orders)`                                                  | interno (revogado de navegador) | earn idempotente: membership presente, `payment_status <> 'refunded'` (guard de hardening), programa habilitado, `points = floor(subtotal * points_per_real) > 0`; paga `recovery_points` antes de compor saldo |
| `_loyalty_reverse_order(orders)`                                               | interno (revogado de navegador) | reversal idempotente: devolve o earn do pedido; se exceder saldo, cria `recovery_points`                                                                                                                        |

### 9.11 Regra de pontos (DEC-090)

`points = floor(orders.subtotal * points_per_real)` (1 ponto por R$ 1,00 elegível com
`points_per_real = 1.00`). `delivery_fee` e centavos não geram pontos; pedido `< R$ 1,00` gera 0
pontos e nenhuma entrada de ledger. Earn acontece somente na 1ª transição `status → completed` com
`payment_status <> 'refunded'`; `payment_status → refunded` após o earn gera reversal completo.

### 9.12 Erros do Prompt 09

| SQLSTATE | Mensagem                                                                       |
| -------- | ------------------------------------------------------------------------------ |
| `PED51`  | `LOYALTY_UNAVAILABLE` (programa ausente/desabilitado)                          |
| `PED52`  | `INVALID_LOYALTY_TOKEN` (token ausente/expirado/inválido/outro tenant/formato) |
| `PED53`  | `LOYALTY_INTEGRITY` (inconsistência interna; também `limit` fora de 1..200)    |

Esses três SQLSTATE permanecem inalterados; a Edge os mapeia para o contrato HTTP público abaixo.

### 9.13 Edge Function `loyalty-cpf`

Única porta de resolução/inscrição do Clube (`supabase/functions/loyalty-cpf/index.ts`). Roda no
Edge Runtime do Supabase, usa `service_role` apenas internamente e lê o secret backend-only
`LOYALTY_CPF_HMAC_KEY` por `Deno.env`. Ele é um **Supabase Edge Secret de ambiente, não Vault**, e
nunca entra no repositório/browser. CPF e telefone brutos existem só em memória de request: nunca
são persistidos, logados nem retornados.

Contrato HTTP `POST <project-ref>.supabase.co/functions/v1/loyalty-cpf` (JWT da plataforma ativo —
o navegador envia a anon key via `supabase.functions.invoke`):

| Campo         | Tipo    | Regras                                                                               |
| ------------- | ------- | ------------------------------------------------------------------------------------ |
| `public_slug` | string  | slug 24 hex do cardápio; formato inválido ⇒ 404 `INVALID_SLUG`                       |
| `mode`        | string  | `lookup` \| `enroll`; outro valor ⇒ 400 `INVALID_MODE`                               |
| `cpf`         | string  | dígitos verificadores validados; inválido ⇒ 422 `INVALID_CPF`                        |
| `phone`       | string  | obrigatório; normalizado para 10/11 dígitos; inválido ⇒ 422 `INVALID_PHONE`          |
| `name`        | string  | obrigatório em `enroll`; `btrim` 2..120 sem `< >`/controle; senão 422 `INVALID_NAME` |
| `consent`     | boolean | `enroll` exige exatamente `true`; senão 422 `CONSENT_REQUIRED`                       |

- `200 { found: true, membership_id, customer: { name, cpf_last2 }, account: { points_balance,
recovery_points }, statement, token: { access_token, expires_at } }`; `access_token` é 64 hex
  opaco de 2h e só seu SHA-256 é persistido.
- CPF desconhecido e telefone divergente retornam exatamente o mesmo HTTP 422
  `IDENTITY_NOT_CONFIRMED`, com a mesma mensagem; não há `200 found=false` nesses casos na Edge.
- `403 LOYALTY_UNAVAILABLE`; `429 RATE_LIMITED` com `Retry-After`; `500 LOYALTY_INTEGRITY`,
  `SERVER_CONFIG` ou `UPSTREAM_ERROR`.
- Fluxo: rate limit HMAC(IP + slug + mode) → contexto do slug → HMAC tenant-bound de CPF + telefone
  → `resolve_loyalty_identity_internal_v2(...)` → conta/extrato. Enroll envia a versão fixa
  `pedon-clube-v1`.
- Respostas com `Cache-Control: no-store`; CORS habilitado (`*`); payload limitado a 4 KB.
- `verify_jwt` está ativo; chamada sem JWT é rejeitada antes da função. `OPTIONS` 204 usa corpo nulo.

Contrato HTTP completo:

| HTTP | Códigos públicos                                                                             |
| ---: | -------------------------------------------------------------------------------------------- |
|  400 | `INVALID_JSON`, `INVALID_MODE`                                                               |
|  403 | `LOYALTY_UNAVAILABLE`                                                                        |
|  404 | `INVALID_SLUG`                                                                               |
|  405 | `METHOD_NOT_ALLOWED`                                                                         |
|  413 | `PAYLOAD_TOO_LARGE`                                                                          |
|  422 | `INVALID_CPF`, `INVALID_PHONE`, `INVALID_NAME`, `CONSENT_REQUIRED`, `IDENTITY_NOT_CONFIRMED` |
|  429 | `RATE_LIMITED`, com `Retry-After`                                                            |
|  500 | `LOYALTY_INTEGRITY`, `SERVER_CONFIG`, `UPSTREAM_ERROR`                                       |

## 10. Recompensas, resgates e vouchers (Prompt 10)

### 10.1 Entidades

| Tabela                         | Contrato principal                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loyalty_rewards`              | reward por organização; nome único case-insensitive; custo positivo, estoque não negativo, estado ativo e ordenação; não possui valor monetário          |
| `loyalty_redemptions`          | snapshot imutável de nome/custo/revisão; unique `(organization_id,idempotency_key)`; guarda SHA-256 do request e do segredo de recovery                  |
| `loyalty_vouchers`             | um voucher por redemption; código global único de 16 hex uppercase; estados `issued`/`consumed`; sem expiração no Core MVP                              |
| `loyalty_reward_stock_events`  | trilha append-only `initial`/`admin_adjustment`/`redemption`; soma dos deltas corresponde ao estoque atual                                               |
| `loyalty_voucher_events`       | trilha append-only `issued`/`consumed`; no máximo um evento de cada tipo por voucher                                                                    |

FKs compostas por `organization_id` impedem relações cross-tenant. Redemptions, vouchers e eventos
usam `ON DELETE RESTRICT`; rewards não são removidas pela API. `DELETE: NOT SUPPORTED BY DESIGN`,
conforme DEC-108; a remoção operacional é `set_loyalty_reward_active(false)`.

### 10.2 Catálogo e resgate público

`get_public_loyalty_rewards(text)` retorna `found=false` para slug inválido/desconhecido. Para slug
válido, expõe somente rewards ativas com `id`, nome, descrição, custo textual, disponibilidade
booleana e revisão opaca; nunca revela estoque exato ou organização. Programa desativado retorna
`loyalty_enabled=false` e lista vazia.

`redeem_public_loyalty_reward(text,uuid,uuid,text,text,text)` executa atomicamente:

- replay idempotente antes das validações correntes, sob advisory lock por slug + chave;
- locks do token, reward e conta, nessa ordem; valida programa, revisão, atividade, estoque, saldo e
  ausência de `recovery_points`;
- redemption imutável, ledger `redeem`, débito de pontos, débito de uma unidade do estoque, stock
  event, voucher `issued` e voucher event;
- remoção do token somente no sucesso; rollback preserva token, saldo e estoque.

O custo vem da reward bloqueada, nunca do browser. O código retornado é formatado como
`ABCD-EF12-3456-7890`. `get_public_redemption_by_attempt(text,uuid,text)` recupera a mesma resposta
por slug, idempotency UUID e segredo de 64 hex correto, ou retorna `found=false`, sem PII ou IDs
internos. Replay de resgate exige `public_slug`, `idempotency_key` e `recovery_secret` correto; secret
ausente ou divergente nunca retorna o bearer voucher. O lock é organization-wide por organização +
idempotency key.

Todos os `bigint` autoritativos de pontos cruzam JSON como texto decimal. Isso inclui saldo,
recovery, custos, deltas de ledger e métricas. O cliente valida a string e usa `BigInt`; valores
monetários `numeric(12,2)` permanecem strings decimais monetárias.

### 10.3 Administração e operação

| RPC                                             | Autorização                       | Contrato                                                          |
| ----------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `get_loyalty_rewards_admin(uuid,integer,uuid)`  | owner da organização              | lista paginada com estoque exato, estado e revisão                |
| `create_loyalty_reward(uuid,jsonb)`             | owner da organização              | cria reward e evento de estoque inicial quando maior que zero     |
| `update_loyalty_reward(uuid,jsonb)`             | owner da organização              | atualiza nome/descrição/custo; não altera estoque                  |
| `set_loyalty_reward_active(uuid,boolean)`       | owner da organização              | soft deactivate/reactivate                                        |
| `set_loyalty_reward_stock(uuid,bigint)`         | owner da organização              | define saldo absoluto e registra o delta append-only               |
| `get_loyalty_voucher_staff(uuid,text)`          | `can_access_unit` em unidade ativa | valida código e retorna shape operacional minimizado               |
| `consume_loyalty_voucher(uuid,text)`            | `can_access_unit` em unidade ativa | transição terminal `issued → consumed` sob lock e evento auditável |

Owner, manager e operator podem operar vouchers somente nas unidades autorizadas. Código inválido é
`PED62`; lookup desconhecido ou cross-tenant retorna `found=false`, enquanto consumo desconhecido
usa `PED60`. Voucher consumido não pode ser consumido novamente (`PED61`).

### 10.4 Erros do Prompt 10

| SQLSTATE | Mensagem                   |
| -------- | -------------------------- |
| `PED54`  | `REWARD_NOT_FOUND`         |
| `PED55`  | `REWARD_UNAVAILABLE`       |
| `PED56`  | `REWARD_CHANGED`           |
| `PED57`  | `REWARD_OUT_OF_STOCK`      |
| `PED58`  | `INSUFFICIENT_POINTS`      |
| `PED59`  | `REDEMPTION_CONFLICT`      |
| `PED60`  | `VOUCHER_NOT_FOUND`        |
| `PED61`  | `VOUCHER_ALREADY_CONSUMED` |
| `PED62`  | `INVALID_VOUCHER_CODE`     |
| `PED63`  | `INVALID_REWARD`           |
| `PED64`  | `REDEMPTION_INTEGRITY`     |
| `PED65`  | `REWARD_NAME_CONFLICT`     |
| `PED66`  | `INVALID_REWARD_STOCK`     |

## 11. Funções e triggers atuais

| Objeto                                                                             | Contrato                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `handle_new_user()`                                                                | trigger `security definer`; cria profile idempotente após insert em `auth.users`      |
| `set_updated_at()`                                                                 | trigger comum; define `updated_at=now()`                                              |
| `is_org_member(uuid)`                                                              | membro da organização                                                                 |
| `is_org_owner(uuid)`                                                               | owner da organização                                                                  |
| `can_access_unit(uuid)`                                                            | owner da org ou vínculo em `membership_units`                                         |
| `can_manage_unit(uuid)`                                                            | owner da org ou manager vinculado à unidade                                           |
| `complete_onboarding(text)`                                                        | cria organização, owner, unidade principal e completa perfil atomicamente             |
| `get_my_admin_context()`                                                           | perfil, primeira organização, role e unidades autorizadas                             |
| `create_unit(text)` / `update_unit(uuid,text)`                                     | criação/renomeação exclusiva de owner                                                 |
| `set_unit_active(uuid,boolean)`                                                    | ativação de owner com proteção da última unidade ativa                                |
| `_validate_money(jsonb)` / `_validate_minutes(jsonb)`                              | validadores internos operacionais                                                     |
| `get_unit_operational_config(uuid)` / `save_unit_operational_config(uuid,jsonb)`   | contrato operacional completo                                                         |
| `_validate_catalog_price(text)`                                                    | validador interno de preço do catálogo                                                |
| oito RPCs da Seção 6.4                                                             | leitura e mutações server-authoritative do catálogo                                   |
| `publish_unit_menu(uuid)`                                                          | publicação imutável do cardápio (owner/manager)                                       |
| `get_unit_menu_publication_admin(uuid)`                                            | leitura administrativa da publicação e histórico                                      |
| `get_public_menu(text)`                                                            | cardápio público anônimo via slug (anon)                                              |
| helpers `_is_safe_plain_text`, `_is_unit_open_at` e serializadores `_order_*_json` | validação e respostas minimizadas de pedidos                                          |
| `create_public_order(text,uuid,jsonb)` / `get_public_order(text)`                  | checkout idempotente e tracking público (aceita `loyalty_token` opcional)             |
| quatro RPCs administrativas históricas da Seção 8.5                                | lista v1, detalhe e transições server-authoritative                                   |
| `get_unit_orders_admin_v2(uuid,jsonb)`                                              | filtros server-side e paginação keyset da Central v2                                  |
| `get_kds_orders_minimal(uuid)`                                                      | leitura KDS dedicada, minimizada e limitada a 200                                     |
| RPCs e helpers das Seções 9.7–9.10                                                 | programa, identidade v2, rate limit, conta/extrato, membros e recuperação de checkout |
| `_loyalty_earn_order(orders)` / `_loyalty_reverse_order(orders)`                   | earn/reversal internos do ledger (revogados de navegador)                             |
| RPCs da Seção 10.2                                                                | catálogo, resgate atômico e recovery públicos                                         |
| RPCs da Seção 10.3                                                                | Reward management owner-only e operação staff de vouchers                            |
| `get_org_pilot_readiness(uuid)`                                                    | readiness derivada; owner/manager; nove checks bloqueantes e loyalty opcional         |
| `get_org_members_admin(uuid)`                                                      | membros e vínculos minimizados; owner-only                                            |
| `assign_unit_to_member(uuid,uuid,uuid)` / `remove_unit_from_member(uuid,uuid,uuid)` | gestão transacional owner-only, sem escrita direta do browser             |
| cinco RPCs da Seção 4.7                                                            | convite/aceite de membro `manager`/`operator` por e-mail verificado (PED80–PED90) |
| sete RPCs da Seção 6.7                                                             | grupos e opções de produto server-authoritative                                      |
| `_validate_option_delta_by_kind()` / `_guard_option_group_kind_change()`           | triggers de integridade entre `kind` do grupo e `price_delta` das opções             |
| `_validate_option_delta(text,text)` / `_options_fingerprint(uuid[])`               | validadores internos de `price_delta` e ordenação                                    |

Todas as funções desta tabela, exceto `set_updated_at()`, são `security definer` com
`search_path=''`; `get_my_admin_context`, helpers de acesso e getters são `stable` quando aplicável,
e validadores puros são `immutable`.

As quatro RPCs do Prompt 11 usam `SECURITY DEFINER`, `search_path=''`, grant somente para
`authenticated` entre os papéis de navegador e SQLSTATEs `PED67..PED71`. Readiness não persiste flag
manual: deriva organização, unidades ativas, configuração, horários, pagamentos, catálogo,
publicação, primeiro pedido e loyalty. A implementação aplicada usa `bool_or(lp.enabled)`, não
`max(boolean)`. A migration 19 acrescenta o check `pilot_unit`, impedindo que pré-requisitos
distribuídos entre unidades diferentes resultem em `ready=true`.

`complete_onboarding` serializa pelo usuário. `set_unit_active` serializa a contagem pelo tenant
com `pg_advisory_xact_lock(hashtext('pedon:org:' || organization_id))`, garantindo pelo menos uma
unidade ativa. RPCs de unidade usam o contrato histórico `PED00..PED05`:

| SQLSTATE | Mensagem             |
| -------- | -------------------- |
| `PED00`  | `NOT_AUTHENTICATED`  |
| `PED01`  | `FORBIDDEN`          |
| `PED02`  | `UNIT_NOT_FOUND`     |
| `PED03`  | `UNIT_NAME_REQUIRED` |
| `PED04`  | `LAST_ACTIVE_UNIT`   |
| `PED05`  | `UNIT_NAME_TOO_LONG` |

As RPCs de convite/aceite de membro (migration 24) usam o contrato `PED80`–`PED90`:

| SQLSTATE | Mensagem                 |
| -------- | ------------------------ |
| `PED80`  | `NOT_AUTHENTICATED`      |
| `PED81`  | `FORBIDDEN`              |
| `PED82`  | `EMAIL_REQUIRED`         |
| `PED83`  | `INVALID_ROLE`           |
| `PED84`  | `ALREADY_MEMBER`         |
| `PED85`  | `ALREADY_IN_ORGANIZATION`|
| `PED86`  | `INVITE_NOT_FOUND`       |
| `PED87`  | `INVITE_EXPIRED`         |
| `PED88`  | `INVITE_REVOKED`         |
| `PED89`  | `INVITE_ALREADY_ACCEPTED`|
| `PED90`  | `EMAIL_MISMATCH`         |

## 12. RLS e ACLs

| Tabela                            | SELECT autenticado                                                       | Escrita direta                                             |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `profiles`                        | próprio perfil                                                           | somente `UPDATE(full_name)` no próprio perfil              |
| `organizations`                   | membro do tenant                                                         | sem grant/policy                                           |
| `organization_members`            | membro do tenant                                                         | sem grant/policy                                           |
| `units`                           | `is_org_owner` ou `can_access_unit`                                      | sem grant/policy                                           |
| `membership_units`                | próprio vínculo ou owner                                                 | sem grant/policy                                           |
| três tabelas operacionais         | sem policy seletora; acesso via RPC                                      | sem grant/policy                                           |
| `catalog_categories`              | policy `can_access_unit(unit_id)`                                        | I/U/D revogados                                            |
| `catalog_products`                | policy `can_access_unit(unit_id)`                                        | I/U/D revogados                                            |
| `catalog_product_option_groups`   | policy `can_access_unit(unit_id)`                                        | I/U/D revogados; escrita por RPC                           |
| `catalog_product_options`         | policy `can_access_unit(unit_id)`                                        | I/U/D revogados; escrita por RPC                           |
| `menu_versions`                   | policy `can_access_unit(unit_id)`                                        | sem grant/policy                                           |
| `menu_version_categories`         | policy `can_access_unit(unit_id)`                                        | sem grant/policy                                           |
| `menu_version_products`           | policy `can_access_unit(unit_id)`                                        | sem grant/policy                                           |
| `menu_version_option_groups`      | policy `can_access_unit(unit_id)`                                        | sem grant/policy                                           |
| `menu_version_options`            | policy `can_access_unit(unit_id)`                                        | sem grant/policy                                           |
| `menu_publications`               | policy `can_access_unit(unit_id)`                                        | sem grant/policy                                           |
| `orders`                          | policy `can_access_unit(unit_id)`                                        | I/U/D revogados; escrita por RPC                           |
| `order_items`                     | policy `can_access_unit(unit_id)`                                        | I/U/D revogados; escrita por RPC                           |
| `order_item_options`              | policy `can_access_unit(unit_id)`                                        | I/U/D revogados; escrita por RPC                           |
| `order_events`                    | policy `can_access_unit(unit_id)`                                        | I/U/D revogados; append-only por RPC                       |
| `organization_member_invites`     | policy `is_org_owner(organization_id)` (SELECT)                          | I/U/D sem grant/policy; escrita por RPC (migration 24)     |
| 13 tabelas do Clube (Seções 9 e 10) | sem policy seletora; acesso via RPC `security definer` ou `service_role` | grants de `public`/`anon`/`authenticated` revogados (zero) |

Nas tabelas do catálogo e do cardápio publicado, `SELECT` foi concedido a `authenticated` (e a
`anon` somente nas duas tabelas do catálogo mutável), mas só existe policy `TO authenticated`.
Portanto `anon` pode emitir a consulta e recebe zero linhas; não existe acesso público efetivo
direto. As RPCs do catálogo, a publicação e a leitura administrativa tiveram `EXECUTE`
explicitamente revogado de `PUBLIC` e `anon` e concedido somente a `authenticated`; o helper
`_validate_catalog_price` também é revogado de `authenticated`. `get_public_menu` é a única
superfície pública de leitura do cardápio. As tabelas de pedidos não possuem grants para `anon`;
checkout e tracking públicos passam exclusivamente pelas RPCs minimizadas.

## 13. Produção e validação

Checkpoint Prompt 13 — `BACKEND_OPERATIONAL_CHECKPOINT — ACHIEVED` (Etapa 13.2):

- Prompt 13 `COMPLETED`; Etapa 13.1 `COMPLETED` — `CONTRACT_FREEZE APPROVED_WITH_FINDINGS`;
  Etapa 13.2 `COMPLETED`; Etapas 13.3, 13.4B, 13.5A, 13.5B e 13.6 `COMPLETED` (frontend puro,
  DEC-123, DEC-124 e DEC-125); `OPERATION_READY: ACHIEVED`;
- HEAD técnico `0e171c55afe3a88a699f1ee81b8f937a70659226`; migration 23
  `20260814100000_prompt13_backend_operational_core.sql` (etapas 13.3, 13.4B e 13.5A não introduziram
  nova migration; backend permanece no contrato da Etapa 13.2);
- DB push PASS; Git/filesystem/remoto 23/23/23; post-push dry-run PASS/up to date; linked DB lint
  PASS com zero erros; remote drift `NONE`;
- migration 23 não cria tabela, coluna, policy RLS, publicação Realtime, status/transição de pedido
  nem segunda state machine;
- `NEW-MEDIUM-1: RESOLVED`; a inversão conhecida foi eliminada com ordem unit → produto, mantendo a
  serialização do `sort_order`;
- CI isolado `31859960640` SUCCESS: fresh rebuild 23 migrations, alinhamento, DB lint, 12 suítes DB
  1494/1494, Edge 15/15, Quality gates e E2E smoke tests;
- remote smokes: cobertura limitada, PASS nos casos executados; paginação com massa real não foi
  executada no remoto. Paginação e concorrência permanecem cobertas autoritativamente no CI isolado;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`;
- `LOCAL DB TESTS: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint Prompt 12 — `COMPLETED` / `RELEASE_VERIFIED` / `MENU_COMMERCIALLY_USABLE` (evidência
atual — fechamento final):

- parecer da reauditoria final #2: `PASS_WITH_FINDINGS` / `GO_WITH_NON_BLOCKING_FINDINGS` —
  CRITICAL 0, HIGH 0, MEDIUM BLOCKING 0, MEDIUM NON-BLOCKING 1 (`NEW-MEDIUM-1`), INFO 1;
- HEAD técnico (release funcional) `f663cecb96ef87f397376e29aee82cd24ba846df`; novo HEAD documental
  de fechamento não substitui o SHA técnico;
- CI técnico `31814657987` e CI documental `31823617636` SUCCESS nos três jobs;
- fresh rebuild isolado das 22 migrations, alinhamento e DB lint aprovados;
- suítes DB aprovadas com 1409/1409 PASS, 0 FAIL, 0 SKIP, em 11 suítes; Edge unit 15/15;
- Frontend unit: 383/383 (40 arquivos); E2E smoke tests: 345/345, com 3 skips móveis intencionais;
- migrations Git/filesystem 22/22; remoto 22/22 (último estado verificado); `LIVE SQL RECHECK
  DURING FINAL REAUDIT: UNAVAILABLE` — limitação de credencial/rede, sem evidência de drift;
- seis blockers originais revalidados como RESOLVED (HIGH-1..HIGH-5, MEDIUM BLOCKING-1);
- Cloudflare stable responsiva; `FUNCTIONAL SOURCE HEAD` `f663cec…` ≠ `CLOUDFLARE BUILD SOURCE SHA`
  (docs/current main de cada deploy); deployment id/immutable URL `UNVERIFIED` (INFO);
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint Prompt 12 — `READY_FOR_REAUDIT` (Release Reconvergence, histórico técnico):

- HEAD técnico (release funcional) `f663cecb96ef87f397376e29aee82cd24ba846df`; etapa iniciada em
  `1c1fff0`;
- CI `31814657987`: `Quality gates`, `Backend release gates` e `E2E smoke tests` SUCCESS;
- fresh rebuild isolado das 22 migrations, alinhamento e DB lint aprovados;
- suítes DB aprovadas com 1409/1409 PASS, 0 FAIL, 0 SKIP; Edge unit 15/15;
- Frontend unit: 383/383 (40 arquivos); E2E smoke tests: 345/345, com 3 skips móveis intencionais;
- migrations Git/filesystem 22/22; remoto 22/22 (registrado na etapa B1); checagem remota ao vivo
  não executável nesta máquina na reconvergência (limitação de credencial/conexão), sem evidência de
  drift;
- seis blockers originais revalidados como RESOLVED (HIGH-1..HIGH-5, MEDIUM BLOCKING-1);
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint Prompt 12 — `READY_FOR_REAUDIT` (Etapa 5, histórico técnico):

- HEAD técnico `9139391ca418dc063cdd7366d6b8e447cccacc3a`;
- CI `31787020339`: `Quality gates`, `Backend release gates` e `E2E smoke tests` aprovados;
- fresh rebuild isolado das 21 migrations, alinhamento e DB lint aprovados;
- dez suítes DB aprovadas com baseline 1340/1340 checks (`product_options_integrity` 158/158);
- Frontend unit: 354/354; Edge unit: 15/15; E2E smoke tests: 345/345, com 3 skips móveis
  intencionais; Prompt 12 4B: 20/20;
- migration list local/remota: 21/21; dry-run linked: remote up to date; lint linked sem erros;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint Prompt 11 — `READY_FOR_REAUDIT` (histórico técnico):

- HEAD técnico `925f7d94adea4c0c2cef9a1017270269960817aa`;
- CI `31712486989`: `Quality gates`, `Backend release gates` e `E2E smoke tests` aprovados;
- fresh rebuild isolado das 19 migrations, alinhamento e DB lint aprovados;
- nove suítes DB aprovadas com baseline 1182/1182 checks;
- `pilot_readiness_team_integrity.test.mjs`: 84/84;
- Edge unit: 15/15; E2E smoke tests: 236/236;
- migration list local/remota: 19/19; dry-run linked: remote up to date; lint linked sem erros;
- Cloudflare check/deployment `82dedad7-c36e-4ddf-af8a-8d48176b9b0a` aprovado;
- URLs aprovadas: `https://82dedad7.ped-on.pages.dev` e `https://ped-on.pages.dev`, com fallback
  SPA e SHA técnico confirmados;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint Prompt 11 — `RELEASE_VERIFIED` (evidência final da reauditoria independente):

- HEAD auditado: `3a6cd42eab24719e01505fc854d03c65ca9d9975`;
- CI `31713901328`: `Quality gates`, `Backend release gates` e `E2E smoke tests` SUCCESS;
- Cloudflare imutável `https://8f7d42fd.ped-on.pages.dev` e estável `https://ped-on.pages.dev`;
- resultado: `GO_WITH_NON_BLOCKING_FINDINGS` — CRITICAL 0, HIGH 0, MEDIUM BLOCKING 0; LOW 4, INFO 1;
- test baseline: Frontend 274/274; E2E 236/236; Prompt 11 44/44; DB 1182/1182; readiness 84/84;
  Edge 15/15; DB lint PASS; CI isolated rebuild PASS; migrations 19/19;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint do Prompt 10 (`RELEASE_VERIFIED`):

- migrations do Prompt 10 versionadas até `20260812090000_prompt10_final_integrity_hardening.sql`;
  **17 migrations no release esperado**;
- `supabase db lint --linked`: sem erros;
- loyalty `loyalty_integrity.test.mjs` **148/148 PASS** cobrindo identidade CPF + telefone,
  consentimento, token repetível/consumido, disable explícito, rate limit opaco, extrato público,
  checkout v2/recovery, ledger, owner-only e ACL/RLS;
- rewards/vouchers `loyalty_rewards_integrity.test.mjs` **254/254 PASS** cobrindo ACL/RLS, RBAC,
  idempotência, concorrência, saldo/estoque, recovery, vouchers e ausência de DELETE;
- Edge unit **15/15 PASS** e remote smoke **36/36 PASS** contra `loyalty-cpf` deployada com
  `verify_jwt` ativo;
- DB isolado **22/22**, **32/32**, **80/80**, **123/123**, **121/121**, **318/318**, **148/148** e
  **254/254**; Edge unit **15/15** e db lint local sem erros;
- CI `31598675826` (Quality gates, Backend release gates e E2E smoke tests) e Cloudflare deployment
  `ceaf4832-bc0e-4159-a983-fd5ca367efd8`, source `2a91711`, aprovados.

Checkpoint histórico do Prompt 08, supersedido pelo estado cumulativo atual de 23 migrations:

- migrations `20260810144145_orders_checkout.sql` e
  `20260810162508_orders_checkout_lint_hardening.sql` aplicadas oficialmente naquele checkpoint;
- `supabase db lint --linked`: sem erros;
- banco: pedidos 318/318, publicação 121/121, catálogo 123/123, operacional 80/80, RBAC 31/31 e RLS
  22/22 PASS;
- testes cobrem grants, RLS, direct writes, cross-unit/cross-tenant, FKs compostas, preço decimal,
  flags independentes, atomicidade e concorrência de `sort_order`, menu vazio, snapshot imutável,
  slug estável/opaco, overlay de disponibilidade, checkout estrito, snapshots de pedidos,
  idempotência/replay, máquinas de estado, PII minimizada, Realtime e concorrência;
- cleanup automático remove organizações e usuários sintéticos, sem dados residuais esperados.

## 14. Fora do escopo atual

Imagens, expiração/cancelamento de vouchers, gateway, pagamento online e logística avançada não
fazem parte deste schema. Reward DELETE também não é pendência: é `NOT SUPPORTED BY DESIGN`.
