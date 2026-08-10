# PED-ON — Runbook

> Guia operacional do Ped-On após o Prompt 07. Ambiente oficial: modelo Main-First monitorado,
> Supabase vinculado e Cloudflare Pages em produção.

## 1. Pré-requisitos e versões

| Ferramenta | Contrato |
|---|---|
| Node.js | `>=22`; fundação validada com Node `v24.15.0` |
| pnpm | `>=9`; fixado como `pnpm@9.15.9` em `package.json` |
| Git | `>=2.x` |
| Supabase CLI | disponível; checkpoint com `2.109.1` |
| Playwright | Chromium instalado para E2E |

Instalação:

```bash
pnpm install
pnpm --filter @pedon/web exec playwright install chromium
```

## 2. Comandos do projeto

| Ação | Comando |
|---|---|
| Desenvolvimento web | `pnpm dev` |
| Build PWA | `pnpm build` |
| Preview local | `pnpm --filter @pedon/web preview` |
| Formatar | `pnpm format` |
| Verificar formato | `pnpm format:check` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit/componente | `pnpm test:run` |
| Unit em watch | `pnpm test` |
| E2E | `pnpm test:e2e` |

O build de produção fica em `apps/web/dist`, incluindo `manifest.webmanifest` e `sw.js`. O PWA
cacheia assets estáticos; não há `runtimeCaching` de API, dados privados ou tokens.

## 3. Gates locais

Antes de integrar uma mudança funcional:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm test:e2e
gitleaks detect --source . --redact --log-level warn
```

Checkpoint do Prompt 07: formato, lint, typecheck, build e Gitleaks v8.30.1 PASS; frontend
unit/component 55/55; E2E 92/92 em 360/768/1024/1440, incluindo cardápio/publicação 36/36.

## 4. Variáveis e secrets

- `.env.example` contém somente nomes; `.env` real é gitignored e nunca deve ser commitado.
- Frontend: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são públicos e sujeitos a RLS.
- Nunca expor secret key ou `service_role` em variável `VITE_*`.
- Testes DB usam `SUPABASE_DB_PASSWORD`; não imprimir nem persistir a senha.
- Repositório GitHub é público. Tokens GitHub/Cloudflare/Supabase ficam fora do repositório.

PowerShell:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
```

## 5. Supabase oficial

| Item | Valor |
|---|---|
| Projeto | `ped-on` |
| Project ref | `zmuxkztnilnzjyyojbbr` |
| Região | South America (São Paulo) |
| API | `https://zmuxkztnilnzjyyojbbr.supabase.co` |
| Link | `supabase link --project-ref zmuxkztnilnzjyyojbbr` |
| Config versionada | `supabase/config.toml` |

### 5.1 Migrations aplicadas

Na ordem:

1. `20260809221710_identity_tenant_foundation.sql`
2. `20260810015224_rbac_units_context.sql`
3. `20260810032804_unit_operational_config.sql`
4. `20260810033118_unit_operational_config_hardening.sql`
5. `20260810120000_unit_operational_config_acceptance_hardening.sql`
6. `20260810122401_catalog_base.sql`
7. `20260810135051_menu_versioning_publication.sql`
8. `20260810141000_menu_publication_slug_fix.sql`

Checkpoint Prompt 07: Local == Remote para as oito versões; migrations do catálogo, do cardápio
publicado e do slug aplicadas oficialmente; db lint sem erros.

### 5.2 Fluxo linked não destrutivo

```bash
# conferir vínculo e histórico antes de aplicar
supabase projects list
supabase migration list

# aplicar somente migrations locais pendentes ao projeto vinculado
supabase db push --linked

# confirmar igualdade e validar o schema remoto
supabase migration list
supabase db lint --linked
```

Regras:

- criar arquivo versionado antes de alterar o banco;
- revisar e testar a migration;
- usar `supabase db push --linked` para o projeto oficial;
- confirmar Local == Remote e lint;
- nunca editar/apagar migration já aplicada nem aplicar SQL silencioso pelo Dashboard.

`supabase db push --linked` aplica migrations pendentes no banco remoto vinculado e preserva os
dados existentes. `supabase db reset` é um reset destrutivo da stack local: recria o banco local e
reaplica migrations, apagando dados locais. Não usar `db reset` contra o projeto oficial e não
confundi-lo com o fluxo linked de produção.

Para alterações backward-compatible, manter banco primeiro e aplicação depois: aplicar/validar a
migration, então publicar o frontend que depende dela.

## 6. Testes de banco

Os testes conectam diretamente em `db.zmuxkztnilnzjyyojbbr.supabase.co:5432` como `postgres` e
simulam sessões com `SET ROLE`/claims. Não usar pooler de sessão: reutilização de backend pode vazar
role/claims entre clients.

Execute os cinco scripts **sequencialmente, nunca em paralelo**:

```powershell
$env:SUPABASE_DB_PASSWORD = '<senha-do-banco>'
node supabase/tests/rls_integrity.test.mjs
node supabase/tests/rbac_units_integrity.test.mjs
node supabase/tests/unit_operational_config_integrity.test.mjs
node supabase/tests/catalog_integrity.test.mjs
node supabase/tests/menu_publication_integrity.test.mjs
```

| Script | Checkpoint |
|---|---:|
| `rls_integrity.test.mjs` | 22/22 PASS |
| `rbac_units_integrity.test.mjs` | 31/31 PASS |
| `unit_operational_config_integrity.test.mjs` | 80/80 PASS |
| `catalog_integrity.test.mjs` | 123/123 PASS |
| `menu_publication_integrity.test.mjs` | 121/121 PASS |

A execução sequencial é obrigatória porque o teste RBAC herdado possui uma verificação de contagem
global de `membership_units`; outra suíte inserindo vínculos simultaneamente pode produzir falso
negativo. Cada script cria usuários/organizações sintéticos e executa cleanup automático no
`finally`. Se houver interrupção abrupta, localizar dados `*@pedon-test.invalid` e organizações de
teste antes de repetir; não remover dados reais.

## 7. Validação de segurança e cross-tenant

Nos testes DB, sempre validar:

- anon sem leitura efetiva do catálogo: query direta retorna zero linhas e RPCs de catálogo retornam
  permission denied (`42501`);
- authenticated sem identidade retorna `PED10` nas RPCs atuais;
- owner não acessa unidade de outro tenant;
- manager/operator não acessam unidade sem `membership_units`;
- FK composta rejeita vínculo ou categoria de outra organização/unidade;
- `INSERT`/`UPDATE`/`DELETE` diretos no catálogo permanecem bloqueados;
- operator consegue somente `set_catalog_product_available` no catálogo da unidade autorizada;
- cleanup remove organizações e usuários sintéticos.

Nunca validar RLS com `service_role`. Setup/cleanup usam a conexão administrativa direta; cenários de
aplicação usam roles e claims equivalentes ao cliente.

## 8. Operações do catálogo

Rota administrativa: `/app/catalogo`, protegida por sessão e contexto de unidade.

| Operação | RPC obrigatória | Roles |
|---|---|---|
| Ler catálogo | `get_unit_catalog_admin` | owner/manager/operator autorizados |
| Criar categoria | `create_catalog_category` | owner/manager |
| Editar categoria | `update_catalog_category` | owner/manager |
| Ativar/desativar categoria | `set_catalog_category_active` | owner/manager |
| Criar produto | `create_catalog_product` | owner/manager |
| Editar/mover produto | `update_catalog_product` | owner/manager |
| Ativar/desativar produto | `set_catalog_product_active` | owner/manager |
| Disponibilizar/indisponibilizar | `set_catalog_product_available` | owner/manager/operator |

