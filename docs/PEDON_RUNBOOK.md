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
| Rodar testes de banco/RLS | `$env:SUPABASE_DB_PASSWORD = '<senha>'; node supabase/tests/rls_integrity.test.mjs` | Disponível (conexão direta com o Supabase oficial) |
| Rodar formatação | `pnpm format` | Disponível |
| Verificar formatação | `pnpm format:check` | Disponível |
| Rodar build | `pnpm build` | Disponível |
| Executar web em dev | `pnpm dev` | Disponível |
| Preview do build (local) | `pnpm preview` | Disponível |
| Rodar Supabase local | `supabase start` | PENDENTE — será configurado em etapa posterior |
| Verificar CLI Supabase | `supabase --version` | Disponível (2.109.1) |
| Vincular ao projeto Supabase | `supabase link --project-ref <PROJECT_REF>` | Disponível (link real executado) |

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

## 8.1 Como rodar testes de banco/RLS

Teste de integração que valida migrations, isolamento multiempresa (RLS), idempotência e
concorrência do onboarding. Requer acesso ao banco do projeto Supabase oficial (conexão direta,
sem Docker local).

```bash
# PowerShell (Windows)
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
node supabase/tests/rls_integrity.test.mjs
```

Regras:

- A senha vem da variável `SUPABASE_DB_PASSWORD` (nunca embutida no código/commit).
- Conecta diretamente em `db.<project-ref>.supabase.co:5432` como `postgres`
  (DEC-044) — não usar pooler de sessão para testes.
- Cria usuários sintéticos descartáveis (`rls-*@pedon-test.invalid`) e limpa tudo ao final
  (usuários + organizações criadas).
- O teste falha com exit code != 0 se qualquer cenário reprovar.

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
- Política completa (fluxo de 8 passos, proibições e estratégia Main-First): Seção 18 e 19.

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

## 17. Infraestrutura real

### 17.1 GitHub

| Item | Valor |
|---|---|
| Repositório | `Rodrigo-Kotlin/ped-on` (`https://github.com/Rodrigo-Kotlin/ped-on`) |
| Visibilidade | PUBLIC (código-fonte acessível publicamente — nenhum secret pode existir no repositório) |
| Branch oficial | `main` |
| Modelo | Main-First monitorado (DEC-037) |
| CI | GitHub Actions — workflow `CI`; gates de qualidade + E2E |

### 17.2 Cloudflare Pages

| Item | Valor |
|---|---|
| Projeto | `ped-on` |
| Production branch | `main` |
| Build command | `pnpm build` |
| Output directory | `apps/web/dist` |
| Root directory | raiz do repositório (monorepo) |
| Node | `22` (fixado via `.nvmrc` na raiz) |
| SPA routing | fallback `/* → /index.html 200` via `apps/web/public/_redirects` |
| Deployment URL | `https://ped-on.pages.dev` |

Procedimento de verificação de deployment:
1. Cloudflare Dashboard → **Workers & Pages** → projeto `ped-on` → **Deployments**.
2. Conferir último deployment com status `SUCCESS` e o commit SHA esperado.
3. Validar `HTTP 200` em `https://ped-on.pages.dev/` e o título/identidade Ped-On.
4. Validar rotas diretas (SPA): abrir uma URL direta de rota e confirmar que retorna
   `index.html` (fallback), sem `404` do Cloudflare.

Deploy automático: push em `main` → Cloudflare detecta → build → deploy. GitHub Actions
permanece responsável apenas pelos quality gates (não há workflow de deploy concorrente).

### 17.3 Supabase

| Item | Valor |
|---|---|
| Projeto | `ped-on` |
| Project ref | `zmuxkztnilnzjyyojbbr` |
| Região | South America (São Paulo) |
| API URL | `https://zmuxkztnilnzjyyojbbr.supabase.co` |
| CLI | `supabase` 2.109.1 (sessão autenticada via CLI; token em secret manager, fora do Git) |
| Link local | `supabase link --project-ref zmuxkztnilnzjyyojbbr` (executado — ref em `supabase/.temp/project-ref`) |
| Config | `supabase/config.toml` (versionado; sem secrets) |
| Migrations aplicadas | `20260809221710_identity_tenant_foundation` (única migration; Local = Remote) |
| Projeto de sistema anterior (`firecheck`) | NÃO usado |

