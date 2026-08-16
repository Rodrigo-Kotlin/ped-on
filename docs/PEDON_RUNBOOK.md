# PED-ON — Runbook

> Guia operacional do Ped-On no Prompt 13 `COMPLETED`, checkpoint
> `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED`. Backend técnico/remoto validado no HEAD
> `ddd11b44`, CI `31924328717`. Piloto controlado preparado em `docs/PEDON_PILOT_GATE.md`
> (PILOT GATE `IN PROGRESS`, Parte 1; `PILOT_PREPARATION_CHECKPOINT — ACHIEVED`).

## 1. Pré-requisitos

| Ferramenta   | Contrato                               |
| ------------ | -------------------------------------- |
| Node.js      | `>=22`                                 |
| pnpm         | `>=9`; `pnpm@9.15.9` fixado no projeto |
| Deno         | 2.x para unit tests da Edge Function   |
| Git          | 2.x                                    |
| Supabase CLI | projeto oficial linked                 |
| Playwright   | Chromium instalado para E2E            |

```bash
pnpm install
pnpm --filter @pedon/web exec playwright install chromium
```

## 2. Comandos do projeto

| Ação                | Comando                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Desenvolvimento web | `pnpm dev`                                                                                                 |
| Build PWA           | `pnpm build`                                                                                               |
| Auditar precache    | `pnpm audit:precache`                                                                                      |
| Preview local       | `pnpm --filter @pedon/web preview`                                                                         |
| Formatar            | `pnpm format`                                                                                              |
| Verificar formato   | `pnpm format:check`                                                                                        |
| Lint                | `pnpm lint`                                                                                                |
| Typecheck           | `pnpm typecheck`                                                                                           |
| Unit/componente     | `pnpm test:run`                                                                                            |
| E2E mocked          | `pnpm test:e2e`                                                                                            |
| Edge unit           | `deno test --config supabase/functions/loyalty-cpf/deno.json supabase/functions/loyalty-cpf/index_test.ts` |

O build de produção fica em `apps/web/dist`. O PWA cacheia apenas assets estáticos; não há
`runtimeCaching` de API, dados privados, tokens ou respostas do Clube.

## 3. Gates do Prompt 13

Gates locais leves obrigatórios:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm audit:precache
pnpm test:e2e
pnpm test:edge
gitleaks git --redact --log-level warn .
```

Não executar Docker, `supabase start`, `supabase db reset` nem stack Supabase local na máquina de
desenvolvimento. O GitHub Actions é o ambiente oficial e descartável para fresh rebuild, aplicação
das 23 migrations, doze suítes DB, DB lint e Edge unit.

- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`;
- `LOCAL DB TESTS: NOT RUN — BY DESIGN / NO LOCAL DOCKER`;
- `CI ISOLATED DB REBUILD: PASS` no run `31859960640`, com fresh rebuild das 23 migrations e
  DB 1494/1494 em 12 suítes;
- migration 23 aplicada remotamente; Git/filesystem/remoto em 23/23/23; post-push dry-run up to date,
  linked lint com zero erros e drift remoto `NONE`.

## 4. Variáveis e secrets

- `.env.example` contém somente nomes; `.env` real é gitignored.
- Frontend: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são valores públicos sujeitos a
  RLS.
- Testes DB e smoke usam `SUPABASE_DB_PASSWORD`; nunca imprimir ou persistir a senha.
- `service_role`, Supabase secret key e `LOYALTY_CPF_HMAC_KEY` nunca usam prefixo `VITE_*`.
- `LOYALTY_CPF_HMAC_KEY` é um **Supabase Edge Secret de ambiente**, lido pela função com
  `Deno.env.get`. Não é armazenado no Supabase Vault e não deve entrar no repositório.

Gerenciamento remoto do Edge Secret:

```bash
supabase secrets set LOYALTY_CPF_HMAC_KEY=<segredo-forte> --project-ref zmuxkztnilnzjyyojbbr
supabase secrets list --project-ref zmuxkztnilnzjyyojbbr
```

Para `supabase functions serve` local, fornecer o secret por arquivo de ambiente gitignored. Rotação
da chave muda todos os fingerprints; só realizar com plano explícito de migração/reidentificação.