Criação de categoria, criação/edição de produto e alteração de disponibilidade devem ocorrer
exclusivamente por essas RPCs. Não fazer writes diretos, não fornecer `organization_id` ou
`sort_order` pelo cliente e não criar endpoint de DELETE. Preço entra como string decimal; o banco
persiste `numeric(12,2)`.

`is_active` e `is_available` são independentes. Desativar categoria não propaga flags aos produtos.
O catálogo é mutável e administrativo; não usá-lo como API pública de cardápio.

### 8.2 Cardápio publicado (Prompt 07)

Rota administrativa: `/app/cardapio` (owner/manager publicam; operador apenas lê via
`get_unit_menu_publication_admin`). Rota pública: `/menu/:slug`.

| Operação | RPC obrigatória | Roles |
|---|---|---|
| Publicar cardápio | `publish_unit_menu` | owner/manager |
| Ler publicação/histórico | `get_unit_menu_publication_admin` | owner/manager/operator autorizados |
| Ler cardápio público | `get_public_menu` | anon/authenticated |

A publicação cria um snapshot comercial imutável a partir do catálogo estruturalmente ativo e
mantém um slug público opaco e estável. Nenhuma escrita direta é permitida nas tabelas
`menu_versions`, `menu_version_categories`, `menu_version_products` ou `menu_publications`. O
cardápio público é lido somente via `get_public_menu`; `anon` nunca consulta as tabelas
diretamente.

| Código | Tratamento |
|---|---|
| `PED31` | menu vazio (sem produtos ativos); ajustar catálogo e republicar |
| `PED32` | conflito raro de slug; republicar |

### 8.1 Erros do catálogo

| Código | Tratamento |
|---|---|
| `PED10` | sessão ausente/expirada; solicitar novo login |
| `PED11` | usuário sem acesso ou gestão da unidade |
| `PED12` | unidade não encontrada |
| `PED20` | categoria não encontrada; recarregar catálogo |
| `PED21`/`PED22` | nome de categoria ausente/acima de 80 |
| `PED23` | nome de categoria conflitante na unidade |
| `PED24` | produto não encontrado; recarregar catálogo |
| `PED25`/`PED26` | nome de produto ausente/acima de 120 |
| `PED27` | descrição acima de 500 |
| `PED28` | preço inválido, não positivo, mais de duas casas ou overflow |
| `PED29` | categoria fora da unidade/tenant do produto |
| `PED30` | flag booleana inválida |

## 9. Configuração operacional

Rota: `/app/configuracoes`, restrita a owner e manager autorizado por `RequireManageUnit`.

- leitura: `get_unit_operational_config`;
- save completo: `save_unit_operational_config`;
- unidade não configurada retorna `configured=false` e `accepting_orders=false`;
- ligar aceite exige unidade ativa, modalidade, ao menos um dia aberto e um método habilitado;
- dinheiro é string decimal no contrato; banco usa `numeric(12,2)`;
- erros estáveis: `PED10..PED18`, detalhados em `PEDON_DATABASE_SCHEMA.md`.

## 10. Rotas web atuais

| Rota | Estado |
|---|---|
| `/` | landing/fundação |
| `/login` | entrada |
| `/cadastro` | cadastro com confirmação de e-mail |
| `/onboarding` | onboarding transacional |
| `/app` | área administrativa e contexto de unidade |
| `/app/catalogo` | catálogo por unidade; todos os roles leem, RBAC por ação |
| `/app/configuracoes` | configuração operacional; owner/manager |
| `/app/cardapio` | publicação e histórico do cardápio; owner/manager |
| `/menu/:slug` | cardápio público do cliente, sem sessão |
| `*` | página não encontrada |

