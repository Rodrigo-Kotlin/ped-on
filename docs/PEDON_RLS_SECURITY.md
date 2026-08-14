# PED-ON — RLS Security

> Modelo de segurança Supabase/PostgreSQL da Fase 4A, Prompt 12, checkpoint
> `READY_FOR_REAUDIT`. O frontend usa apenas a publishable key; `service_role` nunca é exposta. RLS
> nega por padrão e o Clube usa superfícies públicas minimizadas e RPCs internas restritas.

## 1. Princípios

- RLS está habilitado nas 35 tabelas `public` atuais.
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
- Checkout e tracking públicos passam exclusivamente por `create_public_order`/`create_public_order_v2`,
  `get_public_order` e `get_public_order_by_attempt`; respostas anônimas não expõem PII, endereço,
  IDs internos ou idempotência.
- Identidade do Clube v2 exige CPF + telefone; o PostgreSQL recebe somente fingerprints HMAC
  tenant-bound, e desconhecido/telefone divergente são indistinguíveis no contrato HTTP.
- As 13 tabelas do Clube não possuem grants de navegador. Edge identity/rate limit usam RPCs
  internas `service_role`; conta/extrato e checkout usam RPCs públicas minimizadas.
- `LOYALTY_CPF_HMAC_KEY` é Supabase Edge Secret de ambiente, não Vault, e nunca entra em variável
  `VITE_*`.

## 2. RLS por tabela

| Tabela                      | RLS | Policy atual                                 | Semântica                                          |
| --------------------------- | --- | -------------------------------------------- | -------------------------------------------------- |
| `profiles`                  | ON  | `profiles_select_own`                        | `auth.uid() = id`                                  |
| `profiles`                  | ON  | `profiles_update_own`                        | próprio perfil; grant somente em `full_name`       |
| `organizations`             | ON  | `organizations_select_member`                | `is_org_member(id)`                                |
| `organization_members`      | ON  | `organization_members_select_same_org`       | `is_org_member(organization_id)`                   |
| `units`                     | ON  | `units_select_authorized`                    | owner da org ou `can_access_unit(id)`              |
| `membership_units`          | ON  | `membership_units_select_own_access`         | vínculo próprio ou owner da org                    |
| `unit_operational_settings` | ON  | nenhuma                                      | acesso exclusivamente via RPC operacional          |
| `unit_business_hours`       | ON  | nenhuma                                      | acesso exclusivamente via RPC operacional          |
| `unit_payment_methods`      | ON  | nenhuma                                      | acesso exclusivamente via RPC operacional          |
| `catalog_categories`        | ON  | `catalog_categories_select_unit_access`      | authenticated com `can_access_unit(unit_id)`       |
| `catalog_products`          | ON  | `catalog_products_select_unit_access`        | authenticated com `can_access_unit(unit_id)`       |
| `catalog_product_option_groups` | ON | `catalog_product_option_groups_select_unit_access` | authenticated com `can_access_unit(unit_id)` |
| `catalog_product_options`   | ON  | `catalog_product_options_select_unit_access` | authenticated com `can_access_unit(unit_id)`       |
| `menu_versions`             | ON  | `menu_versions_select_unit_access`           | authenticated com `can_access_unit(unit_id)`       |
| `menu_version_categories`   | ON  | `menu_version_categories_select_unit_access` | authenticated com `can_access_unit(unit_id)`       |
| `menu_version_products`     | ON  | `menu_version_products_select_unit_access`   | authenticated com `can_access_unit(unit_id)`       |
| `menu_version_option_groups` | ON | `menu_version_option_groups_select_unit_access` | authenticated com `can_access_unit(unit_id)`    |
| `menu_version_options`      | ON  | `menu_version_options_select_unit_access`    | authenticated com `can_access_unit(unit_id)`       |
| `menu_publications`         | ON  | `menu_publications_select_unit_access`       | authenticated com `can_access_unit(unit_id)`       |
| `orders`                    | ON  | `orders_select_unit_access`                  | authenticated com `can_access_unit(unit_id)`       |
| `order_items`               | ON  | `order_items_select_unit_access`             | authenticated com `can_access_unit(unit_id)`       |
| `order_item_options`        | ON  | `order_item_options_select_unit_access`      | authenticated com `can_access_unit(unit_id)`       |
| `order_events`              | ON  | `order_events_select_unit_access`            | authenticated com `can_access_unit(unit_id)`       |
| `loyalty_programs`          | ON  | nenhuma                                      | acesso somente por RPC                             |
| `customers`                 | ON  | nenhuma                                      | acesso somente por RPC interna/admin minimizada    |
| `loyalty_memberships`       | ON  | nenhuma                                      | acesso somente por RPC interna/admin minimizada    |
| `loyalty_consent_events`    | ON  | nenhuma                                      | evidência append-only interna                      |
| `loyalty_accounts`          | ON  | nenhuma                                      | acesso somente por RPC                             |
| `loyalty_ledger`            | ON  | nenhuma                                      | append-only interno; leitura por serializadores    |
| `loyalty_access_tokens`     | ON  | nenhuma                                      | hash acessado somente por RPC                      |
| `loyalty_rate_limits`       | ON  | nenhuma                                      | contador opaco acessado somente por `service_role` |
| `loyalty_rewards`           | ON  | nenhuma                                      | acesso somente por RPC                             |
| `loyalty_redemptions`       | ON  | nenhuma                                      | resgate imutável via RPC pública                   |
| `loyalty_vouchers`          | ON  | nenhuma                                      | emissão/consumo somente por RPC                    |
| `loyalty_reward_stock_events` | ON | nenhuma                                     | auditoria append-only interna                      |
| `loyalty_voucher_events`    | ON  | nenhuma                                      | auditoria append-only interna                      |

