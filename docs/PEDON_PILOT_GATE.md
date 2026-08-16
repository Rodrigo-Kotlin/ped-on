# PED-ON — Pilot Gate

> Governança formal do piloto controlado (aproximadamente 3–5 estabelecimentos).
> Etapa de PREPARAÇÃO (Parte 1). Não inicia onboarding, não seleciona estabelecimentos reais e não
> inicia o Prompt 14. Documento de continuidade oficial — leia junto com
> `PEDON_IMPLEMENTATION_STATUS.md`, `PEDON_RUNBOOK.md` e `PEDON_DECISION_REGISTER.md`.

---

## 1. Estado do checkpoint

| Campo | Valor |
| --- | --- |
| PILOT_GATE | `IN PROGRESS` |
| PILOT_PREPARATION_CHECKPOINT | `ACHIEVED` |
| PILOT_ONBOARDING | `READY / NOT STARTED` |
| PILOT_OPERATION | `NOT STARTED` |
| PROMPT 14 | `NOT STARTED` |

Decisão registrada: `DEC-126 — Pilot Charter e preparação do piloto controlado` (3–5
estabelecimentos).

## 2. Freeze do Release Candidate

O Release Candidate de referência do piloto é:

- **HEAD documental:** `1cf27ee` — `docs(prompt13): record 13.6 hardening audit and RC decision`
- **HEAD técnico:** `ddd11b44` — `feat(prompt13): polish operational tablet and desktop UI`
- **CI do RC:** run `31925684279` SUCCESS; CI técnico anterior `31924328717` SUCCESS
- **Estado do RC:** `RELEASE_CANDIDATE_CHECKPOINT — ACHIEVED`, `OPERATION_READY — ACHIEVED`

Regras:

1. O piloto começa utilizando esse baseline ou um sucessor explicitamente homologado.
2. Durante o piloto, NÃO incorporar features novas diretamente.
3. Mudanças funcionais ocorrem somente quando justificadas por P0, P1 ou correção P2 aprovada.
4. Cada mudança durante o piloto gera: finding → causa raiz → correção → evidência de teste → novo
   SHA → CI verde → decisão de continuidade (seção 12).
5. Nenhuma mudança silenciosa de baseline é permitida.

## 3. Pilot Charter

1. **Objetivo do piloto:** validar a operação de pedidos 2.0 em ambiente controlado real — Central de
   Pedidos, KDS, comanda 80 mm, alertas operacionais, Realtime+fallback, offline fail-closed,
   RBAC multi-tenant e impressão — medindo viabilidade operacional, estabilidade e usabilidade antes
   do Prompt 14.
2. **Escopo:** operação do dia a dia de recebimento/gestão/cozinha/retirada/delivery de pedidos;
   catálogo/cardápio; Clube e vouchers no fluxo operacional; suporte e coleta de evidências.
3. **Fora do escopo:** Prompts 14+, novas features, billing, novas integrações, app mobile, analytics
   novos, refactor/redesign, mudanças de loyalty fora de finding e melhorias cosméticas não críticas.
4. **Release Candidate:** `ddd11b44` (HEAD técnico) / `1cf27ee` (HEAD documental) — seção 2.
5. **Quantidade pretendida:** 3 a 5 estabelecimentos, controlados e em fases.
6. **Perfil adequado:** estabelecimentos com operação de delivery e/ou pickup, catálogo minimamente
   estruturado, responsável operacional identificado, internet estável e disponibilidade para
   treinamento e feedback. Ver matriz de elegibilidade (seção 4).
7. **Condições técnicas mínimas:** computador/tablet com navegador atualizado (Chromium/Firefox),
   internet estável, impressora quando a comanda for usada, e usuários individuais por membro da
   equipe.
8. **Responsabilidades da equipe Ped-On:** preparar tenant/unidade/catálogo com o estabelecimento;
   treinar usuários; garantir suporte no canal definido; classificar e acompanhar findings; validar
   cada correção (hotfix flow, seção 12); decidir continuidade; não expor PII em documentos.
9. **Responsabilidades do estabelecimento:** indicar o responsável operacional; preparar
   infraestrutura e catálogo; treinar a equipe; operar pelo produto; reportar incidentes e feedback
   estruturado; não compartilhar credenciais; não aplicar workarounds fora do produto sem registro.