Fluxo Auth permanece: cadastro, confirmação de e-mail, login, onboarding e área administrativa. O
Prompt 07 não alterou Auth e enviou zero e-mails. A homologação real do Prompt 03/05 permanece
válida: confirmação pelo Supabase built-in mailer, redirect para `https://ped-on.pages.dev`, login,
onboarding, restauração de sessão, logout/relogin e cleanup; incidente antigo de `SITE_URL` em
localhost está resolvido.

## 11. CI e GitHub

| Item | Valor |
|---|---|
| Repositório | `https://github.com/Rodrigo-Kotlin/ped-on` (PUBLIC) |
| Branch | `main` |
| Modelo | Main-First monitorado |
| Workflow | `.github/workflows/ci.yml`, nome `CI` |

Job `quality`: install frozen, format check, lint, typecheck, unit tests, build e Gitleaks. Job
`e2e`: depende de quality, instala Chromium e roda Playwright. Checkpoint Prompt 07: run
`31407263950`, SHA `a1640ad8c12115602eb299c47cae82c13822d7f3`, `SUCCESS` em quality + E2E.

Comandos de inspeção:

```bash
gh run list --workflow CI
gh run view 31407263950
```

Há aviso de depreciação do runtime Node.js 20 em actions de terceiros, mas o workflow executa e
passa com Node.js 24.

## 12. Cloudflare Pages

| Item | Valor |
|---|---|
| Projeto | `ped-on` |
| Production branch | `main` |
| Build | `pnpm build` |
| Output | `apps/web/dist` |
| Node | `22` via `.nvmrc` |
| URL estável | `https://ped-on.pages.dev` |
| Deploy Prompt 07 | `90d70dc2-f739-4a2c-a04d-af55cc250406` |
| URL do deploy | `https://90d70dc2.ped-on.pages.dev` |
| Source | `a1640ad` |

Deploy é automático após push em `main`; GitHub Actions faz gates, não um segundo deploy.

### 12.1 Checkpoint pós-deploy Prompt 07

- confirmar deployment `SUCCESS` e source `a1640ad`;
- validar HTTP 200 em `/`, `/login`, `/app`, `/app/cardapio`, `/app/catalogo`, `/app/configuracoes`,
  `manifest.webmanifest`, `sw.js` e assets JS/CSS;
- confirmar SPA fallback nas rotas diretas;
- confirmar no bundle `publish_unit_menu`, `get_public_menu` e `get_unit_menu_publication_admin`
  (além de `get_unit_catalog_admin` e `get_unit_operational_config`);
- confirmar que o bundle aponta para o Supabase real e não contém secret key;
- confirmar que service worker não adicionou cache de API/dados privados.

Esse checkpoint foi executado com sucesso no deploy acima. O build registra warning de chunk JS de
~677 kB; é pendência de otimização, não falha do deploy.

## 13. Diagnóstico rápido

| Sintoma | Verificação |
|---|---|
| Rota direta retorna 404 | `_redirects` e SPA fallback do Pages |
| Catálogo retorna `PED10` | sessão/claims e restauração do Auth |
| Catálogo retorna `PED11` | unidade selecionada, role e `membership_units` |
| Produto retorna `PED29` | categoria pertence à mesma unidade e tenant |
| Publicar retorna `PED31` | catálogo sem produto ativo; ajustar antes de republicar |
| Anon vê zero linhas | comportamento esperado; cardápio via `get_public_menu` |
| Write direto falha `42501` | comportamento esperado; usar RPC |
| Migration ausente | `supabase migration list`, depois `db push --linked` se revisada |
| DB test falha por contagem | confirmar que as cinco suítes não rodaram em paralelo |
| Teste deixa dados após crash | localizar somente fixtures `pedon-test.invalid`; limpar com cuidado |
| Build avisa chunk grande | warning conhecido de 677.59 kB |

## 14. Próximo passo oficial

Prompt 08: carrinho local, checkout guest, pedido idempotente e Central de Pedidos. Até essa
etapa, o cardápio público continua lido exclusivamente via `get_public_menu`; pedidos não existem
no schema.
