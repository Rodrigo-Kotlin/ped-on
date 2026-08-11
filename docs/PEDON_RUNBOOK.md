# PED-ON — Runbook

> Guia operacional do Ped-On após o Prompt 08. Ambiente oficial: modelo Main-First monitorado,
> Supabase vinculado e Cloudflare Pages em produção.

## 1. Pré-requisitos e versões

| Ferramenta | Contrato |
|---|---|
| Node.js | `>=22`; fundação validada com Node `v24.15.0` |
| pnpm | `>=9`; fixado como `pnpm@9.15.9` em `package.json` |
| Git | `>=2.x` |
| Supabase CLI | disponível; checkpoint com `2.109.1` |
| Playwright | Chromium instalado para E2E |

Instalação:

```bash
pnpm install
pnpm --filter @pedon/web exec playwright install chromium
```

## 2. Comandos do projeto

| Ação | Comando |
|---|---|
| Desenvolvimento web | `pnpm dev` |
| Build PWA | `pnpm build` |
| Preview local | `pnpm --filter @pedon/web preview` |
| Formatar | `pnpm format` |
| Verificar formato | `pnpm format:check` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit/componente | `pnpm test:run` |
| Unit em watch | `pnpm test` |
| E2E | `pnpm test:e2e` |

O build de produção fica em `apps/web/dist`, incluindo `manifest.webmanifest` e `sw.js`. O PWA
cacheia assets estáticos; não há `runtimeCaching` de API, dados privados ou tokens.

## 3. Gates locais

Antes de integrar uma mudança funcional:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm test:e2e
gitleaks detect --source . --redact --log-level warn
```

Checkpoint do Prompt 08: formato, lint, typecheck, build e Gitleaks v8.30.1 PASS; frontend
unit/component 87/87; E2E 104/104 em 360/768/1024/1440.

## 4. Variáveis e secrets

- `.env.example` contém somente nomes; `.env` real é gitignored e nunca deve ser commitado.
- Frontend: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são públicos e sujeitos a RLS.
- Nunca expor secret key ou `service_role` em variável `VITE_*`.
- Testes DB usam `SUPABASE_DB_PASSWORD`; não imprimir nem persistir a senha.
- Repositório GitHub é público. Tokens GitHub/Cloudflare/Supabase ficam fora do repositório.

PowerShell:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
```

## 5. Supabase oficial

| Item | Valor |
|---|---|
| Projeto | `ped-on` |
| Project ref | `zmuxkztnilnzjyyojbbr` |
| Região | South America (São Paulo) |
| API | `https://zmuxkztnilnzjyyojbbr.supabase.co` |
| Link | `supabase link --project-ref zmuxkztnilnzjyyojbbr` |
| Config versionada | `supabase/config.toml` |

### 5.1 Migrations aplicadas

Na ordem:

1. `20260809221710_identity_tenant_foundation.sql`
2. `20260810015224_rbac_units_context.sql`
3. `20260810032804_unit_operational_config.sql`
4. `20260810033118_unit_operational_config_hardening.sql`
5. `20260810120000_unit_operational_config_acceptance_hardening.sql`
6. `20260810122401_catalog_base.sql`
7. `20260810135051_menu_versioning_publication.sql`
8. `20260810141000_menu_publication_slug_fix.sql`
9. `20260810144145_orders_checkout.sql`
10. `20260810162508_orders_checkout_lint_hardening.sql`

Checkpoint Prompt 08: Local == Remote para as dez versões; migrations de pedidos e hardening
aplicadas oficialmente; db lint sem erros.

### 5.2 Fluxo linked não destrutivo

```bash
# conferir vínculo e histórico antes de aplicar
supabase projects list
supabase migration list

# aplicar somente migrations locais pendentes ao projeto vinculado
supabase db push --linked

# confirmar igualdade e validar o schema remoto
supabase migration list
supabase db lint --linked
```

Regras:

- criar arquivo versionado antes de alterar o banco;
- revisar e testar a migration;
- usar `supabase db push --linked` para o projeto oficial;
- confirmar Local == Remote e lint;
- nunca editar/apagar migration já aplicada nem aplicar SQL silencioso pelo Dashboard.

