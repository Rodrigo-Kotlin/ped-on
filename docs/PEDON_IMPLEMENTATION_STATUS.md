# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo                  | Valor                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PROJETO                | Ped-On                                                                                                                                                                                                                                                                                     |
| BRANCH                 | `main`                                                                                                                                                                                                                                                                                     |
| MODELO                 | Main-First monitorado                                                                                                                                                                                                                                                                      |
| FASE ATUAL             | Fase 4A — Pilot Ready                                                                                                                                                                                                                                                                      |
| PROMPT ATUAL           | Prompt 11 — Pilot Readiness, Observabilidade e Product Hardening                                                                                                                                                                                                                           |
| STATUS                 | `COMPLETED`                                                                                                                                                                                                                                                                                |
| CHECKPOINT             | `RELEASE_VERIFIED` — gates técnicos, convergência remota, deployment e reauditoria independente aprovados                                                                                                                                                                                  |
| HEAD INICIAL DO PROMPT | `7ee0e9a` — docs: formalize post-MVP roadmap                                                                                                                                                                                                                                               |
| HEAD TÉCNICO VALIDADO  | `925f7d94adea4c0c2cef9a1017270269960817aa`                                                                                                                                                                                                                                                 |
| BACKEND                | `IMPLEMENTED / VERIFIED` — CI `31712486989` aprovou fresh rebuild isolado das 19 migrations, alinhamento, DB lint, nove suítes DB com 1182/1182 checks e Edge unit 15/15; remoto alinhado em 19/19 e lint linked sem erros                                                                       |
| FRONTEND               | `IMPLEMENTED / VERIFIED` — painel de prontidão, equipe, diagnóstico, estados offline/erro/loading, lazy routes, SHA de build e atualização PWA não destrutiva; Quality gates e E2E smoke tests 236/236 aprovados no CI `31712486989`                                                           |
| IDENTIDADE V2          | CPF + telefone protegidos por HMAC-SHA-256 tenant-bound; lookup desconhecido e telefone incorreto usam a mesma resposta exata HTTP 422 `IDENTITY_NOT_CONFIRMED`; resolver legado revogado de `service_role`; enroll exige consentimento e gera evidência append-only                         |
| RATE LIMIT             | Fixed-window persistente no PostgreSQL, chaveado por HMAC(IP confiável + slug canônico + mode), sem PII; lookup 10/60s e enroll 5/60s; excesso HTTP 429 com `Retry-After`; slugs inexistentes compartilham escopo canônico                                                                        |
| TOKEN                  | 64 hex, hash SHA-256 no banco, TTL máximo de 2h + tolerância transacional de 5 min; leitura repetível de conta/extrato até checkout; checkout o remove atomicamente; cleanup incremental remove expirados; token existente continua legível após disable                              |
| TESTES VERIFICADOS     | CI `31712486989`: Quality gates PASS; Backend release gates PASS, com nove suítes DB e baseline 1182/1182, Edge 15/15; E2E smoke tests 236/236 PASS                                                                                                                                          |
| PWA                    | Atualização por prompt explícito; aplicação bloqueada durante checkout, order mutation, redemption, voucher consume e team assignment/removal; runtime cache de API `NONE`; precache sem duplicatas após audit estático                                                                      |
| CLOUDFLARE             | Check/deployment `82dedad7-c36e-4ddf-af8a-8d48176b9b0a` aprovado; URL imutável `https://82dedad7.ped-on.pages.dev` e estável `https://ped-on.pages.dev`; fallback SPA 18/18 e 4/4 e SHA técnico confirmado nos bundles                                                                          |
| GITHUB ACTIONS         | CI `31712486989` aprovado para o HEAD técnico validado, com `Quality gates`, `Backend release gates` e `E2E smoke tests`                                                                                                                                                                    |
| PENDÊNCIAS             | Nenhuma pendência bloqueante; dívida técnica não bloqueante registrada (LOW 4, INFO 1); Prompt 11 oficialmente encerrado                                                                                                                                                              |
| NEXT_STEP              | Preparar e executar o Prompt 12 — Produtos, Variações e Adicionais, conforme o roadmap pós-Core MVP                                                                                                                                                                                     |
| FASE SEGUINTE          | Não iniciada                                                                                                                                                                                                                                                                               |
| PROMPT SEGUINTE        | Prompt 12 — `NOT STARTED`                                                                                                                                                                                                                                                                  |
| PROMPT 10              | `COMPLETED` — checkpoint `RELEASE_VERIFIED`; reauditoria independente concluída com `GO_WITH_NON_BLOCKING_FINDINGS`                                                                                                                                                              |
| LOCAL DB REBUILD       | `NOT RUN — BY DESIGN / NO LOCAL DOCKER`                                                                                                                                                                                                                                                    |
| CI ISOLATED DB REBUILD | `PASS` — fresh rebuild das 19 migrations no CI `31712486989` (técnico) e revalidado no CI `31713901328` (reauditado)                                                                                                                                                                      |

