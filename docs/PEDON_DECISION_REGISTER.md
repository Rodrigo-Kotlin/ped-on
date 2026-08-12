# PED-ON — Decision Register

> Registro oficial de decisões técnicas e de produto.
> Toda nova decisão deve ser adicionada aqui com ID sequencial, data, descrição, justificativa e status.

## Formato

| Campo     | Descrição                                                  |
| --------- | ---------------------------------------------------------- |
| `DEC-NNN` | Identificador sequencial                                   |
| Status    | `APROVADA` (aprovada), `OPEN` (em aberto / requer decisão) |
| Data      | Data de registro                                           |
| Decisão   | Descrição objetiva                                         |

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

## Decisões Aprovadas (Prompt 03 — Supabase Auth, identidade e modelo multiempresa inicial)

### DEC-039 — Supabase Auth (email + senha) e cliente oficial no frontend

- **Status:** APROVADA
- **Decisão:** adotar o Supabase Auth com fluxo de e-mail + senha como sistema de
  autenticação do MVP. Instalar `@supabase/supabase-js` no app web e criar o cliente em
  `apps/web/src/lib/supabase.ts` usando apenas `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable key, baixo privilégio, respeita RLS).
  A sessão é gerenciada pelo cliente supabase-js (persistência local), com restauração via
  `getSession`/`onAuthStateChange` no carregamento da aplicação.
- **Contexto:** a secret key / `service_role` nunca é usada no browser (DEC-038).
- **Atualização (2026-08-09):** o Supabase oficial vem com **confirmação de e-mail habilitada**
  (configuração default do projeto; `signup` via REST exige e-mail confirmado e é limitado por
  rate limit). Mantida como está (sem alteração manual via Dashboard, preservando o padrão
  seguro). O frontend deve tratar o fluxo "verifique seu e-mail" e a restauração de sessão; os
  testes de RLS usam usuários inseridos diretamente no `auth.users` (e-mail confirmado) via
  conexão direta — nunca o fluxo de signup da API.

### DEC-040 — `profiles` como identidade compartilhada (1:1 com `auth.users`)

- **Status:** APROVADA
- **Decisão:** criar a tabela pública `profiles` como espelho mínimo da identidade
  (`id` = `auth.users.id` com FK `ON DELETE CASCADE`, `email`, `full_name`,
  `onboarding_status` inicial `pending`, timestamps). Um trigger `security definer` cria o
  registro automaticamente no `AFTER INSERT ON auth.users` (idempotente) e mantém o e-mail
  sincronizado em mudanças. RLS: cada usuário autenticado pode ler e atualizar apenas o
  próprio perfil; nenhuma operação de escrita é feita pelo browser (o trigger cuida da criação).

### DEC-041 — Modelo multiempresa inicial

- **Status:** APROVADA
- **Decisão:** implementar o modelo de tenant inicial com as tabelas `organizations`,
  `organization_members` (papéis `owner`/`member`, PK `(organization_id, user_id)`) e
  `units` (1:N por organização). `organization_id` continua sendo o tenant principal
  (DEC-001) e `unit_id` o escopo operacional (DEC-002). Nesta etapa, as tabelas de domínio
  escopadas por tenant são criadas com políticas somente de leitura para membros da
  organização; as operações de escrita do onboarding são feitas exclusivamente por RPC
  transacional.

### DEC-042 — Onboarding pós-cadastro via RPC transacional

- **Status:** APROVADA
- **Decisão:** o fluxo de primeiro acesso acontece em `/onboarding`. Um usuário recém-cadastrado
  possui `onboarding_status = pending` e é redirecionado a `/onboarding`. Ao submeter o nome da
  organização, o frontend chama a função `complete_onboarding` (segura, `security definer`), que
  em uma única transação: cria a organização, insere o membro `owner`, cria a unidade inicial
  e marca `onboarding_status = completed`. Chamadas duplicadas para um usuário já vinculado a uma
  organização são recusadas (idempotência).

### DEC-043 — Testes de banco e RLS

- **Status:** APROVADA
- **Decisão:** validar migrations e isolamento multiempresa com testes versionados em
  `supabase/tests/` (pgTAP via `supabase test db` quando a stack local estiver disponível;
  se indisponível, testes de integração equivalentes executados contra o ambiente oficial com
  usuários sintéticos descartáveis, verificando RLS/cross-tenant e concorrência, com limpeza
  dos dados sintéticos ao final). Nenhum teste de RLS depende de desabilitar RLS ou de
  `service_role`.
- **Execução (2026-08-09):** implementado `supabase/tests/rls_integrity.test.mjs` (Node + `pg`,
  sem pgTAP porque o Docker local não está disponível). **22 checks / 12 cenários PASS**
  (anon negado, profile próprio, cross-tenant, idempotência, concorrência, escrita direta
  bloqueada). Cleanup verificado: banco sem dados sintéticos residuais.

### DEC-044 — Testes de banco usam conexão direta, nunca pooler de sessão

- **Status:** APROVADA
- **Decisão:** os testes de integração de banco conectam diretamente em
  `db.<project-ref>.supabase.co:5432` como `postgres` (setup/cleanup e simulação de sessões com
  `SET ROLE`/`SET request.jwt.claims`). O pooler **session mode** (porta 6543) não é usado para
  testes: ele reutiliza backends sem resetar `role`/claims entre clients, fazendo com que uma
  conexão "admin" executasse como `authenticated` (vazamento de contexto — fonte do bug de
  cleanup "permission denied for table users" e do cenário de trigger com resultado falso).
- **Detalhes:** conexão direta exige o usuário `postgres` (e não `postgres.<ref>`); senha vem de
  `SUPABASE_DB_PASSWORD` (presente no `.env` local, fora do Git). Sessões de aplicação são
  simuladas com `SET ROLE authenticated` + `SET request.jwt.claims` em conexões dedicadas.
  Cleanup apaga `auth.users` (cascade em `profiles`/`organization_members`) **e** `organizations`
  criadas (não possuem FK para `auth.users`, ficando órfãs se apenas o usuário for apagado).

### DEC-045 — Auth no frontend: cliente oficial + provider + guards

- **Status:** APROVADA
- **Decisão:** cliente único `src/lib/supabase.ts` criado com `createClient` usando
  `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable key, nunca `service_role`).
  `AuthProvider` (React Context) centraliza `getSession()`/`onAuthStateChange`, expõe
  `signIn/signUp/signOut/completeOnboarding` e carrega o `profiles` do usuário logado. Rotas são
  protegidas por guards (`GuestOnly`, `RequireAuth`, `OnboardingGate`, `AppGate`) que redirecionam
  conforme `authStatus` + `onboarding_status`; estado de carregamento inicial exibe tela de
  "Carregando…" (evita flash de tela errada antes do `getSession` resolver). Telas usam
  react-hook-form + zod para validação client-side antes de tocar a API.
