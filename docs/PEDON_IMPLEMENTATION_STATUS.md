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
| STATUS                 | `IN PROGRESS` — Remediation C concluída; reauditoria independente pendente                                                                                                                                                                                                                 |
| CHECKPOINT             | `READY_FOR_REAUDIT` — reconvergência do release após NO_GO da primeira reauditoria; blockers originais revalidados como RESOLVED; não equivale a `COMPLETED`, `RELEASE_VERIFIED` ou `MENU_COMMERCIALLY_USABLE`                                                                               |
| HEAD INICIAL DO PROMPT | `3a6cd42` — Prompt 11 encerrado (`RELEASE_VERIFIED`)                                                                                                                                                                                                                                       |
| HEAD TÉCNICO VALIDADO  | `f663cecb96ef87f397376e29aee82cd24ba846df` — B2 (lease de operação crítica até resolução de voucher ambíguo); HEAD técnico do release funcional                                                                                                                                              |
| BACKEND                | `IMPLEMENTED / VERIFIED` — migrations 20–22; HIGH-1..HIGH-5 e MEDIUM BLOCKING-1 corrigidos; `_lock_unit_structure` unit-scoped, publicação com PED73 e sem versão parcial, `order_item_options` com vínculo relacional composto; CI `31814657987` aprovou fresh rebuild das 22 migrations, DB lint e DB 1409/1409 checks     |
| FRONTEND               | `READY_FOR_REAUDIT` — lease `beginCriticalOperation` com release idempotente; recovery ambíguo de voucher mantém a lease até conclusão; recovery fail-closed de pedido/redemption antes de RPC; sanitizer global de carrinhos no bootstrap; PED73 no admin                                                                       |
| OPÇÕES DE PRODUTO      | kinds `variation`/`addon`/`removal`; `single`/`multiple`; min/max validados no servidor; `price_delta` decimal exato com `unit_price = base + SUM(delta)` no checkout; snapshot imutável na publicação (`menu_version_*`) e por linha no pedido (`order_item_options`)                       |
| TESTES VERIFICADOS     | Frontend 383/383 (40 arquivos); E2E 345/345 com 3 skips móveis intencionais; DB 1409/1409; Edge 15/15; format, lint, typecheck, build, precache, gitleaks e `git diff --check` PASS                                                                                                            |
| PWA                    | Atualização por prompt explícito; bloqueio por lease de operação crítica (checkout, order mutation, redemption, voucher consume e team assignment/removal) até desfecho conclusivo; runtime cache de API `NONE`; precache sem duplicatas após audit estático                                     |
| CLOUDFLARE             | estável `https://ped-on.pages.dev` servindo o bundle do SHA `f663cecb96ef87f397376e29aee82cd24ba846df` (verificado no diagnóstico); rotas SPA 13/13, manifest e SW PASS; deployment id e immutable URL `UNVERIFIED` — sem credencial Cloudflare API no ambiente (limitação de evidência, INFO não bloqueante) |
| GITHUB ACTIONS         | CI `31814657987` aprovado para o HEAD técnico, com `Quality gates`, `Backend release gates` e `E2E smoke tests`                                                                                                                                                                             |
| PENDÊNCIAS             | Reauditoria independente final do Prompt 12, carregando a limitação de evidência Cloudflare (deployment id/immutable URL); não declarar `COMPLETED`, `RELEASE_VERIFIED` ou cardápio comercialmente utilizável antes do parecer                                                               |
| NEXT_STEP              | Executar a reauditoria independente final do Prompt 12                                                                                                                                                                                                                                     |
| FASE SEGUINTE          | Não iniciada                                                                                                                                                                                                                                                                               |
| PROMPT SEGUINTE        | Prompt 13 — `NOT STARTED`; bloqueado até a reauditoria final do Prompt 12                                                                                                                                                                                                                   |
| PROMPT 10              | `COMPLETED` — checkpoint `RELEASE_VERIFIED`; reauditoria independente concluída com `GO_WITH_NON_BLOCKING_FINDINGS`                                                                                                                                                              |
| LOCAL DB REBUILD       | `NOT RUN — BY DESIGN / NO LOCAL DOCKER`                                                                                                                                                                                                                                                    |
| CI ISOLATED DB REBUILD | `PASS` — fresh rebuild das 22 migrations no CI `31814657987` (Prompt 12)                                                                                                                                                                                                                   |

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
- Opção de `removal` exige `price_delta = 0`; `variation` exige escolha única (`single`,
  `max_select = 1`) e só é obrigatória quando `min_select > 0`; `addon`/`removal` não podem ter
  preço negativo.
