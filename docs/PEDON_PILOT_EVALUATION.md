# PED-ON — Avaliação de Candidatos do Piloto

> Modelo de avaliação da Parte 2A/2B do PILOT GATE. Fonte normativa:
> `docs/PEDON_PILOT_GATE.md` (seções 3, 4, 5, 6 e 10) e `DEC-126`. Não recria regras novas.
>
> Regra operacional: trabalhar SOMENTE com candidatos fornecidos pelo responsável humano. Não
> procurar, escolher, contatar ou criar leads de empresas reais por conta própria. Não enviar
> mensagens.

## 1. Uso

- Uma ficha por candidato fornecido. Identificar por `PILOT-P01`, `PILOT-P02`, ... (sem PII
  desnecessária no Git).
- Avaliar cada critério como `PASS` / `CONDITIONAL` / `FAIL`.
- Requisitos separados em `MANDATORY` e `DESIRABLE` (matriz da seção 4.1 de `PEDON_PILOT_GATE.md`).
- NÃO inventar pontuação complexa não documentada. A avaliação é qualitativa por critério.

## 2. Classificação final

- `ELIGIBLE`
- `ELIGIBLE_WITH_CONDITIONS`
- `NOT_ELIGIBLE_NOW`

`NOT_ELIGIBLE_NOW` quando houver pelo menos um bloqueador MANDATORY (seção 4).

## 3. Perfil de diversidade controlada

| Participante | Perfil esperado |
| --- | --- |
| PILOT-P01 | simples/controlado |
| PILOT-P02 | intermediário |
| PILOT-P03 | volume ou complexidade moderadamente superior |
| PILOT-P04 | somente após evidência suficiente nos primeiros |
| PILOT-P05 | somente após evidência suficiente nos primeiros |

Não é obrigatório atingir 5. O piloto pode começar com 1 e expandir progressivamente até
aproximadamente 3–5.

## 4. Bloqueadores (qualquer um destes ⇒ `NOT_ELIGIBLE_NOW` ou condição crítica)

- sem responsável operacional identificado;
- impossibilidade de treinamento;
- infraestrutura incompatível (equipamento/navegador/internet);
- operação muito complexa para a primeira validação;
- exigência de feature ainda inexistente;
- dependência crítica externa não suportada.

## 5. Ficha do candidato

```text
FICHA DE AVALIAÇÃO
PILOT ID:      PILOT-P0X
Identificação: <nome/identificador fornecido pelo responsável humano>
Perfil alvo:   SIMPLES / INTERMEDIÁRIO / MODERADO
Data:          YYYY-MM-DD
```

| Critério | Tipo | Avaliação | Observação |
| --- | --- | --- | --- |
| Operação de delivery | MANDATORY | | |
| Operação de retirada/pickup | DESIRABLE | | |
| Volume de pedidos baixo a médio | MANDATORY | | |
| Funcionários operacionais 1–3 na operação | MANDATORY | | |
| Quantidade de unidades (1 no início) | MANDATORY | | |
| Maturidade digital básica | MANDATORY | | |
| Internet estável | MANDATORY | | |
| Computador/tablet disponível | MANDATORY | | |
| Navegador atualizado (Chromium/Firefox) | MANDATORY | | |
| Impressora (quando a comanda for usada) | DESIRABLE | | |
| Disponibilidade real para treinamento | MANDATORY | | |
| Responsável operacional identificado | MANDATORY | | |
| Cardápio minimamente estruturado | MANDATORY | | |
| Formas de pagamento conhecidas | MANDATORY | | |
| Horário de funcionamento definido | MANDATORY | | |
| Disposição para piloto controlado confirmada | MANDATORY | | |

Dados contextuais complementares (sem PII desnecessária):

- tipo de operação (retirada/delivery/misto);
- volume aproximado de pedidos;
- número de usuários operacionais e perfis (OWNER/MANAGER/OPERATOR/COZINHA);
- maturidade digital e estabilidade de internet;
- computador/tablet principal e navegador;
- impressão (usada ou não);
- disponibilidade para treinamento e feedback;
- cardápio disponível e formas de pagamento utilizadas;
- horário de operação;
- complexidade operacional e riscos específicos.

## 6. Saída da avaliação

```text
CONDITIONS: ...
RISKS: ...
RECOMMENDATION: APPROVE / DO_NOT_APPROVE
```

Aprovação do primeiro participante exige autorização humana explícita:

`APPROVE PARTICIPANT 01`

## 7. Avaliação registrada — PILOT-P01 (Mr. Burger — Oriximiná/PA)