- **Motivação:** sessão gerenciada em um único lugar evita duplicação e desincronização; guards
  declarativos no router mantêm as rotas legíveis e testáveis.

### DEC-046 — Signup com confirmação de e-mail: UX "verifique seu e-mail"

- **Status:** APROVADA
- **Decisão:** a tela de cadastro considera `data.session === null` após `signUp` como
  "e-mail de confirmação pendente" (confirmado que o projeto remoto tem email confirmation
  HABILITADO — ver DEC-039) e exibe o estado "Confirme seu e-mail" em vez de redirecionar para o
  app. Login com e-mail não confirmado cai em erro do Supabase exibido no alert da tela.
- **Motivação:** sem isso o usuário veria "nada acontecer" após o cadastro.

### DEC-047 — Onboarding pós-cadastro no frontend via RPC `complete_onboarding`

- **Status:** APROVADA
- **Decisão:** página `/onboarding` (protegida por `OnboardingGate`) coleta o nome da organização
  e chama a RPC transacional `complete_onboarding(p_organization_name)`. Após sucesso, o
  `AuthProvider` recarrega o perfil e o guard `OnboardingGate` redireciona para `/app`. A página
  `/app` lista as organizações do usuário via TanStack Query (`organizations` + RLS) e oferece
  sign out.
- **Motivação:** mantém o fluxo transacional no banco (DEC-042) e o frontend apenas como camada de
  apresentação.

### DEC-048 — Vitest: pool `threads` em vez do padrão `forks`

- **Status:** APROVADA
- **Decisão:** `vitest.config.ts` define `pool: 'threads'`. No ambiente local (Windows, Node 24)
  o pool padrão `forks` falhava ao iniciar os workers (timeout de 60s sem resposta); com
  `threads` a suíte roda em segundos. Comportamento idêntico no CI (Linux).
- **Motivação:** estabilidade e velocidade da suíte de testes em todos os ambientes.

### DEC-049 — Testes de frontend: módulo supabase mockado por arquivo

- **Status:** APROVADA
- **Decisão:** testes unitários mockam `src/lib/supabase` com `vi.mock` (factory que importa o
  singleton `supabaseMock` em `src/test/supabaseMock.ts`), com helper `mockFromQuery` para chains
  `.select().eq().maybeSingle()` e `renderWithAuth` (QueryClient + AuthProvider + MemoryRouter).
  Nenhum teste unitário toca a rede; o E2E Playwright cobre rotas reais (redirects sem sessão e
  validação de formulário) e não depende de credenciais.

## Decisões Aprovadas (Prompt 04 — RBAC administrativo, gestão de unidades e contexto)

### DEC-050 — RBAC administrativo mínimo: `owner` / `manager` / `operator`

- **Status:** APROVADA
- **Decisão:** evoluir o papel de membro de `owner`/`member` para `owner`/`manager`/`operator`
  (sem dados reais com `member`, a migração altera o CHECK sem reclassificação). `owner` possui
  acesso total ao tenant e à gestão de unidades; `manager`/`operator` têm acesso restrito às
  unidades com vínculo explícito. A autorização por unidade independe da hierarquia
  manager↔operator (ambos seguem o mesmo escopo nesta etapa).

