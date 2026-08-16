# PED-ON — PILOT-P01 Onboarding Plan (Mr. Burger — Oriximiná/PA)

> Plano de onboarding controlado do primeiro participante do piloto (PILOT GATE Parte 2C).
> Fonte normativa: `docs/PEDON_PILOT_GATE.md` (DEC-126) e `docs/PEDON_PILOT_EVALUATION.md`
> (ficha do candidato). Sem PII no Git. Escrito em modo planejamento — NENHUMA escrita remota
> executada até autorização explícita.

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

Aguardando: `TARGET ENVIRONMENT` e/ou `ONBOARDING DATA` e/ou `AUTHORIZE PILOT-P01 REMOTE WRITES`.
O hotfix de adição de membros já está disponível; nenhum dado de onboarding real foi gravado.

## 2. Participante e baseline

- PILOT ID: **PILOT-P01** — Mr. Burger — Oriximiná/PA (autorizado pelo responsável humano).
- Seleção: `APPROVED` (Parte 2A/2B — ELIGIBLE).
- RC técnico: `ddd11b44`; baseline documental: `4c28b4a`; CI de referência: `31954083313` SUCCESS.
- `OPERATION_READY — ACHIEVED`; `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED`.
- **GATE 1 — RELEASE: PASS** (validação documental; nenhuma escrita necessária).

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
| Nome interno exato a gravar | PARTIAL | confirmar grafia exata a usar em `complete_onboarding` |
| E-mail do usuário owner (cadastro) | MISSING | solicitar no HUMAN GATE; NÃO gravar no Git |
| Integrações externas obrigatórias | PARTIAL | nenhuma informada até o momento; avaliar antes da ativação se descoberta |

### B. UNIT

| Dado | Status | Observação |
| --- | --- | --- |
| Nome da unidade | PARTIAL | sugerido "Mr. Burger — Oriximiná"; confirmar |
| Timezone | AVAILABLE | `America/Sao_Paulo` (default do produto) |
| Horários | AVAILABLE | terça a domingo 18:00–23:59; segunda fechado |
| Modos de serviço | AVAILABLE | pickup + delivery |
| Delivery fee / valor mínimo / ETAs | MISSING | solicitar; sem frete inventado |
| Unidade ativa | PLANNED | `is_active = true` |

### C. USERS

| Dado | Status | Observação |
| --- | --- | --- |
| Usuário owner | MISSING | responsável operacional; e-mail fora do Git |
| Manager/operator | MISSING | quem, papel e e-mail (mínimo necessário; ~6 é estimativa) |
| Mecanismo oficial de adição de membro | RESOLVED | HOTFIX P1 (DEC-127): convite/aceite por e-mail verificado em `/app/equipe` + `/onboarding`; migration 24 |

Roles reais do produto: `owner`, `manager`, `operator` (nenhuma role nova). Menor privilégio.
Contas individuais; conta compartilhada não é aceita silenciosamente.

### D. CATALOG

| Dado | Status | Observação |
| --- | --- | --- |
| Categorias/produtos/preços/opções | MISSING | coletar em CSV/XLSX/JSON ou preenchimento manual |
| Importador novo | NÃO | usar fluxo administrativo/RPCs oficiais existentes |

CATALOG IMPORT SUMMARY (preencher após os dados):

```text
Categories: N
Products: N
Option groups: N
Options: N
Products with variations: N
Products with addons: N
Products with removals: N
Potential validation issues: ...
```

Regras: preço nunca inferido/arredondado/zero por omissão — valor ausente ⇒ `BLOCK CATALOG ENTRY`.
Contratos de opções preservados (`single`⇒`max_select=1`, `min/max`, `price_delta` positivo/zero).

### E. OPERATIONAL CONFIG

| Item | Status | Observação |
| --- | --- | --- |
| Pagamentos | AVAILABLE | `pix`, `credit_card`, `debit_card`, `cash` — flags de aceitação |
| Processamento online | N/A | o produto registra a forma de pagamento; NÃO processa pagamento online (sem adquirente) |
| Impressão | PARTIAL | POS-58 `INFRASTRUCTURE AVAILABLE`; `PRINT COMPATIBILITY — TO BE VALIDATED` na Parte 2D |
| `accepting_orders` | PLANNED | habilitar somente após Gates preparatórios e autorização |

### F. TRAINING

PLANNED — roteiro enxuto por perfil (seção 9). Não basta enviar manual.

### G. SUPPORT

Papéis com placeholder até nomes/canais autorizados (seção 10).

## 5. GATE 2 — TENANT PLAN

```text
TENANT CREATION PLAN
Organization: Mr. Burger (1)
Unit: Mr. Burger — Oriximiná (1)
Users: owner 1 primeiro; depois os mínimos manager/operator autorizados
Roles: owner / manager / operator (reais, sem role nova)
Expected access: owner = todas as unidades; manager/operator = somente a unidade via membership_units
Expected isolation: tenant `organization_id` único; nenhuma visão cross-tenant
```

NÃO criado ainda. Escritas via mecanismo oficial (UI/RPC), incremental e validada por bloco.

## 6. GATE 3 — CATALOG PLAN

- Coleta de dados em formato de menor risco (CSV/XLSX/JSON ou manual). Sem parser/importador novo.
- Cadastro via RPCs oficiais do catálogo (`create_catalog_category`, `create_catalog_product`,
  grupos/opções) — can_manage_unit (owner/manager).