Não há policies `INSERT` ou `DELETE` para clientes. Fora do `UPDATE(full_name)` de `profiles`, não há
policy/grant de update direto para `authenticated`.

## 3. Helpers de autorização

| Helper                           | Resultado                                                                |
| -------------------------------- | ------------------------------------------------------------------------ |
| `is_org_member(organization_id)` | usuário atual pertence à organização                                     |
| `is_org_owner(organization_id)`  | usuário atual é owner da organização                                     |
| `can_access_unit(unit_id)`       | owner da organização da unidade ou vínculo próprio em `membership_units` |
| `can_manage_unit(unit_id)`       | owner da organização ou manager vinculado à unidade                      |

Todos são `stable security definer set search_path=''`. O uso de `security definer` permite
consultar tabelas protegidas sem recursão de policy; o resultado continua derivado de `auth.uid()`.

## 4. Matriz RBAC de catálogo, publicação e pedidos

Toda célula positiva abaixo ainda exige acesso à unidade correta. Não existe autorização global por
role sem escopo.

| Ação                                                         | Owner | Manager vinculado | Operator vinculado |
| ------------------------------------------------------------ | ----: | ----------------: | -----------------: |
| SELECT do catálogo                                           |   Sim |               Sim |                Sim |
| Criar/editar categoria                                       |   Sim |               Sim |                Não |
| Alterar `category.is_active`                                 |   Sim |               Sim |                Não |
| Criar/editar/mover produto                                   |   Sim |               Sim |                Não |
| Alterar `product.is_active`                                  |   Sim |               Sim |                Não |
| Alterar `product.is_available`                               |   Sim |               Sim |                Sim |
| Criar/editar/desativar grupo ou opção                        |   Sim |               Sim |                Não |
| Alterar `option.is_available`                                |   Sim |               Sim |                Sim |
| Publicar cardápio (`publish_unit_menu`)                      |   Sim |               Sim |                Não |
| Ler publicação/histórico (`get_unit_menu_publication_admin`) |   Sim |               Sim |                Sim |
| Ler Central e detalhe de pedidos                             |   Sim |               Sim |                Sim |
| Alterar status do pedido                                     |   Sim |               Sim |                Sim |
| Registrar `pending → paid`                                   |   Sim |               Sim |                Sim |
| Registrar `paid → refunded`                                  |   Sim |               Sim |                Não |
| Ler programa/métricas/membros do Clube                       |   Sim |               Não |                Não |
| Ativar/desativar o Clube                                     |   Sim |               Não |                Não |
| Gerenciar rewards e estoque                                  |   Sim |               Não |                Não |
| Consultar/consumir voucher na unidade                        |   Sim |               Sim |                Sim |
| Consultar readiness da organização                            |   Sim |               Sim |                Não |
| Listar equipe e vínculos                                      |   Sim |               Não |                Não |
| Atribuir/remover acesso por unidade                           |   Sim |               Não |                Não |
| Acessar `/app/equipe` e `/app/diagnostico`                    |   Sim |               Não |                Não |