### DEC-051 — Autorização por unidade via `membership_units` com integridade cross-org

- **Status:** APROVADA
- **Decisão:** criar `membership_units (organization_id, user_id, unit_id)` como o vínculo
  explícito de acesso por unidade. A PK `(organization_id, user_id, unit_id)` garante unicidade;
  a FK composta `(organization_id, unit_id) → units(organization_id, id)` (suportada pelo unique
  `units_organization_id_id_key`) impede vínculo com unidade de outra organização. É a
  materialização da DEC-005.

### DEC-052 — Escrita de unidades exclusivamente via RPCs server-authoritative

- **Status:** APROVADA
- **Decisão:** criação/renomeação/ativação de unidades ocorrem apenas pelas RPCs
  `create_unit(text)`, `update_unit(uuid, text)` e `set_unit_active(uuid, boolean)`
  (`security definer`, exigem role `owner`, validam a organização da unidade). Não existem
  policies `INSERT`/`UPDATE`/`DELETE` em `units` — a escrita direta continua bloqueada (DEC-010
  permanece válido). Contrato de erro estável via SQLSTATE próprio: `PED00` não autenticado,
  `PED01` proibido (não-owner), `PED02` unidade não encontrada na org, `PED03` nome vazio,
  `PED04` última unidade ativa, `PED05` nome > 200 caracteres.

### DEC-053 — Proteção da última unidade ativa com lock transacional

- **Status:** APROVADA
- **Decisão:** `set_unit_active` impede a desativação da última unidade ativa da organização
  (`PED04`). A verificação é serializada por `pg_advisory_xact_lock(hashtext('pedon:org:' || org_id))`
  para evitar corrida entre desativações concorrentes (validado em teste com duas conexões
  paralelas: exatamente uma desativação tem sucesso).

### DEC-054 — `get_my_admin_context()` como fonte única do contexto administrativo

- **Status:** APROVADA
- **Decisão:** o frontend administrativo lê uma única RPC `get_my_admin_context()` que retorna
  `jsonb` com perfil, organização, papel e unidades acessíveis (owner: todas; demais: vinculadas).
  Evita múltiplas queries e centraliza a semântica de escopo em um ponto testável. As políticas
  seletoras continuam garantindo o isolamento em leituras individuais.

### DEC-055 — Helpers `is_org_owner` / `can_access_unit` (`security definer`) para políticas RLS

- **Status:** APROVADA
- **Decisão:** implementar `is_org_owner(uuid)` e `can_access_unit(uuid)` como funções
  `stable security definer set search_path = ''`, usadas pela policy `units_select_authorized`
  (substitui `units_select_member`). O `security definer` evita recursão de RLS ao consultar
  `organization_members`/`membership_units` dentro da própria política; o `search_path=''`
  elimina risco de hijacking de schema. `can_access_unit` encapsula owner-da-org-ou-vínculo,
  padrão obrigatório para futuras tabelas escopadas por unidade.

### DEC-056 — Gestão de `membership_units` permanece server-side nesta etapa

- **Status:** APROVADA
- **Decisão:** a gestão de vínculos (inserir/remover manager/operator por unidade) fica restrita
  ao acesso administrativo/`security definer` — sem policy de escrita para `authenticated`
  nesta etapa. A leitura dos próprios vínculos (e do owner) é liberada por RLS para fundação de
  uma futura UI de gestão. A UI de gestão é pendência registrada.

## Decisões Aprovadas (Prompt 06 — Catálogo base administrativo)

### DEC-057 — O catálogo mutável pertence à unidade

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** categorias e produtos do catálogo administrativo são escopados por
  `organization_id` e `unit_id`; uma categoria ou produto nunca pode atravessar unidade ou tenant.
- **Justificativa:** preço, disponibilidade e composição comercial podem variar entre unidades e
  devem respeitar o mesmo isolamento multiempresa do restante do domínio.

### DEC-058 — O produto inicial é simples

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o catálogo base representa produto simples com categoria, nome, descrição opcional,
  preço, ordenação e flags de estado, sem adicionais, variações ou combinações.
- **Justificativa:** entrega o menor modelo consistente para gestão administrativa antes da evolução
  do domínio de cardápio.

### DEC-059 — Estado estrutural e disponibilidade operacional são distintos

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `is_active` representa o estado estrutural de categorias e produtos;
  `is_available` representa somente a disponibilidade operacional do produto. Desativar uma
  categoria não altera em cascata nenhuma flag dos produtos, e alterar `is_active` do produto não
  altera `is_available`.
- **Justificativa:** suspensão operacional temporária não deve modificar a estrutura do catálogo, e
  a desativação de uma categoria deve ser reversível sem perda ou mutação implícita dos produtos.