---

## Contratos do checkpoint

- `get_public_loyalty_account` retorna saldo e extrato público minimizado com no máximo 50 entradas,
  em ordem decrescente.
- Cada item público do extrato contém somente `entry_type`, `gross_points`, `points_delta`,
  `recovery_delta`, `eligible_amount`, `order_number` e `created_at`.
- `create_public_order_v2` associa um hash de tentativa ao checkout idempotente;
  `get_public_order_by_attempt` recupera a mesma resposta sem PII nem IDs internos.
- O browser persiste em `pedon:pending-order:<slug>` somente `idempotency_key`, segredo aleatório de
  recuperação em `request_fingerprint`, `public_slug` e `created_at`; o valor não é derivado do
  payload, e nome, telefone, notas e token do Clube não são persistidos nesse registro.
- O tracking público preserva nome/preço/quantidade/total dos itens, mas omite a nota livre, que
  permanece apenas no detalhe administrativo.
- O domínio de rewards/vouchers usa `PED54` a `PED66`; DELETE de reward é
  `NOT SUPPORTED BY DESIGN` e a remoção operacional usa `set_loyalty_reward_active(false)`.
- `redeem_public_loyalty_reward` executa débito de pontos, débito de estoque, ledger `redeem`,
  redemption e emissão de voucher em uma transação; o token é consumido somente no sucesso.
- O browser persiste em `pedon:pending-redemption:<slug>` somente `public_slug`, `idempotency_key`,
  `recovery_secret`, `reward_id` e `created_at`, por no máximo 24 horas; não persiste token, CPF,
  telefone, saldo ou payload da conta.
- `/app/vouchers` normaliza o código em memória e não o coloca na URL, Local Storage ou Session
  Storage; owner, manager e operator ainda dependem de `can_access_unit` no PostgreSQL.

## Reauditoria independente do Prompt 10 — resultado histórico

- Independent final reaudit: `GO_WITH_NON_BLOCKING_FINDINGS`.
- CRITICAL: 0; HIGH: 0; MEDIUM BLOCKING: 0.
- Bloqueadores originais: B1 Migration versioned, B2 Replay protected, B3 DB tests isolated,
  B4 Backend CI gates e B5 Release convergence — todos `RESOLVED`.
- Base verificada: technical release `2a91711bc83b54841b4b4beee8beca930b9ea986`, technical CI
  `31598675826`, deployment `ceaf4832-bc0e-4159-a983-fd5ca367efd8`, docs `453af6557964620de8565d884ece6123b46266ba`.
- Dívida não bloqueante preservada na linha `PENDÊNCIAS`; nenhum item foi corrigido nesta execução.

## Reauditoria independente do Prompt 11 — encerramento oficial

- Independent final reaudit: `GO_WITH_NON_BLOCKING_FINDINGS`.
- CRITICAL: 0; HIGH: 0; MEDIUM BLOCKING: 0; LOW: 4; INFO: 1 — dívida não bloqueante preservada,
  nenhum item corrigido nesta execução.