`is_active` é estrutural; `is_available` é operacional. Desativar categoria não altera produtos e
desativar produto não altera disponibilidade. Operator não acessa nenhuma RPC estrutural nem a
publicação.

## 5. Grants e superfície SQL

### 5.1 Tabelas

- `authenticated` possui `SELECT` nas tabelas de identidade/tenant/unidade e catálogo conforme as
  policies; `profiles` concede também `UPDATE(full_name)`.
- As três tabelas operacionais não têm policy de leitura nem grants diretos para o cliente; getters
  e saves passam pelas RPCs.
- As quatro tabelas do catálogo e as seis tabelas de cardápio executam `REVOKE ALL` de `PUBLIC`,
  `anon` e `authenticated`, depois concedem somente `SELECT` a `authenticated`; `anon` recebe o
  privilégio apenas nas duas tabelas-base do catálogo mutável, sem policy. I/U/D permanecem revogados.
- `anon` tem privilégio SQL de `SELECT` em `catalog_categories` e `catalog_products`, mas não é alvo
  de nenhuma policy. O resultado é sempre zero linhas, não publicação pública. As tabelas de menu
  não concedem `SELECT` ao `anon` de forma alguma.
- `get_public_menu(text)` é a única leitura anônima efetiva do cardápio.
- As quatro tabelas de pedidos concedem `SELECT` somente a `authenticated`, filtrado por
  `can_access_unit`; `anon` não possui acesso direto e nenhum papel cliente recebe I/U/D.
- As 13 tabelas do Clube executam `REVOKE ALL` de `PUBLIC`, `anon` e `authenticated`; não há
  leitura nem escrita direta efetiva por navegador. Isso inclui `loyalty_rate_limits`, que contém
  somente escopo HMAC opaco e metadados de janela.

### 5.2 Funções

RPCs de catálogo, publicação e leitura administrativa têm `EXECUTE` apenas para `authenticated`:

- oito RPCs do catálogo-base (Seção 6.4 do schema) e sete RPCs de grupos/opções (Seção 6.7);
- `publish_unit_menu(uuid)`;
- `get_unit_menu_publication_admin(uuid)`.

`get_public_menu(text)` tem `EXECUTE` para `anon` e `authenticated`.

`create_public_order(text,uuid,jsonb)`, `get_public_order(text)`,
`create_public_order_v2(text,uuid,jsonb,text)` e
`get_public_order_by_attempt(text,uuid,text)` têm `EXECUTE` para `anon`/`authenticated` e retornos
minimizados. As quatro RPCs administrativas de pedidos têm `EXECUTE` apenas para `authenticated`;
helpers internos de pedidos são revogados de todos os papéis cliente.
`get_public_loyalty_account(text)` é a única leitura pública de conta/extrato.
`get_loyalty_program_admin`, `set_loyalty_program_enabled` e `get_loyalty_members_admin` exigem
`authenticated` e validam `is_org_owner` no servidor. `get_loyalty_public_context_internal`,
`resolve_loyalty_identity_internal_v2` e `consume_loyalty_rate_limit_internal` têm execute somente
para `service_role`; o resolver de identidade legado não possui mais esse grant.