### DEC-060 — Desativação lógica sem `DELETE` físico exposto

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** categorias e produtos são retirados de uso por flags; não existe RPC de exclusão
  física e o cliente autenticado não recebe `DELETE` direto nas tabelas do catálogo.
- **Justificativa:** preservar dados e evitar remoção acidental enquanto ainda não existe histórico
  imutável de publicação.

### DEC-061 — Preço do catálogo usa decimal exato e contrato textual no frontend

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `catalog_products.price` usa `numeric(12,2)` no PostgreSQL e atravessa RPC/frontend
  como string decimal, sem `float` ou notação exponencial.
- **Justificativa:** preservar centavos e zeros significativos no round-trip sem introduzir erro de
  ponto flutuante.

### DEC-062 — Estrutura por owner/manager; disponibilidade também por operator

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** owner e manager autorizados na unidade podem criar e editar categorias/produtos e
  alterar `is_active`; operator autorizado pode ler o catálogo e alterar apenas
  `is_available` dos produtos. Owner e manager também podem alterar disponibilidade.
- **Justificativa:** separar governança estrutural do catálogo da ação operacional cotidiana de
  marcar item disponível ou indisponível.

### DEC-063 — Catálogo administrativo mutável não é publicação pública

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o catálogo do Prompt 06 permanece mutável e administrativo; não há leitura anônima
  efetiva, cardápio público ou versão publicada nesta etapa.
- **Justificativa:** a publicação exige snapshots imutáveis e contrato público próprios, previstos
  para a etapa seguinte, sem expor diretamente as tabelas mutáveis.

### DEC-064 — Imagens ficam fora do Prompt 06

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** categorias e produtos do catálogo base não possuem upload, storage ou referência de
  imagem nesta etapa.
- **Justificativa:** imagens exigem decisões adicionais de armazenamento, transformação, segurança e
  ciclo de vida que não são necessárias para validar o catálogo simples.

## Decisões Aprovadas (Prompt 07 — Versionamento e publicação imutável)

### DEC-065 — Publicação é snapshot comercial imutável

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `publish_unit_menu` cria `menu_versions` (categoria e produtos) como snapshot comercial
  imutável a partir do catálogo administrativo mutável; nenhuma coluna da versão é editada depois.
- **Justificativa:** pedidos futuros precisam reproduzir exatamente o que o cliente viu no checkout.

### DEC-066 — Disponibilidade é overlay dinâmico via `source_product_id`

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o snapshot mantém `source_product_id`; `get_public_menu` sobrepõe apenas
  `catalog_products.is_available` ao preço/nome/descrição imutáveis da versão. Sem `source_product_id`
  disponível, o item é tratado como indisponível.
- **Justificativa:** preço e composição congelados; disponibilidade permanece uma decisão operacional
  viva sem reescrever a versão.

### DEC-067 — `menu_publications` mantém current version e slug público estável/opaco

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** no máximo uma publicação por unidade; `current_menu_version_id` aponta a versão atual e
  o `public_slug` é persistido na primeira publicação e reutilizado nas republicações (opaco, 24 hex).
- **Justificativa:** o link público do cliente não muda ao republicar; o slug não revela estrutura.

### DEC-068 — Publicação inclui somente estrutura ativa e exclui categorias vazias

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** apenas categorias e produtos com `is_active=true` entram no snapshot; categorias sem ao
  menos um produto ativo são omitidas.
- **Justificativa:** o cardápio público reflete o estado comercialmente disponível.

### DEC-069 — Menu vazio não pode ser publicado (`PED31`)

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** publicação com zero produtos ativos falha com `PED31` (`MENU_EMPTY`) sem criar versão.
- **Justificativa:** não existe cardápio público válido sem ao menos um item.

### DEC-070 — API pública usa IDs dos snapshots e não IDs do catálogo

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `get_public_menu` retorna `id` de `menu_version_products`/`menu_version_categories`;
  `source_*_id` e IDs do catálogo mutável nunca são expostos publicamente.
- **Justificativa:** o cliente referencia o item concreto da versão, preservando o snapshot.

### DEC-071 — Publicação é transacional e serializada por unidade

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `publish_unit_menu` é uma transação única que adquire advisory locks
  (`pedon:menu:publish:<unit_id>` e locks de categoria/produto) para capturar um snapshot coerente e
  impedir corridas com edições do catálogo.
- **Justificativa:** evita versões intermediárias inconsistentes e duplicação de `version_number`.

### DEC-072 — Anon acessa cardápio exclusivamente via `get_public_menu`, sem SELECT direto

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `anon` não possui grants diretos nas tabelas de menu/publicação; a única superfície
  pública é a RPC `get_public_menu` (`security definer`), com `found=false` para slug inválido.
- **Justificativa:** nenhuma leitura anônima efetiva das tabelas mutáveis ou dos snapshots.

### DEC-073 — Prompt 07 não possui draft, rollback ou agendamento

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** não há rascunho, rollback para versão anterior, agendamento de publicação nem
  comparação visual de versões nesta etapa.
