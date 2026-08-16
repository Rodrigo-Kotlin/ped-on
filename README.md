# Ped-On

> Gestão de Pedidos Inteligente

PWA SaaS multiempresa para restaurantes, hamburguerias, lanchonetes e estabelecimentos semelhantes.

## Estado atual

Fase 4A — Pilot Ready, Prompt 13: Operação de Pedidos 2.0.
Status `COMPLETED`, checkpoint `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED`.
Etapas 13.1–13.6 `COMPLETED` (13.6 = hardening audit + RC sem alteração de código, DEC-125).

`PILOT_READY: ACHIEVED`.
`MENU_COMMERCIALLY_USABLE: ACHIEVED`.
`PROMPT 12: COMPLETED / RELEASE_VERIFIED`; `PROMPT 13: COMPLETED`.
`NEW-MEDIUM-1: RESOLVED — Prompt 13 / migration 23`.
`OPERATION_READY: ACHIEVED`.

PILOT GATE `IN PROGRESS` (Parte 1 — preparação): `PILOT_PREPARATION_CHECKPOINT — ACHIEVED` (DEC-126);
`PILOT_ONBOARDING — READY / NOT STARTED`; `PILOT_OPERATION — NOT STARTED`; `PROMPT 14 — NOT STARTED`.
Governança do piloto controlado (3–5 estabelecimentos) em `docs/PEDON_PILOT_GATE.md`.

`LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.
`CI ISOLATED DB REBUILD: PASS` (GitHub Actions; nenhum Docker local).

O produto atual inclui:

- Supabase Auth, onboarding, tenant e RBAC `owner`/`manager`/`operator` por unidade;
- configuração operacional, catálogo mutável e publicação de cardápio por snapshot imutável;
- grupos de variações/adicionais/remoções, personalização pública, preço autoritativo e snapshots de
  opções no pedido;
- carrinho local sem PII, checkout guest idempotente e recuperação segura de tentativa pendente;
- tracking público por token opaco, com resposta minimizada e sem notas livres dos itens;
- Central de Pedidos, lifecycle, pagamento operacional separado, auditoria e Realtime para refetch;
- backend da Central v2 com filtros server-side, paginação keyset e contrato `PED79`, além de RPC KDS
  dedicada e minimizada; frontend da Central, KDS e comanda entregue nas Etapas 13.3–13.5B;
- Clube Ped-On por organização, com identificação pública por CPF + telefone protegidos por HMAC;
- consentimento explícito e auditável, saldo, ledger append-only, extrato público e vínculo opcional
  no checkout;
- painel owner-only para ativar/desativar o programa e consultar métricas e membros mascarados;
- catálogo público de recompensas, resgate atômico recuperável, vouchers ativos e extrato `redeem`;
- Reward management owner-only com Create / Read / Update / Activate-Deactivate / Stock Adjustment;
- validação e consumo de vouchers por owner/manager/operator no contexto da unidade;
- prontidão para piloto derivada do estado real, gestão owner-only de acessos por unidade e
  diagnóstico com versão/SHA;
- estados offline/loading/error e atualização PWA explícita, sem interromper mutações críticas;
- PWA hospedada em Cloudflare Pages e CI no GitHub Actions.

O CPF e o telefone completos não são persistidos. A Edge Function `loyalty-cpf` usa fingerprints
HMAC tenant-bound, aplica rate limit persistente e emite token opaco de 2 horas. Recompensas,
resgates e vouchers estão implementados de ponta a ponta. Reward management não possui DELETE por
design; a remoção operacional usa `set_loyalty_reward_active(false)`.

## Objetivo do MVP

```text
proprietário → organização → unidade → catálogo → publicação → cardápio público
→ carrinho → checkout → pedido idempotente → Central de Pedidos → conclusão
→ fidelidade → pontos → recompensa → voucher
```

Essa sequência é o roadmap do MVP, não uma declaração de que todos os módulos já existem.

## Stack

- TypeScript estrito, React 19 e React Router 8
- pnpm workspaces
- Vite, Tailwind CSS 4 e PWA via `vite-plugin-pwa`
- Supabase (PostgreSQL, Auth, RLS, RPCs e Edge Functions/Deno)
- Cloudflare Pages
- Vitest, Testing Library, Playwright e testes de integração PostgreSQL
- GitHub Actions e Gitleaks

## Estrutura do monorepo

```text
ped-on/
├── apps/
│   └── web/                       # PWA React/Vite
│       ├── e2e/                   # E2E mocked em quatro viewports
│       └── src/                   # app, componentes, domínio web e páginas
├── packages/                      # config, domain, schemas, test-utils e UI
├── supabase/
│   ├── migrations/                # 23 migrations versionadas até a Etapa 13.2 do Prompt 13
│   ├── tests/                     # doze suítes DB e smoke remoto da Edge
│   ├── functions/loyalty-cpf/     # Edge Function e testes Deno
│   └── seed.example.sql           # seed de exemplo, sem dados reais
├── docs/                          # continuidade, schema, RLS e operação
├── .github/workflows/             # CI
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