- Todo grupo `single`, independentemente do `kind`, exige `max_select = 1`; constraints autoritativas
  existem no catálogo e no snapshot publicado.
- Writers de grupos/opções e publicação usam o mesmo advisory lock por produto. O snapshot final do
  pedido bloqueia a opção de catálogo disponível, serializando checkout contra toggle/delete.
- O formato persistido do carrinho omite `note`; observações ficam em memória até o checkout. Ao
  carregar qualquer carrinho, registros legados de todos os slugs são saneados ou removidos.

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

- HEAD técnico: `3610be50e27014751b825f8b67740d118041591a` — checkout envia somente `menu_item_id`, `quantity`, nota opcional e
  `options` com IDs de snapshot ordenados; não envia preço, delta, nomes, grupos ou fingerprint.
- `create_public_order_v2`, idempotência, recovery, Clube e limpeza do carrinho após confirmação
  permanecem inalterados; preço final e snapshots continuam autoritativos no PostgreSQL.
- Erros `PED72`–`PED78` são sanitizados e preservam o carrinho com CTA de revisão; `PED35` não
  remapeia IDs antigos e mantém a revisão explícita do carrinho stale.
- Tracking público e detalhe administrativo exibem variação, adicionais e remoções a partir de
  `order_item_options`; IDs técnicos não são apresentados e pedidos simples antigos seguem legíveis.
- Gates locais: frontend 350/350; E2E 345/345 com 3 skips móveis intencionais; suíte 4B 20/20;
  format, lint, typecheck, build, precache, gitleaks e `git diff --check` aprovados.
- Backend sem alteração; migrations permanecem 20/20. Próximo: Etapa 5 e reauditoria independente.

## Checkpoint Prompt 12 — `READY_FOR_REAUDIT` (Etapa 5)

- HEAD técnico validado `9139391ca418dc063cdd7366d6b8e447cccacc3a`; implementação de hardening
  `c970381a70da16c23140604e2da355c29f2c1974`; CI `31787020339` SUCCESS nos três jobs.
- Migration 21 aditiva aplicada: `single => max_select=1`, locks estruturais coerentes com publicação
  e row lock de disponibilidade no snapshot final do pedido; Git/filesystem/remoto 21/21, dry-run up
  to date e linked lint sem erros.
- Privacidade: `CartItem.note` não entra no formato persistido, valores legados de todos os slugs são
  purgados e o fluxo cart→checkout preserva a nota apenas sob o mesmo provider em memória.
- PWA: consumo de voucher e recovery ambíguo permanecem na mesma janela de `runCriticalOperation`.
- Gates: frontend 354/354; E2E 345/345 com 3 skips móveis intencionais; 4B 20/20; DB 1340/1340;
  Edge 15/15; precache 33 entradas, 929032 bytes, `runtimeCaching: NONE`; gitleaks PASS.
- Cloudflare: deployment `40091196-3bdf-4f15-86fe-54d2816138a2`, source `9139391`, imutável
  `https://40091196.ped-on.pages.dev`, stable `https://ped-on.pages.dev`, SHA no diagnóstico e
  fallbacks SPA 18/18.
- Próximo: reauditoria independente. Prompt 12 continua `IN PROGRESS`; Prompt 13 não foi iniciado.

## Checkpoint Prompt 12 — `REMEDIATION_IN_PROGRESS` (Reauditoria #1 NO_GO → Remediation A/B1/B2)

- Primeira reauditoria independente do Prompt 12 resultou em **NO_GO**: HIGH-1 (grupo obrigatório
  insatisfazível na publicação), HIGH-2 (publicação não serializada com writers estruturais),
  HIGH-3 (`signedDecimalToCents` errava descontos `-0.xx`), HIGH-4 (voucher ambíguo liberava a janela
  crítica PWA cedo), HIGH-5 (order/redemption podiam iniciar RPC sem recovery durável) e
  MEDIUM BLOCKING-1 (notas legadas de carrinho não saneadas globalmente).