Documentos de referência: `docs/PEDON_DATABASE_SCHEMA.md` (esquema) e
`docs/PEDON_RLS_SECURITY.md` (modelo de segurança RLS).

Procedimento de verificação de estado:
- Projetos e vínculo: `supabase projects list` e `supabase link` (sem força).
- Conectividade não destrutiva: `GET https://<ref>.supabase.co/rest/v1/` (401 = gateway vivo).
- Migrations aplicadas: `supabase migration list` (quando houver migrations versionadas).

Procedimento futuro de migrations: ver Seção 18.

### 17.4 Variáveis de ambiente do frontend (Cloudflare Pages)

Valores destinados ao browser (públicos, com RLS):
- `VITE_SUPABASE_URL` = URL da API do projeto.
- `VITE_SUPABASE_PUBLISHABLE_KEY` = publishable key do projeto.

O cliente Supabase já está implementado no frontend (Prompt 03, PASSO B) e lê essas duas
variáveis em build time via `import.meta.env`. Sem elas a app roda com um endpoint placeholder
(auth indisponível). **Único passo pendente para autenticação real em produção:** cadastrar as
duas variáveis em Cloudflare Pages (Settings → Environment variables) e disparar um novo deploy
(push ou redeploy). Valores já definidos localmente em `.env` (gitignored) para desenvolvimento.
**Nunca** configurar secret key / `service_role` como `VITE_*`.

### 17.5 Autenticação e rotas do frontend

- Cliente: `apps/web/src/lib/supabase.ts` (`createClient` com as `VITE_*` acima).
- Sessão: `AuthProvider` (`src/lib/auth/`) centraliza `getSession`/`onAuthStateChange` e expõe
  `signIn`, `signUp`, `signOut`, `completeOnboarding` e o `profiles` do usuário.
- Guards: `GuestOnly` (login/cadastro), `OnboardingGate` (`/onboarding`), `AppGate` (`/app`).
- Rotas: `/` (landing), `/login`, `/cadastro`, `/onboarding`, `/app`.
- Fluxo: cadastro → confirmação de e-mail (HABILITADO no projeto — ver DEC-039) → login →
  onboarding (RPC `complete_onboarding`) → `/app` (lista organizações via RLS).
- Testes: unitários mockam `src/lib/supabase` (`src/test/supabaseMock.ts`); E2E Playwright em
  `apps/web/e2e/auth.spec.ts` cobre redirects sem sessão e validação de formulário (não depende
  de credenciais).

## 18. Política de migrations (refinada)

Toda alteração de banco deverá:

1. existir primeiro como arquivo em `supabase/migrations/`;
2. possuir nome `timestamp + descrição objetiva`;
3. ser revisada;
4. passar pelos testes correspondentes;
5. ser aplicada ao projeto Supabase por CLI ou mecanismo oficial
   (`supabase db push` / `supabase db reset`);
6. ser validada no banco;
7. ser commitada/versionada;
8. ser registrada em `PEDON_IMPLEMENTATION_STATUS.md`.

**PROIBIDO:**

- alterar schema manualmente pelo Dashboard sem migration correspondente;
- editar migration já aplicada;
- apagar migration aplicada para "corrigir" histórico;
- aplicar SQL de produção que não esteja versionado;
- alterações manuais silenciosas no banco.

## 19. Estratégia de alterações de banco na Main (Main-First + deploy automático)

Como o projeto usa Main-First e Cloudflare pode publicar a `main` automaticamente, para
alterações futuras que dependam de migration preferir a sequência segura:

- **PASSO A — banco primeiro:** migration backward-compatible → aplicar no Supabase → validar
  banco → registrar.
- **PASSO B — código depois:** código da aplicação que utiliza a nova estrutura → gates → push
  `main` → Cloudflare deploy.

Evitar que código novo chegue ao Cloudflare antes de o banco necessário existir. Alterações
destrutivas deverão exigir estratégia específica (backup/rollback + janela de migração).

## 20. Observabilidade da infraestrutura

| Alvo | Como verificar |
|---|---|
| GitHub CI | `gh run list --workflow CI` / `gh run view <id>` (conclusão + SHA) |
| Cloudflare | Dashboard → Workers & Pages → `ped-on` → Deployments (status + URL) |
| Supabase | `supabase projects list`; `supabase migration list`; health não destrutivo da API |

Nenhuma plataforma externa de observabilidade é utilizada nesta fase.