## Rotas atuais

| Rota                     | Função                                               |
| ------------------------ | ---------------------------------------------------- |
| `/`                      | landing técnica                                      |
| `/login`                 | autenticação                                         |
| `/cadastro`              | criação de conta                                     |
| `/onboarding`            | criação transacional da organização/unidade          |
| `/app`                   | área administrativa e seleção de unidade             |
| `/app/catalogo`          | categorias e produtos por unidade                    |
| `/app/configuracoes`     | configuração operacional da unidade                  |
| `/app/cardapio`          | publicação e cardápio público                        |
| `/app/pedidos`           | Central de Pedidos por unidade                       |
| `/app/clube`             | programa, métricas, membros e rewards; somente owner |
| `/app/vouchers`          | validação e consumo de vouchers por unidade          |
| `/app/equipe`            | gestão owner-only dos acessos por unidade            |
| `/app/diagnostico`       | versão, contexto, conectividade e readiness          |
| `/menu/:slug`            | cardápio público do cliente                          |
| `/menu/:slug/carrinho`   | carrinho público local                               |
| `/menu/:slug/checkout`   | checkout guest/Clube, idempotente e network-only     |
| `/pedido/:trackingToken` | acompanhamento público minimizado                    |
| `/clube/:publicSlug`     | identificação, cadastro, saldo e extrato públicos    |

As autorizações administrativas permanecem vinculadas à organização e à unidade. A gestão do Clube
é owner-only no frontend e no PostgreSQL; manager e operator não acessam programa, métricas ou
membros.

## Requisitos locais

- Node.js `>=22`
- pnpm `>=9` (`pnpm@9.15.9` fixado no projeto)
- Deno 2 para testes unitários da Edge Function
- Git
- Chromium do Playwright para E2E
- Supabase CLI e acesso ao banco oficial somente para operações/testes DB

## Instalação

```bash
pnpm install
pnpm --filter @pedon/web exec playwright install chromium
```

## Comandos

| Comando                                                                                                    | Descrição                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pnpm dev`                                                                                                 | app web em desenvolvimento           |
| `pnpm build`                                                                                               | build PWA em `apps/web/dist`         |
| `pnpm lint`                                                                                                | ESLint                               |
| `pnpm typecheck`                                                                                           | TypeScript sem emissão               |
| `pnpm test:run`                                                                                            | testes frontend unitários/componente |
| `pnpm test:e2e`                                                                                            | E2E Playwright mocked                |
| `deno test --config supabase/functions/loyalty-cpf/deno.json supabase/functions/loyalty-cpf/index_test.ts` | testes unitários da Edge             |
| `node supabase/tests/loyalty_integrity.test.mjs`                                                           | integração DB do Clube               |
| `node supabase/tests/loyalty_edge_smoke.mjs`                                                               | smoke remoto da Edge deployada       |
| `pnpm format` / `pnpm format:check`                                                                        | aplicar/verificar Prettier           |

## Banco e migrations

O filesystem versionado possui 23 migrations ordenadas:

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

Fluxo linked não destrutivo:

```bash
supabase migration list
supabase db push --linked --dry-run
# Somente após CI verde e aprovação explícita da migration:
supabase db push --linked
supabase migration list
supabase db lint --linked
```

Git/filesystem e remoto estão em 23/23/23; o post-push dry-run linked informa que o remoto está up to
date, o linked lint tem zero erros e o drift remoto é `NONE`.
Somente o comando com `--dry-run` é não destrutivo; não executar o push real antes de CI verde e
aprovação da migration. Não reaplicar migrations já aplicadas, editar migration existente ou usar
`supabase db reset` localmente.

## Testes do Prompt 13 — backend operational checkpoint

- CI técnico `31859960640`: frontend unit 383/383 (40 arquivos), E2E 345/345 com 3 skips móveis
  intencionais e Edge unit 15/15;
- banco isolado: doze suítes, DB lint e baseline 1494/1494 checks, com fresh rebuild das 23
  migrations;
- migrations Git/filesystem/remoto: 23/23/23; post-push dry-run up to date; linked lint zero erros;
  remote drift `NONE`;
- remote smokes limitados passaram nos casos executados; paginação com massa real não foi executada
  no remoto, permanecendo paginação/concorrência autoritativamente cobertas no CI isolado;
- `LOCAL DB TESTS: NOT RUN — BY DESIGN / NO LOCAL DOCKER`;
- Cloudflare estável `https://ped-on.pages.dev` responsiva. **Distinção intencional:**
  `FUNCTIONAL SOURCE HEAD` = `f663cecb96ef87f397376e29aee82cd24ba846df`;
  `CLOUDFLARE BUILD SOURCE SHA` = SHA docs/current main de cada deploy (`CF_PAGES_COMMIT_SHA`); os
  commits entre o HEAD técnico e o build source são docs-only, sem mudança funcional. Deployment id
  e immutable URL permanecem `UNVERIFIED` por ausência de credencial Cloudflare API no ambiente
  (limitação de evidência, não bloqueante).