PowerShell para testes DB:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
```

## 5. Supabase oficial

| Item              | Valor                                              |
| ----------------- | -------------------------------------------------- |
| Projeto           | `ped-on`                                           |
| Project ref       | `zmuxkztnilnzjyyojbbr`                             |
| Região            | South America (São Paulo)                          |
| API               | `https://zmuxkztnilnzjyyojbbr.supabase.co`         |
| Link              | `supabase link --project-ref zmuxkztnilnzjyyojbbr` |
| Config versionada | `supabase/config.toml`                             |
| Edge              | `loyalty-cpf`, deployada, `verify_jwt` ativo       |

### 5.1 Migrations aplicadas

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
11. `20260810170000_loyalty_customers_ledger.sql`
12. `20260811080000_loyalty_earn_refunded_guard.sql`
13. `20260811130000_prompt09_release_hardening.sql`
14. `20260811170000_prompt09_reaudit_hardening.sql`
15. `20260811200418_loyalty_rewards_redemptions_vouchers.sql`
16. `20260812030000_prompt10_release_hardening.sql`
17. `20260812090000_prompt10_final_integrity_hardening.sql`
18. `20260812120000_prompt11_pilot_readiness_team.sql`
19. `20260813120000_prompt11_readiness_unit_coherence.sql`
20. `20260814000000_prompt12_product_options.sql`
21. `20260814010000_prompt12_final_hardening.sql`
22. `20260814020000_prompt12_remediation_a_hardening.sql`
23. `20260814100000_prompt13_backend_operational_core.sql`

### 5.2 Fluxo linked controlado

```bash
supabase projects list
supabase migration list
supabase db push --linked --dry-run
# Somente após CI verde e aprovação explícita da migration:
supabase db push --linked
supabase migration list
supabase db lint --linked
```

Regras:

- criar e revisar migration versionada antes de alterar o banco;
- nunca editar/apagar migration já aplicada;
- nunca aplicar SQL silencioso pelo Dashboard;
- executar o dry-run antes do push real; somente o comando com `--dry-run` é não destrutivo;
- confirmar Git/filesystem/remoto em 23/23/23; o dry-run linked deve informar que o remoto está up to
  date;
- não usar `supabase db reset` no projeto oficial.

## 6. Testes DB e Edge

