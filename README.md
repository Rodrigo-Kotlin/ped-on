# Ped-On

> Gestão de Pedidos Inteligente

PWA SaaS multiempresa para restaurantes, hamburguerias, lanchonetes e estabelecimentos semelhantes.

## Estado atual

Fase 2B — Catálogo administrativo. O Prompt 06 está concluído com:

- Supabase Auth, identidade, onboarding e tenant;
- RBAC `owner`/`manager`/`operator` com acesso por unidade;
- gestão de unidades e contexto administrativo;
- configuração operacional por unidade;
- catálogo administrativo por unidade com categorias e produtos simples;
- preço decimal exato e disponibilidade operacional separada do estado estrutural;
- PWA em Cloudflare Pages e CI no GitHub Actions.

O catálogo atual é mutável e autenticado. Versionamento, publicação imutável, cardápio público,
imagens, carrinho e pedidos ainda não estão implementados.

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
│       ├── e2e/                   # E2E Auth, configuração e catálogo
│       └── src/
│           ├── app/               # Router e providers
│           ├── components/        # Shell administrativo
│           ├── lib/               # Auth, admin, configuração e catálogo
│           └── pages/             # Páginas e testes de componente
├── packages/
│   ├── config/                    # Configuração compartilhada
│   ├── domain/                    # Fundação de domínio
│   ├── schemas/                   # Contratos compartilhados
│   ├── test-utils/                # Utilitários de teste
│   └── ui/                        # Componentes compartilhados
├── supabase/
│   ├── migrations/                # Seis migrations versionadas até Prompt 06
│   ├── tests/                     # Quatro suítes de integração DB
│   ├── functions/                 # Espaço para Edge Functions
│   └── seed.example.sql           # Seed de exemplo, sem dados reais
├── docs/                          # Continuidade, schema, RLS e operação
├── .github/workflows/             # CI
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

## Rotas atuais

| Rota                 | Função                                      |
| -------------------- | ------------------------------------------- |
| `/`                  | landing técnica                             |
| `/login`             | autenticação                                |
| `/cadastro`          | criação de conta                            |
| `/onboarding`        | criação transacional da organização/unidade |
| `/app`               | área administrativa e seleção de unidade    |
| `/app/catalogo`      | categorias e produtos por unidade           |
| `/app/configuracoes` | configuração operacional da unidade         |

`/app/catalogo` permite leitura a owner, manager e operator autorizados. Owner/manager gerenciam a
estrutura; operator altera somente a disponibilidade de produtos. `/app/configuracoes` é restrita a
owner/manager autorizados.

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

O projeto oficial possui seis migrations Local == Remote:

1. `20260809221710_identity_tenant_foundation.sql`
2. `20260810015224_rbac_units_context.sql`
3. `20260810032804_unit_operational_config.sql`
4. `20260810033118_unit_operational_config_hardening.sql`
5. `20260810120000_unit_operational_config_acceptance_hardening.sql`
6. `20260810122401_catalog_base.sql`

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
```

Não rode em paralelo: a suíte RBAC herdada possui uma contagem global frágil durante um cenário.
Resultados oficiais: RLS 22/22, RBAC 31/31, operacional 80/80 e catálogo 123/123. As suítes criam
fixtures descartáveis e fazem cleanup automático.

## Qualidade validada

- frontend unit/component: 30/30;
- E2E: 56/56 em 360/768/1024/1440, incluindo catálogo 16/16;
- format, lint, typecheck, build, Gitleaks v8.30.1 e db lint: PASS;
- GitHub CI run `31390204057`: quality + E2E `SUCCESS`;
- produção: `https://ped-on.pages.dev`.

## Segurança e secrets

- Nunca commitar tokens, senhas, chaves Supabase, `service_role` ou credenciais.
- `.env` real não entra no repositório; usar `.env.example` como referência.
- O browser usa apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Catálogo tem RLS por unidade e escrita exclusivamente por RPC.
- `anon` recebe zero linhas das tabelas mutáveis do catálogo e não executa suas RPCs.
- O PWA não adiciona cache de API, dados privados ou tokens.

## Documentação

- `docs/PEDON_PROJECT_BASELINE.md` — baseline e invariantes arquiteturais
- `docs/PEDON_IMPLEMENTATION_STATUS.md` — checkpoint oficial da implementação
- `docs/PEDON_DECISION_REGISTER.md` — decisões aprovadas e abertas
- `docs/PEDON_DATABASE_SCHEMA.md` — schema cumulativo e contratos SQL
- `docs/PEDON_RLS_SECURITY.md` — RLS, grants, RBAC e testes de isolamento
- `docs/PEDON_RUNBOOK.md` — operação local, Supabase, CI e deploy

Próximo passo oficial: Prompt 07 — Versionamento e publicação imutável do cardápio.
