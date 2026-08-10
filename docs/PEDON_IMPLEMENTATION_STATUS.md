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
| PROMPT ATUAL | Prompt 05 |
| STATUS | COMPLETED |
| ÚLTIMO COMMIT | `cadeea5` — feat(admin): add unit operational configuration UI; hardening de banco em `fc6a0c4` |
| CLOUDFLARE | CONNECTED — projeto `ped-on` (conta `f7c78675…` — auth via Wrangler OAuth); production branch `main`; build `pnpm build`; output `apps/web/dist`; deployment URL `https://ped-on.pages.dev`; **env vars `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` configuradas**; deploy Prompt 05 `c619a18b` (source `cadeea5`) validado em produção: HTTP 200, SPA fallback em `/app/configuracoes`, `manifest.webmanifest`, `sw.js`, bundle com Supabase real e UI do Prompt 05, sem endpoint placeholder, e `index.html` publicado byte a byte idêntico ao build local |
| SUPABASE | CONNECTED — projeto `ped-on`; project ref `zmuxkztnilnzjyyojbbr`; região South America (São Paulo); link local OK; migrations Local == Remote até `20260810120000`; `accepting_orders` default `false`; configuração ausente retorna `configured=false` e `accepting_orders=false`; regras de aceite server-authoritative ativas · **AUTH EMAIL HOMOLOGATION: PASS** — fluxo real de confirmação de e-mail validado em produção em 2026-08-10; usuário temporário e organização de homologação removidos após validação |
| GITHUB | Repositório: `https://github.com/Rodrigo-Kotlin/ped-on` (visibilidade PUBLIC) — push para `main` concluído até `cadeea5` |
| GITHUB ACTIONS | Workflow `CI` — Prompt 05: run `31382693915` (SHA `cadeea5`, success — Quality gates + E2E smoke tests) · Prompt 04: run `31349391392` (SHA `4d447a6`, success) |
| MIGRATIONS APLICADAS | `20260809221710_identity_tenant_foundation` (identidade + multiempresa) · `20260810015224_rbac_units_context` (RBAC administrativo e contexto por unidade) · `20260810032804_unit_operational_config` (configuração operacional e RPCs transacionais) · `20260810033118_unit_operational_config_hardening` (validações defensivas) · `20260810120000_unit_operational_config_acceptance_hardening` (default seguro, contrato `configured` e aceite server-authoritative) |
| TESTES | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (PASS); `pnpm test:run` (22/22 PASS); `pnpm test:e2e` (40/40 PASS em 4 viewports, incluindo owner/manager/operator e save determinístico sem Auth real); Gitleaks v8.30.1 (PASS); `supabase db lint --linked` (PASS); banco operacional (80/80 PASS), RLS (22/22 PASS) e RBAC (31/31 PASS); migration list Local == Remote e SQL `20260810120000` local/remoto com SHA-256 idêntico |
| PENDÊNCIAS | Ícones PWA definitivos (atuais são placeholders técnicos); TypeScript 7.x aguarda suporte do `typescript-eslint`; gestão de `membership_units` via UI ainda não exposta; rotas de negócio de pedidos ainda não implementadas; aviso de depreciação do runtime Node.js 20 em actions de terceiros (workflow executa e passa em Node.js 24) |
| NEXT_STEP | Prompt 06 — aguarda definição e autorização; nenhum trabalho iniciado |

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