Ficha preenchida com dados fornecidos pelo responsável humano em 2026-08-16. Sem PII
(telefone/CPF/e-mail/endereço pessoal) na documentação.

```text
FICHA DE AVALIAÇÃO
PILOT ID:      PILOT-P01
Identificação: Mr. Burger — Oriximiná/PA
Perfil alvo:   SIMPLES/CONTROLADO
Data:          2026-08-16
```

| Critério | Tipo | Avaliação | Observação |
| --- | --- | --- | --- |
| Operação de delivery | MANDATORY | PASS | informado |
| Operação de retirada/pickup | DESIRABLE | PASS | informado |
| Volume de pedidos baixo a médio | MANDATORY | PASS | aproximadamente 70 pedidos/dia |
| Funcionários operacionais 1–3 na operação | MANDATORY | PASS | 6 usuários operacionais; cobertura de turno satisfeita |
| Quantidade de unidades (1 no início) | MANDATORY | PASS | 1 unidade |
| Maturidade digital básica | MANDATORY | PASS | cardápio já estruturado; uso de computador/smartphones |
| Internet estável | MANDATORY | PASS | informado |
| Computador/tablet disponível | MANDATORY | PASS | computador e smartphones |
| Navegador atualizado (Chromium/Firefox) | MANDATORY | PASS | Chrome |
| Impressora (quando a comanda for usada) | DESIRABLE | CONDITIONAL | POS-58: `INFRASTRUCTURE AVAILABLE`; `PRINT COMPATIBILITY — TO BE VALIDATED` no pedido controlado |
| Disponibilidade real para treinamento | MANDATORY | PASS | disponível |
| Responsável operacional identificado | MANDATORY | PASS | disponível |
| Cardápio minimamente estruturado | MANDATORY | PASS | pronto/estruturado |
| Formas de pagamento conhecidas | MANDATORY | PASS | Pix, crédito, débito, dinheiro — dentro dos fluxos suportados |
| Horário de funcionamento definido | MANDATORY | PASS | 18h00 às 23h59; folga segunda-feira |
| Disposição para piloto controlado confirmada | MANDATORY | PASS | candidato informado pelo responsável; treinamento e feedback disponíveis |

Dados contextuais complementares:

- tipo de operação: delivery + retirada (+ presencial em mesas — `OUT OF SCOPE FOR FIRST PILOT CYCLE`);
- volume aproximado: ~70 pedidos/dia;
- usuários operacionais: ~6 + equipe de cozinha 8 (perfis RBAC a definir no onboarding);
- infraestrutura: computador, smartphones, internet estável, Chrome;
- impressão: POS-58 presente; compatibilidade operacional a validar;
- pagamentos: Pix, crédito, débito, dinheiro;
- horário: 18h00–23h59, folga segunda-feira;
- integrações externas obrigatórias: nenhuma informada até o momento (não inferir inexistência; avaliar antes da ativação caso alguma seja descoberta).

Bloqueadores (seção 4): nenhum.

### Classificação e saída

```text
ELIGIBILITY: ELIGIBLE
COMPLEXITY:  CONTROLLED / SUITABLE FOR FIRST PARTICIPANT
RISK:        LOW TO MODERATE

CONDITIONS:
1. atendimento em mesas permanece fora do primeiro ciclo;
2. POS-58 deve ser homologada no pedido controlado;
3. nenhuma feature nova será criada para entrada no piloto;
4. eventual integração externa obrigatória descoberta deverá ser avaliada antes da ativação;
5. onboarding ocorrerá somente após autorização humana explícita.

RISKS:
- compatibilidade de impressão POS-58 ainda não validada (validar na Parte 2D);
- integrações externas obrigatórias não informadas até o momento;
- volume concentrado na janela 18h00–23h59 (picos possíveis);
- equipe de 14 pessoas (operação + cozinha) exige distribuição correta de perfis RBAC;
- mesas fora do escopo inicial — necessidade de alinhamento de expectativa no treinamento.

RECOMMENDATION: APPROVE AS PILOT-P01
```

Escopo inicial do PILOT-P01:

- IN SCOPE: cardápio público; configuração de produtos suportada; carrinho; checkout; delivery;
  retirada; Pix; crédito; débito; dinheiro; Central de Pedidos; alertas operacionais; KDS; fluxo de
  status; impressão; reimpressão quando aplicável; operação com usuários autorizados.
- OUT OF SCOPE: atendimento em mesas; gestão de mesas; comandas presenciais específicas; qualquer
  feature ainda inexistente; novas integrações; Prompt 14.
- MESAS: `OUT OF SCOPE FOR FIRST PILOT CYCLE`.