`get_public_loyalty_rewards`, `redeem_public_loyalty_reward` e
`get_public_redemption_by_attempt` têm `EXECUTE` para `anon`/`authenticated` e retornos públicos
minimizados. As cinco RPCs de Reward management têm `EXECUTE` apenas para `authenticated` e validam
`is_org_owner`; não existe RPC de DELETE. `get_loyalty_voucher_staff` e
`consume_loyalty_voucher` também exigem `authenticated` e validam `can_access_unit` em unidade ativa.

As RPCs `get_org_pilot_readiness`, `get_org_members_admin`, `assign_unit_to_member` e
`remove_unit_from_member` têm `EXECUTE` somente para `authenticated` entre os papéis de navegador;
`PUBLIC`/`anon` estão revogados. Todas validam tenant/role no servidor, usam `SECURITY DEFINER` e
`search_path=''`. Atribuição rejeita membro externo, unidade de outro tenant, inexistente ou inativa.

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
- Gestão de `membership_units` possui UI owner-only em `/app/equipe` e RPCs dedicadas; continua sem
  policy/grant de escrita direta para o navegador.

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
- O snapshot é capturado sob advisory locks do catálogo e da publicação. Writers de grupos/opções
  participam do mesmo lock por produto, evitando mistura entre estados estruturais.
- O snapshot é imutável por construção: sem policies de escrita e sem grants de I/U/D em nenhuma
  das cinco tabelas `menu_version_*`; nenhuma coluna é alterada depois da criação.
- O slug público é opaco (24 hex) e estável; nunca expõe `unit_id`, `menu_version_id` ou IDs do
  catálogo.

### 6.5 Pedidos

- `create_public_order` deriva tenant/unidade/versão pelo slug, rejeita campos autoritativos do
  cliente e recalcula itens, taxas e totais no PostgreSQL.
- Idempotência é única por `(unit_id,idempotency_key)` e serializada; replay com hash diferente é
  rejeitado, e o token público de tracking tem 32 hex gerados no servidor.
- `get_public_order` devolve somente o contrato público minimizado. PII completa fica disponível
  apenas no detalhe administrativo protegido por `can_access_unit`.
- Tracking público não inclui a nota livre de item; ela permanece apenas no detalhe administrativo.
- O carrinho persistido contém somente dados públicos e omite `note`. Observações de item ficam em
  memória até o checkout; cargas posteriores saneiam ou removem registros legados de todos os slugs.
- Antes de gravar `order_item_options`, o checkout bloqueia a opção mutável disponível; toggle/delete
  concorrente espera o pedido ou vence antes e causa `PED75`, sem pedido parcial.
- Recuperação por tentativa exige slug + UUID de idempotência + hash de 64 hex e devolve a mesma
  resposta pública de criação ou `found=false`, sem PII/IDs internos.
- Lista, detalhe e transições administrativas validam sessão e acesso à unidade. Refund exige
  `can_manage_unit`; operator não possui esse privilégio.
- `order_events` é append-only por ACL: nenhum papel cliente recebe insert/update/delete.
- Realtime publica somente `id`, `unit_id`, `updated_at`, `status` e `payment_status`; o cliente
  invalida/refaz a fonte autoritativa em vez de confiar no payload websocket.

### 6.6 Clube Ped-On

- A Edge calcula HMAC tenant-bound separado para CPF e telefone; os valores brutos não chegam ao
  PostgreSQL, não são retornados e não devem entrar em logs.
- Lookup de identidade inexistente e telefone incorreto recebem o mesmo HTTP 422
  `IDENTITY_NOT_CONFIRMED`, impedindo enumeração.
