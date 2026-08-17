# PED-ON — PILOT-P01 Onboarding Plan (Mr. Burger — Oriximiná/PA)

> Plano de onboarding controlado do primeiro participante do piloto (PILOT GATE Parte 2C).
> Fonte normativa: `docs/PEDON_PILOT_GATE.md` (DEC-126) e `docs/PEDON_PILOT_EVALUATION.md`
> (ficha do candidato). Sem PII no Git. Escrito em modo planejamento — NENHUMA escrita remota
> executada até autorização explícita.
>
> **TARGET ENVIRONMENT: `PRODUCTION`** (selecionado em 2026-08-16). Isso NÃO constitui autorização
> de escrita: `PRODUCTION WRITE AUTHORIZATION: NOT GRANTED`.

## 1. Estado

| Campo | Valor |
| --- | --- |
| PILOT GATE | `IN PROGRESS` |
| PILOT_PREPARATION_CHECKPOINT | `ACHIEVED` |
| PILOT_ONBOARDING | `IN PROGRESS` |
| PILOT_PARTICIPANT_01 | `ONBOARDING PLANNED` |
| PILOT_OPERATION | `NOT STARTED` |
| PROMPT 14 | `NOT STARTED` |
| MEMBER ONBOARDING FINDING | `RESOLVED` (HOTFIX P1 — DEC-127; ver seção 13) |
| TARGET ENVIRONMENT | `PRODUCTION` — selecionado; escrita NÃO autorizada |
| PRODUCTION STRUCTURAL STATE | migration 24 **APLICADA** em produção (DEC-128, Parte 2C-R1) — fluxo de convite disponível (seção 16) |

Aguardando: `AUTHORIZE PILOT-P01 REMOTE WRITES IN PRODUCTION`. Catálogo estruturado e validado
(Parte 2C-R2/R3). Nenhuma escrita de negócio executada.

## 2. Participante e baseline

- PILOT ID: **PILOT-P01** — Mr. Burger — Oriximiná/PA (autorizado pelo responsável humano).
- Seleção: `APPROVED` (Parte 2A/2B — ELIGIBLE).
- RC técnico: `ddd11b44`; baseline documental: `4c28b4a`; CI de referência: `31954083313` SUCCESS.
- Baseline do hotfix P1 (DEC-127): técnico `8714d1d` / CI `31962585865` SUCCESS; documental `45cf3c9` /
  CI `31968332581` SUCCESS.
- `OPERATION_READY — ACHIEVED`; `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED`.
- **GATE 1 — RELEASE: PASS** (validação documental; nenhuma escrita necessária).

TARGET ENVIRONMENT: `PRODUCTION` (registro oficial). E-mails operacionais autorizados usam
placeholders neste documento: `PILOT-P01-OWNER` e `PILOT-P01-OPERATOR-01` (nunca gravar e-mails reais
no Git).

## 3. Escopo congelado do primeiro ciclo

IN SCOPE: cardápio público; categorias; produtos; opções já suportadas; carrinho; checkout; delivery;
retirada; Pix; crédito; débito; dinheiro; Central de Pedidos; alertas; som opt-in; KDS; fluxo de
status; impressão; reimpressão; usuários e RBAC; troca de unidade quando aplicável; operação controlada.

OUT OF SCOPE: mesas; gestão de mesas; comandas presenciais específicas; atendimento presencial via
smartphones; feature nova; integração externa nova; Prompt 14.

MESAS: `OUT OF SCOPE FOR FIRST PILOT CYCLE`.

## 4. Onboarding Data Pack

### A. ORGANIZATION

| Dado | Status | Observação |
| --- | --- | --- |
| Nome comercial | AVAILABLE | "Mr. Burger" (autorizado) |
| Nome interno exato a gravar | CONFIRMED | `Mr. Burger` **já existe** em produção (inspeção read-only; seção 16) — NÃO recriar |
| E-mail do usuário owner (cadastro) | CONFIRMED | `PILOT-P01-OWNER` já possui conta Auth e é `owner` de "Mr. Burger" em produção |
| Integrações externas obrigatórias | NONE | nenhuma informada; nenhuma integração necessária nesta etapa |

### B. UNIT