Os testes DB usam conexão PostgreSQL administrativa para setup/cleanup e sessões dedicadas com
`SET ROLE`/claims. As doze suítes destrutivas rodam sequencialmente apenas no banco descartável do
GitHub Actions:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
node supabase/tests/rls_integrity.test.mjs
node supabase/tests/rbac_units_integrity.test.mjs
node supabase/tests/unit_operational_config_integrity.test.mjs
node supabase/tests/catalog_integrity.test.mjs
node supabase/tests/menu_publication_integrity.test.mjs
node supabase/tests/orders_integrity.test.mjs
node supabase/tests/product_options_integrity.test.mjs
node supabase/tests/product_options_remediation_integrity.test.mjs
node supabase/tests/loyalty_integrity.test.mjs
node supabase/tests/loyalty_rewards_integrity.test.mjs
node supabase/tests/pilot_readiness_team_integrity.test.mjs
node supabase/tests/prompt13_order_operations.test.mjs
```

| Script                                       |   Checkpoint |
| -------------------------------------------- | -----------: |
| `rls_integrity.test.mjs`                     |   22/22 PASS |
| `rbac_units_integrity.test.mjs`              |   32/32 PASS |
| `unit_operational_config_integrity.test.mjs` |   80/80 PASS |
| `catalog_integrity.test.mjs`                 | 123/123 PASS |
| `menu_publication_integrity.test.mjs`        | 121/121 PASS |
| `orders_integrity.test.mjs`                  | 318/318 PASS |
| `product_options_integrity.test.mjs`         | 158/158 PASS |
| `product_options_remediation_integrity.test.mjs` | 65/65 PASS |
| `loyalty_integrity.test.mjs`                 | 148/148 PASS |
| `loyalty_rewards_integrity.test.mjs`         | 254/254 PASS |
| `pilot_readiness_team_integrity.test.mjs`    |   84/84 PASS |
| `prompt13_order_operations.test.mjs`         |   89/89 PASS |

A execução sequencial evita interferência na contagem global herdada de `membership_units`. Cada
script cria fixtures sintéticas e faz cleanup. Nunca limpar registros reais ao recuperar uma
execução interrompida.

Baseline atual do CI `31859960640`: doze suítes, 1494/1494 checks. O baseline histórico do Prompt 12
permanece registrado em seus checkpoints próprios.

### 6.1 Edge unit

Use o config Deno versionado, que habilita as libs do runtime e resolução npm:

```bash
deno test --config supabase/functions/loyalty-cpf/deno.json supabase/functions/loyalty-cpf/index_test.ts
```

Checkpoint: 15/15 PASS.

### 6.2 Edge deploy e smoke remoto

Deploy preservando `verify_jwt` ativo:

```bash
supabase functions deploy loyalty-cpf --project-ref zmuxkztnilnzjyyojbbr
```

Smoke contra a função deployada:

```bash
node supabase/tests/loyalty_edge_smoke.mjs
```

Checkpoint remoto histórico do Prompt 10: 36/36 PASS, incluindo request sem JWT rejeitada, CPF +
telefone, consentimento, resposta uniforme de identidade, rate limit 429/`Retry-After`,
saldo/extrato, vouchers públicos e programa desabilitado. O smoke cria fixtures e executa cleanup.
Para o Prompt 11, o CI `31712486989` aprovou Edge unit 15/15.

## 7. Contratos operacionais do Clube

### 7.1 Identidade pública v2

Endpoint: `POST /functions/v1/loyalty-cpf`, com a publishable key do projeto nos headers `apikey` e
`Authorization`. Smoke remoto confirmou que a chave atual atravessa o gateway; não assumir formato
JWT legado apenas pelo nome da credencial.

| Campo         | Lookup                                  | Enroll                                  |
| ------------- | --------------------------------------- | --------------------------------------- |
| `public_slug` | obrigatório, 24 hex                     | obrigatório, 24 hex                     |
| `mode`        | `lookup`                                | `enroll`                                |
| `cpf`         | obrigatório e validado                  | obrigatório e validado                  |
| `phone`       | obrigatório, 10/11 dígitos normalizados | obrigatório, 10/11 dígitos normalizados |
| `name`        | omitido                                 | obrigatório, 2..120, texto seguro       |
| `consent`     | omitido                                 | deve ser boolean `true`                 |

CPF e telefone são convertidos em HMAC-SHA-256 com domínios distintos e `organization_id`. Lookup
desconhecido e telefone errado retornam exatamente o mesmo HTTP 422:

```json
{
  "error": {
    "code": "IDENTITY_NOT_CONFIRMED",
    "message": "Não foi possível confirmar os dados informados."
  }
}
```

Não alterar status, código ou mensagem de apenas um dos casos. `enroll` persiste no servidor
`consented_at` e `consent_version = 'pedon-clube-v1'`.

### 7.2 Rate limit

- fixed-window persistido no PostgreSQL;
- escopo HMAC de IP + slug + mode;
- lookup: 10 tentativas por 60 segundos;
- enroll: 5 tentativas por 60 segundos;
- excesso: HTTP 429 `RATE_LIMITED` com `Retry-After` positivo;
- tabela armazena apenas hash, início da janela, contador e expiração.

### 7.3 Token, disable e extrato

- token opaco 64 hex, TTL 2h, somente SHA-256 persistido;
- repetível para conta/extrato até checkout;
- checkout apaga o token atomicamente; falha da transação não o consome;
- após checkout ou expiração, consulta retorna `found=false`;
- token já emitido continua legível se o programa for desativado;
- programa desativado bloqueia novas identificações, novos checkouts Clube e novos earns;
- extrato público: máximo 50, ordem `created_at DESC, id DESC`;
- campos: `entry_type`, `gross_points`, `points_delta`, `recovery_delta`, `eligible_amount`,
  `order_number`, `created_at`.

### 7.4 Erros

SQLSTATE permanece:

| SQLSTATE | Mensagem                |
| -------- | ----------------------- |
| `PED51`  | `LOYALTY_UNAVAILABLE`   |
| `PED52`  | `INVALID_LOYALTY_TOKEN` |
| `PED53`  | `LOYALTY_INTEGRITY`     |

Edge HTTP público:

| HTTP | Códigos                                                                                      |
| ---: | -------------------------------------------------------------------------------------------- |
|  400 | `INVALID_JSON`, `INVALID_MODE`                                                               |
|  403 | `LOYALTY_UNAVAILABLE`                                                                        |
|  404 | `INVALID_SLUG`                                                                               |
|  405 | `METHOD_NOT_ALLOWED`                                                                         |
|  413 | `PAYLOAD_TOO_LARGE`                                                                          |
|  422 | `INVALID_CPF`, `INVALID_PHONE`, `INVALID_NAME`, `CONSENT_REQUIRED`, `IDENTITY_NOT_CONFIRMED` |
|  429 | `RATE_LIMITED`, com `Retry-After`                                                            |
|  500 | `LOYALTY_INTEGRITY`, `SERVER_CONFIG`, `UPSTREAM_ERROR`                                       |

### 7.5 Recompensas, resgate e vouchers

- `get_public_loyalty_rewards`: catálogo público sem estoque exato; `available` é booleano;
- `redeem_public_loyalty_reward`: custo server-authoritative, débito atômico de saldo/estoque,
  ledger `redeem`, voucher e consumo do token;
- `get_public_redemption_by_attempt`: recovery por slug, UUID e segredo aleatório, sem PII;
- `get_public_loyalty_account`: extrato de até 50 entradas e até 20 vouchers ativos;
- Reward management em `/app/clube`: owner-only, sem DELETE; desativar usa
  `set_loyalty_reward_active(false)`;
- `/app/vouchers`: owner/manager/operator com acesso à unidade consultam e consomem códigos;
- vouchers não expiram no Core MVP e `issued → consumed` é terminal.

Tentativa pendente de resgate usa `pedon:pending-redemption:<publicSlug>` por no máximo 24 horas e
contém somente `public_slug`, `idempotency_key`, `recovery_secret`, `reward_id` e `created_at`. Nunca
persistir access token, CPF, telefone, saldo ou resposta da conta. O código operacional do voucher
também não deve entrar em URL, Local Storage ou Session Storage.

## 8. Checkout e recuperação

O checkout público usa `create_public_order_v2`. Antes do envio, o frontend calcula um fingerprint
SHA-256 do payload canônico e mantém uma tentativa pendente em
`pedon:pending-order:<publicSlug>` por no máximo 24 horas.

Shape persistido exato:

```json
{
  "idempotency_key": "<uuid>",
  "request_fingerprint": "<64-hex>",
  "public_slug": "<slug>",
  "created_at": "<ISO-8601>"
}
```

Não persistir payload, nome, telefone, CPF, endereço, notas ou token de fidelidade. Ao reabrir, chamar
`get_public_order_by_attempt`; `found=true` recupera exatamente a resposta pública da criação, e
`found=false` permite retry seguro da mesma tentativa. Divergência de slug/chave/hash não revela o
pedido.

Tracking público usa `get_public_order` e omite notas livres dos itens. O detalhe administrativo
continua autorizado a exibi-las.

### 8.1 Central v2 e KDS

- `get_unit_orders_admin_v2(uuid,jsonb)` preserva a v1, usa filtros server-side e cursor keyset sem
  `OFFSET`; não há busca por cliente nesta etapa; `limit` default 50 e máximo 100.
- Active aceita `new`, `confirmed`, `preparing`, `ready`, `out_for_delivery` e ordena por overdue
  rank, status bucket, `status_updated_at`, `created_at`, `id`. History aceita `completed`,
  `cancelled` e ordena por `created_at DESC, id DESC`.
- View/status incompatível e demais filtros inválidos retornam `PED79 INVALID_ORDER_FILTER`.
- Cursor é base64url, single-line, opaco, sem PII/segredo. A migration remove whitespace/newline no
  encode e no decode com `regexp_replace(..., '\s', '', 'g')`.
- `snapshot_at` congela apenas a referência temporal de overdue, não o dataset entre requests.
  Mudanças reais de status podem alterar páginas; em Realtime/refetch, reiniciar da primeira página.
- `get_kds_orders_minimal(uuid)` usa `can_access_unit`, retorna no máximo 200 pedidos
  `new`/`confirmed`/`preparing`/`ready` e sinaliza `truncated=true`. É uma superfície dedicada e usa a
  mesma order state machine.
- O KDS retorna somente identidade operacional do pedido, status/modo/tempos, itens, quantidade,
  nota e nomes/tipos de opções. Não retorna cliente/telefone/endereço, pagamento, dinheiro/totais,
  loyalty, tracking, idempotência nem IDs técnicos de menu/catálogo.

## 9. Administração e frontend

- `/clube/:publicSlug`: lookup/enroll, saldo, rewards, resgate/recovery, vouchers e extrato;
- checkout: vínculo opcional do token do Clube sem quebrar guest checkout;
- `/app/clube`: protegido por `RequireOwner`; programa, métricas, membros e Reward management;
- `/app/vouchers`: operação por unidade para owner/manager/operator autorizados;
- `/app/equipe`: gestão de acesso por unidade, owner-only;
- `/app/diagnostico`: versão/SHA, contexto, conectividade e readiness, owner-only;
- manager/operator não acessam a página nem as RPCs owner-only;
- toggle chama RPC server-authoritative e invalida/refaz a query do programa;
- mudança de usuário chama `queryClient.clear()` e remove a unidade selecionada;
- Realtime continua somente como gatilho de invalidação/refetch.

## 10. Rotas atuais

| Rota                         | Estado                                    |
| ---------------------------- | ----------------------------------------- |
| `/`                          | landing/fundação                          |
| `/login`                     | entrada                                   |
| `/cadastro`                  | cadastro com confirmação de e-mail        |
| `/onboarding`                | onboarding transacional                   |
| `/app`                       | área administrativa e contexto de unidade |
| `/app/catalogo`              | catálogo por unidade                      |
| `/app/configuracoes`         | configuração operacional owner/manager    |
| `/app/cardapio`              | publicação owner/manager                  |
| `/app/pedidos`               | Central de Pedidos                        |
| `/app/clube`                 | administração owner-only                  |
| `/app/vouchers`              | consulta e consumo por unidade             |
| `/app/equipe`                | gestão de equipe owner-only                 |
| `/app/diagnostico`           | diagnóstico owner-only                      |
| `/menu/:publicSlug`          | cardápio público                          |
| `/menu/:publicSlug/carrinho` | carrinho público local                    |
| `/menu/:publicSlug/checkout` | checkout guest/Clube network-only         |
| `/pedido/:trackingToken`     | tracking público minimizado               |
| `/clube/:publicSlug`         | Clube público                             |

## 11. CI e Cloudflare

| Item              | Configuração existente                     |
| ----------------- | ------------------------------------------ |
| Repositório       | `https://github.com/Rodrigo-Kotlin/ped-on` |
| Branch            | `main`                                     |
| Workflow          | `.github/workflows/ci.yml`, nome `CI`      |
| Pages project     | `ped-on`                                   |
| Production branch | `main`                                     |
| Build             | `pnpm build`                               |
| Output            | `apps/web/dist`                            |
| URL estável       | `https://ped-on.pages.dev`                 |

