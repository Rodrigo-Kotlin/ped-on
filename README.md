# Ped-On

> Gestão de Pedidos Inteligente

PWA SaaS multiempresa para restaurantes, hamburguerias, lanchonetes e estabelecimentos semelhantes.

## Descrição

O Ped-On é uma plataforma de gestão de pedidos que conecta o fluxo completo do estabelecimento: da criação da organização e das unidades, passando pelo catálogo e cardápio público, até o pedido, a Central de Pedidos e o programa de fidelidade (Clube Ped-On).

## Objetivo do MVP

Construir o fluxo funcional completo:

```
proprietário → organização → unidade → catálogo → publicação → cardápio público
→ carrinho → checkout → pedido idempotente → Central de Pedidos → conclusão
→ fidelidade → pontos → recompensa → voucher
```

## Stack planejada

- TypeScript estrito
- pnpm + pnpm workspaces
- Arquitetura modular (monorepo)
- Git + GitHub
- Cloudflare Pages
- Supabase (PostgreSQL + RLS)
- PWA

## Estrutura do monorepo

```
ped-on/
├── apps/
│   └── web/                 # Aplicação web (PWA)
├── packages/
│   ├── domain/              # Lógica de domínio
│   ├── schemas/             # Schemas/contratos compartilhados
│   ├── ui/                  # Componentes de UI
│   ├── config/              # Configurações compartilhadas
│   └── test-utils/          # Utilitários de teste
├── supabase/
│   ├── migrations/          # Migrations versionadas
│   ├── functions/           # Edge Functions
│   ├── tests/               # Testes de banco/RLS
│   └── seed.example.sql     # Exemplo de seed (sem dados reais)
├── docs/                    # Documentação de continuidade
├── .github/
│   └── workflows/           # CI/CD
├── .env.example
├── .gitignore
├── package.json
└── pnpm-workspace.yaml
```

## Requisitos locais

- Node.js `>=22`
- pnpm `>=9`
- Git

## Instalação inicial

```bash
pnpm install
```

## Comandos disponíveis

| Comando             | Descrição                                  |
| ------------------- | ------------------------------------------ |
| `pnpm install`      | Instala as dependências do workspace       |
| `pnpm dev`          | Sobe o app web em dev (Vite, porta 5173)   |
| `pnpm build`        | Build de produção (PWA em `apps/web/dist`) |
| `pnpm preview`      | Preview do build de produção               |
| `pnpm lint`         | ESLint                                     |
| `pnpm typecheck`    | `tsc --noEmit` em todos os pacotes         |
| `pnpm test:run`     | Testes unitários/componente (Vitest)       |
| `pnpm test:e2e`     | Testes E2E (Playwright; requer build)      |
| `pnpm format`       | Formata com Prettier                       |
| `pnpm format:check` | Verifica formatação (CI)                   |

## Política de secrets

- Nunca commitar tokens, senhas, chaves Supabase, `service_role` ou credenciais.
- `.env` real nunca entra no repositório; use `.env.example` como modelo.
- Nenhuma `service_role` pode ser variável pública `VITE_*`.

## Documentação

Consulte a documentação técnica oficial em `docs/`:

- `docs/PEDON_PROJECT_BASELINE.md` — baseline e princípios arquiteturais
- `docs/PEDON_DECISION_REGISTER.md` — registro de decisões
- `docs/PEDON_IMPLEMENTATION_STATUS.md` — status de implementação
- `docs/PEDON_RUNBOOK.md` — runbook operacional

Toda etapa futura deve ler esses documentos antes de qualquer alteração.
