# Ped-On

> Gestão de Pedidos Inteligente

PWA SaaS multiempresa para restaurantes, hamburguerias, lanchonetes e estabelecimentos semelhantes.

## Estado atual

Fase 3A — Pedidos: checkout público e Central de Pedidos. O Prompt 08 está concluído com:

- Supabase Auth, identidade, onboarding e tenant;
- RBAC `owner`/`manager`/`operator` com acesso por unidade;
- gestão de unidades e contexto administrativo;
- configuração operacional por unidade;
- catálogo administrativo por unidade com categorias e produtos simples;
- preço decimal exato e disponibilidade operacional separada do estado estrutural;
- cardápio público anônimo via slug opaco a partir de snapshot comercial imutável, com overlay
  dinâmico de disponibilidade;
- publicação `owner`/`manager` com histórico de versões;
- carrinho público local vinculado à versão publicada, sem persistência de PII;
- checkout guest idempotente com preços, taxas e totais calculados no PostgreSQL;
- tracking público por token opaco, sem PII ou IDs internos;
- Central de Pedidos por unidade com lifecycle, pagamento operacional separado e auditoria;
- Realtime usado somente para invalidar e refazer queries administrativas;
- PWA em Cloudflare Pages e CI no GitHub Actions.

O catálogo administrativo continua mutável; publicação e pedido preservam snapshots comerciais
imutáveis. Não há gateway, pagamento online, roteirização, CPF ou fidelidade nesta etapa.

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
- Supabase (PostgreSQL, Auth, RLS e RPCs)
- Cloudflare Pages
- Vitest, Testing Library e Playwright
- GitHub Actions e Gitleaks

## Estrutura do monorepo

```text
ped-on/
├── apps/
│   └── web/                       # PWA React/Vite
│       ├── e2e/                   # E2E Auth, catálogo, cardápio e pedidos
│       └── src/
│           ├── app/               # Router e providers
│           ├── components/        # Shell administrativo
│           ├── lib/               # Auth, admin, catálogo, carrinho e pedidos
│           └── pages/             # Páginas e testes de componente
├── packages/
│   ├── config/                    # Configuração compartilhada
│   ├── domain/                    # Fundação de domínio
│   ├── schemas/                   # Contratos compartilhados
│   ├── test-utils/                # Utilitários de teste
│   └── ui/                        # Componentes compartilhados
├── supabase/
│   ├── migrations/                # Dez migrations versionadas até Prompt 08
│   ├── tests/                     # Seis suítes de integração DB
│   ├── functions/                 # Espaço para Edge Functions
│   └── seed.example.sql           # Seed de exemplo, sem dados reais
├── docs/                          # Continuidade, schema, RLS e operação
├── .github/workflows/             # CI
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

## Rotas atuais

| Rota                     | Função                                      |
| ------------------------ | ------------------------------------------- |
| `/`                      | landing técnica                             |
| `/login`                 | autenticação                                |
| `/cadastro`              | criação de conta                            |
| `/onboarding`            | criação transacional da organização/unidade |
| `/app`                   | área administrativa e seleção de unidade    |
| `/app/catalogo`          | categorias e produtos por unidade           |
| `/app/configuracoes`     | configuração operacional da unidade         |
| `/app/cardapio`          | publicação e cardápio público               |
| `/app/pedidos`           | Central de Pedidos por unidade              |
| `/menu/:slug`            | cardápio público do cliente (sem sessão)    |
| `/menu/:slug/carrinho`   | carrinho público local                      |
| `/menu/:slug/checkout`   | checkout guest network-only                 |
| `/pedido/:trackingToken` | acompanhamento público do pedido            |

`/app/catalogo` permite leitura a owner, manager e operator autorizados. Owner/manager gerenciam a
estrutura; operator altera somente a disponibilidade de produtos. `/app/configuracoes` é restrita a
owner/manager autorizados. `/app/cardapio` exige owner/manager para publicar; `/menu/:slug` é
público e lê apenas `get_public_menu`. `/app/pedidos` permite leitura e transição de status aos três
papéis autorizados; reembolso operacional exige owner/manager.

## Requisitos locais

- Node.js `>=22`
- pnpm `>=9` (`pnpm@9.15.9` fixado no projeto)
- Git
- Chromium do Playwright para E2E
- Supabase CLI e acesso ao banco oficial somente para operações/testes DB

## Instalação

```bash
pnpm install
pnpm --filter @pedon/web exec playwright install chromium
```

## Comandos

| Comando                            | Descrição                            |
| ---------------------------------- | ------------------------------------ |
| `pnpm dev`                         | app web em desenvolvimento           |
| `pnpm build`                       | build PWA em `apps/web/dist`         |
| `pnpm --filter @pedon/web preview` | preview do build                     |
| `pnpm lint`                        | ESLint                               |
| `pnpm typecheck`                   | TypeScript sem emissão               |
| `pnpm test:run`                    | testes unitários/componente          |
| `pnpm test:e2e`                    | E2E Playwright; requer build/browser |
| `pnpm format`                      | formata o repositório com Prettier   |
| `pnpm format:check`                | verifica formatação                  |

## Banco e migrations

O projeto oficial possui dez migrations Local == Remote:

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

Fluxo linked:

```bash
supabase migration list
supabase db push --linked
supabase migration list
supabase db lint --linked
```

`db push --linked` aplica migrations pendentes ao projeto vinculado. `supabase db reset` é
destrutivo para o banco local e não substitui esse fluxo.

## Testes DB

Defina `SUPABASE_DB_PASSWORD` e execute sequencialmente:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
node supabase/tests/rls_integrity.test.mjs
node supabase/tests/rbac_units_integrity.test.mjs
node supabase/tests/unit_operational_config_integrity.test.mjs
node supabase/tests/catalog_integrity.test.mjs
node supabase/tests/menu_publication_integrity.test.mjs
node supabase/tests/orders_integrity.test.mjs
```