Jobs obrigatórias atuais: `Quality gates`, `E2E smoke tests` e `Backend release gates`. Backend
reconstrói o Supabase local exclusivamente pelas migrations versionadas, valida alinhamento local,
executa `supabase db lint --local --level error --fail-on error`, as doze suítes DB sequenciais e
Edge unit. O job
não usa service role, senha ou banco remoto. Edge smoke remoto e Cloudflare smoke permanecem gates
manuais de release por dependerem de ambiente implantado.

Checkpoint Prompt 13 — `BACKEND_OPERATIONAL_CHECKPOINT — ACHIEVED` (Etapa 13.2):

- Prompt 13 `IN PROGRESS`; Etapa 13.1 `COMPLETED` — `CONTRACT_FREEZE APPROVED_WITH_FINDINGS`;
  Etapa 13.2 `COMPLETED`; Etapa 13.3 `NOT STARTED — READY`; `OPERATION_READY: NOT ACHIEVED`;
- HEAD técnico `0e171c55afe3a88a699f1ee81b8f937a70659226`; CI `31859960640` SUCCESS nos três jobs;
- migration 23 `20260814100000_prompt13_backend_operational_core.sql`: NEW-MEDIUM-1, Central v2,
  KDS minimizado, PED79, índice `orders_unit_active_urgency_idx` e grants/revokes;