`supabase db push --linked` aplica migrations pendentes no banco remoto vinculado e preserva os
dados existentes. `supabase db reset` é um reset destrutivo da stack local: recria o banco local e
reaplica migrations, apagando dados locais. Não usar `db reset` contra o projeto oficial e não
confundi-lo com o fluxo linked de produção.

Para alterações backward-compatible, manter banco primeiro e aplicação depois: aplicar/validar a
migration, então publicar o frontend que depende dela.

## 6. Testes de banco

Os testes conectam diretamente em `db.zmuxkztnilnzjyyojbbr.supabase.co:5432` como `postgres` e
simulam sessões com `SET ROLE`/claims. Não usar pooler de sessão: reutilização de backend pode vazar
role/claims entre clients.

Execute os sete scripts **sequencialmente, nunca em paralelo**:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
node supabase/tests/rls_integrity.test.mjs
node supabase/tests/rbac_units_integrity.test.mjs
node supabase/tests/unit_operational_config_integrity.test.mjs
node supabase/tests/catalog_integrity.test.mjs
node supabase/tests/menu_publication_integrity.test.mjs
node supabase/tests/orders_integrity.test.mjs
node supabase/tests/loyalty_integrity.test.mjs
```

| Script | Checkpoint |
|---|---:|
| `rls_integrity.test.mjs` | 22/22 PASS |
| `rbac_units_integrity.test.mjs` | 31/31 PASS |
| `unit_operational_config_integrity.test.mjs` | 80/80 PASS |
| `catalog_integrity.test.mjs` | 123/123 PASS |
| `menu_publication_integrity.test.mjs` | 121/121 PASS |
| `orders_integrity.test.mjs` | 318/318 PASS |
| `loyalty_integrity.test.mjs` | 108/108 PASS |

A execução sequencial é obrigatória porque o teste RBAC herdado possui uma verificação de contagem
global de `membership_units`; outra suíte inserindo vínculos simultaneamente pode produzir falso
negativo. Cada script cria usuários/organizações sintéticos e executa cleanup automático no
`finally`. Se houver interrupção abrupta, localizar dados `*@pedon-test.invalid` e organizações de
teste antes de repetir; não remover dados reais.

### 6.1 Clube Ped-On (Prompt 09) — validação e diagnóstico

Procedimentos de verificação manual do ledger e da identidade do Clube (conexão direta como
`postgres`, mesmo padrão dos testes):

- **Account × ledger:** `sum(loyalty_ledger.amount)` deve igualar `points_balance - recovery_points`
  da conta correspondente para fluxos orgânicos (sem reparos manuais):
  ```sql
  select ac.membership_id, ac.points_balance, ac.recovery_points,
         (select coalesce(sum(l.amount),0) from public.loyalty_ledger l
           where l.membership_id = ac.membership_id) as ledger_sum
  from public.loyalty_accounts ac;
  ```
- **Earn/reversal por pedido:** um pedido gera no máximo um `earn` e um `reversal`; conferir o
  índice parcial único em `loyalty_ledger (order_id, entry_type)`:
  ```sql
  select order_id, entry_type, amount, created_at
  from public.loyalty_ledger
  where membership_id = '<membership_id>' order by created_at;
  ```
- **`recovery_points`:** estorno que excede o saldo transforma a diferença em dívida; o próximo
  earn quita a dívida antes de compor saldo (`repayment = least(points, recovery_points)`).
- **Diagnóstico `PED53`:** inconsistência interna do ledger ou `limit` de
  `get_loyalty_members_admin` fora de 1..200. Conferir primeiro se há duas entradas do mesmo tipo no
  mesmo `order_id` (deve ser impossível pelo índice único parcial) e se a conta da membership existe.
- **Estornado antes de `completed`:** não gera earn (guard de `_loyalty_earn_order`,
  migration `20260811080000`); o reverso de earn já concedido é feito por `_loyalty_reverse_order`
  no `payment_status → refunded`.
- **Sem CPF em claro:** `customers` só contém `cpf_fingerprint` (64 hex) e `cpf_last2`; nenhuma
  coluna de CPF existe. Nunca inserir/logar CPF.
- **Cleanup das fixtures do Clube:** a suíte remove `loyalty_ledger`, depois `orders` e por fim as
  `organizations` de teste (cascade para memberships/accounts/customers). Em interrupção abrupta,
  remover manualmente nesta ordem — o ledger tem `ON DELETE RESTRICT` para orders e memberships:
  ```sql
  delete from public.loyalty_ledger where organization_id in
    (select id from public.organizations where name like '%Loyalty Org%');
  delete from public.orders where organization_id in
    (select id from public.organizations where name like '%Loyalty Org%');
  delete from public.organizations where name like '%Loyalty Org%';
  ```
- **PED51/PED52:** `PED51` = programa ausente/desabilitado; `PED52` = token ausente/expirado/
  inválido/de outro tenant. O retry idempotente precede a validação (DEC-100).

## 7. Validação de segurança e cross-tenant

Nos testes DB, sempre validar:

- anon sem leitura efetiva do catálogo: query direta retorna zero linhas e RPCs de catálogo retornam
  permission denied (`42501`);
- authenticated sem identidade retorna `PED10` nas RPCs atuais;
- owner não acessa unidade de outro tenant;
- manager/operator não acessam unidade sem `membership_units`;
- FK composta rejeita vínculo ou categoria de outra organização/unidade;
- `INSERT`/`UPDATE`/`DELETE` diretos no catálogo permanecem bloqueados;
- operator consegue somente `set_catalog_product_available` no catálogo da unidade autorizada;
- anon não lê diretamente pedidos e recebe somente respostas públicas minimizadas das RPCs;
- owner/manager/operator não acessam pedidos de unidade não autorizada, e refund exige gestão;
- escritas diretas em `orders`, `order_items` e `order_events` permanecem bloqueadas;
- publicação Realtime de `orders` não inclui PII, endereço ou idempotência;
- cleanup remove organizações e usuários sintéticos.

Nunca validar RLS com `service_role`. Setup/cleanup usam a conexão administrativa direta; cenários de
aplicação usam roles e claims equivalentes ao cliente.

## 8. Operações de catálogo, cardápio e pedidos

### 8.1 Catálogo administrativo

Rota administrativa: `/app/catalogo`, protegida por sessão e contexto de unidade.

| Operação | RPC obrigatória | Roles |
|---|---|---|
| Ler catálogo | `get_unit_catalog_admin` | owner/manager/operator autorizados |
| Criar categoria | `create_catalog_category` | owner/manager |
| Editar categoria | `update_catalog_category` | owner/manager |
| Ativar/desativar categoria | `set_catalog_category_active` | owner/manager |
| Criar produto | `create_catalog_product` | owner/manager |
| Editar/mover produto | `update_catalog_product` | owner/manager |
| Ativar/desativar produto | `set_catalog_product_active` | owner/manager |
| Disponibilizar/indisponibilizar | `set_catalog_product_available` | owner/manager/operator |

Criação de categoria, criação/edição de produto e alteração de disponibilidade devem ocorrer
exclusivamente por essas RPCs. Não fazer writes diretos, não fornecer `organization_id` ou
`sort_order` pelo cliente e não criar endpoint de DELETE. Preço entra como string decimal; o banco
persiste `numeric(12,2)`.

`is_active` e `is_available` são independentes. Desativar categoria não propaga flags aos produtos.
O catálogo é mutável e administrativo; não usá-lo como API pública de cardápio.

### 8.2 Cardápio publicado (Prompt 07)

Rota administrativa: `/app/cardapio` (owner/manager publicam; operador apenas lê via
`get_unit_menu_publication_admin`). Rota pública: `/menu/:slug`.

| Operação | RPC obrigatória | Roles |
|---|---|---|
| Publicar cardápio | `publish_unit_menu` | owner/manager |
| Ler publicação/histórico | `get_unit_menu_publication_admin` | owner/manager/operator autorizados |
| Ler cardápio público | `get_public_menu` | anon/authenticated |

A publicação cria um snapshot comercial imutável a partir do catálogo estruturalmente ativo e
mantém um slug público opaco e estável. Nenhuma escrita direta é permitida nas tabelas
`menu_versions`, `menu_version_categories`, `menu_version_products` ou `menu_publications`. O
cardápio público é lido somente via `get_public_menu`; `anon` nunca consulta as tabelas
diretamente.

| Código | Tratamento |
|---|---|
| `PED31` | menu vazio (sem produtos ativos); ajustar catálogo e republicar |
| `PED32` | conflito raro de slug; republicar |

### 8.3 Erros do catálogo

| Código | Tratamento |
|---|---|
| `PED10` | sessão ausente/expirada; solicitar novo login |
| `PED11` | usuário sem acesso ou gestão da unidade |
| `PED12` | unidade não encontrada |
| `PED20` | categoria não encontrada; recarregar catálogo |
| `PED21`/`PED22` | nome de categoria ausente/acima de 80 |
| `PED23` | nome de categoria conflitante na unidade |
| `PED24` | produto não encontrado; recarregar catálogo |
| `PED25`/`PED26` | nome de produto ausente/acima de 120 |
| `PED27` | descrição acima de 500 |
| `PED28` | preço inválido, não positivo, mais de duas casas ou overflow |
| `PED29` | categoria fora da unidade/tenant do produto |
| `PED30` | flag booleana inválida |

### 8.4 Pedidos (Prompt 08)

Rotas públicas: `/menu/:slug`, `/menu/:slug/carrinho`, `/menu/:slug/checkout` e
`/pedido/:trackingToken`. Rota administrativa: `/app/pedidos` para os três papéis com acesso à
unidade.

| Operação | RPC obrigatória | Roles |
|---|---|---|
| Criar pedido | `create_public_order` | anon/authenticated |
| Acompanhar pedido | `get_public_order` | anon/authenticated |
| Listar pedidos | `get_unit_orders_admin` | owner/manager/operator autorizados |
| Ler detalhe | `get_order_admin` | owner/manager/operator autorizados |
| Alterar status | `set_order_status` | owner/manager/operator autorizados |
| Marcar pago | `set_order_payment_status` | owner/manager/operator autorizados |
| Registrar refund externo | `set_order_payment_status` | owner/manager |

Regras operacionais:

- checkout é network-only; não simular sucesso offline nem persistir PII no carrinho;
- retry da mesma tentativa deve reutilizar o `idempotency_key`; edição após erro cria nova tentativa;
- `PED35`/`PED36` exigem revisão explícita do menu/checkout, sem repricing silencioso;
- status segue a máquina progressiva; payment status é independente; terminais não reabrem;
- Realtime apenas invalida/refaz as queries TanStack da unidade ativa;
- pagamento/refund é registro operacional externo, sem gateway ou estorno automático.

Erros públicos: `PED33..PED45` e `PED50`; erros administrativos: `PED46..PED48`. `PED49` representa
colisão rara após esgotar retries do token. O mapa completo está em `PEDON_DATABASE_SCHEMA.md`.

## 9. Configuração operacional

Rota: `/app/configuracoes`, restrita a owner e manager autorizado por `RequireManageUnit`.

- leitura: `get_unit_operational_config`;
- save completo: `save_unit_operational_config`;
- unidade não configurada retorna `configured=false` e `accepting_orders=false`;
- ligar aceite exige unidade ativa, modalidade, ao menos um dia aberto e um método habilitado;
- dinheiro é string decimal no contrato; banco usa `numeric(12,2)`;
- erros estáveis: `PED10..PED18`, detalhados em `PEDON_DATABASE_SCHEMA.md`.

## 10. Rotas web atuais

| Rota | Estado |
|---|---|
| `/` | landing/fundação |
| `/login` | entrada |
| `/cadastro` | cadastro com confirmação de e-mail |
| `/onboarding` | onboarding transacional |
| `/app` | área administrativa e contexto de unidade |
| `/app/catalogo` | catálogo por unidade; todos os roles leem, RBAC por ação |
| `/app/configuracoes` | configuração operacional; owner/manager |
| `/app/cardapio` | publicação e histórico do cardápio; owner/manager |
| `/app/pedidos` | Central de Pedidos; todos os roles autorizados, refund por owner/manager |
| `/menu/:slug` | cardápio público do cliente, sem sessão |
| `/menu/:slug/carrinho` | carrinho público local, sem PII |
| `/menu/:slug/checkout` | checkout guest idempotente, network-only |
| `/pedido/:trackingToken` | acompanhamento público sem PII |
| `*` | página não encontrada |

Fluxo Auth permanece: cadastro, confirmação de e-mail, login, onboarding e área administrativa. O
Prompt 08 não alterou Auth e enviou zero e-mails. A homologação real do Prompt 03/05 permanece
válida: confirmação pelo Supabase built-in mailer, redirect para `https://ped-on.pages.dev`, login,
onboarding, restauração de sessão, logout/relogin e cleanup; incidente antigo de `SITE_URL` em
localhost está resolvido.