- `enroll` exige `consent === true` antes da RPC, mantém o estado atual na membership e registra cada
  evidência em `loyalty_consent_events` append-only com versão `pedon-clube-v1`.
- Rate limit fixed-window é persistente e atômico, chaveado por HMAC(IP confiável + slug canônico +
  mode): lookup 10/60s, enroll 5/60s; 429 inclui `Retry-After`. A Edge ignora
  `X-Forwarded-For`, usa `CF-Connecting-IP` e agrega slugs inexistentes. Nenhuma origem fica em claro.
- Token público tem 2 horas, é repetível para conta/extrato até checkout e é apagado atomicamente
  quando vinculado ao pedido. Depois retorna `found=false`.
- Desativar o programa bloqueia nova identificação e novo checkout Clube, mas não revoga a leitura
  de token já emitido. Earn novo permanece bloqueado enquanto desativado.
- Extrato público limita 50 entradas em ordem decrescente e omite todos os IDs internos.
- Programa, métricas, membros e toggle são owner-only no frontend e no banco. Após toggle, o
  frontend invalida/refaz a query; troca de usuário chama `queryClient.clear()`.

### 6.7 Recompensas e vouchers

- Catálogo público revela somente rewards ativas, custo, disponibilidade e revisão; estoque exato e
  tenant não são expostos.
- Resgate usa custo e estoque bloqueados no servidor. Débito da conta, ledger `redeem`, redemption,
  stock event, voucher e consumo do token formam uma única transação.
- Replay público exige slug, idempotency key e recovery secret correto. Request igual com secret
  ausente ou divergente não revela o voucher bearer.
- FKs compostas ligam voucher, stock event e ledger à mesma redemption/reward/membership. Um índice
  único limita stock event de redemption a um por redemption, e o evento consumed deve corresponder
  à unidade/ator persistidos no voucher.
- Replay idempotente precede validações correntes. Recovery requer slug, UUID e segredo aleatório de
  64 hex; nenhum dos contratos retorna membership, customer, redemption ou voucher ID.
- O browser não persiste o token do Clube. A tentativa pendente persiste somente slug, UUID,
  recovery secret, reward ID e timestamp por até 24 horas.
- Reward management é owner-only. `DELETE: NOT SUPPORTED BY DESIGN`; somente soft deactivation por
  `set_loyalty_reward_active(false)`.
- Owner/manager/operator consultam e consomem vouchers somente em unidade ativa autorizada. Código
  cross-tenant/desconhecido não é enumerado pelo lookup; consumo é terminal e auditável.

## 7. Isolamento e integridade anti-IDOR