- backend: fresh rebuild isolado das 23 migrations, alinhamento, DB lint, 12 suítes com 1494/1494
  checks e Edge 15/15;
- DB push PASS; Git/filesystem/remoto 23/23/23; post-push dry-run PASS/up to date; linked lint PASS
  com zero erros; remote drift `NONE`;
- remote smokes limitados, PASS nos casos executados. Não houve paginação com massa real no remoto;
  paginação e concorrência permanecem autoritativamente cobertas no CI isolado;
- `NEW-MEDIUM-1: RESOLVED` pela ordem unit → produto → `max(sort_order)+100` → insert;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`;
- `LOCAL DB TESTS: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Checkpoint Prompt 12 — `ADMIN_CHECKPOINT` (Etapa 3 do Prompt 12 concluída):

- source técnico `df2cee31fa4afb288ab5d7bb08ae54d07aff1572`;
- CI `31761944228`: `Quality gates`, `Backend release gates` e `E2E smoke tests` aprovados;
- backend: fresh rebuild isolado das 20 migrations, alinhamento, DB lint, dez suítes com 1332/1332
  checks (inclui `product_options_integrity`) e Edge unit 15/15;
- Frontend unit: 312/312; E2E smoke tests: 288/288, dos quais 52 são os 13 cenários do Prompt 12
  (grupos variação/adicional/remoção, min/max, opções com preço/desconto, edição, desativação,
  operator view-only e offline) em 4 viewports;
