# PED-ON — Runbook

> Guia operacional do projeto Ped-On.
> Comandos ainda não implementados nesta fase são marcados como `PENDENTE — será criado em etapa posterior`.

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
| Rodar lint | `pnpm -r lint` | PENDENTE — será criado no Prompt 01 |
| Rodar typecheck | `pnpm -r typecheck` | PENDENTE — será criado no Prompt 01 |
| Rodar testes | `pnpm -r test` | PENDENTE — será criado no Prompt 01 |
| Rodar build | `pnpm -r build` | PENDENTE — será criado no Prompt 01 |
| Executar web em dev | — | PENDENTE — será criado no Prompt 01 |
| Rodar Supabase local | `supabase start` | PENDENTE — será configurado em etapa posterior |

## 4. Como instalar dependências

```bash
pnpm install
```

Instala as dependências de todos os workspaces definidos em `pnpm-workspace.yaml`.

## 5. Como rodar lint

PENDENTE — será criado no Prompt 01 (Scaffold técnico, qualidade e CI mínimo).

## 6. Como rodar typecheck

PENDENTE — será criado no Prompt 01.

## 7. Como rodar testes

PENDENTE — será criado no Prompt 01.

## 8. Como executar build

PENDENTE — será criado no Prompt 01.

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
- Antes de qualquer push, executar varredura de secrets (ver Seção 13).

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
4. Varrer o repositório por secrets: tokens, senhas, chaves Supabase, `service_role`, credenciais Cloudflare, dados/URLs/IDs de projetos anteriores.
5. Confirmar ausência de código herdado de outros projetos.
6. Confirmar que nenhuma feature de negócio foi antecipada.
7. Confirmar que nenhuma migration de domínio foi criada.
8. Atualizar `PEDON_IMPLEMENTATION_STATUS.md` (ver Seção 15).
9. Executar `pnpm install` e confirmar resolução do workspace, se aplicável.
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
