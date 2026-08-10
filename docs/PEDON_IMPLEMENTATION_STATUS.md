# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo | Valor |
|---|---|
| PROJETO | Ped-On |
| BRANCH | `main` |
| MODELO | Main-First monitorado |
| FASE ATUAL | Fase 3A — Pedidos: checkout público e Central de Pedidos |
| PROMPT ATUAL | Prompt 08 — Carrinho, checkout guest, pedido idempotente e Central de Pedidos |
| STATUS | IN PROGRESS |
| HEAD INICIAL DO PROMPT | `cb946a6` — docs: close Prompt 07 status record |
| ÚLTIMO COMMIT | `cb946a6` — docs: close Prompt 07 status record (Prompt 08 em execução) |
| CLOUDFLARE | CONNECTED — projeto `ped-on` (conta `f7c78675…` — auth via Wrangler OAuth); production branch `main`; build `pnpm build`; output `apps/web/dist`; deployment Prompt 07 `90d70dc2-f739-4a2c-a04d-af55cc250406` (source `a1640ad`) em `https://90d70dc2.ped-on.pages.dev` e `https://ped-on.pages.dev`; HTTP 200 validado em `/`, `/login`, `/app`, `/app/cardapio`, `/app/catalogo`, `/app/configuracoes`, `manifest.webmanifest`, `sw.js`, assets JS/CSS e SPA fallback em rota desconhecida; bundle contém `publish_unit_menu`, `get_public_menu`, `get_unit_menu_publication_admin`, `get_unit_catalog_admin` e `get_unit_operational_config`; aponta para Supabase real sem secret key; variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` configuradas |
| SUPABASE | CONNECTED — projeto `ped-on`; project ref `zmuxkztnilnzjyyojbbr`; região South America (São Paulo); link local OK; migrations Local == Remote até `20260810141000`; migrations `20260810135051_menu_versioning_publication.sql` e `20260810141000_menu_publication_slug_fix.sql` aplicadas oficialmente; `supabase db lint --linked` sem erros; Auth não alterado e zero e-mails enviados no Prompt 08 até o momento; regras de catálogo/operacional dos Prompts 05–06 e cardápio do Prompt 07 permanecem ativas |
| GITHUB | Repositório: `https://github.com/Rodrigo-Kotlin/ped-on` (visibilidade PUBLIC) — push para `main` concluído até `a1640ad` |
| GITHUB ACTIONS | Workflow `CI` funcional — run `31407263950`, SHA `a1640ad8c12115602eb299c47cae82c13822d7f3`, conclusão `SUCCESS` nos jobs quality + E2E |
| MIGRATIONS APLICADAS | `20260809221710_identity_tenant_foundation` · `20260810015224_rbac_units_context` · `20260810032804_unit_operational_config` · `20260810033118_unit_operational_config_hardening` · `20260810120000_unit_operational_config_acceptance_hardening` · `20260810122401_catalog_base` · `20260810135051_menu_versioning_publication` · `20260810141000_menu_publication_slug_fix` |
| TESTES | Frontend unit/component 55/55; E2E total 92/92 em 360/768/1024/1440, sendo cardápio/publicação 36/36 (página admin, público sem sessão, slug inválido, indisponível, vazio); banco: publicação 121/121, catálogo 123/123, operacional 80/80, RLS 22/22 e RBAC 31/31; `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` e `supabase db lint --linked` PASS; migration list Local == Remote com 8 migrations |
| PWA | Nenhum cache privado novo; service worker continua sem `runtimeCaching` de API/dados/tokens |
| PENDÊNCIAS | Ícones PWA definitivos (atuais são placeholders técnicos); TypeScript 7.x aguarda suporte do `typescript-eslint`; gestão de `membership_units` via UI ainda não exposta; pedidos em implementação no Prompt 08 (checkout público, pedido idempotente e Central); bundle JS de ~677 kB gera warning de tamanho; aviso de depreciação do runtime Node.js 20 em actions de terceiros |
| NEXT_STEP | Prompt 08 em execução: carrinho local, checkout guest idempotente, tracking público e Central de Pedidos |

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