- Supabase em 20/20, dry-run linked informa remote up to date e lint linked não encontrou erros;
- rebuild local não executado por design.

Fechamento oficial do Prompt 12 — `COMPLETED` / `RELEASE_VERIFIED` / `MENU_COMMERCIALLY_USABLE`
(evidência atual):

- reauditoria final #2: `PASS_WITH_FINDINGS` / `GO_WITH_NON_BLOCKING_FINDINGS` — CRITICAL 0, HIGH 0,
  MEDIUM BLOCKING 0, MEDIUM NON-BLOCKING 1 (`NEW-MEDIUM-1`, lock-order inversion nos dois CREATE de
  product options — follow-up Prompt 13+), INFO 1 (limitação de evidência Cloudflare);
- HEAD técnico (release funcional) `f663cecb96ef87f397376e29aee82cd24ba846df`; o novo HEAD
  documental de fechamento não substitui o SHA técnico;
- CI técnico `31814657987` e CI documental `31823617636` SUCCESS nos três jobs; CI final de
  fechamento registrado abaixo;
- backend: fresh rebuild isolado das 22 migrations, alinhamento, DB lint, onze suítes com 1409/1409
  checks (0 FAIL, 0 SKIP) e Edge unit 15/15;
- Frontend unit 383/383 (40 arquivos); E2E 345/345 com 3 skips móveis intencionais;
- migrations Git/filesystem 22/22; remoto 22/22 (último estado verificado); `LIVE SQL RECHECK
  DURING FINAL REAUDIT: UNAVAILABLE` — limitação de credencial/rede do ambiente de execução, sem
  evidência de drift; nenhum teste destrutivo no banco oficial;
- Cloudflare stable `https://ped-on.pages.dev` responsiva. **Distinção intencional:**
  `FUNCTIONAL SOURCE HEAD` = `f663cec…`; `CLOUDFLARE BUILD SOURCE SHA` = SHA docs/current main do
  deploy (na reauditoria final, o stable servia o bundle com `CF_PAGES_COMMIT_SHA` `7e351a4`,
  redeployado pelos commits docs-only; após o commit de fechamento, passa a servir o novo HEAD
  documental). Não afirmar que o stable "serve f663cec" se o `CF_PAGES_COMMIT_SHA` indicar outro
  commit. Commits intermediários são docs-only — sem mudança funcional;
- deployment id e immutable URL `UNVERIFIED` — sem credencial Cloudflare API no ambiente
  (limitação de evidência, INFO não bloqueante);
- precache 33 entradas, 933164 bytes, sem duplicatas e `runtimeCaching: NONE`;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`; `CI ISOLATED DB REBUILD: PASS`.

Release candidata do Prompt 12 — `READY_FOR_REAUDIT` (Release Reconvergence, histórico):

- source técnico / release funcional `f663cecb96ef87f397376e29aee82cd24ba846df`; etapa iniciada em
  `1c1fff0`; worktree limpo e `main` alinhado;
- CI `31814657987`: `Quality gates`, `Backend release gates` e `E2E smoke tests` SUCCESS;
- backend: fresh rebuild isolado das 22 migrations, alinhamento, DB lint, onze suítes com 1409/1409
  checks (0 FAIL, 0 SKIP) e Edge unit 15/15;
- Frontend unit 383/383 (40 arquivos); E2E 345/345 com 3 skips móveis intencionais;
- seis blockers originais revalidados como RESOLVED (HIGH-1..HIGH-5, MEDIUM BLOCKING-1);
- migrations Git/filesystem 22/22; remoto 22/22 (registrado na etapa B1); checagem remota ao vivo
  não executável nesta máquina na reconvergência (sem credencial de banco válida) — sem evidência de
  drift;
- Cloudflare estável `https://ped-on.pages.dev` responsiva na reconvergência; verificação de SHA
  registrada na seção de fechamento final acima (o stable redeploya por commits docs-only e o
  `CF_PAGES_COMMIT_SHA` reflete o build source, não o HEAD funcional); deployment id e immutable URL
  `UNVERIFIED` — sem credencial Cloudflare API no ambiente (limitação de evidência, INFO não
  bloqueante);
