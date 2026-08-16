# PROMPT 13 — Etapa 13.6 — Hardening + Release Candidate

> Auditoria de hardening e decisão de Release Candidate do Prompt 13 (Operação de Pedidos 2.0).
> Fase A (auditoria) → Fase B (gates de baseline) → Fase C (testes de hardening) → Fase D (correções).
> Documento de fechamento da Etapa 13.6. Commit documental (nenhuma alteração de código).

---

## 1. Escopo e método de auditoria

- **Baseline congelado:** branch `main`, `HEAD` = `origin/main` = `ddd11b44afa61792d51b6fba023e5fd4015bcd5c`
  (`feat(prompt13): polish operational tablet and desktop UI`), working tree limpo no início.
- **Método:** revisão estática dos 12 domínios (6.1–6.12) com leitura direta dos módulos do
  frontend (`apps/web/src/lib/orders/**`, `apps/web/src/pages/{KdsPage,PedidosPage,KdsPrintPage}.tsx`,
  `apps/web/src/components/{AppShell,OperationalOrderStatus}.tsx`, `AdminProvider`, `useOnline`,
  `critical-operation`, config PWA) e do backend operacional
  (`supabase/migrations/20260814100000_prompt13_backend_operational_core.sql`,
  `20260810170000_loyalty_customers_ledger.sql`), contra os contratos das DEC-120 a DEC-124 e os
  cenários E2E existentes.
- **Classificação:** P0 crítico; P1 bloqueador de RC; P2 corrigível de baixo risco; P3 registrado
  sem implementação.
- **Restrições:** nenhum banco/Docker local; CI é o ambiente autoritativo de banco.
  `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.
  `LOCAL DB TESTS: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

## 2. Tabela de achados por área

| Área | Classificação | Achado / descarte |
| --- | --- | --- |
| 6.1 Central de Pedidos | NENHUM (P0/P1/P2) | v2 keyset (cursor base64, `snapshot_at`), filtros normalizados com validação `PED79`, conflito `PED47/PED48` invalida e mantém consistência, foco restaurado após mutação, ações rápidas com `busy`/`primaryBusy`/`cancelBusy` (anti double-click). Sem correção. |
| 6.2 KDS | NENHUM (P0/P1/P2) | Board `key={selectedUnit.id}` (isolamento de estado por unidade), ações com `startedRef` + `isPending` + `aria-busy` (anti double-click), aviso de truncamento >200 (E2E K), sem PII (E2E H). Sem correção. |
| 6.3 Realtime + Polling | NENHUM (P0/P1/P2) | Única subscription realtime, owner exclusivo no `AppShell` via `useOperationalOrdersBridge` (E2E I — navegação não duplica); invalidação por prefixo `unit-orders/<unit>/list` cobre listas v1, v2 e KDS; `degraded → connected` força resync (E2E H); polling KDS 15s gated por `online` + `visibilityState`. Sem correção. |
| 6.4 Alertas Operacionais | NENHUM (P0/P1/P2); 2 achados P3 | Baseline conservador (E2E A/F/J), dedup via `OrderSeenTracker` (E2E C), 1 chime por lote (E2E D), auto-dismiss 10s, banner sem PII (E2E G). P3-1 e P3-2 abaixo (registrados, não implementados). |
| 6.5 Impressão | NENHUM (P0/P1/P2) | `window.print` somente por ação explícita (E2E M), comanda sem PII/pagamento/valores (E2E N), viewports 360–1440 (E2E O), reimpressão de pronto (E2E P), acesso por função (E2E Q), indisponível sem imprimir (E2E R). Sem correção. |
| 6.6 Offline / Fail-closed | NENHUM (P0/P1/P2) | `assertOnline()` síncrono antes de toda mutação; `networkMode: 'always'` + `assertOnline` → falha rápida, sem execução em background offline; `useCriticalOperation` rastreia operações ativas (bloqueia atualização PWA durante mutação — DEC-112). Sem correção. |
| 6.7 Multi-tenant / troca de unidade | NENHUM (P0/P1/P2) | `selectedUnit` validado contra unidades ativas e saneado no `localStorage` (`pedon:selectedUnitId`); páginas remontadas por `key={selectedUnit.id}`; bridge zera `newCount`, dispensa alerta e re-assina por unidade (E2E F). Sem correção. |
| 6.8 Privacidade / PII | NENHUM (P0/P1/P2) | `get_kds_orders_minimal` sem cliente/telefone/endereço/pagamento/totais/IDs técnicos (DEC-121); KDS/print/alerts nunca expõem PII (E2E G/H/N). Sem correção. |
| 6.9 PWA / SW | NENHUM (P0/P1/P2) | `registerType: 'prompt'`; precache somente (37 entries, 0 duplicatas, `runtimeCaching: NONE`) — gate `audit:precache` PASS e helper de regressão ativo (DEC-124). Sem correção. |
| 6.10 Acessibilidade | NENHUM (P0/P1/P2) | Uma `role="status"`/`aria-live` por superfície (rotas operacionais exatas), foco restaurado pós-mutação, badge de contagem sem `aria-label` (contrato 13.5B restaurado). Sem correção. |
| 6.11 Responsividade | NENHUM (P0/P1/P2) | Layout largo apenas em `/app/pedidos` e `/app/cozinha` (`isOperationalRoute` exato); board/cards/comanda sem overflow em 360–1440 (E2E I/J/O). Sem correção. |
| 6.12 Segurança frontend | NENHUM (P0/P1/P2) | Sem `dangerouslySetInnerHTML`, `eval` ou `new Function`; somente chaves publishable `VITE_SUPABASE_*`; acesso de dados exclusivamente via RPC com `can_access_unit`; erros RPC mapeados para mensagens seguras (códigos `PED`), sem vazar mensagens internas do banco. Sem correção. |

