# PED-ON — RLS Security

> Modelo de segurança Supabase/PostgreSQL após o Prompt 06. O frontend usa apenas a publishable
> key; `service_role` nunca é exposta. RLS nega por padrão e toda autorização de catálogo é
> vinculada à unidade.

## 1. Princípios

- RLS está habilitado nas dez tabelas `public` atuais.
- `organization_id` delimita o tenant; `unit_id` delimita o acesso operacional.
- Owner acessa todas as unidades da própria organização. Manager/operator dependem de vínculo em
  `membership_units`.
- Policies controlam leitura; mutações de tenant, unidade, configuração e catálogo ocorrem por RPCs
  `security definer`, não por escrita direta.
- Funções de autorização e RPCs `security definer` usam `set search_path = ''` para impedir
  hijacking de schema.
- IDs recebidos do cliente nunca são suficientes: RPCs resolvem organização/unidade no servidor e
  verificam `can_access_unit` ou `can_manage_unit`.
- Catálogo administrativo mutável não é cardápio publicado. Não existe leitura pública efetiva no
  Prompt 06.

## 2. RLS por tabela

| Tabela | RLS | Policy atual | Semântica |
|---|---|---|---|
| `profiles` | ON | `profiles_select_own` | `auth.uid() = id` |
| `profiles` | ON | `profiles_update_own` | próprio perfil; grant somente em `full_name` |
| `organizations` | ON | `organizations_select_member` | `is_org_member(id)` |
| `organization_members` | ON | `organization_members_select_same_org` | `is_org_member(organization_id)` |
| `units` | ON | `units_select_authorized` | owner da org ou `can_access_unit(id)` |
| `membership_units` | ON | `membership_units_select_own_access` | vínculo próprio ou owner da org |
| `unit_operational_settings` | ON | nenhuma | acesso exclusivamente via RPC operacional |
| `unit_business_hours` | ON | nenhuma | acesso exclusivamente via RPC operacional |
| `unit_payment_methods` | ON | nenhuma | acesso exclusivamente via RPC operacional |
| `catalog_categories` | ON | `catalog_categories_select_unit_access` | authenticated com `can_access_unit(unit_id)` |
| `catalog_products` | ON | `catalog_products_select_unit_access` | authenticated com `can_access_unit(unit_id)` |

Não há policies `INSERT` ou `DELETE` para clientes. Fora do `UPDATE(full_name)` de `profiles`, não há
policy/grant de update direto para `authenticated`.

## 3. Helpers de autorização

| Helper | Resultado |
|---|---|
| `is_org_member(organization_id)` | usuário atual pertence à organização |
| `is_org_owner(organization_id)` | usuário atual é owner da organização |
| `can_access_unit(unit_id)` | owner da organização da unidade ou vínculo próprio em `membership_units` |
| `can_manage_unit(unit_id)` | owner da organização ou manager vinculado à unidade |

Todos são `stable security definer set search_path=''`. O uso de `security definer` permite
consultar tabelas protegidas sem recursão de policy; o resultado continua derivado de `auth.uid()`.

## 4. Matriz RBAC do catálogo

Toda célula positiva abaixo ainda exige acesso à unidade correta. Não existe autorização global por
role sem escopo.

| Ação | Owner | Manager vinculado | Operator vinculado |
|---|---:|---:|---:|
| SELECT do catálogo | Sim | Sim | Sim |
| Criar/editar categoria | Sim | Sim | Não |
| Alterar `category.is_active` | Sim | Sim | Não |
| Criar/editar/mover produto | Sim | Sim | Não |
| Alterar `product.is_active` | Sim | Sim | Não |
| Alterar `product.is_available` | Sim | Sim | Sim |

`is_active` é estrutural; `is_available` é operacional. Desativar categoria não altera produtos e
desativar produto não altera disponibilidade. Operator não acessa nenhuma RPC estrutural.

## 5. Grants e superfície SQL

### 5.1 Tabelas

- `authenticated` possui `SELECT` nas tabelas de identidade/tenant/unidade e catálogo conforme as
  policies; `profiles` concede também `UPDATE(full_name)`.
- As três tabelas operacionais não têm policy de leitura nem grants diretos para o cliente; getters
  e saves passam pelas RPCs.
- O catálogo executa `REVOKE ALL` de `PUBLIC`, `anon` e `authenticated`, depois concede somente
  `SELECT` a `authenticated` e `anon`. Assim, I/U/D permanecem revogados.
- `anon` tem privilégio SQL de `SELECT` em `catalog_categories` e `catalog_products`, mas não é alvo
  de nenhuma policy. O resultado é sempre zero linhas, não publicação pública.

### 5.2 Funções

As oito RPCs do catálogo têm `EXECUTE` apenas para `authenticated`:

- `get_unit_catalog_admin(uuid)`;
- `create_catalog_category(uuid,text)`;
- `update_catalog_category(uuid,text)`;
- `set_catalog_category_active(uuid,boolean)`;
- `create_catalog_product(uuid,uuid,text,text,text)`;
- `update_catalog_product(uuid,uuid,text,text,text)`;
- `set_catalog_product_active(uuid,boolean)`;
- `set_catalog_product_available(uuid,boolean)`.

`PUBLIC` e `anon` foram explicitamente revogados dessas funções. O helper
`_validate_catalog_price(text)` não possui `EXECUTE` para `PUBLIC`, `anon` ou `authenticated`.