- precache 33 entradas, 933164 bytes, sem duplicatas e `runtimeCaching: NONE`;
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

Release candidata do Prompt 12 — `READY_FOR_REAUDIT` (Etapa 5 concluída, histórico técnico):

- source técnico `9139391ca418dc063cdd7366d6b8e447cccacc3a`; implementação de hardening `c970381`;
- CI `31787020339`: `Quality gates`, `Backend release gates` e `E2E smoke tests` aprovados;
- backend: fresh rebuild isolado das 21 migrations, alinhamento, DB lint, dez suítes com 1340/1340
  checks (`product_options_integrity` 158/158) e Edge unit 15/15;
- Frontend unit 354/354; E2E 345/345 com 3 skips móveis intencionais; Prompt 12 4B 20/20;
- Supabase em 21/21, dry-run linked up to date e linked lint sem erros;
- Cloudflare deployment `40091196-3bdf-4f15-86fe-54d2816138a2`, source `9139391`, imutável
  `https://40091196.ped-on.pages.dev` e estável `https://ped-on.pages.dev`; assets iguais, SHA no
  diagnóstico e fallbacks SPA 18/18;
- precache 33 entradas, 929032 bytes, sem duplicatas e `runtimeCaching: NONE`;
- rebuild local não executado por design.

Release candidata do Prompt 11 — `READY_FOR_REAUDIT` (histórico):

- source técnico `925f7d94adea4c0c2cef9a1017270269960817aa`;
- CI `31712486989`: `Quality gates`, `Backend release gates` e `E2E smoke tests` aprovados;
- backend: fresh rebuild isolado das 19 migrations, alinhamento, DB lint, nove suítes com 1182/1182
  checks e Edge unit 15/15;
- E2E smoke tests: 236/236;
- Cloudflare check/deployment `82dedad7-c36e-4ddf-af8a-8d48176b9b0a` aprovado;
- URL imutável `https://82dedad7.ped-on.pages.dev` e URL estável `https://ped-on.pages.dev`;
- fallback SPA aprovado em 18/18 rotas imutáveis e 4/4 rotas estáveis, com o SHA técnico confirmado
  no bundle lazy de diagnóstico;
- Supabase em 19/19, dry-run linked informa remote up to date e lint linked não encontrou erros;
- rebuild local não executado por design.

Encerramento oficial do Prompt 11 — `RELEASE_VERIFIED` (reauditoria independente):

- HEAD auditado / release verificado: `3a6cd42eab24719e01505fc854d03c65ca9d9975`;
- CI final auditado `31713901328`: `Quality gates`, `Backend release gates` e `E2E smoke tests`
  SUCCESS;
- Cloudflare imutável `https://8f7d42fd.ped-on.pages.dev` e estável `https://ped-on.pages.dev`;
- resultado: `GO_WITH_NON_BLOCKING_FINDINGS` — CRITICAL 0, HIGH 0, MEDIUM BLOCKING 0; LOW 4, INFO 1;
- test baseline: Frontend 274/274; E2E 236/236; Prompt 11 44/44; DB 1182/1182; readiness 84/84;
  Edge 15/15; DB lint PASS; migrations 19/19; Supabase dry-run remote up to date;
- PILOT_READY: ACHIEVED; Prompt 12: IN PROGRESS — checkpoint `ADMIN_CHECKPOINT`;
- banco descartável/rebuild: exclusivamente GitHub Actions; nenhum Docker local.

Release técnica histórica do Prompt 10, não utilizável como evidência do Prompt 11:

- source `2a91711bc83b54841b4b4beee8beca930b9ea986`;
- run CI `31598675826`, com Quality gates, Backend release gates e E2E smoke tests aprovados;
- deployment `ceaf4832-bc0e-4159-a983-fd5ca367efd8`;
- URL imutável `https://ceaf4832.ped-on.pages.dev` e domínio estável aprovados;
- fallback SPA 200 nas rotas públicas e administrativas do Prompt 10 (HTTP PASS);
- PWA PASS; stable e immutable serviram o mesmo asset;
- smoke com Service Worker ativo confirmou ausência de runtime cache para APIs mutáveis do Clube;
- manifest, service worker e assets aprovados;
- RPCs públicas v2 presentes no bundle, sem nomes de secret, `service_role` ou runtime cache privado.

