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