| Dado | Status | Observação |
| --- | --- | --- |
| Nome da unidade | CONFIRMED | aprovado: **Matriz**. Produção tem unidade `Unidade principal` (default) na org — plano: renomear via `update_unit` (owner-only), não criar duplicada |
| Timezone | AVAILABLE | `America/Sao_Paulo` (default do produto) |
| Horários | AVAILABLE | terça a domingo 18:00–23:59; segunda fechado |
| Modos de serviço | AVAILABLE | delivery + pickup; mesas `OUT OF SCOPE` |
| Delivery fee / valor mínimo / ETAs | AVAILABLE | taxa R$ 5,00; pedido mínimo R$ 20,00; ETA 30–50 min (validar contrato real na configuração) |
| Unidade ativa | PLANNED | `is_active = true` |

### C. USERS

| Dado | Status | Observação |
| --- | --- | --- |
| Usuário owner | CONFIRMED | `PILOT-P01-OWNER` — role `owner`, função Gestor Administrativo, unidade Matriz; já existe em produção |
| Gerente Operacional | CONFIRMED | `PILOT-P01-OPERATOR-01` — role **`operator`** (aprovada; NÃO elevar para manager), unidade Matriz; **sem conta Auth ainda** |
| Mecanismo oficial de adição de membro | RESOLVED | HOTFIX P1 (DEC-127): convite/aceite por e-mail verificado; **porém NÃO implantado em produção (BLOCKER — seção 16)** |

Roles reais do produto: `owner`, `manager`, `operator` (nenhuma role nova). Menor privilégio.
Contas individuais; conta compartilhada não é aceita silenciosamente. TOTAL USERS EXPECTED: **2**
(1 owner + 1 operator; nenhum manager no primeiro ciclo).

### D. CATALOG

| Dado | Status | Observacao |
| --- | --- | --- |
| Categorias/produtos/precos/opcoes | STRUCTURED | `docs/PILOT_P01_CATALOG_DATA_PACK.md` (Parte 2C-R2) |
| Importador novo | NAO | usar fluxo administrativo/RPCs oficiais existentes |

CATALOG IMPORT SUMMARY (Parte 2C-R2):

```text
Categories: 4 (TRADICIONAIS, ARTESANAIS, PORCOES, BEBIDAS)
Products: 49 (10 + 14 + 10 + 15)
Option groups: 2 required (variation — A08, A10 — RESOLVED Parte 2C-R3)
Options: 4 required (Calabresa + Bacon x 2)
Juice products: 4 independent (HC-12 RESOLVED Parte 2C-R3)
Products with addons: PENDING (non-blocking, applicability undecided)
Products with removals: NOT CONFIGURED INITIALLY
Catalog model blockers: ZERO
Price validation: 63/63 PASS
```

Regras: preço nunca inferido/arredondado/zero por omissão — valor ausente ⇒ `BLOCK CATALOG ENTRY`.
Contratos de opções preservados (`single`⇒`max_select=1`, `min/max`, `price_delta` positivo/zero).

### E. OPERATIONAL CONFIG

| Item | Status | Observação |
| --- | --- | --- |
| Pagamentos | AVAILABLE | `pix`, `credit_card`, `debit_card`, `cash` — flags de aceitação do pedido (sem adquirente/TEF/gateway) |
| Processamento online | N/A | o produto registra a forma de pagamento; NÃO processa pagamento online (sem integração; não inferir captura/Pix automático) |
| Delivery | AVAILABLE | taxa R$ 5,00 (500 centavos), pedido mínimo R$ 20,00 (2000 centavos), ETA 30–50 min — conferir formato exato no contrato real antes de gravar |
| Impressão | PARTIAL | POS-58 `INFRASTRUCTURE AVAILABLE`; `PRINT COMPATIBILITY — TO BE VALIDATED` na Parte 2D |
| `accepting_orders` | PLANNED | habilitar somente após Gates preparatórios e autorização |

### F. TRAINING

PLANNED — roteiro enxuto por perfil (seção 9). Não basta enviar manual.

### G. SUPPORT

Papéis definidos: PILOT OWNER Rodrigo; TECHNICAL OWNER Rodrigo; ESTABLISHMENT OWNER Valdemir;
SUPPORT CONTACT WhatsApp (sem número pessoal no Git); INCIDENT OWNER Rodrigo (seção 10).

