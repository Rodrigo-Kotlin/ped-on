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
| PROMPT ATUAL           | Prompt 12 — Produtos, Variações e Adicionais                                                                                                                                                                                                                                               |
| STATUS                 | `IN PROGRESS` — Etapa 4 concluída                                                                                                                                                                                                                                                          |
| CHECKPOINT             | `PUBLIC FLOW IMPLEMENTED` — cardápio, personalização, carrinho, checkout, pedido, tracking e detalhe administrativo integrados; Etapa 5 pendente                                                                                                                                             |
| HEAD INICIAL DO PROMPT | `3a6cd42` — Prompt 11 encerrado (`RELEASE_VERIFIED`)                                                                                                                                                                                                                                       |
| HEAD TÉCNICO VALIDADO  | `a8afcb1a0e3f8f05df8086c61ab6e2652b910cef` — integração pública de options no checkout/order/tracking/admin                                                                                                                                                                                 |
| BACKEND                | `IMPLEMENTED / VERIFIED` — migration 20 (`catalog_product_option_groups`/`catalog_product_options`, snapshot de publicação, `order_item_options` e validação de seleção no checkout); CI `31761944228` aprovou fresh rebuild das 20 migrations, DB lint e dez suítes DB com 1332/1332 checks  |
| FRONTEND               | `PUBLIC FLOW IMPLEMENTED` — personalizador público, linhas canônicas no carrinho, IDs de snapshot no checkout, UX `PED72`–`PED78`, snapshots no tracking e detalhe administrativo; backend e cálculo autoritativo preservados                                                               |
| OPÇÕES DE PRODUTO      | kinds `variation`/`addon`/`removal`; `single`/`multiple`; min/max validados no servidor; `price_delta` decimal exato com `unit_price = base + SUM(delta)` no checkout; snapshot imutável na publicação (`menu_version_*`) e por linha no pedido (`order_item_options`)                       |
| TESTES VERIFICADOS     | Etapa 4 local: frontend 349/349; E2E 345/345 com 3 skips móveis intencionais; Prompt 12 4B 20/20; build, lint, typecheck, precache e gitleaks PASS; baseline DB/Edge anterior preservado em 1332/1332 e 15/15                                                                                |
| PWA                    | Atualização por prompt explícito; aplicação bloqueada durante checkout, order mutation, redemption, voucher consume e team assignment/removal; runtime cache de API `NONE`; precache sem duplicatas após audit estático                                                                      |
| CLOUDFLARE             | URLs vigentes do Prompt 11 mantidas: imutável `https://8f7d42fd.ped-on.pages.dev` e estável `https://ped-on.pages.dev`; sem alteração de deploy nesta etapa                                                                                                                                  |
| GITHUB ACTIONS         | CI `31761944228` aprovado para o HEAD técnico, com `Quality gates`, `Backend release gates` e `E2E smoke tests`                                                                                                                                                                             |
| PENDÊNCIAS             | Etapa 5 do Prompt 12 e reauditoria independente; não declarar `COMPLETED`, `RELEASE_VERIFIED` ou cardápio comercialmente utilizável antes dessas etapas                                                                                                                                      |
| NEXT_STEP              | Executar a Etapa 5 do Prompt 12 e, depois, a reauditoria independente                                                                                                                                                                                                                       |
| FASE SEGUINTE          | Não iniciada                                                                                                                                                                                                                                                                               |
| PROMPT SEGUINTE        | Prompt 12 — `IN PROGRESS` (Etapa 5 não iniciada)                                                                                                                                                                                                                                           |
| PROMPT 10              | `COMPLETED` — checkpoint `RELEASE_VERIFIED`; reauditoria independente concluída com `GO_WITH_NON_BLOCKING_FINDINGS`                                                                                                                                                              |
| LOCAL DB REBUILD       | `NOT RUN — BY DESIGN / NO LOCAL DOCKER`                                                                                                                                                                                                                                                    |
| CI ISOLATED DB REBUILD | `PASS` — fresh rebuild das 20 migrations no CI `31761944228` (Prompt 12)                                                                                                                                                                                                                   |

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
- O catálogo mutável ganhou grupos de opções (`catalog_product_option_groups` com `kind`
  `variation`/`addon`/`removal`, `selection_mode` `single`/`multiple`, `min_select`/`max_select`) e
  opções (`catalog_product_options` com `price_delta` decimal exato); escrita exclusiva por RPCs
  server-authoritative, leitura administrativa por SELECT com policy `can_access_unit`.
