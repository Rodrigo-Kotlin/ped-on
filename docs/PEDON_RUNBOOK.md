# PED-ON — Runbook

> Guia operacional do projeto Ped-On.

## 1. Pré-requisitos locais

- Node.js (LTS recomendado) — ver versão esperada abaixo.
- pnpm — ver versão esperada abaixo.
- Git.
- Acesso ao repositório GitHub `ped-on`.

## 2. Versões esperadas

| Ferramenta | Versão esperada |
|---|---|
| Node.js | `>=22` (instalado na fundação: `v24.15.0`) |
| pnpm | `>=9` (instalado na fundação: `9.15.9`) |
| Git | `>=2.x` |

A versão de pnpm é fixada em `package.json` via `packageManager`.

## 3. Comandos básicos do projeto

| Ação | Comando | Estado |
|---|---|---|
| Instalar dependências | `pnpm install` | Disponível |
| Rodar lint | `pnpm lint` | Disponível |
| Rodar typecheck | `pnpm typecheck` | Disponível |
| Rodar testes unitários | `pnpm test:run` | Disponível |
| Rodar testes com watch | `pnpm test` | Disponível |
| Rodar testes E2E | `pnpm test:e2e` | Disponível |
| Rodar formatação | `pnpm format` | Disponível |
| Verificar formatação | `pnpm format:check` | Disponível |
| Rodar build | `pnpm build` | Disponível |
| Executar web em dev | `pnpm dev` | Disponível |
| Preview do build (local) | `pnpm preview` | Disponível |
| Rodar Supabase local | `supabase start` | PENDENTE — será configurado em etapa posterior |

O script raiz roda em todos os workspaces (`pnpm -r`), exceto quando indicado.

## 4. Como instalar dependências

```bash
pnpm install
```

Instala as dependências de todos os workspaces definidos em `pnpm-workspace.yaml`.

## 5. Como rodar lint

```bash
pnpm lint
```

Executa `eslint` nos arquivos de código de todos os pacotes (raiz e apps).

## 6. Como rodar typecheck

```bash
pnpm typecheck
```

Executa `tsc --noEmit` em todos os pacotes e na aplicação web.

## 7. Como rodar testes

```bash
# unit/componente (Vitest, uma execução)
pnpm test:run

# unit/componente com watch
pnpm test

# E2E (Playwright — requer build e browsers instalados)
pnpm build
pnpm --filter @pedon/web exec playwright install chromium
pnpm test:e2e
```

## 8. Como executar build

```bash
pnpm build
```

Produz a saída PWA de produção em `apps/web/dist` (inclui `manifest.webmanifest` e service
worker gerados pelo `vite-plugin-pwa`). O service worker cacheia somente assets estáticos;
nenhuma rota de API/dados é cacheada.

## 9. Convenção de variáveis de ambiente

- Arquivo modelo: `.env.example` (somente nomes de variáveis, sem valores reais).
- Variáveis públicas do frontend usam prefixo `VITE_*` (ou equivalente do framework escolhido).
- Nenhuma `service_role` pode ser declarada como variável pública `VITE_*`.
- Variáveis sensíveis (servidor/CI) não usam prefixo público.
- Nunca criar/commitar arquivos `.env` reais.

## 10. Política de secrets

- Nenhum secret, token, senha, chave Supabase, `service_role` ou credencial Cloudflare pode ser commitado.
- `.env` e `.env.*` são ignorados por `.gitignore` (com exceção de `.env.example`).
- Secrets devem ser gerenciados fora do repositório (gerenciadores de secrets/CI).
- O CI roda `gitleaks` automaticamente (job `quality`); antes de push local, executar:
  `gitleaks detect --source .` (ver referência: `https://github.com/gitleaks/gitleaks`).

## 11. Política de migrations

- Migrations seguem o padrão `timestamp + descrição objetiva`.
- Migrations de domínio não são criadas na Fase 0.
- Migrations devem ser versionadas em `supabase/migrations`.
- Nenhuma migration de negócio pode existir antes de sua etapa ser oficialmente planejada.

## 12. Política de commits

- Commits pequenos, atômicos e descritivos.
- Um commit deve conter somente um escopo lógico.
- Convenção de mensagens: `conventional commits` (ex.: `chore:`, `feat:`, `fix:`, `docs:`).
- Nunca commitar secrets.
- Commits de fundação referem-se exclusivamente à etapa corrente (não misturar funcionalidades futuras).

## 13. Política Main-First

- Todo trabalho é feito diretamente na branch `main` (modelo Main-First monitorado).
- `main` é a branch de trabalho e de referência.
- Alterações são monitoradas e revisadas antes de integração em massa.
- Pull requests/branches de feature só devem surgir quando o modelo assim o exigir.

## 14. Procedimento de verificação antes de push

1. Conferir `git status` (somente arquivos esperados).
2. Revisar `git diff --staged` (nenhum arquivo inesperado).
3. Garantir que nenhum `.env` real esteja staged.
4. Varrer o repositório por secrets: `gitleaks detect --source . --redact --log-level warn`.
5. Confirmar ausência de código herdado de outros projetos.
6. Confirmar que nenhuma feature de negócio foi antecipada.
7. Confirmar que nenhuma migration de domínio foi criada.
8. Atualizar `PEDON_IMPLEMENTATION_STATUS.md` (ver Seção 15).
9. Rodar a sequência de qualidade localmente: `pnpm format:check`, `pnpm lint`,
   `pnpm typecheck`, `pnpm test:run`, `pnpm build`.
10. Commitar de forma atômica e fazer push para `main`.

## 15. Procedimento de atualização do PEDON_IMPLEMENTATION_STATUS.md

1. Atualizar `PROMPT ATUAL`, `FASE ATUAL` e `STATUS`.
2. Registrar `ÚLTIMO COMMIT` (hash + mensagem) após o commit.
3. Atualizar os estados de CLOUDFLARE / SUPABASE / GITHUB conforme o andamento.
4. Registrar migrations aplicadas (ou "nenhuma").
5. Registrar testes/preflight executados.
6. Registrar somente pendências reais.
7. Registrar `NEXT_STEP` oficial (justificar qualquer desvio).
8. Adicionar linha no Histórico de Execução com data e status.

## 16. CI/CD

- Workflow: `.github/workflows/ci.yml`.
- Job `quality`: checkout → pnpm → Node 24 → `pnpm install --frozen-lockfile` →
  `pnpm format:check` → `pnpm lint` → `pnpm typecheck` → `pnpm test:run` → `pnpm build` →
  varredura `gitleaks`.
- Job `e2e`: depende do `quality`; instala Chromium do Playwright e roda `pnpm test:e2e`,
  subindo o preview do build.
- Disparo: push/PR para `main` e `workflow_dispatch`.