| Vetor                                                 | Defesa                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Owner tenta unidade de outro tenant                   | `can_access_unit`/`can_manage_unit` falham com `PED11`                 |
| Manager/operator tenta unidade sem vínculo            | `membership_units` ausente; `PED11` ou zero linhas                     |
| Cliente troca `organization_id`                       | RPCs de criação não recebem organização; servidor deriva da unidade    |
| Cliente usa categoria de outra unidade/org            | lookup composto + `PED29`; FK composta também rejeita                  |
| Produto persistido aponta para categoria cross-tenant | FK `(organization_id,unit_id,category_id)`                             |
| Vínculo de usuário aponta para unidade cross-org      | FK `(organization_id,unit_id)` em `membership_units`                   |
| Query direta authenticated busca outro escopo         | policy `can_access_unit(unit_id)` filtra a linha                       |
| Anon consulta tabelas do catálogo                     | SELECT permitido, mas sem policy: zero linhas                          |
| Anon consulta tabelas de menu/publicação              | sem grant de SELECT: `42501`                                           |
| Anon chama RPC de catálogo/publicação                 | `EXECUTE` revogado: `42501`                                            |
| Anon tenta ler cardápio sem slug                      | `get_public_menu` retorna `found=false`                                |
| Authenticated tenta I/U/D direto                      | grants revogados/ausência de policy: bloqueado                         |
| Corrida calcula mesma ordem                           | advisory lock por unidade/categoria e ordem server-side                |
| Publicações concorrentes                              | locks `pedon:menu:publish:<unit>` serializam e preservam o slug        |
| Publicação concorre com mutação de grupo/opção        | advisory lock compartilhado por produto serializa o snapshot          |
| Escrita direta no snapshot                            | sem policy/grant: bloqueado; imutabilidade é estrutural                |
| Anon consulta tabelas de pedidos                      | sem grant de SELECT: `42501`                                           |
| Checkout envia preço/total/nome                       | payload estrito + snapshot e cálculo server-authoritative: `PED37`     |
| Toggle de opção concorre com checkout                 | row lock da fonte lineariza sucesso ou `PED75`; transação é atômica    |
| Checkout reutiliza chave com payload diferente        | hash canônico + unique/lock por unidade: `PED42`                       |
| Tracking tenta enumerar pedido                        | token opaco de 32 hex; desconhecido retorna `found=false`              |
| Staff tenta pedido de outra unidade                   | `can_access_unit` nas RPCs e RLS filtra leitura direta                 |
| Operator tenta refund                                 | `can_manage_unit` obrigatório: `PED11`                                 |
| Websocket contém PII                                  | publicação Realtime limitada às cinco colunas de invalidação           |
| CPF/telefone enviados ao banco                        | Edge normaliza e envia apenas HMAC tenant-bound; bruto fica na request |
| Atacante enumera CPF por lookup                       | desconhecido e telefone divergente retornam o mesmo 422/corpo          |
| Ataque distribuído entre instâncias Edge              | rate limit persiste no PostgreSQL por escopo HMAC/janela               |
| Browser consulta tabelas do Clube                     | zero grants/policies; somente RPCs públicas minimizadas                |
| Manager/operator tenta administrar Clube              | `is_org_owner` obrigatório nas três RPCs administrativas               |
| Token é reutilizado após checkout                     | DELETE atômico no checkout; consulta posterior `found=false`           |
| Programa é desligado após emissão                     | token existente só lê; nova identificação/checkout/earn bloqueados     |
| Recovery tenta outro hash/chave/slug                  | `get_public_order_by_attempt` retorna `found=false`                    |
| Tracking tenta obter nota livre                       | serializador público omite `order_items.note`                          |
| Público tenta inferir estoque exato                   | catálogo expõe somente `available`                                    |
| Browser envia custo de resgate                        | RPC não aceita custo; lê reward sob lock                              |
| Resgates concorrentes excedem saldo/estoque           | ordem de locks + transação serializam conta e reward                   |
| Recovery usa segredo/chave/slug divergente            | retorna `found=false` sem IDs internos                                |
| Manager/operator tenta gerenciar reward               | `is_org_owner` obrigatório; `PED11`                                   |
| Staff tenta voucher de outro tenant/unidade           | unidade + `can_access_unit`; lookup retorna `found=false`              |
| Voucher é consumido duas vezes                        | row lock + estado terminal; `PED61`                                   |
| Browser tenta DELETE de reward                        | sem RPC, grant, policy ou ação de UI                                  |

As FKs compostas são defesa de integridade adicional, não substituto da autorização. As RPCs
verificam autorização antes da mutação e restringem updates por tenant/unidade já resolvidos.

## 8. Contratos de erro relevantes

Catálogo reutiliza:

| Código                  | Significado                                        |
| ----------------------- | -------------------------------------------------- |
| `PED10`                 | não autenticado                                    |
| `PED11`                 | sem acesso/gestão da unidade                       |
| `PED12`                 | unidade inexistente                                |
| `PED20..PED23`          | categoria ausente/nome inválido/conflito           |
| `PED24..PED28`          | produto ausente/campos ou preço inválidos          |
| `PED29`                 | categoria não pertence à unidade/organização       |
| `PED30`                 | flag booleana inválida                             |
| `PED31`                 | menu vazio não pode ser publicado                  |
| `PED32`                 | conflito raro de slug público                      |
| `PED33`                 | menu público não encontrado                        |
| `PED34`                 | unidade indisponível para pedidos                  |
| `PED35`/`PED36`         | menu ou configuração mudou durante o checkout      |
| `PED37`/`PED38`         | carrinho inválido ou item indisponível             |
| `PED39`/`PED40`         | modalidade ou pagamento indisponível               |
| `PED41`/`PED42`         | mínimo não atingido ou conflito de idempotência    |
| `PED43`/`PED44`/`PED45` | cliente, endereço ou troco inválido                |
| `PED46`                 | pedido não encontrado                              |
| `PED47`/`PED48`         | transição inválida de pedido ou pagamento          |
| `PED49`/`PED50`         | colisão de tracking ou overflow monetário/numérico |

Configuração operacional usa `PED10..PED18`; RPCs históricas de unidade usam `PED00..PED05`.
`get_public_menu` nunca lança erro (retorna `found=false`). Detalhes completos estão em
`PEDON_DATABASE_SCHEMA.md`.

O núcleo de identidade e pontos usa `PED51 LOYALTY_UNAVAILABLE`,
`PED52 INVALID_LOYALTY_TOKEN` e `PED53 LOYALTY_INTEGRITY`. A Edge expõe códigos HTTP próprios: 403
`LOYALTY_UNAVAILABLE`; 422 `INVALID_CPF`, `INVALID_PHONE`, `INVALID_NAME`,
`CONSENT_REQUIRED` ou `IDENTITY_NOT_CONFIRMED`; 429 `RATE_LIMITED` com `Retry-After`; e 500 para
integridade/configuração/upstream. Slug inválido/desconhecido usa 404 `INVALID_SLUG`.

Recompensas e vouchers usam `PED54..PED66`: reward ausente/indisponível/alterada/sem estoque,
saldo insuficiente, conflito/integridade de redemption, voucher ausente/já consumido/código inválido,
payload/nome/estoque inválidos. O contrato completo está no schema, Seção 10.4.

## 9. Testes executados

As onze suítes DB rodam sequencialmente no PostgreSQL descartável do GitHub Actions. O projeto
oficial não substitui esse ambiente destrutivo:

| Script                                       | Resultado oficial | Cobertura principal                                                                       |
| -------------------------------------------- | ----------------: | ----------------------------------------------------------------------------------------- |
| `rls_integrity.test.mjs`                     |             22/22 | identidade, onboarding, isolamento e escrita direta                                       |
| `rbac_units_integrity.test.mjs`              |             32/32 | owner/manager/operator, ACL, vínculos, FKs e concorrência                                 |
| `unit_operational_config_integrity.test.mjs` |             80/80 | grants, RBAC, validações, aceite e atomicidade                                            |
| `catalog_integrity.test.mjs`                 |           123/123 | RLS/ACL, matriz RBAC, IDOR, FKs, flags, preço e locks                                     |
| `menu_publication_integrity.test.mjs`        |           121/121 | publicação, imutabilidade, slug, overlay, API pública e isolamento                        |
| `orders_integrity.test.mjs`                  |           318/318 | checkout, idempotência, snapshots, PII, lifecycle, ACL/RLS, Realtime e concorrência       |
| `product_options_integrity.test.mjs`         |           158/158 | opções, snapshots, checkout, RLS/ACL e concorrência de publicação/disponibilidade          |
| `loyalty_integrity.test.mjs`                 |           148/148 | identidade v2, consent auditável, ACL legado, TTL, rate limit, recovery e ledger           |
| `loyalty_rewards_integrity.test.mjs`         |           254/254 | rewards, replay secret, FKs, estoque, vouchers e concorrência real                         |
| `pilot_readiness_team_integrity.test.mjs`    |             84/84 | readiness, grants, owner-only, IDOR, vínculos e configuração segura das RPCs               |