- Validação de preços antes da publicação. Publicação via `publish_unit_menu` (owner/manager).
- Sumário de importação apresentado antes de qualquer cadastro em massa.

## 7. GATE 4 — OPERATION PLAN

- SERVICE MODES: delivery `ENABLED`, pickup `ENABLED`, tables `OUT OF SCOPE`.
- PAYMENTS: `pix`, `credit_card`, `debit_card`, `cash` — representados como flags de aceitação
  (`unit_payment_methods`). Aceitar cartão ≠ processar pagamento online; sem integração com adquirente.
- DELIVERY: coletar endereço de entrega do pedido; confirmar taxa, valor mínimo e ETAs com o
  estabelecimento antes de configurar. Nenhuma estratégia de frete inventada.
- HORÁRIOS: terça a domingo 18:00–23:59; segunda fechado — validar no modelo real de
  `unit_business_hours` (7 linhas por unidade; `close_time < open_time` = virada de dia).

## 8. GATE 5 — SECURITY PLAN

- Verificar organização correta; unidade correta; usuários corretos; roles corretas.
- Isolamento `organization_id` + `membership_units`; nenhuma visão cross-tenant; nenhuma PII indevida
  na Central/KDS; nenhum secret; nenhuma credencial versionada.
- Qualquer evidência cross-tenant: `P0` — STOP PILOT.

## 9. GATE 6 — TRAINING PLAN

- OWNER: login; unidade; equipe; visão geral; catálogo; pedidos.
- MANAGER: Central; KDS; status; cancelamento; pagamento; operação.
- OPERATOR: Central; ações permitidas; alertas.
- COZINHA: KDS; Novo; Confirmado; Em preparo; Pronto; impressão; reimpressão.
- Incluir explicitamente: **MESAS NÃO FAZEM PARTE DO PRIMEIRO CICLO**.
- Solicitações "seria melhor se tivesse X": classificar `UX_FEEDBACK` ou `FEATURE_REQUEST`; não
  implementar durante o piloto.

## 10. GATE 7 — SUPPORT PLAN

| Papel | Valor |
| --- | --- |
| PILOT OWNER | `TBD` (placeholder até autorização) |
| TECHNICAL OWNER | `TBD` (placeholder até autorização) |
| ESTABLISHMENT OWNER | `TBD` (placeholder até autorização) |
| SUPPORT CONTACT | `TBD` (canal autorizado) |
| INCIDENT OWNER | `TBD` (placeholder até autorização) |

Pendência registrada: papéis de suporte devem ser definidos antes da ativação operacional.

## 11. REMOTE WRITE PLAN

```text
TARGET ENVIRONMENT: UNDEFINED (aguardando decisão humana)

CREATE (quando autorizado):
Organizations: 1
Units: 1
Users: mínimo necessário (owner + manager/operator autorizados)
Categories: N (do catálogo fornecido)
Products: N
Option groups: N
Options: N
Operational configs: horários, pagamentos, modos, delivery

NO CODE CHANGES: YES
NO DATABASE STRUCTURAL CHANGES: YES
NO MIGRATIONS: YES
NO RLS CHANGES: YES
NO RPC CHANGES: YES
NO EDGE CHANGES: YES
NO SW CHANGES: YES
```

Mecanismo: somente fluxo oficial (UI do produto / RPCs `security definer`). Proibido: SQL direto como
atalho, `service_role` para burlar regras, desativar RLS.

Sequência incremental: organização → validar → unidade → validar → owner → validar acesso → usuários
adicionais → validar RBAC → configurações → catálogo → publicação. Verificar cada bloco antes do próximo.

## 12. Evidence Register — PILOT-P01-ONBOARDING-001

```text
PILOT-ID:  PILOT-P01-ONBOARDING-001
Release SHA: ddd11b44 (RC) / 4c28b4a (doc)
Environment: <TARGET ENVIRONMENT — definir>
Organization/Unit: <identificadores operacionais mínimos>
Gates: G1 <PASS> G2 <...> G3 <...> G4 <...> G5 <...> G6 <...> G7 <...>
Result: <PASS / FAIL / PENDING>
```

Sem senha, token, payload sensível ou PII.

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

1. **REMOTE WRITE GATE:** `TARGET ENVIRONMENT: UNDEFINED` — definir
   (`PILOT` / `STAGING` / `PRODUCTION` / `OTHER`) antes de qualquer escrita.
2. **Autorização de escrita:** `AUTHORIZE PILOT-P01 REMOTE WRITES` (se `PRODUCTION`:
   `AUTHORIZE PILOT-P01 REMOTE WRITES IN PRODUCTION`).
3. Sem autorização: `READ_ONLY`.

## 15. REQUIRED FROM HUMAN (lista objetiva)

1. `TARGET ENVIRONMENT` (PILOT / STAGING / PRODUCTION / OTHER).
2. Nome exato da organização e da unidade a gravar.
3. E-mail do usuário owner (não gravar no Git).
4. Decisão sobre equipe: nomes, papéis (`manager`/`operator`), e-mails mínimos; e decisão sobre o
   achado da seção 13.
5. Dados do catálogo (CSV/XLSX/JSON ou manual): categorias, produtos, preços, opções/adicionais.
6. Configuração de delivery: taxa, valor mínimo e ETAs estimados.
7. Papéis de suporte autorizados (nomes/canais).
8. Autorização de escrita remota (frase exata da seção 14).

Nenhuma lacuna será preenchida por suposição.