As RPCs históricas de onboarding, unidade e configuração mantêm seus grants versionados. Helpers
internos `_validate_money`, `_validate_minutes` e `_validate_catalog_price` não são uma API de
cliente.

## 6. Escrita server-authoritative

### 6.1 Identidade, tenant e unidade

- `handle_new_user()` cria profile após `auth.users`.
- `complete_onboarding(text)` cria organização, owner e unidade em uma transação serializada.
- `create_unit`, `update_unit` e `set_unit_active` são exclusivas de owner; a última unidade ativa é
  protegida por advisory lock por organização.
- Gestão de `membership_units` continua sem UI/policy de escrita e permanece administrativa.

### 6.2 Configuração operacional

`get_unit_operational_config` e `save_unit_operational_config` exigem `can_manage_unit`: owner ou
manager vinculado. Operator não lê nem salva a configuração operacional. O save serializa por
unidade, valida o payload completo e aplica regras server-authoritative para
`accepting_orders=true`.

### 6.3 Catálogo

- Organização e `sort_order` não são argumentos de criação; são derivados/calculados no servidor.
- Categorias são criadas/alteradas somente via RPC por `can_manage_unit`.
- Produtos são criados/alterados somente via RPC por `can_manage_unit`; categoria alvo deve ter o
  mesmo `(organization_id,unit_id)`.
- Disponibilidade usa `can_access_unit`, permitindo operator vinculado sem liberar outras colunas.
- Não existe RPC de hard delete. `DELETE` direto não é concedido.

## 7. Isolamento e integridade anti-IDOR

| Vetor | Defesa |
|---|---|
| Owner tenta unidade de outro tenant | `can_access_unit`/`can_manage_unit` falham com `PED11` |
| Manager/operator tenta unidade sem vínculo | `membership_units` ausente; `PED11` ou zero linhas |
| Cliente troca `organization_id` | RPCs de criação não recebem organização; servidor deriva da unidade |
| Cliente usa categoria de outra unidade/org | lookup composto + `PED29`; FK composta também rejeita |
| Produto persistido aponta para categoria cross-tenant | FK `(organization_id,unit_id,category_id)` |
| Vínculo de usuário aponta para unidade cross-org | FK `(organization_id,unit_id)` em `membership_units` |
| Query direta authenticated busca outro escopo | policy `can_access_unit(unit_id)` filtra a linha |
| Anon consulta tabelas do catálogo | SELECT permitido, mas sem policy: zero linhas |
| Anon chama RPC de catálogo | `EXECUTE` revogado: `42501` |
| Authenticated tenta I/U/D direto | grants revogados/ausência de policy: bloqueado |
| Corrida calcula mesma ordem | advisory lock por unidade/categoria e ordem server-side |

As FKs compostas são defesa de integridade adicional, não substituto da autorização. As RPCs
verificam autorização antes da mutação e restringem updates por tenant/unidade já resolvidos.

## 8. Contratos de erro relevantes

Catálogo reutiliza:

| Código | Significado |
|---|---|
| `PED10` | não autenticado |
| `PED11` | sem acesso/gestão da unidade |
| `PED12` | unidade inexistente |
| `PED20..PED23` | categoria ausente/nome inválido/conflito |
| `PED24..PED28` | produto ausente/campos ou preço inválidos |
| `PED29` | categoria não pertence à unidade/organização |
| `PED30` | flag booleana inválida |

Configuração operacional usa `PED10..PED18`; RPCs históricas de unidade usam `PED00..PED05`.
Detalhes completos estão em `PEDON_DATABASE_SCHEMA.md`.

## 9. Testes executados

Os quatro scripts em `supabase/tests/` usam conexão direta ao PostgreSQL oficial, criam usuários e
organizações sintéticos, simulam `authenticated`/`anon` e executam cleanup automático:

| Script | Resultado oficial | Cobertura principal |
|---|---:|---|
| `rls_integrity.test.mjs` | 22/22 | identidade, onboarding, isolamento e escrita direta |
| `rbac_units_integrity.test.mjs` | 31/31 | owner/manager/operator, vínculos, FKs e concorrência |
| `unit_operational_config_integrity.test.mjs` | 80/80 | grants, RBAC, validações, aceite e atomicidade |
| `catalog_integrity.test.mjs` | 123/123 | RLS/ACL, matriz RBAC, IDOR, FKs, flags, preço e locks |

O catálogo valida expressamente: anon zero linhas e sem RPC; authenticated sem identidade;
cross-unit/cross-tenant; I/U/D diretos; FKs compostas; roles; estados independentes; ausência de
hard delete; grants; preço textual exato; ordenação e oito criações concorrentes. `supabase db lint
--linked` passou sem erros.

Os scripts devem rodar sequencialmente. O teste RBAC herdado verifica uma contagem global de
`membership_units` durante um cenário e é frágil se outra suíte inserir vínculos em paralelo.

## 10. Regras de manutenção

- Não adicionar policy/grant de escrita direta sem decisão registrada e testes de regressão.
- Toda nova tabela por unidade deve carregar e validar o escopo; preferir FK composta quando houver
  referência entre entidades escopadas.
- Não transformar `SELECT` concedido ao `anon` nas tabelas mutáveis em policy pública. Publicação de
  cardápio deve usar o modelo imutável próprio do Prompt 07.
- Alterações de autorização exigem execução sequencial dos quatro testes DB e
  `supabase db lint --linked`.
- Nunca usar pooler de sessão nos testes que fazem `SET ROLE`/claims; usar conexão direta conforme
  DEC-044.
