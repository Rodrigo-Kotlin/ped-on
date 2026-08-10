# PED-ON — RLS Security

> Modelo de segurança Supabase/PostgreSQL após o Prompt 07. O frontend usa apenas a publishable
> key; `service_role` nunca é exposta. RLS nega por padrão e toda autorização de catálogo e
> cardápio é vinculada à unidade.

## 1. Princípios

- RLS está habilitado nas quatorze tabelas `public` atuais.
- `organization_id` delimita o tenant; `unit_id` delimita o acesso operacional.
- Owner acessa todas as unidades da própria organização. Manager/operator dependem de vínculo em
  `membership_units`.
- Policies controlam leitura; mutações de tenant, unidade, configuração, catálogo e publicação
  ocorrem por RPCs `security definer`, não por escrita direta.
- Funções de autorização e RPCs `security definer` usam `set search_path = ''` para impedir
  hijacking de schema.
- IDs recebidos do cliente nunca são suficientes: RPCs resolvem organização/unidade no servidor e
  verificam `can_access_unit` ou `can_manage_unit`.
- Catálogo administrativo mutável não é cardápio publicado. Leitura pública do cardápio ocorre
  exclusivamente via `get_public_menu` (snapshot imutável + overlay de disponibilidade); `anon` não
  lê nenhuma tabela diretamente.

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
| `menu_versions` | ON | `menu_versions_select_unit_access` | authenticated com `can_access_unit(unit_id)` |
| `menu_version_categories` | ON | `menu_version_categories_select_unit_access` | authenticated com `can_access_unit(unit_id)` |
| `menu_version_products` | ON | `menu_version_products_select_unit_access` | authenticated com `can_access_unit(unit_id)` |
| `menu_publications` | ON | `menu_publications_select_unit_access` | authenticated com `can_access_unit(unit_id)` |

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

## 4. Matriz RBAC do catálogo e publicação

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
| Publicar cardápio (`publish_unit_menu`) | Sim | Sim | Não |
| Ler publicação/histórico (`get_unit_menu_publication_admin`) | Sim | Sim | Sim |

`is_active` é estrutural; `is_available` é operacional. Desativar categoria não altera produtos e
desativar produto não altera disponibilidade. Operator não acessa nenhuma RPC estrutural nem a
publicação.

## 5. Grants e superfície SQL

### 5.1 Tabelas

- `authenticated` possui `SELECT` nas tabelas de identidade/tenant/unidade e catálogo conforme as
  policies; `profiles` concede também `UPDATE(full_name)`.
- As três tabelas operacionais não têm policy de leitura nem grants diretos para o cliente; getters
  e saves passam pelas RPCs.
- O catálogo e as quatro tabelas de cardápio executam `REVOKE ALL` de `PUBLIC`, `anon` e
  `authenticated`, depois concedem somente `SELECT` (a `authenticated`; a `anon` também no caso das
  duas tabelas do catálogo mutável). Assim, I/U/D permanecem revogados.
- `anon` tem privilégio SQL de `SELECT` em `catalog_categories` e `catalog_products`, mas não é alvo
  de nenhuma policy. O resultado é sempre zero linhas, não publicação pública. As tabelas de menu
  não concedem `SELECT` ao `anon` de forma alguma.
- `get_public_menu(text)` é a única leitura anônima efetiva do cardápio.

### 5.2 Funções

RPCs de catálogo, publicação e leitura administrativa têm `EXECUTE` apenas para `authenticated`:

- oito RPCs do catálogo (Seção 6.4 do schema);
- `publish_unit_menu(uuid)`;
- `get_unit_menu_publication_admin(uuid)`.

`get_public_menu(text)` tem `EXECUTE` para `anon` e `authenticated`.

`PUBLIC` e `anon` foram explicitamente revogados das funções administrativas. O helper
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

### 6.4 Cardápio publicado

- Publicação exige `can_manage_unit` (owner/manager); operator não publica.
- O snapshot é capturado sob advisory locks do catálogo e da publicação, garantindo coerência e
  ausência de `version_number` duplicado.
- O snapshot é imutável por construção: sem policies de escrita e sem grants de I/U/D em nenhuma
  das quatro tabelas; nenhuma coluna é alterada depois da criação.
- O slug público é opaco (24 hex) e estável; nunca expõe `unit_id`, `menu_version_id` ou IDs do
  catálogo.

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
| Anon consulta tabelas de menu/publicação | sem grant de SELECT: `42501` |
| Anon chama RPC de catálogo/publicação | `EXECUTE` revogado: `42501` |
| Anon tenta ler cardápio sem slug | `get_public_menu` retorna `found=false` |
| Authenticated tenta I/U/D direto | grants revogados/ausência de policy: bloqueado |
| Corrida calcula mesma ordem | advisory lock por unidade/categoria e ordem server-side |
| Publicações concorrentes | locks `pedon:menu:publish:<unit>` serializam e preservam o slug |
| Escrita direta no snapshot | sem policy/grant: bloqueado; imutabilidade é estrutural |

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
| `PED31` | menu vazio não pode ser publicado |
| `PED32` | conflito raro de slug público |

Configuração operacional usa `PED10..PED18`; RPCs históricas de unidade usam `PED00..PED05`.
`get_public_menu` nunca lança erro (retorna `found=false`). Detalhes completos estão em
`PEDON_DATABASE_SCHEMA.md`.

## 9. Testes executados

Os cinco scripts em `supabase/tests/` usam conexão direta ao PostgreSQL oficial, criam usuários e
organizações sintéticos, simulam `authenticated`/`anon` e executam cleanup automático:

| Script | Resultado oficial | Cobertura principal |
|---|---:|---|
| `rls_integrity.test.mjs` | 22/22 | identidade, onboarding, isolamento e escrita direta |
| `rbac_units_integrity.test.mjs` | 31/31 | owner/manager/operator, vínculos, FKs e concorrência |
| `unit_operational_config_integrity.test.mjs` | 80/80 | grants, RBAC, validações, aceite e atomicidade |
| `catalog_integrity.test.mjs` | 123/123 | RLS/ACL, matriz RBAC, IDOR, FKs, flags, preço e locks |
| `menu_publication_integrity.test.mjs` | 121/121 | publicação, imutabilidade, slug, overlay, API pública e isolamento |

O cardápio valida expressamente: menu vazio (`PED31`), grants e RLS das quatro tabelas, escrita
direta bloqueada no snapshot, snapshot congelado após mutações do catálogo, numeração crescente,
slug estável/opaco e único, republicação preservando histórico, API pública sem sessão,
disponibilidade em overlay (inclusive fonte deletada), unidade inativa, isolamento entre
organizações, publicações concorrentes e ausência de vazamento entre unidades. `supabase db lint
--linked` passou sem erros.

Os scripts devem rodar sequencialmente. O teste RBAC herdado verifica uma contagem global de
`membership_units` durante um cenário e é frágil se outra suíte inserir vínculos em paralelo.

## 10. Regras de manutenção

- Não adicionar policy/grant de escrita direta sem decisão registrada e testes de regressão.
- Toda nova tabela por unidade deve carregar e validar o escopo; preferir FK composta quando houver
  referência entre entidades escopadas.
- Não transformar `SELECT` concedido ao `anon` nas tabelas mutáveis em policy pública. Publicação de
  cardápio e leitura pública devem usar o modelo imutável do Prompt 07.
- Alterações de autorização exigem execução sequencial dos cinco testes DB e
  `supabase db lint --linked`.
- Nunca usar pooler de sessão nos testes que fazem `SET ROLE`/claims; usar conexão direta conforme
  DEC-044.