- **Justificativa:** escopo mínimo do MVP; republicar substitui a versão atual mantendo histórico.

## Decisões Aprovadas (Prompt 08 — Carrinho, checkout, pedido idempotente e Central)

### DEC-074 — Carrinho é público, local e vinculado à versão do menu

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o carrinho vive em `localStorage` (`pedon:cart:<publicSlug>`), contém somente dados
  públicos do cardápio (slug, `menu_version_id`, itens com id/quantidade e nome/preço apenas para
  apresentação) e pertence à versão do cardápio aberta pelo usuário. Nenhuma PII de checkout é
  persistida localmente.
- **Justificativa:** carrinho offline tolerável; PII do checkout fica somente em memória (DEC-028).

### DEC-075 — Criação de pedido é idempotente

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o cliente gera `idempotency_key` (UUID) por tentativa lógica de checkout; o servidor
  calcula `request_hash` (SHA-256 do payload canônico) e garante `(unit_id, idempotency_key)` único.
  Mesma chave + mesmo payload retorna o pedido original; mesma chave + payload diferente retorna
  `PED42`; duas tentativas concorrentes produzem um único pedido.
- **Justificativa:** retry de rede seguro, sem duplicar pedidos (DEC-011).

### DEC-076 — Preços, taxas e totais são server-authoritative e `order_items` são snapshots

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `create_public_order` não aceita preço/nome/total do navegador; copia o snapshot da
  versão publicada e calcula `line_total`, `subtotal`, `delivery_fee` e `total` no PostgreSQL com
  `numeric(12,2)`. Itens de pedido nunca dependem do catálogo mutável após a criação.
- **Justificativa:** dinheiro exato e ausência de price injection (DEC-009, DEC-010).

### DEC-077 — Versão diferente gera `MENU_CHANGED` sem repricing silencioso

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** se `menu_version_id` do payload difere da versão atual publicada, o checkout falha com
  `PED35`; o frontend não remapeia, não renomeia e não recalcula o carrinho antigo — mantém o carrinho
  como stale e pede revisão explícita.
- **Justificativa:** nunca cobrar preço diferente do exibido no checkout.

### DEC-078 — Configuração operacional possui revision e alteração durante checkout gera `CHECKOUT_CHANGED`

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o cardápio público expõe `operation.revision` (derivada de
  `unit_operational_settings.updated_at`); o checkout envia `operation_revision` e o servidor rejeita
  com `PED36` se a configuração mudou entre leitura e envio.
- **Justificativa:** taxa, mínimo, modalidade ou horário alterados no meio do checkout não podem
  gerar pedido com condições diferentes das apresentadas.

### DEC-079 — Guest checkout usa PII mínima e não exige CPF

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** checkout público exige somente nome (2..120) e telefone (10/11 dígitos, armazenado só
  dígitos); não coleta CPF, e-mail, senha ou criação de conta; o pedido guarda snapshot mínimo do
  comprador sem tabela de clientes.
- **Justificativa:** atrito mínimo no MVP; modelagem de clientes fica para o Prompt 09 (DEC-023).

### DEC-080 — Pedido usa máquina de estados progressiva e estados terminais

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `orders.status` segue `new → confirmed → preparing → ready → (out_for_delivery →)
completed`, com cancelamento permitido enquanto não `completed`; `completed` e `cancelled` são
  terminais e não podem ser reabertos. Transições inválidas retornam `PED47`.
- **Justificativa:** rastreabilidade operacional determinística sem reabertura no MVP.

### DEC-081 — `payment_status` é separado de `order.status`

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `orders.payment_status` (`pending → paid → refunded`) é independente do status do
  pedido; cancelar não altera pagamento; `refunded` é terminal e é apenas registro operacional de
  reembolso feito externamente (sem estorno financeiro).
- **Justificativa:** os dois domínios evoluem por trilhas distintas (DEC-013, DEC-086).

### DEC-082 — Acompanhamento público usa tracking token de alta entropia

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** cada pedido recebe `tracking_token` (32 hex derivado de `gen_random_uuid()`), único e
  gerado no servidor com retry em colisão rara; a rota pública `/pedido/:trackingToken` não usa
  `order_id`, `order_number` ou `unit_id` e não expõe PII.
- **Justificativa:** impedir enumeração de pedidos (DEC-012).

### DEC-083 — Mudanças críticas geram `order_events` append-only

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `created`, `status_changed` e `payment_changed` são registrados em `order_events`
  (append-only) apenas pelas RPCs; nenhum cliente insere/edita/apaga eventos diretamente.
- **Justificativa:** auditoria imutável do ciclo de vida (invariante de auditoria do baseline).

### DEC-084 — Owner/manager/operator operam pedidos da unidade; refund manual exige owner/manager

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** leitura da Central e mudança de status do pedido exigem `can_access_unit`;
  `pending→paid` exige `can_access_unit`; `paid→refunded` exige `can_manage_unit` (owner/manager).
  Operator vinculado não registra reembolso.
