# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo                  | Valor                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PROJETO                | Ped-On                                                                                                                                                                                                                                                                                     |
| BRANCH                 | `main`                                                                                                                                                                                                                                                                                     |
| MODELO                 | Main-First monitorado                                                                                                                                                                                                                                                                      |
| FASE ATUAL             | Fase 3C — Recompensas e Vouchers                                                                                                                                                                                                                                                           |
| PROMPT ATUAL           | Prompt 10 — Recompensas, resgate atômico e vouchers do Clube Ped-On                                                                                                                                                                                                                        |
| STATUS                 | `COMPLETED`                                                                                                                                                                                                                                                                              |
| CHECKPOINT             | `RELEASE_VERIFIED` — reauditoria independente concluída com GO e encerramento oficial do Prompt 10                                                                                                                                                                                                   |
| HEAD INICIAL DO PROMPT | `429e2fe` — docs: close Prompt 09 status record                                                                                                                                                                                                                                            |
| BACKEND                | `IMPLEMENTED` — 17 migrations reconstruídas do zero localmente até `20260812090000_prompt10_final_integrity_hardening`; replay exige recovery secret, BigInt sai como texto decimal e relações privilegiadas têm FKs/uniques                                                                  |
| FRONTEND               | `IMPLEMENTED` — catálogo público, resgate/recovery, vouchers do membro e extrato `redeem`; Reward management owner-only sem DELETE; `/app/vouchers` para staff com acesso à unidade                                                                                                          |
| IDENTIDADE V2          | CPF + telefone protegidos por HMAC-SHA-256 tenant-bound; lookup desconhecido e telefone incorreto usam a mesma resposta exata HTTP 422 `IDENTITY_NOT_CONFIRMED`; resolver legado revogado de `service_role`; enroll exige consentimento e gera evidência append-only                         |
| RATE LIMIT             | Fixed-window persistente no PostgreSQL, chaveado por HMAC(IP confiável + slug canônico + mode), sem PII; lookup 10/60s e enroll 5/60s; excesso HTTP 429 com `Retry-After`; slugs inexistentes compartilham escopo canônico                                                                        |
| TOKEN                  | 64 hex, hash SHA-256 no banco, TTL máximo de 2h + tolerância transacional de 5 min; leitura repetível de conta/extrato até checkout; checkout o remove atomicamente; cleanup incremental remove expirados; token existente continua legível após disable                              |
| TESTES VERIFICADOS     | Frontend 233/233; E2E 192/192 e Prompt 10 44/44; banco isolado: RLS 22/22, RBAC 32/32, operacional 80/80, catálogo 123/123, menu 121/121, pedidos 318/318, loyalty 148/148, rewards/vouchers 254/254; Edge unit 15/15; db lint local sem erros                                             |
| PWA                    | Nenhum cache de API/dados privados/tokens; recoveries de pedido e redemption persistem somente identificadores/segredos aleatórios, slug, timestamp e, no resgate, reward ID                                                                                                                                   |
| CLOUDFLARE             | Deployment técnico de produção `ceaf4832-bc0e-4159-a983-fd5ca367efd8`, source `2a91711bc83b54841b4b4beee8beca930b9ea986`, verificado em `ped-on.pages.dev` e `ceaf4832.ped-on.pages.dev`; rotas HTTP e PWA PASS, stable e immutable serviram o mesmo asset, smoke com Service Worker ativo confirmou ausência de runtime cache para APIs mutáveis do Clube |
| GITHUB ACTIONS         | Run `31598675826`, SHA `2a91711bc83b54841b4b4beee8beca930b9ea986`, SUCCESS em Quality gates, Backend release gates e E2E smoke tests; run docs/re-audit `31607829475`, SHA `453af6557964620de8565d884ece6123b46266ba`, SUCCESS                                                                                                                                                  |
| PENDÊNCIAS             | Heranças não bloqueantes: ícones PWA definitivos, atualização das actions que ainda recebem aviso de Node.js 20, TypeScript 7.x, gestão de `membership_units` via UI, otimização do bundle e dívida registrada na reauditoria (bundle ~809 kB, política futura de retenção/FKs históricas para `auth.users`, reconciliação global de stock procedural, semântica documentada de disable concorrente, recovery `found=false` mantém pending até 24h, pequenos gaps de evidência de SW, entradas obsoletas de `.gitleaksignore`, `verify_jwt` dependente do default cloud, precache cosmético duplicado)                                                                                              |
| NEXT_STEP              | Prompt 11 — Pilot Readiness, Observabilidade e Product Hardening                                                                                                                                                             |
| FASE SEGUINTE          | Fase 4 — Pilot Ready                                                                                                                                                                                                         |
| PROMPT SEGUINTE        | Prompt 11 — Pilot Readiness, Observabilidade e Product Hardening                                                                                                                                                             |
| PROMPT 10              | `COMPLETED` — checkpoint `RELEASE_VERIFIED`; reauditoria independente concluída com `GO_WITH_NON_BLOCKING_FINDINGS`                                                                                                                                                              |

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

## Reauditoria independente — resultado oficial

- Independent final reaudit: `GO_WITH_NON_BLOCKING_FINDINGS`.
- CRITICAL: 0; HIGH: 0; MEDIUM BLOCKING: 0.
- Bloqueadores originais: B1 Migration versioned, B2 Replay protected, B3 DB tests isolated,
  B4 Backend CI gates e B5 Release convergence — todos `RESOLVED`.
- Base verificada: technical release `2a91711bc83b54841b4b4beee8beca930b9ea986`, technical CI
  `31598675826`, deployment `ceaf4832-bc0e-4159-a983-fd5ca367efd8`, docs `453af6557964620de8565d884ece6123b46266ba`.
- Dívida não bloqueante preservada na linha `PENDÊNCIAS`; nenhum item foi corrigido nesta execução.

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
