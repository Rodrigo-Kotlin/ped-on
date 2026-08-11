# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo                  | Valor                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PROJETO                | Ped-On                                                                                                                                                                                                                                                                                     |
| BRANCH                 | `main`                                                                                                                                                                                                                                                                                     |
| MODELO                 | Main-First monitorado                                                                                                                                                                                                                                                                      |
| FASE ATUAL             | Fase 3B — Clientes e Fidelidade                                                                                                                                                                                                                                                            |
| PROMPT ATUAL           | Prompt 09 — Clientes e Clube Ped-On: CPF protegido e ledger de pontos                                                                                                                                                                                                                      |
| STATUS                 | `IN_PROGRESS`                                                                                                                                                                                                                                                                              |
| CHECKPOINT             | `LOCAL_GATES_PASS` — reauditoria local aprovada; aguardando commit/push, CI e deploy rastreáveis                                                                                                                                                                                            |
| HEAD INICIAL DO PROMPT | `f662fdc` — docs: close Prompt 08 status record                                                                                                                                                                                                                                            |
| BACKEND                | 14 migrations Local == Remote até `20260811170000_prompt09_reaudit_hardening`; `supabase db lint --linked` PASS; Edge Function `loyalty-cpf` v5 deployada com `verify_jwt` ativo; secret `LOYALTY_CPF_HMAC_KEY` configurado como Supabase Edge Secret de ambiente, não Vault                 |
| FRONTEND               | `/clube/:publicSlug`, integração opcional do Clube no checkout e `/app/clube` owner-only implementados; recuperação segura de checkout implementada; cache de queries limpo na troca real de usuário; tracking sem nota livre dos itens; toggle do programa invalida/refaz a query autoritativa |
| IDENTIDADE V2          | CPF + telefone protegidos por HMAC-SHA-256 tenant-bound; lookup desconhecido e telefone incorreto usam a mesma resposta exata HTTP 422 `IDENTITY_NOT_CONFIRMED`; resolver legado revogado de `service_role`; enroll exige consentimento e gera evidência append-only                         |
| RATE LIMIT             | Fixed-window persistente no PostgreSQL, chaveado por HMAC(IP confiável + slug canônico + mode), sem PII; lookup 10/60s e enroll 5/60s; excesso HTTP 429 com `Retry-After`; slugs inexistentes compartilham escopo canônico                                                                        |
| TOKEN                  | 64 hex, hash SHA-256 no banco, TTL máximo de 2h + tolerância transacional de 5 min; leitura repetível de conta/extrato até checkout; checkout o remove atomicamente; cleanup incremental remove expirados; token existente continua legível após disable                              |
| TESTES VERIFICADOS     | Reauditoria local: format, lint, typecheck, build e Gitleaks PASS; frontend unit/component 157/157; E2E mocked 148/148 em 360/768/1024/1440; banco: RLS 22/22, RBAC 31/31, operacional 80/80, catálogo 123/123, menu 121/121, pedidos 318/318 e loyalty 148/148; Edge unit 14/14 e remote smoke 36/36; db lint linked PASS; 14 migrations Local == Remote |
| PWA                    | Nenhum cache de API/dados privados/tokens; tentativa pendente persiste somente UUID de idempotência, segredo aleatório de recuperação, slug e timestamp                                                                                                                                     |
| CLOUDFLARE             | Infraestrutura existente em `ped-on.pages.dev`; produção ainda aponta para `f662fdc`, anterior à versão completa do Prompt 09                                                                                                                                                              |
| GITHUB ACTIONS         | Workflow existente; último run de `main` verificado é o sucesso de `f662fdc`, anterior à versão completa do Prompt 09                                                                                                                                                                     |
| PENDÊNCIAS             | Criar commit de release, fazer push, validar CI da SHA correta e o deployment Cloudflare correspondente; heranças: ícones PWA definitivos, TypeScript 7.x, gestão de `membership_units` via UI e otimização do bundle                                                                      |
| NEXT_STEP              | Publicar a versão completa de forma rastreável e encerrar o Prompt 09 somente após CI e deploy passarem                                                                                                                                                                                     |
| PROMPT 10              | `NOT STARTED` — recompensas, resgates e vouchers permanecem deferidos                                                                                                                                                                                                                      |

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
- SQLSTATE do Clube permanece limitado a `PED51`, `PED52` e `PED53`.

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
| Fase 3B — Clientes e Fidelidade   | Prompt 09 — Clube Ped-On e release hardening            | IN_PROGRESS — LOCAL_GATES_PASS | não encerrado                              | 2026-08-11 |
