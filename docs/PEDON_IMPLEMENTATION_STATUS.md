# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo | Valor |
|---|---|
| PROJETO | Ped-On |
| BRANCH | `main` |
| MODELO | Main-First monitorado |
| FASE ATUAL | Fase 3B — Clientes e Fidelidade |
| PROMPT ATUAL | Prompt 09 — Clientes e Clube Ped-On: CPF protegido e ledger de pontos |
| STATUS | IN_PROGRESS |
| CHECKPOINT | DB/ledger core + Edge identity completed |
| HEAD INICIAL DO PROMPT | `f662fdc` — docs: close Prompt 08 status record |
| ÚLTIMO COMMIT FUNCIONAL | `3b1ed21` — feat(edge): add loyalty-cpf identity function |
| CLOUDFLARE | CONNECTED — projeto `ped-on` (conta `f7c78675…` — auth via Wrangler OAuth); production branch `main`; build `pnpm build`; output `apps/web/dist`; deployment Prompt 08 `f1afe182-8999-4c30-b635-e39e51a1dbac` (source `7fe07df`) em `https://f1afe182.ped-on.pages.dev` e `https://ped-on.pages.dev`; HTTP 200 validado em `/`, Auth, rotas administrativas incluindo `/app/pedidos`, `/menu/:slug`, carrinho, checkout, `/pedido/:trackingToken`, `manifest.webmanifest`, `sw.js`, assets JS/CSS e fallback SPA; domínio estável serve o mesmo bundle `index-CTtpL05m.js`; bundle contém as RPCs públicas/administrativas do Prompt 08, aponta para o Supabase oficial e não contém `service_role`; service worker sem cache runtime de API |
| SUPABASE | CONNECTED — projeto `ped-on`; project ref `zmuxkztnilnzjyyojbbr`; região South America (São Paulo); migrations Local == Remote até `20260811080000` (12 migrations); migrations do Clube e hardening aplicadas oficialmente; Edge Function `loyalty-cpf` deployada (verify_jwt ativo, CORS/`no-store`) e secret `LOYALTY_CPF_HMAC_KEY` setado (backend-only); `supabase db lint --linked` sem erros; Auth não alterado e zero e-mails enviados no Prompt 09; regras anteriores permanecem ativas |
| GITHUB | Repositório: `https://github.com/Rodrigo-Kotlin/ped-on` (visibilidade PUBLIC) — push para `main` concluído até `7fe07df` |
| GITHUB ACTIONS | Workflow `CI` funcional — run `31429728244`, SHA `7fe07dfadd3993ff8d6869dd6d4f53f82cb53c8b`, conclusão `SUCCESS` nos jobs quality + E2E |
| MIGRATIONS APLICADAS | `20260809221710_identity_tenant_foundation` · `20260810015224_rbac_units_context` · `20260810032804_unit_operational_config` · `20260810033118_unit_operational_config_hardening` · `20260810120000_unit_operational_config_acceptance_hardening` · `20260810122401_catalog_base` · `20260810135051_menu_versioning_publication` · `20260810141000_menu_publication_slug_fix` · `20260810144145_orders_checkout` · `20260810162508_orders_checkout_lint_hardening` · `20260810170000_loyalty_customers_ledger` · `20260811080000_loyalty_earn_refunded_guard` |
| TESTES | Frontend unit/component 87/87; E2E total 104/104 em 360/768/1024/1440; banco: loyalty 108/108, pedidos 318/318, publicação 121/121, catálogo 123/123, operacional 80/80, RLS 22/22 e RBAC 31/31; Edge smoke `loyalty_edge_smoke.mjs` 26/26 PASS contra a função deployada; `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, Gitleaks e `supabase db lint --linked` PASS; migration list Local == Remote com 12 migrations |
| PWA | Nenhum cache privado novo; service worker continua sem `runtimeCaching` de API/dados/tokens |
| PENDÊNCIAS | Prompt 09: página pública `/clube/:publicSlug` (lookup, enroll, consentimento, saldo, extrato, checkout opcional com Clube); painel `/app/clube` owner-only (enable/disable, métricas, membros mascarados); frontend unit tests + E2E + 360/768/1024/1440 + a11y; build, gitleaks, CI e deploy Cloudflare; heranças: ícones PWA definitivos, TypeScript 7.x, gestão de `membership_units` via UI, bundle JS ~734 kB, warning Node 20 em actions de terceiros |
| NEXT_STEP | Página pública `/clube/:publicSlug` (identidade + saldo + checkout com Clube) e painel `/app/clube` |

---

## Histórico de Execução

| Etapa | Prompt | Status | Commit | Data |
|---|---|---|---|---|
| Fase 0 — Fundação | Prompt 00 — Bootstrap controlado e registro de contexto | COMPLETED | `efcb205` | 2026-08-09 |
| Fase 0 — Fundação | Prompt 01 — Scaffold técnico, qualidade e CI mínimo | COMPLETED | `f214362` | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 02 — Integrações de infraestrutura: Supabase + Cloudflare + GitHub | COMPLETED | `34f25aa` | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 03 — Supabase Auth, identidade e modelo multiempresa inicial | COMPLETED | `1f9079b` | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 04 — RBAC administrativo, gestão de unidades e contexto por unidade | COMPLETED | `a8d166b` | 2026-08-10 |
| Fase 0 — Infraestrutura Integrada | Prompt 05 — Configuração operacional da unidade e aceite seguro de pedidos | COMPLETED | `fc6a0c4`, `cadeea5` | 2026-08-10 |
| Fase 2B — Catálogo administrativo | Prompt 06 — Catálogo base: categorias e produtos simples | COMPLETED | `c61bafa`, `891257f` | 2026-08-10 |
| Fase 2C — Cardápio | Prompt 07 — Versionamento e publicação imutável do cardápio | COMPLETED | `87a796b`, `ee509b7`, `3e2bfdd`, `a1640ad` | 2026-08-10 |
| Fase 3A — Pedidos | Prompt 08 — Carrinho, checkout guest, pedido idempotente e Central de Pedidos | COMPLETED | `41b9da2`, `b801468`, `7fe07df` | 2026-08-10 |