- **Justificativa:** impedir escalada de privilégio financeiro por operador.

### DEC-085 — Realtime apenas invalida/refaz queries; PostgreSQL continua fonte da verdade

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `public.orders` entra na publicação `supabase_realtime` somente como gatilho de
  invalidação/refetch no painel administrativo; o frontend nunca aplica estado crítico apenas do
  websocket.
- **Justificativa:** invariante "Realtime é mecanismo de atualização, não fonte da verdade".

### DEC-086 — Entrega continua simples/fixa; sem roteirização, gateway ou pagamento online

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** a modalidade delivery usa taxa fixa da unidade e endereço textual simples; não há
  distância, raio, CEP com preço, geocodificação, entregador, rota, gateway, PIX automático ou cartão
  online. Pagamento é externo ao estabelecimento.
- **Justificativa:** MVP sem intermediação financeira (baseline seção 5) e sem logística.

## Decisões do Prompt 09 — Clientes e Clube Ped-On (Fase 3B)

### DEC-087 — Fidelidade é organization-scoped, compartilhada entre todas as unidades

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** programa, cadastro, saldo e extrato do Clube Ped-On pertencem à organização (tenant),
  não à unidade; pedidos de qualquer unidade da mesma organização alimentam o mesmo saldo.
- **Justificativa:** um restaurante com múltiplas unidades deve premiar o cliente de forma única;
  simplifica RLS e evita saldos duplicados por unidade.

### DEC-088 — Cliente do Clube não usa Supabase Auth; identidade via fingerprint + token efêmero

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** consumidor nunca cria conta nem senha; a identidade é resolvida por fingerprint
  derivado do CPF (HMAC) na Edge Function `loyalty-cpf`, e a sessão pública usa um access token
  opaco e de curta duração mantido apenas em memória. Fidelidade é independente do staff.
- **Justificativa:** sem custo de onboarding do consumidor; evita reutilização do Auth de staff e
  cumpre DEC-023 sem expor PII.

### DEC-089 — CPF nunca é armazenado; apenas HMAC-SHA-256 keyed por tenant + `cpf_last2`

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o banco guarda `cpf_fingerprint` (64 hex) calculado como
  `HMAC(secret, 'pedon:cpf:v1:' || organization_id || ':' || cpf_normalizado)` e `cpf_last2`; o CPF
  bruto não é persistido, logado nem retornado. Proibido SHA-256 simples, MD5, bcrypt lookup ou
  chave global compartilhada entre tenants.
- **Justificativa:** fingerprint sem chave é inviável para lookup por força bruta; keyed HMAC com
  domínio por tenant impede correlação entre organizações.

### DEC-090 — Pontos por pedido = `floor(subtotal)`; taxa de entrega não gera pontos

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** pontos elegíveis = `floor(orders.subtotal)` (1 ponto por R$ 1,00 elegível);
  `delivery_fee` e centavos abaixo de R$ 1,00 não geram pontos; pedido abaixo de R$ 1,00 gera 0
  pontos. Reforça DEC-015/DEC-016 e não registra ledger para zerados.
- **Justificativa:** regra simples, determinística e sem arredondamento por moeda.

### DEC-091 — Earn somente na 1ª transição `status → completed` com pagamento não reembolsado

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** pontos são creditados no ledger apenas quando o pedido alcança `completed` pela
  primeira vez e `payment_status <> 'refunded'`; transição `payment_status → refunded` após o earn
  gera estorno completo via ledger. Earn é idempotente por `(order_id, entry_type)`.
- **Justificativa:** alinhado a DEC-080/DEC-081: completar entrega ou retirada é o marco de
  fidelidade; reembolso revoga o benefício.
- **Histórico:** a migration `20260810170000` foi aplicada sem a guarda de `payment_status` em
  `_loyalty_earn_order`. Para cumprir exatamente este contrato, a migration de hardening
  `20260811080000_loyalty_earn_refunded_guard.sql` (BUGFIX, não nova decisão) adicionou o guard
  "pedido estornado antes de `completed` não gera earn"; o reverso de earn já concedido permanece a
  cargo de `_loyalty_reverse_order` no `payment_status → refunded`.

### DEC-092 — Ledger append-only; saldo derivado e `recovery_points` sem saldo negativo

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `loyalty_ledger` é append-only (sem UPDATE/DELETE); `loyalty_accounts` é projeção;
  `points_balance` nunca é negativo; estorno que exceda o saldo vira `recovery_points` (dívida) e as
  próximas aquisições quitam a dívida antes de compor saldo disponível.
- **Justificativa:** auditoria imutável (DEC-014) com consistência contábil mesmo sob reversões
  desordenadas no MVP.

### DEC-093 — Access token efêmero 64 hex, hash SHA-256 no banco, 2h, somente em memória

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** a Edge Function gera 32 bytes aleatórios → 64 hex; o banco guarda apenas
  `token_hash = SHA-256(token)` com expiração de 2 horas; o browser mantém o token apenas em
  memória (nunca em localStorage) e o envia no payload do pedido e na consulta pública de saldo.