## Segurança e secrets

- Nunca commitar tokens, senhas, chaves Supabase, `service_role` ou credenciais.
- O browser usa apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `LOYALTY_CPF_HMAC_KEY` é um Supabase Edge Secret lido por `Deno.env`; não fica no frontend, no
  repositório nem no Supabase Vault.
- A Edge `loyalty-cpf` está deployada com `verify_jwt` ativo e respostas `no-store`.
- Lookup desconhecido e telefone divergente retornam exatamente HTTP 422
  `IDENTITY_NOT_CONFIRMED`, sem permitir enumeração.
- Rate limit fixed-window persiste apenas HMAC de IP + slug + modo, sem PII: lookup 10 e enroll 5
  tentativas por 60 segundos; excesso retorna 429 com `Retry-After`.
- O token do Clube é repetível para saldo/extrato durante 2 horas até ser consumido atomicamente no
  checkout; depois retorna `found=false`.
- Se o programa for desativado, token já emitido continua legível, mas novas identificações e novos
  checkouts com Clube são bloqueados.
- A troca de usuário limpa todo o cache de queries administrativo.

## Documentação

- `docs/PEDON_IMPLEMENTATION_STATUS.md`: checkpoint oficial da implementação
- `docs/PEDON_DECISION_REGISTER.md`: decisões aprovadas e abertas
- `docs/PEDON_DATABASE_SCHEMA.md`: schema cumulativo e contratos SQL/HTTP
- `docs/PEDON_RLS_SECURITY.md`: RLS, grants, RBAC e testes de isolamento
- `docs/PEDON_RUNBOOK.md`: operação local, Supabase, testes, CI e deploy
- `docs/PEDON_POST_MVP_ROADMAP.md`: roadmap oficial pós-Core MVP
- `docs/PROMPT13_ETAPA_13_6_HARDENING.md`: auditoria de hardening e decisão RC (13.6)
- `docs/PEDON_PILOT_GATE.md`: governança do piloto controlado (charter, gates, incidentes, evidências)

Prompt 11: `COMPLETED` / checkpoint `RELEASE_VERIFIED` / marco `PILOT_READY: ACHIEVED`.
Prompt 12: `COMPLETED` / checkpoint `RELEASE_VERIFIED` / marco `MENU_COMMERCIALLY_USABLE: ACHIEVED`
(reauditoria final `PASS_WITH_FINDINGS` / `GO_WITH_NON_BLOCKING_FINDINGS`).
Prompt 13: `COMPLETED` / checkpoint `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED` /
`OPERATION_READY: ACHIEVED`.
PILOT GATE: `IN PROGRESS` — `PILOT_PREPARATION_CHECKPOINT — ACHIEVED` (DEC-126);
`PILOT_ONBOARDING: READY / NOT STARTED`; `PILOT_OPERATION: NOT STARTED`; `PROMPT 14: NOT STARTED`.