- HEAD auditado / release verificado (evidência final): `3a6cd42eab24719e01505fc854d03c65ca9d9975`;
  CI `31713901328` (SUCCESS); Cloudflare imutável `https://8f7d42fd.ped-on.pages.dev` e estável
  `https://ped-on.pages.dev`; Supabase 19/19 com dry-run remote up to date.
- HEAD técnico anterior (histórico): `925f7d94adea4c0c2cef9a1017270269960817aa`; CI `31712486989`;
  deployment `82dedad7-c36e-4ddf-af8a-8d48176b9b0a` — preservados como rastreabilidade histórica
  legítima do checkpoint técnico.
- Test baseline final: Frontend 274/274; E2E 236/236; Prompt 11 44/44; DB 1182/1182; Pilot
  readiness 84/84; Edge 15/15; DB lint PASS; CI isolated rebuild PASS; migrations 19/19;
  `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.
- O release funcional auditado permanece `3a6cd42…` / CI `31713901328` / `8f7d42fd.ped-on.pages.dev`;
  o commit documental de encerramento não altera código, banco, CI, Supabase, Cloudflare ou Edge. O
  SHA e o CI do fechamento documental são registrados no relatório final (evitando autorreferência).
- Marco alcançado: `PILOT_READY`. Prompt 12: `NOT STARTED`.

## Histórico de execução

| Etapa                             | Prompt                                                  | Status                          | Commit                                     | Data       |
| --------------------------------- | ------------------------------------------------------- | ------------------------------- | ------------------------------------------ | ---------- |
| Fase 0 — Fundação                 | Prompt 00 — Bootstrap controlado e registro de contexto | COMPLETED                       | `efcb205`                                  | 2026-08-09 |
| Fase 0 — Fundação                 | Prompt 01 — Scaffold técnico, qualidade e CI mínimo     | COMPLETED                       | `f214362`                                  | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 02 — Integrações Supabase + Cloudflare + GitHub  | COMPLETED                       | `34f25aa`                                  | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 03 — Auth, identidade e multiempresa inicial     | COMPLETED                       | `1f9079b`                                  | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 04 — RBAC, unidades e contexto                   | COMPLETED                       | `a8d166b`                                  | 2026-08-10 |
| Fase 0 — Infraestrutura Integrada | Prompt 05 — Configuração operacional e aceite           | COMPLETED                       | `fc6a0c4`, `cadeea5`                       | 2026-08-10 |
| Fase 2B — Catálogo administrativo | Prompt 06 — Catálogo base                               | COMPLETED                       | `c61bafa`, `891257f`                       | 2026-08-10 |
| Fase 2C — Cardápio                | Prompt 07 — Versionamento e publicação imutável         | COMPLETED                       | `87a796b`, `ee509b7`, `3e2bfdd`, `a1640ad` | 2026-08-10 |
| Fase 3A — Pedidos                 | Prompt 08 — Carrinho, checkout e Central de Pedidos     | COMPLETED                       | `41b9da2`, `b801468`, `7fe07df`            | 2026-08-10 |
| Fase 3B — Clientes e Fidelidade   | Prompt 09 — Clube Ped-On e release hardening            | COMPLETED                       | `2013e8d`                                  | 2026-08-11 |
| Fase 3C — Recompensas e Vouchers  | Prompt 10 — Recompensas, resgate atômico e vouchers     | COMPLETED — RELEASE_VERIFIED    | reauditoria GO; encerramento oficial (`2a91711`, `453af65`) | 2026-08-12 |
| Fase 4A — Pilot Ready             | Prompt 11 — Pilot Readiness e Product Hardening         | COMPLETED — RELEASE_VERIFIED    | reauditoria GO; auditado `3a6cd42`, CI `31713901328`, deploy `8f7d42fd` | 2026-08-13 |
