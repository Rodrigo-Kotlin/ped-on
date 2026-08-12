# Ped-On

> Gestão de Pedidos Inteligente

PWA SaaS multiempresa para restaurantes, hamburguerias, lanchonetes e estabelecimentos semelhantes.

## Estado atual

Fase 3C, Prompt 10: Recompensas, resgate atômico e vouchers do Clube Ped-On, `IN_PROGRESS`.
Checkpoint `BACKEND_CORE_COMPLETED` versionado em `0d4dfd5`; frontend do Prompt 10 ainda não iniciado.

O produto atual inclui:

- Supabase Auth, onboarding, tenant e RBAC `owner`/`manager`/`operator` por unidade;
- configuração operacional, catálogo mutável e publicação de cardápio por snapshot imutável;
- carrinho local sem PII, checkout guest idempotente e recuperação segura de tentativa pendente;
- tracking público por token opaco, com resposta minimizada e sem notas livres dos itens;
- Central de Pedidos, lifecycle, pagamento operacional separado, auditoria e Realtime para refetch;
- Clube Ped-On por organização, com identificação pública por CPF + telefone protegidos por HMAC;
- consentimento explícito e auditável, saldo, ledger append-only, extrato público e vínculo opcional
  no checkout;
- painel owner-only para ativar/desativar o programa e consultar métricas e membros mascarados;
- PWA hospedada em Cloudflare Pages e CI no GitHub Actions.

O CPF e o telefone completos não são persistidos. A Edge Function `loyalty-cpf` usa fingerprints
HMAC tenant-bound, aplica rate limit persistente e emite token opaco de 2 horas. O backend de
recompensas, resgates e vouchers está implementado; as interfaces públicas, administrativas e staff
permanecem pendentes.

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
│   ├── migrations/                # 14 migrations versionadas até Prompt 09 hardening
│   ├── tests/                     # sete suítes DB e smoke remoto da Edge
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
| `/app/clube`             | programa, métricas e membros do Clube; somente owner |
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

O projeto oficial possui 14 migrations Local == Remote:

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

Fluxo linked não destrutivo:

```bash
supabase migration list
supabase db push --linked
supabase migration list
supabase db lint --linked
```

`supabase db lint --linked` está verificado com sucesso no checkpoint atual. Não editar migration já
aplicada e não usar `supabase db reset` como substituto desse fluxo.

## Testes verificados

- frontend unit/component: 157/157;
- E2E mocked: 148/148 em 360/768/1024/1440;
- banco: RLS 22/22, RBAC 31/31, operacional 80/80, catálogo 123/123, menu 121/121,
  pedidos 318/318 e loyalty 148/148;
- Edge unit: 14/14;
- Edge remote smoke: 36/36;
- `supabase db lint --linked`: PASS;
- migrations: 14 Local == Remote.

Format, lint, typecheck, testes, build, E2E, Gitleaks, Edge unit, alinhamento de migrations e db lint
passaram na reauditoria local de 2026-08-11. O run CI `31524498264` e o deployment Cloudflare
`63b40263-d3b7-4d41-a5b2-ee8ecc97f4d0`, ambos da release `2013e8d`, também passaram.

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

Próximo passo oficial: frontend público do Prompt 10. O prompt permanece `IN_PROGRESS`, no checkpoint
`BACKEND_CORE_COMPLETED`, até frontend, testes, CI e produção serem verificados.