## 5. GATE 2 — TENANT PLAN

```text
TENANT PLAN (produção já contém recursos reais — NÃO recriar)
Organization: Mr. Burger — JÁ EXISTE (1) — usar a existente
Unit: Matriz — JÁ EXISTE como "Unidade principal" (default); plano: RENOMEAR via update_unit (owner-only), sem criar duplicada
Owner: PILOT-P01-OWNER — JÁ EXISTE (role owner, onboarding completed) — usar a existente
Operator: PILOT-P01-OPERATOR-01 — NÃO EXISTE ainda; criar conta + convite (migration 24, quando implantada)
Roles: owner (existente) + operator (novo); NENHUM manager no primeiro ciclo
Unit assignment: Matriz — owner vincula operator após aceite (assign_unit_to_member)
Expected memberships: 2 users total (1 owner + 1 operator)
Expected access: owner = todas as unidades; operator = somente Matriz via membership_units
Expected isolation: tenant `organization_id` único; nenhuma visão cross-tenant
```

NENHUMA criação executada nesta etapa. Escritas via mecanismo oficial (UI/RPC), incremental e validada
por bloco, somente após autorização humana.

## 6. GATE 3 — CATALOG PLAN

- **Status: `READY_FOR_ENTRY`** — `CATALOG DATA: STRUCTURED`;
  `CATALOG MAPPING: VALIDATED`; `CATALOG AMBIGUITIES: RESOLVED (BLOCKERS)`. Data pack completo em
  `docs/PILOT_P01_CATALOG_DATA_PACK.md` (Parte 2C-R3). Catálogo mapeado: 49 produtos, 4 categorias,
  14 adicionais. Preços validados (63/63 PASS). **CATALOG MODEL BLOCKERS: ZERO.** 9 non-blocking
  confirmations pendentes.
- Blockers HC-06/HC-07 (variação "Calabresa ou Bacon") e HC-12 (sucos) — **RESOLVIDOS** (Parte 2C-R3).
- Cadastro manual via RPCs oficiais do catálogo (`create_catalog_category`, `create_catalog_product`,
  grupos/opções) — can_manage_unit (owner). Sem parser/importador novo.
- Validação de preços antes da publicação. Publicação via `publish_unit_menu` (owner).
- Product image: CASE C (NOT IMPLEMENTED) — fotos RECOMENDADAS mas NÃO bloqueiam cadastro.

## 7. GATE 4 — OPERATION PLAN

- SERVICE MODES: delivery `ENABLED`, pickup `ENABLED`, tables `OUT OF SCOPE`.
- PAYMENTS: `pix`, `credit_card`, `debit_card`, `cash` — representados como flags de aceitação
  (`unit_payment_methods`). Aceitar cartão ≠ processar pagamento online; sem integração com adquirente,
  TEF, gateway, split ou captura de cartão (não inferir).
- DELIVERY: taxa R$ 5,00; pedido mínimo R$ 20,00; ETA 30–50 min — confirmar o formato canônico do
  contrato real (`unit_operational_settings`) antes de gravar (ex.: centavos vs. decimal exato).
- HORÁRIOS: terça a domingo 18:00–23:59; segunda fechado — validar no modelo real de
  `unit_business_hours` (7 linhas por unidade; `close_time < open_time` = virada de dia).
- Status: `PLANNED` — não marcar PASS antes de configuração e verificação.

## 8. GATE 5 — SECURITY PLAN

- owner role correta (`PILOT-P01-OWNER` = owner; sem downgrade);
- operator role correta (`PILOT-P01-OPERATOR-01` = `operator`; NÃO elevar para manager);
- nenhum manager no primeiro onboarding;
- tenant único (organização existente "Mr. Burger"); nenhuma visão cross-tenant;
- operator sem privilégios de owner; acesso à Matriz somente após `membership_units`
  (`assign_unit_to_member`);
- sem conta compartilhada; sem secrets; sem credencial no Git; sem PII nos docs;
- qualquer evidência cross-tenant: `P0` — STOP PILOT.

## 9. GATE 6 — TRAINING PLAN