## 11. CI e GitHub

| Item | Valor |
|---|---|
| Repositório | `https://github.com/Rodrigo-Kotlin/ped-on` (PUBLIC) |
| Branch | `main` |
| Modelo | Main-First monitorado |
| Workflow | `.github/workflows/ci.yml`, nome `CI` |

Job `quality`: install frozen, format check, lint, typecheck, unit tests, build e Gitleaks. Job
`e2e`: depende de quality, instala Chromium e roda Playwright. Checkpoint Prompt 08: run
`31429728244`, SHA `7fe07dfadd3993ff8d6869dd6d4f53f82cb53c8b`, `SUCCESS` em quality + E2E.

Comandos de inspeção:

```bash
gh run list --workflow CI
gh run view 31429728244
```

Há aviso de depreciação do runtime Node.js 20 em actions de terceiros, mas o workflow executa e
passa com Node.js 24.

## 12. Cloudflare Pages

| Item | Valor |
|---|---|
| Projeto | `ped-on` |
| Production branch | `main` |
| Build | `pnpm build` |
| Output | `apps/web/dist` |
| Node | `22` via `.nvmrc` |
| URL estável | `https://ped-on.pages.dev` |
| Deploy Prompt 08 | `f1afe182-8999-4c30-b635-e39e51a1dbac` |
| URL do deploy | `https://f1afe182.ped-on.pages.dev` |
| Source | `7fe07df` |

