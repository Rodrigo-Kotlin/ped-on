# PED-ON — Decision Register

> Registro oficial de decisões técnicas e de produto.
> Toda nova decisão deve ser adicionada aqui com ID sequencial, data, descrição, justificativa e status.

## Formato

| Campo | Descrição |
|---|---|
| `DEC-NNN` | Identificador sequencial |
| Status | `APROVADA` (aprovada), `OPEN` (em aberto / requer decisão) |
| Data | Data de registro |
| Decisão | Descrição objetiva |

## Decisões Iniciais Aprovadas (Prompt 00)

### DEC-001 — `organization_id` é o tenant principal
- **Status:** APROVADA
- **Decisão:** `organization_id` representa o tenant no modelo de dados.

### DEC-002 — `unit_id` é o escopo operacional
- **Status:** APROVADA
- **Decisão:** `unit_id` representa o escopo operacional dentro do tenant.

### DEC-003 — Uma organização pode possuir múltiplas unidades
- **Status:** APROVADA
- **Decisão:** o modelo suporta N unidades por organização.

### DEC-004 — Owner poderá acessar todas as unidades da própria organização
- **Status:** APROVADA
- **Decisão:** o papel owner tem acesso a todas as unidades do próprio tenant.

### DEC-005 — Usuários restritos acessarão somente as unidades autorizadas
- **Status:** APROVADA
- **Decisão:** acesso entre unidades depende de autorização explícita.

### DEC-006 — O cardápio publicado será associado à unidade
- **Status:** APROVADA
- **Decisão:** a publicação do cardápio tem escopo por unidade.

### DEC-007 — Versões publicadas do cardápio serão imutáveis
- **Status:** APROVADA
- **Decisão:** após publicação, a versão não pode ser alterada.

### DEC-008 — Pedido deverá armazenar snapshot dos dados comerciais relevantes
- **Status:** APROVADA
- **Decisão:** o pedido preserva snapshot dos itens/preços relevantes no momento da compra.

### DEC-009 — Valores monetários utilizarão `numeric(12,2)`
- **Status:** APROVADA
- **Decisão:** persistência e cálculo financeiro em `numeric(12,2)`; nunca `float`/`double`.

### DEC-010 — Nenhum total enviado pelo frontend será considerado autoritativo
- **Status:** APROVADA
- **Decisão:** totais são recalculados no servidor.

### DEC-011 — Pedidos deverão possuir idempotência
- **Status:** APROVADA
- **Decisão:** envios duplicados não podem gerar pedidos duplicados.

### DEC-012 — Rastreamento público de pedido não utilizará ID previsível
- **Status:** APROVADA
- **Decisão:** identificadores públicos de rastreamento devem ser não previsíveis.

### DEC-013 — Pagamento operacional e estado do pedido serão conceitos separados
- **Status:** APROVADA
- **Decisão:** o estado de pagamento é distinto do estado do pedido.

### DEC-014 — Pontos utilizarão ledger append-only
- **Status:** APROVADA
- **Decisão:** o histórico de pontos é imutável e somente-adição.

### DEC-015 — Regra inicial do MVP: R$ 1,00 elegível = 1 ponto inteiro
- **Status:** APROVADA
- **Decisão:** taxa de conversão base de 1 ponto por real elegível.

### DEC-016 — O cálculo inicial utilizará floor do valor elegível
- **Status:** APROVADA
- **Exemplo:** R$ 52,90 elegíveis → 52 pontos.

### DEC-017 — Taxa de entrega não gera pontos no Core MVP
- **Status:** APROVADA
- **Decisão:** valores de entrega ficam fora da base de pontos no MVP.

### DEC-018 — Pontos não possuem valor monetário
- **Status:** APROVADA
- **Decisão:** pontos são um direito não monetário.

### DEC-019 — Pontos não podem ser sacados, vendidos ou transferidos
- **Status:** APROVADA
- **Decisão:** pontos são intransferíveis e sem resgate em dinheiro.

### DEC-020 — Expiração automática de pontos não fará parte do Core MVP
- **Status:** APROVADA
- **Decisão:** sem política de expiração no MVP.

### DEC-021 — Campanhas e multiplicadores ficam fora do Core MVP
- **Status:** APROVADA
- **Decisão:** recursos de campanha/multiplicador são pós-MVP.

### DEC-022 — Voucher do MVP será consumido operacionalmente por funcionário autorizado
- **Status:** APROVADA
- **Decisão:** resgate do voucher é operacional (staff autorizado), não self-service no MVP.

### DEC-023 — CPF será opcional para pedido simples e obrigatório para adesão ao Clube Ped-On
- **Status:** APROVADA
- **Decisão:** CPF exigido somente para o programa de fidelidade.

### DEC-024 — CPF não será utilizado como identificador público de rota
- **Status:** APROVADA
- **Decisão:** CPF não aparece em URLs/rotas públicas.

### DEC-025 — CPF não será utilizado como senha
- **Status:** APROVADA
- **Decisão:** CPF não é credencial de acesso.

### DEC-026 — Lookup seguro de CPF utilizará mecanismo HMAC ou estratégia criptográfica equivalente no backend
- **Status:** APROVADA
- **Decisão:** não usar hash simples exposto ao frontend.

### DEC-027 — Nenhum CPF completo deverá aparecer em logs
- **Status:** APROVADA
- **Decisão:** mascaramento obrigatório em logs.