- Remediation A (`968d692`, migration 22 `20260814020000_prompt12_remediation_a_hardening.sql`):
  `_lock_unit_structure` unit-scoped adquirido primeiro por todos os writers estruturais e pela
  publicação; `publish_unit_menu` exige regras satisfazíveis (PED73 antes de qualquer versão, sem
  versão parcial — HIGH-1/HIGH-2); `signedDecimalToCents` corrigido no browser (HIGH-3);
  `order_item_options` passa a exigir vínculo relacional composto com `order_items` (validação
  read-only + `unique (id, menu_version_id, menu_item_id)` + FK composta).
- B1 (`1c1fff0`): recovery fail-closed de pedido e redemption — persistência durável com
  leitura-de-volta antes de qualquer RPC; storage indisponível/corrompido nunca dispara mutação de
  rede (HIGH-5); `order_item_options` com vínculo relacional composto (regressão de Remediation A).
- B2 (`f663cec`): lease de operação crítica idempotente (`beginCriticalOperation`/
  `runCriticalOperation`) e recovery ambíguo de voucher mantém a lease até desfecho conclusivo,
  bloqueando o update do PWA (HIGH-4); `sanitizeStoredCarts()` global no bootstrap saneia todas as
  chaves `pedon:cart:*` independente da rota (MEDIUM BLOCKING-1).
- CI técnico `31814657987` (SUCCESS nos três jobs) validou o release funcional `f663cec`.

## Checkpoint Prompt 12 — `READY_FOR_REAUDIT` (Remediation C / Release Reconvergence)

- HEAD inicial da etapa `1c1fff0`; HEAD final `f663cecb96ef87f397376e29aee82cd24ba846df` (B2),
  igual a origin/main; worktree limpo.
- Migrations: Git/filesystem 22/22; remoto 22/22 registrado na etapa B1. A checagem remota ao vivo
  (`migration list --linked`, `db push --dry-run`, `db lint --linked`) **não pôde ser executada**
  desta máquina nesta etapa: o pooler rejeitou a senha do `.env` e o host direto está com
  IP-restrição/timeout (IPv6). Sem evidência de drift: nenhuma migration nova desde o registro 22/22 e
  o CI Backend gates revalidou fresh rebuild das 22 migrations, alinhamento, DB lint, DB 1409/1409 e
  Edge 15/15 no `31814657987`.
- Revalidação dos seis blockers originais (read-only SQL + testes): HIGH-1, HIGH-2, HIGH-3, HIGH-4,
  HIGH-5 e MEDIUM BLOCKING-1 — todos `RESOLVED`.
- Regressão de Remediation A: `order_item_options` relacional, PED42 com options diferentes na mesma
  chave, fingerprint de opções independente da ordem e earn de loyalty sobre subtotal
  server-authoritative com deltas — `RESOLVED`.
- Gates locais: format, lint, typecheck, test:run 383/383 (40 arquivos), build (33 precache entries),
  e2e 345/345 com 3 skips móveis intencionais, audit:precache 33/33 duplicatas 0 `runtimeCaching:
  NONE`, gitleaks exit 0 e `git diff --check` limpo.
- Cloudflare: estável `https://ped-on.pages.dev` servindo o bundle do SHA completo
  `f663cecb96ef87f397376e29aee82cd24ba846df` (verificado no chunk lazy de diagnóstico); rotas SPA
  13/13, manifest e SW PASS. Deployment id e immutable URL **UNVERIFIED** (sem credencial Cloudflare
  API no ambiente) — limitação de evidência INFO não bloqueante, carregada para a reauditoria.
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`; `CI ISOLATED DB REBUILD: PASS`.
- Próximo: reauditoria independente final. Prompt 12 permanece `IN PROGRESS`; Prompt 13 não iniciado.

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
| Fase 4A — Pilot Ready             | Prompt 12 — Produtos, Variações e Adicionais            | IN PROGRESS — READY_FOR_REAUDIT | Etapa 5 `9139391`, Remediation A/B1/B2 `f663cec`, migrations 22/22, frontend 383/383, E2E 345/345, DB 1409/1409 | 2026-08-14 |