10. **Processo de suporte:** canal único definido pelo SUPPORT CONTACT; triagem com severidade
    (seção 8); registro no Evidence Register (seção 15); acompanhamento por INCIDENT OWNER até
    encerramento.
11. **Gestão de incidentes:** classificação P0/P1/P2/P3 (seção 8), stop conditions (seção 9) e
    hotfix flow (seção 12).
12. **Critérios de interrupção:** seção 9.
13. **Critérios de continuidade:** seção 18 (GO / GO_WITH_FINDINGS / NO_GO) e Daily Pilot Check.
14. **Critérios de encerramento:** seção 18.
15. **Evidências coletadas:** Evidence Register (seção 15) e Daily Pilot Check (seção 16), com
    minimização de dados (seção 17).
16. **Aprovação de alterações durante o piloto:** Change Freeze (seção 20) + hotfix flow (seção 12) —
    nenhuma mudança sem finding, causa raiz, correção, teste e CI verde.

Nenhum estabelecimento real entra no piloto sem aprovação explícita do responsável pelo projeto.

## 4. Critérios de seleção dos 3–5 estabelecimentos

### 4.1 Matriz de elegibilidade

| Critério | Requisito mínimo | Nota |
| --- | --- | --- |
| Operação de delivery | Sim | Entrega e/ou retirada |
| Operação de retirada/pickup | Sim (desejável) | Pelo menos uma modalidade |
| Volume de pedidos | Baixo a médio | Evitar picos extremos no início |
| Funcionários operacionais | 1–3 na operação | Cobertura mínima de turno |
| Quantidade de unidades | 1 no início por estabelecimento | Expansão controlada depois |
| Maturidade digital | Básica | Disposição para usar sistema novo |
| Internet | Estável | Sem quedas frequentes |
| Equipamentos | Computador/tablet disponível | Navegador atualizado |
| Impressora | Quando a comanda for usada | 80 mm ou folha A4 via browser print |
| Treinamento | Disponibilidade real | Sessões agendadas |
| Feedback | Disponibilidade para reportar | Canal definido |
| Responsável operacional | Identificado | ESTABLISHMENT OWNER |
| Cardápio | Minimamente estruturado | Produtos e preços definidos |
| Formas de pagamento | Conhecidas | Dinheiro/Pix/cartão conforme configuração |
| Horário de funcionamento | Definido | Para janelas de operação |
| Disposição para piloto controlado | Confirmada | Acordo de participação |

### 4.2 Diversidade controlada

Preferir diversidade controlada, sem segmentação comercial definitiva. Exemplo conceitual:

- estabelecimento simples (baixo volume, fluxo de retirada);
- estabelecimento intermediário (volume moderado, delivery + retirada);
- estabelecimento com operação um pouco mais intensa (equipe maior, turnos).

Evitar começar somente com estabelecimentos complexos. Não escolher empresas reais nesta etapa.

## 5. Checklist de entrada do estabelecimento

Modelo reutilizável por participante (executado somente na Parte 2 — onboarding):

- **IDENTIFICAÇÃO:** organização; unidade; responsável (ESTABLISHMENT OWNER); contato; horário de operação.
- **INFRAESTRUTURA:** computador/tablet; navegador; conexão; impressão; dispositivos adicionais.
- **CONFIGURAÇÃO:** organização criada; unidade criada; equipe criada; RBAC conferido; horários;
  pagamentos; catálogo; categorias; produtos; variações; adicionais; cardápio publicado.
- **OPERAÇÃO:** Central de Pedidos; KDS; impressão; alertas; áudio; status; cancelamento; pagamento;
  retirada; delivery.
- **SEGURANÇA:** usuários individuais; ausência de credenciais compartilhadas sempre que aplicável;
  permissões; tenant correto; unidade correta.
- **TREINAMENTO:** operador; gerente; proprietário; cozinha.
- **VALIDAÇÃO FINAL:** pedido controlado de teste; KDS; mudança de status; impressão; conclusão do fluxo.

Este checklist é apenas o modelo. NÃO executar onboarding real nesta etapa.

## 6. Critérios de entrada no piloto

Um estabelecimento só é considerado `PILOT PARTICIPANT — READY` quando TODOS os gates abaixo estão
satisfeitos:

- **GATE 1 — RELEASE:** SHA homologado; CI SUCCESS; `OPERATION_READY — ACHIEVED`.
- **GATE 2 — TENANT:** organização correta; unidade correta; usuários corretos; RBAC correto.
- **GATE 3 — CATÁLOGO:** catálogo revisado; preços; produtos; opções; publicação.
- **GATE 4 — OPERAÇÃO:** pedido teste; Central; KDS; impressão quando usada; alertas; transições de status.
- **GATE 5 — SEGURANÇA:** nenhuma evidência de cross-tenant; nenhum secret exposto; permissões verificadas.
- **GATE 6 — TREINAMENTO:** usuários principais treinados; responsável operacional definido.
- **GATE 7 — SUPORTE:** canal definido; responsável definido; protocolo de incidente definido.

## 7. Contratos operacionais de referência (hardening Prompt 13)

O piloto herda os contratos validados na Etapa 13.6 (DEC-120 a DEC-125):

- Realtime único por unidade (owner no AppShell); polling de fallback 15s gated por online+visibilidade.
- Baseline conservador em hidratação, troca de unidade e resync offline→online (sem alert storm).
- Dedup de alertas; um chime por lote; som opt-in sessão-only.
- Mutações fail-closed offline; anti double-click; foco pós-mutação.
- KDS e comanda sem PII; truncamento >200 explícito; `runtimeCaching: NONE`.
- Erros `PED10/PED11/PED12/PED46/PED47/PED48/PED79` mapeados com mensagens seguras.

## 8. Classificação de incidentes do piloto

- **P0 — CRÍTICO:** cross-tenant; bypass de autorização; exposição de secret; perda/corrupção
  significativa de pedidos; duplicação real de operação crítica; indisponibilidade operacional severa
  sem alternativa. Resposta: STOP PILOT para a superfície afetada + escalonamento imediato.
- **P1 — HIGH / PILOT BLOCKER:** pedido não chega à operação; status incorreto persistente; KDS
  inutilizável; impressão essencial indisponível; offline gera operação insegura; PII indevida;
  problema grave de RBAC. Resposta: interromper fluxo afetado; avaliar rollback/hotfix; não expandir piloto.
- **P2 — MEDIUM:** problema reproduzível com workaround seguro; inconsistência operacional relevante;
  UX que aumenta risco de erro sem bloquear totalmente. Resposta: registrar; priorizar; decidir
  correção durante ou após a janela operacional.
- **P3 — LOW / OBSERVAÇÃO:** cosmético; preferência; melhoria; refinamento não bloqueador. Resposta:
  registrar para backlog; não interromper piloto.

## 9. Condições de STOP PILOT

**Interrupção imediata** se houver: qualquer P0; evidência de cross-tenant; vazamento relevante de
PII; exposição de credencial; corrupção de pedido; duplicação sistemática de pedidos; mutation
crítica insegura; perda de rastreabilidade operacional; defeito que possa causar operação comercial
incorreta relevante.

**Avaliar pausa** para: P1 repetitivo; indisponibilidade persistente; falha generalizada de
Realtime + polling; KDS indisponível; impressão obrigatória indisponível sem workaround; regressão
após hotfix.

**Não interromper todo o piloto automaticamente por:** P3; problema cosmético; solicitação de nova
feature; preferência individual.

## 10. Papéis de governança

Sem inventar pessoas. Usar placeholders até que nomes reais sejam documentados.

- **PILOT OWNER:** responsável pela decisão de continuidade. `[placeholder]`
- **TECHNICAL OWNER:** responsável por análise técnica. `[placeholder]`
- **ESTABLISHMENT OWNER:** responsável operacional no estabelecimento. `[placeholder]`
- **SUPPORT CONTACT:** canal principal de suporte. `[placeholder]`
- **INCIDENT OWNER:** responsável por acompanhar finding até encerramento. `[placeholder]`

## 11. Indicadores do piloto

Conjunto pequeno e útil, separado em cinco grupos:

- **A. INTEGRIDADE:** pedidos perdidos; pedidos duplicados; cross-tenant; erros de status; erros
  críticos. Meta desejada: `ZERO` para eventos críticos.
- **B. OPERAÇÃO:** pedidos criados; pedidos concluídos; cancelamentos; falhas de mutation;
  ocorrências de fallback; problemas de impressão; incidentes operacionais.
- **C. ESTABILIDADE:** falhas observadas; eventos Realtime degradado relevantes; períodos offline;
  necessidade de intervenção manual; regressões após alteração.