- OWNER / GESTOR ADMINISTRATIVO (`PILOT-P01-OWNER`): login; unidade; equipe; convite; associação de
  unidade; catálogo; pedidos; KDS; configuração operacional.
- OPERATOR / GERENTE OPERACIONAL (`PILOT-P01-OPERATOR-01`): login; Central de Pedidos; alertas; ações
  permitidas (sem privilégios de owner); KDS; status; impressão/reimpressão.
- COZINHA: KDS; Novo; Confirmado; Em preparo; Pronto; impressão.
- Incluir explicitamente: **MESAS NÃO FAZEM PARTE DO PRIMEIRO CICLO**.
- Solicitações "seria melhor se tivesse X": classificar `UX_FEEDBACK` ou `FEATURE_REQUEST`; não
  implementar durante o piloto.

## 10. GATE 7 — SUPPORT PLAN

| Papel | Valor |
| --- | --- |
| PILOT OWNER | Rodrigo |
| TECHNICAL OWNER | Rodrigo |
| ESTABLISHMENT OWNER | Valdemir |
| SUPPORT CONTACT | WhatsApp (canal autorizado; sem número pessoal no Git) |
| INCIDENT OWNER | Rodrigo |

Status: `READY FOR ONBOARDING` (papéis definidos; canal autorizado).

## 11. REMOTE WRITE PLAN

```text
TARGET ENVIRONMENT: PRODUCTION (selecionado; escrita NÃO autorizada)

CURRENT PRODUCTION STATE (seção 16 — inspeção read-only + deploy DEC-128):
  Migrations: 24 aplicadas — migration 24 (DEC-127) APLICADA em produção (2026-08-16)
  Organization "Mr. Burger": EXISTS (1) — NÃO criar
  Unit "Matriz": NÃO existe — existe "Unidade principal" (renomear, não criar)
  PILOT-P01-OWNER: Auth EXISTS, role owner, onboarding completed, membro único
  PILOT-P01-OPERATOR-01: Auth NÃO existe
  Invites/memberships adicionais: nenhum; tabela de convites PRESENTE (migration 24 aplicada)

CREATE (quando autorizado):
  Organizations: 0 (existente)
  Units: 0 novas (renomear "Unidade principal" -> Matriz via update_unit)
  Auth users: 1 (PILOT-P01-OPERATOR-01)
  Memberships: 1 via aceite de convite (operator)
  Invites: 1 (owner -> PILOT-P01-OPERATOR-01)
  Unit assignments: 1 (operator -> Matriz via assign_unit_to_member)

CONFIGURE:
  Hours: ter a dom 18:00-23:59, segunda fechado
  Service modes: delivery + pickup (mesas OUT OF SCOPE)
  Delivery: taxa R$ 5,00 | mínimo R$ 20,00 | ETA 30-50 min
  Payments: pix, credit_card, debit_card, cash
  Catalog: STRUCTURED — READY_FOR_ENTRY (catalog model blockers: ZERO)

TRAINING: PLANNED
SUPPORT: DEFINED (seção 10)
PRINT: TO BE VALIDATED IN PART 2D

NO CODE CHANGES: YES
NO DATABASE STRUCTURAL CHANGES: YES
NO MIGRATIONS: YES (nesta execução; migration 24 já aplicada em produção — DEC-128)
NO RLS CHANGES: YES
NO RPC CHANGES: YES
NO EDGE CHANGES: YES
NO SW CHANGES: YES
```

Mecanismo: somente fluxo oficial (UI do produto / RPCs `security definer`). Proibido: SQL direto como
atalho, `service_role` para burlar regras, desativar RLS.

Sequência incremental: revalidar estado → renomear unidade → validar → configurar unidade → validar →
operator (conta + convite + aceite + vínculo de unidade) → validar RBAC → catálogo manual →
publicação. Verificar cada bloco antes do próximo. Ordem final sujeita ao fluxo real do produto.

## 12. Evidence Register — PILOT-P01-ONBOARDING-001

