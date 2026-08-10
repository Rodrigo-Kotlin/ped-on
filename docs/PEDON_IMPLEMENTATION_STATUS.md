# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo | Valor |
|---|---|
| PROJETO | Ped-On |
| BRANCH | `main` |
| MODELO | Main-First monitorado |
| FASE ATUAL | Fase 2B — Catálogo administrativo |
| PROMPT ATUAL | Prompt 06 — Catálogo base: categorias e produtos simples |
| STATUS | COMPLETED |
| HEAD INICIAL DO PROMPT | `cc3efe3235fcad8a1d6c338a8c3bd2a956dda8e4` |
| ÚLTIMO COMMIT | `891257f` — feat(admin): add unit catalog management UI; banco do catálogo em `c61bafa` — feat(db): add unit catalog categories and products |
| CLOUDFLARE | CONNECTED — projeto `ped-on` (conta `f7c78675…` — auth via Wrangler OAuth); production branch `main`; build `pnpm build`; output `apps/web/dist`; deployment Prompt 06 `8cab4efd-6b5b-43aa-88da-f4a009df4254` (source `891257f`) em `https://8cab4efd.ped-on.pages.dev` e `https://ped-on.pages.dev`; HTTP 200 validado em `/`, `/login`, `/app`, `/app/catalogo`, `/app/configuracoes`, `manifest.webmanifest`, `sw.js` e assets JS/CSS; bundle contém `get_unit_catalog_admin`, `create_catalog_product` e `set_catalog_product_available`; variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` configuradas |
| SUPABASE | CONNECTED — projeto `ped-on`; project ref `zmuxkztnilnzjyyojbbr`; região South America (São Paulo); link local OK; migrations Local == Remote até `20260810122401`; migration `20260810122401_catalog_base.sql` aplicada oficialmente; `supabase db lint --linked` sem erros; Auth não alterado e zero e-mails enviados no Prompt 06; regras operacionais do Prompt 05 permanecem ativas |
| GITHUB | Repositório: `https://github.com/Rodrigo-Kotlin/ped-on` (visibilidade PUBLIC) — push para `main` concluído até `891257f` |
| GITHUB ACTIONS | Workflow `CI` funcional — run `31390204057`, SHA `891257f8b903a1a8afde3d8f439a4d6bfe6f2352`, conclusão `SUCCESS` nos jobs quality + E2E |
| MIGRATIONS APLICADAS | `20260809221710_identity_tenant_foundation` · `20260810015224_rbac_units_context` · `20260810032804_unit_operational_config` · `20260810033118_unit_operational_config_hardening` · `20260810120000_unit_operational_config_acceptance_hardening` · `20260810122401_catalog_base` |
| TESTES | Frontend unit/component 30/30; E2E total 56/56 em 360/768/1024/1440, sendo catálogo 16/16; banco: catálogo 123/123, regressões RLS 22/22, RBAC 31/31 e operacional 80/80; `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, Gitleaks v8.30.1 e `supabase db lint --linked` PASS; migration list Local == Remote com 6 migrations |
| PWA | Nenhum cache privado novo; service worker continua sem `runtimeCaching` de API/dados/tokens |
| PENDÊNCIAS | Ícones PWA definitivos (atuais são placeholders técnicos); TypeScript 7.x aguarda suporte do `typescript-eslint`; gestão de `membership_units` via UI ainda não exposta; versionamento/publicação imutável e cardápio público ainda não implementados; pedidos ainda não implementados; bundle JS de 677.59 kB gera warning de tamanho; aviso de depreciação do runtime Node.js 20 em actions de terceiros |
| NEXT_STEP | Prompt 07 — Versionamento e publicação imutável do cardápio |

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