O cardápio valida expressamente: menu vazio (`PED31`), grants e RLS das seis tabelas de cardápio, escrita
direta bloqueada no snapshot, snapshot congelado após mutações do catálogo, numeração crescente,
slug estável/opaco e único, republicação preservando histórico, API pública sem sessão,
disponibilidade em overlay (inclusive fonte deletada), unidade inativa, isolamento entre
organizações, publicações concorrentes e ausência de vazamento entre unidades. Pedidos validam
payload estrito, dinheiro exato, replay durável, tracking minimizado, máquinas de estado,
autorização de refund e publicação Realtime sem PII. Clube valida grants zero, HMACs, mismatch
uniforme, consentimento, token repetível/consumido, disable explícito, rate limit sem PII, statement
máximo 50 e recuperação sem PII. Rewards/vouchers validam resgate atômico e idempotente,
concorrência de saldo/estoque, recovery, ACL/RLS, RBAC staff, trilhas append-only e DEC-108.

O CI `31814657987` (técnico) e o CI documental `31823617636` aprovaram fresh rebuild das 22
migrations, alinhamento, DB lint, as onze suítes sequenciais com 1409/1409 checks e Edge unit 15/15
(Prompt 12 encerrado como `RELEASE_VERIFIED` / `MENU_COMMERCIALLY_USABLE` com
`PASS_WITH_FINDINGS`). O remote
smoke 36/36 permanece evidência histórica do Prompt 10. `LOCAL DB REBUILD: NOT RUN — BY DESIGN /
NO LOCAL DOCKER`; `CI ISOLATED DB REBUILD: PASS`.

A publicação passou a exigir regras de seleção satisfazíveis (grupo obrigatório ativo com menos
opções ativas que `min_select` aborta a publicação com `PED73`, sem versão parcial) e todo writer
estrutural do catálogo (categorias, produtos, grupos/opções e publicação) adquire o
advisory lock unit-scoped `_lock_unit_structure(unit_id)` como **contrato arquitetural desejado**,
revogado de `PUBLIC`/`anon`/`authenticated`
e usado somente por RPCs `SECURITY DEFINER`. **Exceção implementacional conhecida (reauditoria
final #2, MEDIUM NON-BLOCKING, follow-up Prompt 13+):** `create_catalog_product_option_group` e
`create_catalog_product_option` podem adquirir o lock de produto no corpo da função antes do trigger
unit-scoped; sob concorrência estreita o PostgreSQL detecta o deadlock (40P01) e aborta uma
transação com rollback atômico, sem impacto de integridade.

Opções de produto seguem o mesmo modelo: leitura por policy `can_access_unit` com SELECT concedido
somente a `authenticated`; escrita exclusiva por RPCs `SECURITY DEFINER`; snapshot imutável na
publicação e `order_item_options` no checkout preservam nomes/deltas sem depender do catálogo
mutável. `single => max_select=1` é constraint do catálogo e do snapshot. Nenhuma escrita de opção
por grant de navegador.

Os scripts devem rodar sequencialmente. O teste RBAC herdado verifica uma contagem global de
`membership_units` durante um cenário e é frágil se outra suíte inserir vínculos em paralelo.

## 10. Regras de manutenção

- Não adicionar policy/grant de escrita direta sem decisão registrada e testes de regressão.
- Toda nova tabela por unidade deve carregar e validar o escopo; preferir FK composta quando houver
  referência entre entidades escopadas.
- Não transformar `SELECT` concedido ao `anon` nas tabelas mutáveis em policy pública. Publicação de
  cardápio e leitura pública devem usar o modelo imutável do Prompt 07.
- Alterações de autorização exigem execução sequencial das onze suítes DB e DB lint no CI isolado.
- Nunca usar pooler de sessão nos testes que fazem `SET ROLE`/claims; usar conexão direta conforme
  DEC-044.