- A publicação congela grupos/opções ativos em `menu_version_option_groups`/`menu_version_options`
  (overlay de disponibilidade via `source_group_id`/`source_option_id`); o checkout valida seleção
  no servidor, calcula `final_unit_price = base + SUM(price_delta)` e grava
  `order_item_options` (snapshot append-only por linha).
- Erros de opções: `PED72`–`PED78`; o tracking público expõe opções com nome/tipo/delta sem IDs
  técnicos, e o detalhe administrativo mantém os IDs de snapshot.
- Opção de `removal` exige `price_delta = 0`; `variation` exige seleção única obrigatória
  (`single`, `max_select = 1`); `addon`/`removal` não podem ter preço negativo.

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

## Checkpoint Prompt 12 — `ADMIN_CHECKPOINT` (Etapa 3)

- HEAD técnico validado: `df2cee31fa4afb288ab5d7bb08ae54d07aff1572`; CI `31761944228` SUCCESS
  (Quality gates, Backend release gates e E2E smoke tests).
- Backend: migration 20 aplicada e verificada — fresh rebuild isolado das 20 migrations, DB lint
  PASS e dez suítes DB 1332/1332 (inclui `product_options_integrity`); Edge 15/15;
  Git/filesystem e remoto em 20/20; dry-run linked informa remote up to date.
- Frontend: painel de variações/adicionais/remoções em `/app/catalogo` — `OptionGroupsPanel`,
  `GroupCard`, `GroupEditor`, `OptionEditor` e lib `product-options.ts` com contratos de preço;
  unit 312/312 (37 arquivos); E2E 288/288 com 13 cenários do Prompt 12 em 4 viewports
  (criação de grupos variação/adicional/remoção, validação min>max sem RPC, opções com
  preço/desconto/sem acréscimo, edição, desativação com confirmação, toggle de disponibilidade,
  operator view-only e offline pausando mutações).
- Sem alteração de deploy Cloudflare nesta etapa; URLs vigentes do Prompt 11 mantidas.
- Próximo: Etapa 4 — seleção de opções no cardápio público e no checkout (backend da migration 20
  já entregue).

## Checkpoint Prompt 12 — `PUBLIC FLOW IMPLEMENTED` (Etapa 4)

- HEAD técnico: `a8afcb1a0e3f8f05df8086c61ab6e2652b910cef` — checkout envia somente `menu_item_id`, `quantity`, nota opcional e
  `options` com IDs de snapshot ordenados; não envia preço, delta, nomes, grupos ou fingerprint.
- `create_public_order_v2`, idempotência, recovery, Clube e limpeza do carrinho após confirmação
  permanecem inalterados; preço final e snapshots continuam autoritativos no PostgreSQL.
- Erros `PED72`–`PED78` são sanitizados e preservam o carrinho com CTA de revisão; `PED35` não
  remapeia IDs antigos e mantém a revisão explícita do carrinho stale.
- Tracking público e detalhe administrativo exibem variação, adicionais e remoções a partir de
  `order_item_options`; IDs técnicos não são apresentados e pedidos simples antigos seguem legíveis.
- Gates locais: frontend 349/349; E2E 345/345 com 3 skips móveis intencionais; suíte 4B 20/20;
  format, lint, typecheck, build, precache, gitleaks e `git diff --check` aprovados.
- Backend sem alteração; migrations permanecem 20/20. Próximo: Etapa 5 e reauditoria independente.

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
| Fase 4A — Pilot Ready             | Prompt 12 — Produtos, Variações e Adicionais            | IN PROGRESS — PUBLIC FLOW IMPLEMENTED | Etapa 4 `a8afcb1`, migrations 20/20, frontend 349/349, E2E 345/345 | 2026-08-14 |