Não rode em paralelo: a suíte RBAC herdada possui uma contagem global frágil durante um cenário.
Resultados oficiais: RLS 22/22, RBAC 31/31, operacional 80/80, catálogo 123/123, publicação
121/121 e pedidos 318/318. As suítes criam fixtures descartáveis e fazem cleanup automático.

## Qualidade validada

- frontend unit/component: 87/87;
- E2E: 104/104 em 360/768/1024/1440;
- format, lint, typecheck, build, Gitleaks v8.30.1 e db lint: PASS;
- GitHub CI run `31429728244`, SHA `7fe07df`: quality + E2E `SUCCESS`;
- produção: `https://ped-on.pages.dev`.

## Segurança e secrets

- Nunca commitar tokens, senhas, chaves Supabase, `service_role` ou credenciais.
- `.env` real não entra no repositório; usar `.env.example` como referência.
- O browser usa apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Catálogo e cardápio têm RLS por unidade e escrita exclusivamente por RPC.
- `anon` recebe zero linhas das tabelas mutáveis do catálogo e não executa suas RPCs; o cardápio
  público é lido somente via `get_public_menu`.
- O PWA não adiciona cache de API, dados privados ou tokens.
- Tabelas de pedidos têm RLS por unidade e nenhuma escrita direta; checkout/tracking públicos usam
  RPCs com respostas minimizadas e token de alta entropia.

## Documentação

- `docs/PEDON_PROJECT_BASELINE.md` — baseline e invariantes arquiteturais
- `docs/PEDON_IMPLEMENTATION_STATUS.md` — checkpoint oficial da implementação
- `docs/PEDON_DECISION_REGISTER.md` — decisões aprovadas e abertas
- `docs/PEDON_DATABASE_SCHEMA.md` — schema cumulativo e contratos SQL
- `docs/PEDON_RLS_SECURITY.md` — RLS, grants, RBAC e testes de isolamento
- `docs/PEDON_RUNBOOK.md` — operação local, Supabase, CI e deploy

Próximo passo oficial: Prompt 09 — modelagem de clientes e fidelidade. Ainda não iniciado.