- **D. SUPORTE:** número de chamados; severidade; tempo até triagem; recorrência; causa raiz.
- **E. USABILIDADE:** feedback estruturado sobre Central, KDS, alertas, impressão e fluxo geral.

NÃO inventar SLA de produção nesta fase: o piloto ainda não possui volume estatístico suficiente
para validar SLA definitivo.

## 12. Processo de hotfix durante o piloto

Quando houver finding que exija código:

1. registrar incidente; 2. classificar severidade; 3. reproduzir; 4. identificar causa raiz;
5. definir a menor correção; 6. adicionar teste; 7. executar gates locais permitidos; 8. commit;
9. push; 10. CI completo; 11. homologar novo SHA; 12. registrar mudança de baseline; 13. somente
então retomar/expandir operação.

Nunca aplicar correção não rastreável diretamente em produção.

## 13. Daily Pilot Check

Modelo curto para operação diária (usado somente na Parte 3):

```text
PILOT DAILY CHECK
Data:
Release SHA:
Estabelecimentos ativos:
Pedidos observados:
P0:  P1:  P2:  P3:
Cross-tenant: NONE / FINDING
Pedidos perdidos: 0 / FINDING
Pedidos duplicados: 0 / FINDING
KDS: OK / FINDING
Realtime: OK / DEGRADED / FINDING
Polling fallback: OK / FINDING
Print: OK / N/A / FINDING
Suporte: resumo
DECISÃO DO DIA: CONTINUE / CONTINUE_WITH_FINDINGS / PAUSE / STOP
```

## 14. Evidence Register

Modelo de registro de evidências do piloto. Não registrar PII desnecessária (seção 17).

| Campo | Valor |
| --- | --- |
| PILOT-ID | `PLT-001` |
| Estabelecimento | `[estabelecimento id]` |
| Unidade | `[unit id]` |
| Data/hora | `YYYY-MM-DDTHH:MM` |
| Release SHA | `[sha]` |
| Área | checkout / pedidos / KDS / realtime / offline / impressão / catálogo / autenticação / equipe / outro |
| Evento | descrição curta |
| Resultado esperado | ... |
| Resultado observado | ... |
| Severidade | P0 / P1 / P2 / P3 |
| Reproduzível | YES / NO |
| Workaround | YES / NO |
| Finding relacionado | `[id]` |
| Commit relacionado | `[sha]` |
| CI relacionado | `[run id]` |
| Status | OPEN / MITIGATED / FIXED / ACCEPTED / CLOSED |

## 15. Privacidade e dados

Minimização obrigatória nos documentos de acompanhamento do piloto. NÃO incluir: CPF; telefone
integral; endereço de cliente; dados de pagamento; códigos de vouchers; tokens; secrets;
credenciais; payloads completos com PII. Usar quando necessário: IDs internos; order number;
PILOT-ID; unit ID; timestamps; dados operacionais mínimos.

## 16. Critérios de saída do piloto

- **GO:** zero P0 aberto; zero P1 aberto; nenhum cross-tenant; nenhum vazamento relevante; nenhum
  problema sistêmico de pedido; operação básica comprovada; suporte administrável; feedback
  operacional satisfatório; Release Candidate estável.
- **GO_WITH_FINDINGS:** apenas P2/P3 não bloqueadores; workaround seguro; nenhuma ameaça à
  integridade; nenhum risco de tenant; plano claro para correção.
- **NO_GO:** P0; P1 não resolvido; instabilidade operacional séria; risco de perda/corrupção;
  isolamento inadequado; segurança inadequada; fluxo essencial inviável.

Regras preparatórias — a decisão real ocorre somente ao fim do piloto (Parte 3).

## 17. Change freeze

Durante o piloto: NÃO iniciar Prompt 14; NÃO incluir novas features, analytics novos, billing,
novas integrações, app mobile, novos módulos, refactor amplo, redesign, mudanças de loyalty fora de
finding, melhorias cosméticas não críticas. Solicitações dos participantes são classificadas como
`BUG` / `PILOT FINDING` / `FEATURE REQUEST` / `UX FEEDBACK`. FEATURE REQUEST não deve
automaticamente virar alteração durante o piloto.

## 18. Próximo passo

Parte 2 — `SELEÇÃO CONTROLADA + ONBOARDING` (somente após aprovação humana explícita deste relatório).
Parte 3 — `PILOT OPERATION` (Daily Pilot Check, Evidence Register, decisão de saída).