- **Justificativa:** token revogável e não enumerável (DEC-012); sem estado de sessão persistente
  para consumidor.

### DEC-094 — Tabelas de loyalty sem escrita direta do navegador; RPCs internas `service_role` + RPC pública por token

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** todas as tabelas do Clube têm RLS ON e nenhuma permissão de escrita para
  `anon`/`authenticated`; resolução/enrolamento usam RPCs internas executadas somente com
  `service_role` (Edge Function); `get_public_loyalty_account` é a única RPC pública e aceita apenas
  o access token.
- **Justificativa:** camada de serviço única para regras de pontos e proteção de PII.

### DEC-095 — `get_public_menu` expõe apenas `loyalty.enabled`

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o cardápio público ganha `loyalty: { enabled: boolean }` sem contagem de membros,
  saldo ou qualquer dado do programa além da flag; contratos existentes de cardápio permanecem
  inalterados.
- **Justificativa:** flag mínima para renderizar o CTA do Clube sem vazar métricas de negócio.

### DEC-096 — `orders.loyalty_membership_id` nullable com FK composta de mesmo tenant

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** pedido pode opcionalmente carregar `loyalty_membership_id` (nullable), validado por
  FK composta que exige `organization_id` igual ao do pedido; o payload aceita `loyalty_token`
  opcional (64 hex); sem token o pedido é um guest normal.
- **Justificativa:** vínculo seguro e opcional entre pedido e fidelidade sem quebrar guest checkout
  (DEC-079).

### DEC-097 — Novos SQLSTATE PED51/PED52/PED53 para o Clube

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** contrato de erros do Prompt 09: `PED51 LOYALTY_UNAVAILABLE` (programa desabilitado/
  ausente), `PED52 LOYALTY_TOKEN_INVALID` (token ausente/expirado/inválido) e
  `PED53 LOYALTY_INTEGRITY_ERROR` (inconsistência interna do ledger). O checkout sem token continua
  válido mesmo com programa ativo.
- **Justificativa:** códigos estáveis e tipados para o frontend tratar cada falha de fidelidade.

### DEC-098 — Página pública `/clube/:publicSlug` e painel `/app/clube` somente owner

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o Clube público é mobile-first e vive fora das rotas autenticadas; o painel
  administrativo do Clube é restrito ao papel `owner` (frontend + backend), enquanto manager e
  operator continuam sem acesso a saldos e ao cadastro.
- **Justificativa:** página pública segue o modelo `/menu/:publicSlug`; gestão de fidelidade é
  decisão estratégica do proprietário (DEC-004).

### DEC-099 — Sem recompensas, resgates ou vouchers no MVP

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** o Prompt 09 entrega somente acúmulo, consulta de saldo, estorno e recovery; pontos
  ainda não têm valor de troca. Recompensas, resgate, vouchers, campanhas, multiplicadores, tiers,
  expiração, transferência e cashback ficam para o Prompt 10.
- **Justificativa:** escopo mínimo verificável; saldo é registrado antes de ganhar utilidade.

### DEC-100 — Retry idempotente precede a validação de token/programa de fidelidade

- **Status:** APROVADA
- **Data:** 2026-08-10
- **Decisão:** `create_public_order` consulta e devolve o replay da chave idempotente ANTES de
  validar `loyalty_token` ou o estado do programa; se o retry não traz token, o replay não falha por
  `PED51/PED52` e retorna o mesmo objeto imutável do pedido original.
- **Justificativa:** preserva idempotência do Prompt 08 (DEC-011) e não quebra retries de
  navegadores que perderam o token da sessão.

## Decisões Aprovadas (Prompt 09 — Release hardening)

### DEC-101 — Telefone é segundo fator de identidade e mismatch é uniforme

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** identidade pública v2 do Clube exige o par CPF + telefone. Ambos são normalizados e
  protegidos por HMAC-SHA-256 com domínio tenant-bound. Lookup de CPF desconhecido e CPF existente
  com telefone divergente retornam exatamente HTTP 422 `IDENTITY_NOT_CONFIRMED`, com o mesmo corpo;
  identidade legada sem telefone não pode ser confirmada ou reivindicada pelo fluxo v2.
- **Justificativa:** o telefone adiciona confirmação sem armazenar PII em claro, e a resposta
  uniforme impede enumeração de CPF ou associação telefone/CPF.

### DEC-102 — Rate limit de identidade é persistente no PostgreSQL

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** `loyalty-cpf` usa fixed-window de 60 segundos persistido em
  `loyalty_rate_limits`, com escopo `HMAC(secret, IP + public_slug + mode)`: 10 tentativas para
  `lookup` e 5 para `enroll`. O excesso retorna HTTP 429 `RATE_LIMITED` e `Retry-After` inteiro.
  A tabela persiste somente `scope_hash`, início da janela, tentativas e expiração.
