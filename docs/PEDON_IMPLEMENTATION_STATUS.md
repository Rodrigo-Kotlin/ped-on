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
| STATUS                 | `IN_PROGRESS`                                                                                                                                                                                                                                                                              |
| CHECKPOINT             | `BACKEND_CORE_COMPLETED` — backend versionado em `0d4dfd5`, CI aprovado; frontend ainda não iniciado                                                                                                                                                                                       |
| HEAD INICIAL DO PROMPT | `429e2fe` — docs: close Prompt 09 status record                                                                                                                                                                                                                                            |
| BACKEND                | `IMPLEMENTED` — 15 migrations Local == Remote até `20260811200418_loyalty_rewards_redemptions_vouchers`; rewards, resgate atômico, vouchers e auditoria implementados; `supabase db lint --linked` sem erros                                                                                 |
| FRONTEND               | `NOT STARTED` — catálogo público, resgate/recovery, vouchers do membro, reward management e operação staff ainda pendentes                                                                                                                                                                 |
| IDENTIDADE V2          | CPF + telefone protegidos por HMAC-SHA-256 tenant-bound; lookup desconhecido e telefone incorreto usam a mesma resposta exata HTTP 422 `IDENTITY_NOT_CONFIRMED`; resolver legado revogado de `service_role`; enroll exige consentimento e gera evidência append-only                         |
| RATE LIMIT             | Fixed-window persistente no PostgreSQL, chaveado por HMAC(IP confiável + slug canônico + mode), sem PII; lookup 10/60s e enroll 5/60s; excesso HTTP 429 com `Retry-After`; slugs inexistentes compartilham escopo canônico                                                                        |
| TOKEN                  | 64 hex, hash SHA-256 no banco, TTL máximo de 2h + tolerância transacional de 5 min; leitura repetível de conta/extrato até checkout; checkout o remove atomicamente; cleanup incremental remove expirados; token existente continua legível após disable                              |
| TESTES VERIFICADOS     | Backend Prompt 10: RLS 22/22, RBAC 31/31, operacional 80/80, catálogo 123/123, menu 121/121, pedidos 318/318, loyalty 148/148 e rewards/vouchers 215/215; db lint linked sem erros; 15 migrations Local == Remote; CI `31552880755` SUCCESS                                                               |
| PWA                    | Nenhum cache de API/dados privados/tokens; tentativa pendente persiste somente UUID de idempotência, segredo aleatório de recuperação, slug e timestamp                                                                                                                                     |
| CLOUDFLARE             | Deployment de produção `63b40263-d3b7-4d41-a5b2-ee8ecc97f4d0`, source `2013e8d`, verificado no domínio estável e na URL imutável; SPA fallback, manifest, service worker, assets, rotas do Clube e bundle aprovados                                                                      |
| GITHUB ACTIONS         | Run `31552880755`, SHA `0d4dfd5e19a2736317fbd38d1fa2b5a069614d06`, sucesso em Quality gates e E2E smoke tests                                                                                                                                                                            |
| PENDÊNCIAS             | Heranças não bloqueantes: ícones PWA definitivos, atualização das actions que ainda recebem aviso de Node.js 20, TypeScript 7.x, gestão de `membership_units` via UI e otimização do bundle                                                                                              |
| NEXT_STEP              | Implementar frontend público do Prompt 10 em `/clube/:publicSlug`, seguido por reward management owner-only e operação de vouchers por unidade                                                                                                                                             |
| PROMPT 10              | `IN_PROGRESS` — checkpoint `BACKEND_CORE_COMPLETED`; não marcar `COMPLETED` antes de frontend, testes, CI e produção                                                                                                                                                                       |

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
| Fase 3B — Clientes e Fidelidade   | Prompt 09 — Clube Ped-On e release hardening            | COMPLETED | `2013e8d`                                 | 2026-08-11 |
| Fase 3C — Recompensas e Vouchers  | Prompt 10 — Recompensas, resgate atômico e vouchers     | IN_PROGRESS — BACKEND_CORE_COMPLETED | `0d4dfd5`                    | 2026-08-11 |