### DEC-028 — O PWA poderá armazenar carrinho local, mas não deverá persistir CPF ou tokens administrativos em cache customizado
- **Status:** APROVADA
- **Decisão:** escopo limitado do armazenamento local.

### DEC-029 — Checkout, resgate e transições de pedido serão network-only
- **Status:** APROVADA
- **Decisão:** operações críticas exigem conexão e não simulam sucesso offline.

### DEC-030 — Realtime deverá disparar invalidação/refetch da fonte autoritativa
- **Status:** APROVADA
- **Decisão:** Realtime é gatilho de atualização; a fonte da verdade permanece no servidor.

## Decisões Aprovadas (Prompt 01 — Fundação técnica web)

### DEC-031 — TypeScript fixado em 5.9.x
- **Status:** APROVADA
- **Decisão:** TypeScript `^5.9.3` em todo o monorepo. O TypeScript 7.x (nativo/Go) não é
  suportado pelo `typescript-eslint` nesta fase (`typescript >=4.8.4 <6.1.0`). A atualização
  será reavaliada quando o ecossistema suportar.

### DEC-032 — React Router v8 adotado
- **Status:** APROVADA
- **Decisão:** `react-router@^8` (declarative mode) como router oficial, importando de
  `react-router`; o `RouterProvider` DOM vem de `react-router/dom`. A v8 removeu o pacote
  `react-router-dom`. Nenhuma rota de negócio criada nesta etapa; o roteiro de rotas futuras
  (`/login`, `/onboarding`, `/app/*`, `/menu/*`, `/pedido/*`, `/clube/*`) está documentado na
  página técnica.

### DEC-033 — PWA via vite-plugin-pwa
- **Status:** APROVADA
- **Decisão:** `vite-plugin-pwa` (registerType `autoUpdate`, generateSW) como fundação PWA.
  Cache apenas de assets estáticos (js/css/html/svg/png/ico/woff2) via `globPatterns` +
  `navigateFallback` para `index.html`. Sem `runtimeCaching`: nenhum cache de API/dados/tokens.
  Ícones atuais são placeholders técnicos; ícones definitivos são pendência registrada.

### DEC-034 — Testes: Vitest + Testing Library + Playwright
- **Status:** APROVADA
- **Decisão:** unit/componente com Vitest + jsdom + Testing Library + jest-dom; E2E com
  Playwright (chromium). Viewports E2E: 360/768/1024/1440. Threshold inicial de coverage:
  statements/lines/functions ≥ 70%, branches ≥ 50% (branch defensiva de fallback de rótulos de
  tokens sem label; todos os tokens atuais possuem label).

### DEC-035 — Tailwind CSS v4 (CSS-first)
- **Status:** APROVADA
- **Decisão:** Tailwind CSS v4 com `@tailwindcss/vite` e configuração CSS-first via `@theme`
  (tokens em CSS custom properties `--color-pedon-*`). Sem dark mode nesta etapa.

### DEC-036 — Consumo de pacotes internos via source exports
- **Status:** APROVADA
- **Decisão:** pacotes internos (`@pedon/ui`, `@pedon/test-utils`) são consumidos diretamente da
  fonte (`exports` apontando para `./src/index.{ts,tsx}`), sem build intermediário. Vite/Vitest
  resolvem `.ts` nativamente. Detalhes estruturais no `docs/adr/0001-internal-packages-source-exports.md`.

## Decisões Aprovadas (Prompt 02 — Integrações de infraestrutura)

### DEC-037 — Ambiente Main-First monitorado do MVP
- **Status:** APROVADA
- **Decisão:** durante a construção monitorada do Core MVP: GitHub `main` será a branch oficial de
  trabalho; commits aprovados serão enviados diretamente à `main`; Cloudflare Pages utilizará
  `main` como production branch; o projeto Supabase oficial será utilizado diretamente para
  desenvolvimento funcional e homologação contínua do MVP; migrations autorizadas serão aplicadas
  diretamente nesse projeto Supabase; não haverá staging separado nesta fase inicial; todo avanço
  deverá permanecer versionado, testável e auditável.
- **Risco:** uma alteração incorreta na `main` pode chegar ao ambiente funcional rapidamente.
- **Controles:** gates locais antes do push; GitHub CI obrigatório; commits atômicos; migrations
  versionadas; migrations pequenas; validação pós-deploy; backup/rollback quando necessário;
  nunca realizar alterações manuais silenciosas no banco; manter documentação de implementação
  atualizada.
- **Nota:** Main-First não significa ausência de controle — significa desenvolvimento funcional
  direto com controles técnicos explícitos.

### DEC-038 — Adiamento do cliente `@supabase/supabase-js` para o Prompt 03
- **Status:** APROVADA
- **Decisão:** `@supabase/supabase-js` **não** é instalado nesta etapa. Não há integração funcional
  da aplicação com o Supabase a validar no Prompt 02 (proibido criar schema, login ou queries de
  domínio). A instalação e o cliente (`apps/web/src/lib/supabase.ts`) ficam para o Prompt 03,
  quando Auth/identidade forem implementados.
- **Contexto:** o projeto Supabase novo usa as novas API keys: **publishable** (público, RLS) e
  **secret** (somente backend). O frontend usará apenas a publishable key; `service_role`/secret
  nunca será usada no browser. Variáveis de ambiente (nomes): `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Decisões em Aberto (OPEN)

Nenhuma decisão em aberto neste momento.