## 12. Diagnóstico rápido

| Sintoma                                  | Verificação                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| Edge retorna 401                         | JWT/publishable key ausente; `verify_jwt` deve permanecer ativo            |
| Edge retorna `SERVER_CONFIG`             | conferir Edge Secrets e envs automáticos; não usar Vault/browser           |
| `IDENTITY_NOT_CONFIRMED`                 | identidade desconhecida ou telefone divergente; não distinguir na resposta |
| `CONSENT_REQUIRED`                       | enroll não enviou boolean `true`                                           |
| 429 `RATE_LIMITED`                       | aguardar `Retry-After`; conferir janela/escopo opaco no backend            |
| `PED51` no checkout                      | programa ausente/desabilitado; guest sem token continua válido             |
| `PED52` no checkout                      | token expirado, consumido, inválido ou de outro tenant                     |
| Conta retorna `found=false`              | token expirado/desconhecido ou já consumido no checkout                    |
| Recovery retorna `found=false`           | slug, idempotency UUID ou attempt hash não correspondem                    |
| Tracking não mostra nota de item         | comportamento esperado de minimização pública                              |
| Manager/operator recebe `PED11` no Clube | comportamento esperado; administração é owner-only                         |
| Reward não aparece publicamente          | conferir programa, `is_active`, slug e resposta de catálogo                 |
| Resgate retorna `PED56`                  | reward mudou; recarregar catálogo e pedir nova confirmação                  |
| Resgate retorna `PED57`/`PED58`          | estoque esgotado ou saldo insuficiente                                      |
| Recovery de resgate retorna `found=false` | slug, UUID ou recovery secret não correspondem                             |
| Voucher retorna `PED61`                  | já consumido; a transição é terminal                                        |
| Staff recebe `PED11` no voucher          | conferir unidade ativa e `membership_units`                                 |
| Painel de opções retorna `PED72`         | grupo ausente/alvo errado; recarregar catálogo                              |
| Grupo/opção retorna `PED73`              | regra de seleção inválida para o `kind` (ex.: variação multi-escolha)       |
| Opção retorna `PED74`/`PED75`            | opção inexistente ou indisponível no momento                                |
| Checkout retorna `PED76`/`PED77`         | seleção obrigatória ausente ou acima do `max_select` do grupo               |
| Checkout retorna `PED78`                 | opção selecionada pertence a outro cardápio publicado                       |
| Central v2 retorna `PED79`               | revisar keys, enums, limit, timestamps, cursor e compatibilidade view/status |
| Página active muda após Realtime         | reiniciar paginação na primeira página; `snapshot_at` não isola o dataset    |
| KDS retorna `truncated=true`             | mais de 200 pedidos de cozinha; tratar como refetch/alerta operacional       |
| Dados antigos após troca de login        | confirmar `queryClient.clear()` em mudança de user ID                      |
| Migration ausente                        | `supabase migration list`; revisar antes de `db push --linked`             |
| DB test falha por contagem               | confirmar execução sequencial das doze suítes                              |

## 13. Próximo passo

Prompt 13 está `COMPLETED`. Etapas 13.1, 13.2, 13.3, 13.4B, 13.5A, 13.5B e 13.6 estão
`COMPLETED` (13.5A registrada como DEC-124 — alertas operacionais locais + audit-precache
endurecido; 13.5B polimento UI operacional; 13.6 hardening audit sem alteração de código —
DEC-125); `NEW-MEDIUM-1` está `RESOLVED` pela migration 23. `RELEASE_CANDIDATE_CHECKPOINT —
ACHIEVED` e `OPERATION_READY — ACHIEVED`. PILOT GATE `IN PROGRESS` — Parte 1 preparação concluída
(`PILOT_PREPARATION_CHECKPOINT — ACHIEVED`; DEC-126) em `docs/PEDON_PILOT_GATE.md`. O próximo passo
é a Parte 2 (`SELEÇÃO CONTROLADA + ONBOARDING`), que não deve ser iniciada sem aprovação humana
explícita do relatório da Parte 1.