- **Justificativa:** o limite sobrevive a instâncias/restarts da Edge e não armazena IP, slug, modo,
  CPF, telefone ou outra PII em claro.

### DEC-103 — Adesão exige consentimento explícito e auditável

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** `enroll` exige `consent === true` na Edge antes da resolução da identidade. O servidor
  envia a versão fixa `pedon-clube-v1`; a membership mantém o estado atual e cada enroll confirmado
  acrescenta uma evidência em `loyalty_consent_events`, sem update/delete de navegador.
- **Justificativa:** a adesão não pode ser inferida pelo cliente e precisa deixar evidência temporal
  e versionada no backend.

### DEC-104 — Tentativa pendente permite recuperação pública sem persistir checkout

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** o frontend persiste por no máximo 24 horas somente `idempotency_key` UUID, segredo de
  recuperação aleatório de 256 bits no campo técnico `request_fingerprint`, `public_slug` e
  `created_at`. O valor não deriva do payload. `create_public_order_v2` vincula o segredo à criação,
  e `get_public_order_by_attempt` recupera a mesma resposta por slug + chave + segredo.
- **Justificativa:** uma resposta HTTP perdida pode ser recuperada sem persistir payload, PII,
  endereço, notas ou token do Clube e sem criar pedido duplicado.

### DEC-105 — Extrato público é limitado, ordenado e minimizado

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** a consulta pública da conta inclui no máximo as 50 entradas mais recentes, ordenadas
  por `created_at DESC, id DESC`. Cada entrada expõe somente `entry_type`, `gross_points`,
  `points_delta`, `recovery_delta`, `eligible_amount`, `order_number` e `created_at`.
- **Justificativa:** o cliente entende saldo, estorno e recuperação sem receber IDs internos,
  membership, order ID ou dados pessoais do pedido.

### DEC-106 — Token e programa desabilitado possuem semântica explícita

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** token do Clube expira em 2 horas e é repetível para consultas de conta/extrato até um
  checkout o apagar atomicamente; depois, consultas retornam `found=false`. Se o programa for
  desabilitado após a emissão, o token existente continua legível, mas novas identificações e novos
  checkouts vinculados ao Clube são bloqueados. Retry idempotente já criado continua seguindo
  DEC-100.
- **Justificativa:** leitura já autorizada permanece previsível, enquanto novas vinculações e novos
  acúmulos respeitam imediatamente o estado do programa.

### DEC-107 — Reauditoria fecha superfícies legadas e retenção efêmera

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** `service_role` executa somente o resolver de identidade v2; consentimentos têm
  histórico append-only; tokens têm TTL máximo de 2h com tolerância transacional de 5 minutos e
  cleanup incremental; rate limit usa apenas `CF-Connecting-IP` e agrega slugs inexistentes.
- **Justificativa:** remove bypass de telefone/consentimento, preserva evidência histórica e limita
  retenção/cardinalidade sem introduzir PII em claro.

## Decisões Aprovadas (Prompt 10 — Recompensas, resgates e vouchers)

### DEC-108 — Reward management não suporta DELETE

- **Status:** APROVADA
- **Data:** 2026-08-11
- **Decisão:** o conjunto de operações é denominado **Reward management**: Create / Read / Update /
  Activate-Deactivate / Stock Adjustment. **DELETE: `NOT SUPPORTED BY DESIGN`**. A remoção operacional
  ocorre exclusivamente por **SOFT DEACTIVATION:** `set_loyalty_reward_active(false)`. Não existe RPC
  `delete_loyalty_reward`, acesso direto de browser, policy RLS de DELETE nem ação de exclusão na UI.
  Uma reward desativada permanece no banco e pode ser reativada com a mesma identidade. A
  desativação bloqueia novos resgates, mas não invalida vouchers já emitidos.
- **Justificativa:** preservar integridade referencial, redemptions históricos, vouchers emitidos,
  stock events, auditoria e todo o histórico operacional do programa de fidelidade.

### DEC-109 — Pontos públicos usam texto decimal e CI de backend é isolada

- **Status:** APROVADA
- **Data:** 2026-08-12
- **Decisão:** todo `bigint` autoritativo de pontos cruza JSON como texto decimal validado e é operado
  no browser com `BigInt`. O CI obrigatório reconstrói migrations e executa DB lint, oito suítes DB e
  Edge unit contra Supabase local descartável, sem credenciais do projeto oficial. Uma operação de
  redemption que já adquiriu seus locks antes de disable/revogação pode concluir; operações que
  validam o estado depois do disable são rejeitadas. Nenhum dos casos pode cruzar tenant ou produzir
  artefatos parcialmente relacionados.
- **Justificativa:** preservar precisão acima de `Number.MAX_SAFE_INTEGER`, tornar o release
  reproduzível pelo Git e documentar uma semântica concorrente segura sem lock global excessivo.

## Decisões em Aberto (OPEN)

Nenhuma decisão em aberto neste momento.