### Achados P3 registrados (não implementados — por design)

- **P3-1 (Som — documentação vs implementação):** a DEC-124 documenta o opt-in sonoro persistido em
  `sessionStorage`, mas a implementação real usa estado React local (`useState(false)` em
  `useOperationalOrdersBridge`) — ou seja, **nenhuma** persistência, reseta a cada reload, ainda mais
  estrito que `sessionStorage`. O contrato "som sessão-only no reload" é satisfeito (E2E D PASS).
  **Descartes:** comportamento verificado e correto; sem finding funcional. Nenhuma alteração de
  código nesta etapa (proibido mudar sem finding reproduzível). Recomenda-se corrigir apenas o texto
  da DEC-124 numa futura edição documental.
- **P3-2 (`OrderSeenTracker.prune` em volume extremo):** o tracker tem teto de 1000 pedidos por
  unidade com evicção do mais antigo. Em volume extremo (>1000 novos não vistos na mesma sessão),
  um pedido evictado poderia re-disparar um único alerta se reaparecer como `new`. Impacto limitado
  (alerta único, sem dados/segurança), memória limitada por design.
  **Descartes:** aceitável para o piloto; não implementado.

## 3. Decisão RC — verificado e NÃO corrigido

Verificado (sem alteração, evidência estável nos cenários E2E A–R e nos gates locais):

1. Realtime único, sem duplicação entre rotas; degradação sinalizada e polling de fallback ativo.
2. Baseline conservador em hidratação, troca de unidade e resync offline→online (sem alert storm).
3. Dedup de alertas por lote/pedido; um único chime por lote; opt-in sonoro sessão-only.
4. Mutações fail-closed offline; anti double-click (pendência desabilita ação); foco preservado.
5. KDS e comanda sem PII; truncamento >200 explícito.
6. `runtimeCaching: NONE` para o escopo Supabase mutável (gate automatizado).
7. Erros operacionais `PED10/PED11/PED12/PED46/PED47/PED48/PED79` mapeados e mensagens seguras.
8. Multi-tenant: unidade validada, estado visual isolado por `key={unit.id}`, badge/alertas zerados.

NÃO corrigido (com justificativa):

1. Nenhum P0/P1/P2 encontrado — não há correção de código na Etapa 13.6 (commit documental).
2. P3-1 e P3-2 registrados e descartados (ver seção 2) — sem ação nesta etapa.
3. Nenhuma mudança de backend/RPC/schema/RLS — nenhuma migration nova; o backend permanece no
   contrato da Etapa 13.2 / migration 23 (23/23/23 reconciliado).

## 4. Resultados dos gates locais (Fase B — baseline)

| Gate | Resultado |
| --- | --- |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS (4 workspaces) |
| `pnpm test:run` (Vitest) | 46 arquivos / 503 testes PASS |
| `pnpm build` | PASS (37 precache entries) |
| `pnpm audit:precache` | PASS — 37 entries, uniqueUrls 37, duplicateOccurrences 0, 978789 bytes, `runtimeCaching: NONE` |
| `git diff --check` | PASS |
| `pnpm test:e2e` | 505 PASS / 3 skipped (intencionais) / 0 failed — viewports mobile-360, tablet-768, desktop-1024, desktop-1440 |

## 5. Resultados do CI

- CI do HEAD técnico `ddd11b44`: `31924328717` SUCCESS (Backend release gates 2m14s, Quality gates
  1m32s, E2E smoke 5m45s — 505 passed / 3 skipped) — Etapa 13.5B.
- CI do commit documental da Etapa 13.6: registrado no relatório final da execução
  (evitando autorreferência), mantendo as 4 etapas do pipeline (Quality gates, Backend release
  gates, E2E smoke tests, secret scan).
- `LOCAL DB REBUILD: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.
- `LOCAL DB TESTS: NOT RUN — BY DESIGN / NO LOCAL DOCKER`.

## 6. Decisão de gate final

- **Fase A:** auditoria completa das 12 áreas → NENHUM P0/P1/P2; 2 achados P3 registrados e
  descartados.
- **Fase B:** todos os gates locais PASS; E2E 505/3/0 estável.
- **Fase C:** sem lacuna de cobertura reproduzível — nenhum teste novo adicionado.
- **Fase D:** nenhuma correção de código (nenhum finding real).
- **Decisão:** RC aceito sem alteração funcional. Prompt 13 pode ser declarado `COMPLETED`.
  O piloto permanece `NOT STARTED` (nenhuma ação de rollout tomada nesta execução).

## 7. RELEASE_CANDIDATE_CHECKPOINT

```
ETAPA 13.6                          — COMPLETED
RELEASE_CANDIDATE_CHECKPOINT        — ACHIEVED
PROMPT 13                           — COMPLETED
OPERATION_READY                     — ACHIEVED
PILOT_GATE                          — READY / NOT STARTED
```