```text
PILOT-ID:  PILOT-P01-ONBOARDING-001
Release SHA: ddd11b44 (RC) / 8714d1d + 45cf3c9 (hotfix P1 DEC-127)
Environment: PRODUCTION (read-only inspeção 2026-08-16; escrita NÃO autorizada)
Organization/Unit: Mr. Burger (existente) / Matriz (renomear de "Unidade principal")
Gates: G1 <PASS> G2 <PLANNED> G3 <READY_FOR_ENTRY> G4 <PLANNED> G5 <PLANNED> G6 <PLANNED> G7 <READY>
Result: <PENDING — aguardando autorizacao de escrita>
```

Sem senha, token, payload sensível ou PII. E-mails reais fora do Git (placeholders).

## 13. Achado principal — adição de membros à organização

- **Observado (original):** `complete_onboarding` é o único mecanismo oficial que insere membro na
  organização (papel `owner`). `/app/equipe` apenas lista membros e atribui/remove vínculo de unidade
  (`get_org_members_admin`, `assign_unit_to_member`, `remove_unit_from_member`). Não existia RPC nem
  UI para adicionar um usuário existente à organização como `manager`/`operator` ou alterar papel.
- **Classificação original:** `PILOT_FINDING` (P1 — PILOT BLOCKER), pendente de decisão humana.
- **Status: `RESOLVED` — HOTFIX P1 (DEC-127).** O fluxo oficial de convite/aceite por e-mail
  verificado foi implementado e liberado com CI verde:
  - migration 24 `20260816120000_pilot_finding_member_onboarding.sql`:
    `organization_member_invites` + 5 RPCs (`create_org_member_invite`, `list_org_member_invites`,
    `revoke_org_member_invite`, `get_my_pending_member_invites`, `accept_org_member_invite`) com
    `PED80`–`PED90`;
  - owner convida em `/app/equipe` (papel `manager`/`operator`, idempotente) e revoga; o convidado
    aceita em `/onboarding` usando o **e-mail verificado** da conta (`PED90 EMAIL_MISMATCH` protege o
    vínculo; `PED85` preserva ONE USER → AT MOST ONE ORGANIZATION);
  - o aceite NÃO cria `membership_units` automáticas: o owner atribui unidade em `/app/equipe` via
    `assign_unit_to_member`, preservando a semântica de autorização por unidade;
  - evidência: commits `0753c18` → `8714d1d`, CI `31962585865` SUCCESS (24 migrations, 13 suítes DB,
    Quality gates, E2E smoke tests).
- **Uso no onboarding do PILOT-P01:** após a autorização humana, o owner do Mr. Burger poderá
  convidar os usuários operacionais pelo mecanismo oficial; nenhuma escrita SQL direta será necessária
  e a governança (seção 30 do prompt / seção 6.1 da RLS) permanece respeitada.
- **Próximos passos humanos (inalterados):** opções 1–3 da decisão original não são mais necessárias
  para o fluxo de adição; resta apenas coletar os dados mínimos e obter a autorização de escrita.

## 14. HUMAN GATES desta etapa

1. **REMOTE WRITE GATE:** `TARGET ENVIRONMENT: PRODUCTION` — registrado.
2. **Autorização de escrita:** `AUTHORIZE PILOT-P01 REMOTE WRITES IN PRODUCTION` (frase exata) —
   ainda **NÃO concedida**.
3. Sem autorização: `READ_ONLY` (mantido nesta execução).

## 15. REQUIRED FROM HUMAN (lista objetiva)

1. `AUTHORIZE PILOT-P01 REMOTE WRITES IN PRODUCTION` (autorização explícita; pré-requisito absoluto).
2. ~~Confirmar implantação do release com a **migration 24** (DEC-127) em produção~~ — **CONCLUÍDO**:
   migration 24 aplicada em produção em 2026-08-16 (DEC-128, Parte 2C-R1 — seção 16). O fluxo de
   convite/aceite já existe no ambiente.
3. ~~Dados do catálogo real~~ — **CONCLUIDO** (Parte 2C-R2/R3): 49 produtos, 4 categorias, 14
   adicionais mapeados. `CATALOG DATA: STRUCTURED`. Blockers HC-06/HC-07/HC-12 resolvidos.
   `CATALOG MODEL BLOCKERS: ZERO`. Non-blocking pendências permanecem (descricoes, addons,
   remocoes).
