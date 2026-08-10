# PED-ON — Implementation Status

> Status oficial de implementação. Atualizado a cada etapa/prompt concluído.
> Antes de qualquer alteração no projeto, leia este documento e os demais documentos de continuidade.

---

| Campo | Valor |
|---|---|
| PROJETO | Ped-On |
| BRANCH | `main` |
| MODELO | Main-First monitorado |
| FASE ATUAL | Fase 0 — Infraestrutura Integrada |
| PROMPT ATUAL | Prompt 04 |
| STATUS | COMPLETED |
| ÚLTIMO COMMIT | `a8d166b` — feat: RBAC administrativo, gestão de unidades e contexto por unidade (Prompt 04) |
| CLOUDFLARE | CONNECTED — projeto `ped-on` (conta `f7c78675…` — auth via wrangler OAuth); production branch `main`; build `pnpm build`; output `apps/web/dist`; deployment URL `https://ped-on.pages.dev`; **env vars `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` configuradas** — bundle publicado injeta a URL real do Supabase (sem placeholder); deploy Prompt 04 `e6719911` (SHA `4d447a6`, status **SUCCESS** — stage `deploy`) validado em produção: HTTP 200 em `/`, SPA fallback (`/login`, `/cadastro`, `/onboarding`, `/app`, `/clube/*`), `manifest.webmanifest`, `sw.js`, assets JS/CSS, e `index.html` publicado byte-a-byte idêntico ao build local |
| SUPABASE | CONNECTED — projeto `ped-on`; project ref `zmuxkztnilnzjyyojbbr`; região South America (São Paulo); CLI 2.109.1; link local OK; migrations `20260809221710_identity_tenant_foundation` e `20260810015224_rbac_units_context` APLICADAS · **AUTH EMAIL HOMOLOGATION: PASS** — fluxo real de confirmação de e-mail validado em produção em 2026-08-10 (signup único → e-mail do mailer padrão → link de confirmação → redirect para `https://ped-on.pages.dev` sem localhost → login → onboarding → session restore → logout → relogin sem repetir onboarding → validação de banco → cleanup); usuário temporário e organização `PEDON HOMOLOGACAO EMAIL` removidos após validação |
| GITHUB | Repositório: `https://github.com/Rodrigo-Kotlin/ped-on` (visibilidade PUBLIC) — push para `main` concluído até `a8d166b` |
| GITHUB ACTIONS | Workflow `CI` — Prompt 04: run `31349391392` (SHA `4d447a6`, success — Quality gates + E2E smoke tests) · Prompt 03: run `31342124765` (SHA `1f9079b`, success) |
| MIGRATIONS APLICADAS | `20260809221710_identity_tenant_foundation` (identidade + multiempresa: `profiles`, `organizations`, `organization_members`, `units`; RPCs `complete_onboarding` e `is_org_member`; RLS por tenant) · `20260810015224_rbac_units_context` (RBAC administrativo: papéis `owner`/`manager`/`operator`; `membership_units` para autorização por unidade; helpers `is_org_owner`/`can_access_unit`; RLS de `units` por autorização efetiva; RPCs server-authoritative `create_unit`/`update_unit`/`set_unit_active`; contexto único `get_my_admin_context`) |
| TESTES | `pnpm format:check` (PASS); `pnpm lint` (PASS); `pnpm typecheck` (PASS); `pnpm test:run` (18/18 PASS — incluindo AuthProvider/guards/telas); `pnpm build` (PASS — PWA generateSW, 16 precache entries); banco/RLS `rls_integrity.test.mjs` (22 checks / 12 cenários PASS — regressão após Prompt 04); banco/RBAC `rbac_units_integrity.test.mjs` (31 checks / 22 cenários PASS — RBAC, escopo por unidade, cross-tenant, última unidade ativa, concorrência); `supabase db lint --linked` (PASS — nenhum erro de schema) |
| PENDÊNCIAS | **PRODUCTION AUTH EMAIL HOMOLOGATION: PASS** (2026-08-10 — fluxo real validado em produção); **AUTH SITE_URL INCIDENT: RESOLVED** (anteriormente o link de confirmação redirecionava para `localhost`; configuração corrigida para `https://ped-on.pages.dev` e validada); rate limit de e-mail observado durante desenvolvimento é limitação do mailer padrão do Supabase (não é bug do Ped-On); ícones PWA definitivos (atuais são placeholders técnicos); TypeScript 7.x aguarda suporte do `typescript-eslint`; gestão de `membership_units` via UI ainda não exposta (fundação de dados criada); rotas de negócio de pedidos ainda não implementadas (próximo prompt) |
| NEXT_STEP | Prompt 05 — aguarda definição (próximas funcionalidades de gestão de pedidos) |

---

## Histórico de Execução

| Etapa | Prompt | Status | Commit | Data |
|---|---|---|---|---|
| Fase 0 — Fundação | Prompt 00 — Bootstrap controlado e registro de contexto | COMPLETED | `efcb205` | 2026-08-09 |
| Fase 0 — Fundação | Prompt 01 — Scaffold técnico, qualidade e CI mínimo | COMPLETED | `f214362` | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 02 — Integrações de infraestrutura: Supabase + Cloudflare + GitHub | COMPLETED | `34f25aa` | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 03 — Supabase Auth, identidade e modelo multiempresa inicial | COMPLETED | `1f9079b` | 2026-08-09 |
| Fase 0 — Infraestrutura Integrada | Prompt 04 — RBAC administrativo, gestão de unidades e contexto por unidade | COMPLETED | `a8d166b` | 2026-08-10 |