Deploy é automático após push em `main`; GitHub Actions faz gates, não um segundo deploy.

### 12.1 Checkpoint pós-deploy Prompt 08

- confirmar deployment de produção e source `7fe07df`;
- validar HTTP 200 em `/`, `/login`, `/app`, `/app/cardapio`, `/app/catalogo`, `/app/configuracoes`,
  `/app/pedidos`, `/menu/:slug`, carrinho, checkout, `/pedido/:trackingToken`,
  `manifest.webmanifest`, `sw.js` e assets JS/CSS;
- confirmar SPA fallback nas rotas diretas;
- confirmar no bundle `create_public_order`, `get_public_order`, `get_unit_orders_admin`,
  `get_order_admin`, `set_order_status` e `set_order_payment_status`;
- confirmar que o bundle aponta para o Supabase real e não contém secret key;
- confirmar que service worker não adicionou cache de API/dados privados.

Esse checkpoint foi executado com sucesso no deploy acima e no domínio estável; ambos servem
`/assets/index-CTtpL05m.js`. O build registra warning de chunk JS de ~734 kB; é pendência de
otimização, não falha do deploy.

## 13. Diagnóstico rápido

| Sintoma | Verificação |
|---|---|
| Rota direta retorna 404 | `_redirects` e SPA fallback do Pages |
| Catálogo retorna `PED10` | sessão/claims e restauração do Auth |
| Catálogo retorna `PED11` | unidade selecionada, role e `membership_units` |
| Produto retorna `PED29` | categoria pertence à mesma unidade e tenant |
| Publicar retorna `PED31` | catálogo sem produto ativo; ajustar antes de republicar |
| Checkout retorna `PED35`/`PED36` | menu/configuração mudou; recarregar e revisar sem repricing silencioso |
| Checkout retorna `PED42` | chave idempotente foi reutilizada com payload diferente; iniciar nova tentativa |
| Tracking retorna `found=false` | token inválido/desconhecido; não usar IDs internos na rota |
| Central retorna `PED11` | sessão sem acesso à unidade ou operator tentando refund |
| Transição retorna `PED47`/`PED48` | estado terminal, salto ou transição repetida/inválida |
| Anon vê zero linhas | comportamento esperado; cardápio via `get_public_menu` |
| Write direto falha `42501` | comportamento esperado; usar RPC |
| Migration ausente | `supabase migration list`, depois `db push --linked` se revisada |
| DB test falha por contagem | confirmar que as seis suítes não rodaram em paralelo |
| Teste deixa dados após crash | localizar somente fixtures `pedon-test.invalid`; limpar com cuidado |
| Build avisa chunk grande | warning conhecido de 733.53 kB |

## 14. Próximo passo oficial

Prompt 09: modelagem de clientes e fidelidade. Ainda não iniciado; não adicionar CPF, pontos,
recompensas ou vouchers como continuação implícita do Prompt 08.