4. Confirmar renomeação da unidade `Unidade principal` → `Matriz` (ou manter o nome atual).
5. Confirmar dados operacionais: taxa R$ 5,00, mínimo R$ 20,00, ETA 30–50 min, horários
   (ter-dom 18:00–23:59, seg fechado), meios: Pix/Crédito/Débito/Dinheiro.
6. Configuração do operador no estabelecimento (credenciais individuais; sem conta compartilhada).

Nenhuma lacuna será preenchida por suposição.

## 16. Produção — inspeção read-only (Parte 2C, 2026-08-16)

Método: conexão read-only via pooler (somente `SELECT`/`information_schema`/existence checks). Nenhuma
escrita. Resultados:

| Verificação | Resultado | Classificação |
| --- | --- | --- |
| Migrations aplicadas | 23 — termina em `20260814100000`; **`20260816120000` AUSENTE** | `DRIFT STRUCTURAL` |
| Tabela `organization_member_invites` | NÃO existe | `MISSING` |
| RPCs DEC-127 (`create/list/revoke/accept/get_my_pending`) | NÃO existem | `MISSING` |
| `PILOT-P01-OWNER` (Auth) | EXISTS | `FOUND` |
| `PILOT-P01-OWNER` (membro) | `owner` de "Mr. Burger"; onboarding `completed`; única organização | `FOUND` |
| Organização "Mr. Burger" | EXISTS (1) — nome exato | `FOUND` |
| Unidade "Matriz" | NÃO existe; org possui `Unidade principal` (1) | `NOT FOUND` (plano: renomear) |
| `PILOT-P01-OPERATOR-01` (Auth) | NÃO existe | `NOT FOUND` |
| Convites/invites | impossível verificar — tabela ausente (migration 24) | `CANNOT VERIFY` |
| Deploy PWA/Cloudflare SHA | não verificável read-only desta máquina (sem credencial) | `CANNOT VERIFY` |

**BLOCKER (estrutural):** produção está na migration 23; o hotfix DEC-127 (migration 24) **não foi
implantado**. O fluxo oficial de convite/aceite de membros não existe no ambiente. Regra da seção 16
do prompt: ambiente fora do baseline estrutural esperado ⇒ **NÃO escrever** — registrado como blocker.
Nenhuma escrita foi executada.

**Consequências:** (1) o convite do operator e o aceite dependem da aplicação do release homologado
(CI `31962585865`) em produção; (2) até lá, qualquer onboarding do operator exigiria atalho
(`service_role`/SQL direto), proibido pela governança — portanto o operator permanece `NOT FOUND` até o
release ser implantado. (3) O owner e a organização já existentes em produção devem ser **reutilizados**
(seção 5), nunca recriados.

**BLOCKER — RESOLVIDO (Parte 2C-R1, 2026-08-16):** autorização `AUTHORIZE DEC-127 PRODUCTION
DEPLOYMENT ONLY` concedida e o release homologado da DEC-127 foi implantado pelo mecanismo oficial
(`supabase db push` — RUNBOOK §5.2; verificação em `docs/PEDON_IMPLEMENTATION_STATUS.md`, checkpoint
Parte 2C-R1, e DEC-128). Estado pós-deploy verificado read-only:

| Verificação (pós-deploy) | Resultado |
| --- | --- |
| Migrations | 24 (24/24; `20260816120000` presente; nenhuma inesperada) |
| `organization_member_invites` | PRESENTE; RLS `ON`; única policy SELECT owner-only (`is_org_owner`); sem policies I/U/D |
| Constraints | `role in ('manager','operator')`; `status`; e-mail não vazio; `expires_at` NOT NULL |
| Índice de pendência | único parcial `(organization_id, email) where status='pending'` |
| 5 RPCs DEC-127 | PRESENTES — `SECURITY DEFINER`, `search_path=''`, grants somente `authenticated` |
| Grants de tabela | padrão idêntico às tabelas existentes (sem exposição nova) |
| Frontend | estável `https://ped-on.pages.dev` com `CF_PAGES_COMMIT_SHA` `599256a` (contém UI de convite DEC-127) |

Após este deploy, as pendências de onboarding são somente o **catálogo real** e a **autorização de
escrita** (`AUTHORIZE PILOT-P01 REMOTE WRITES IN PRODUCTION`). Nenhuma escrita de negócio executada;
nenhum dado do Mr. Burger alterado.
