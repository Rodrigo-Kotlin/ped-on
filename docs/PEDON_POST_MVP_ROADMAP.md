# PED-ON — Roadmap Pós-Core MVP

> Roadmap oficial de evolução pós-MVP do Ped-On. Documento de planejamento; não representa
> compromisso automático de execução das etapas listadas.

## 1. Contexto

- Prompts 00–10 compõem o Core MVP concluído (STATUS `COMPLETED`, checkpoint `RELEASE_VERIFIED`).
- O Core termina funcionalmente em recompensa/voucher: proprietário → organização → unidade →
  catálogo → publicação → cardápio público → carrinho → checkout → pedido idempotente → Central de
  Pedidos → conclusão → fidelidade → pontos → recompensa → voucher.
- As fases seguintes são evolução pós-MVP.
- Prompts 14+ podem ser reordenados após evidência dos pilotos.
- Nenhuma fase futura pode violar os invariantes arquiteturais já aprovados em
  `docs/PEDON_PROJECT_BASELINE.md`.
- PostgreSQL/Supabase continua a fonte da verdade.
- `organization_id` continua o tenant.
- `unit_id` continua o escopo operacional.
- Ped-On continua sem intermediação financeira.

# FASE 4A — PILOT READY

Objetivo: transformar o Core MVP validado em um produto adequado para operação controlada com os
primeiros restaurantes reais.

## Prompt 11 — Pilot Readiness, Observabilidade e Product Hardening

Estado: `COMPLETED / RELEASE_VERIFIED`. Reauditoria independente concluída com
`GO_WITH_NON_BLOCKING_FINDINGS` (CRITICAL 0, HIGH 0, MEDIUM BLOCKING 0) sobre o HEAD auditado
`3a6cd42eab24719e01505fc854d03c65ca9d9975`, CI `31713901328` e Cloudflare
`https://8f7d42fd.ped-on.pages.dev` convergentes. Marco `PILOT_READY` alcançado.

Objetivos:

- readiness operacional;
- dashboard/checklist de implantação;
- gestão de acesso às unidades;
- observabilidade mínima para suporte ao piloto;
- diagnóstico;
- UX de erro/loading/offline;
- acessibilidade;
- PWA hardening;
- redução do bundle;
- limpeza de dívida técnica segura;
- preparação para piloto.

Critério alcançado: `PILOT_READY`. O `ready=true` calculado para uma organização não substitui os
gates de release do projeto.

## Prompt 12 — Produtos, Variações e Adicionais

Estado: `IN PROGRESS` — checkpoint `READY_FOR_REAUDIT`. As Etapas 3–5 e as remediations A/B1/B2/C
estão implementadas e verificadas; a primeira reauditoria independente retornou NO_GO e o release foi
reconvergido no HEAD técnico `f663cecb96ef87f397376e29aee82cd24ba846df` (CI `31814657987` SUCCESS nos
três jobs; migrations 22/22; DB 1409/1409; Edge 15/15; frontend 383/383; E2E 345/345 com 3 skips
móveis intencionais). Falta a reauditoria independente final. Não declarar `MENU_COMMERCIALLY_USABLE`
nem iniciar Prompt 13 antes do parecer.

Objetivos:

- grupos de opções;
- variações;
- adicionais;
- remoções;
- min/max;
- seleção única/múltipla;
- preço adicional;
- snapshots corretos no pedido.

Concluído na Etapa 3 (admin): criação/edição/desativação de grupos e opções, regras por `kind`
(`variation` de escolha única, obrigatória somente se `min_select > 0`; `removal` múltipla sem
preço), `price_delta` decimal exato, operator somente disponibilidade, offline pausa mutações.

Backend da Etapa 4 entregue na migration 20: snapshot de grupos/opções na publicação
(`menu_version_option_groups`/`menu_version_options`), validação de seleção no checkout com
`PED72..PED78`, `unit_price = base + SUM(price_delta)` e `order_item_options` (snapshot por linha).
O cardápio público, carrinho configurável, checkout por IDs, tracking e detalhe administrativo estão
integrados. A migration 21 fecha os blockers de `single`, coerência publicação/mutação e corrida de
disponibilidade; a migration 22 (Remediation A) serializa a publicação com writers estruturais via
lock unit-scoped, exige regras satisfazíveis (PED73) e vincula `order_item_options` relacionalmente.
Notas livres do item permanecem somente em memória (sanitização global de carrinhos legados no
bootstrap) e o recovery ambíguo de voucher mantém a lease crítica PWA até a conclusão.

Critério pendente de reauditoria: `MENU_COMMERCIALLY_USABLE`.

## Prompt 13 — Operação de Pedidos 2.0

Objetivos:

- Central de Pedidos avançada;
- filtros;
- tempos operacionais;
- destaque de pedidos;
- Kitchen Display;
- impressão térmica/browser;
- alertas;
- operação otimizada em tablet/desktop.

Critério: `OPERATION_READY`.

# PILOT GATE

Após o Prompt 13, não avançar automaticamente para o Prompt 14.

Executar o PILOT GATE com aproximadamente 3–5 estabelecimentos controlados.

Medir:

- tempo de onboarding;
- publicação do primeiro cardápio;
- menu → checkout;
- abandono de checkout;
- taxa de erro;
- tempo de aceite;
- tempo de preparo;
- cancelamentos;
- suporte necessário;
- adesão ao Clube;
- resgates;
- estabilidade;
- performance;
- experiência mobile/desktop.

O resultado do piloto pode alterar a prioridade dos Prompts 14+.

# FASE 5 — COMMERCIAL READY

## Prompt 14 — Dashboard e Relatórios Essenciais

- pedidos;
- faturamento operacional registrado;
- ticket médio;
- modalidades;
- formas de pagamento;
- cancelamentos;
- produtos mais vendidos;
- indicadores do Clube;
- períodos e comparativos.

Critério: `MANAGEMENT_READY`.

## Prompt 15 — CRM e Inteligência de Clientes

- customer view;
- frequência;
- histórico;
- ticket;
- recorrência;
- Clube;
- segmentos simples;
- LGPD/minimização.

Critério: `CUSTOMER_INTELLIGENCE_READY`.

## Prompt 16 — Notificações e WhatsApp

Arquitetura:

```
order/domain event → notification queue → provider
```

- Falha da notificação nunca invalida o pedido.

Critério: `CUSTOMER_COMMUNICATION_READY`.

## Prompt 17 — Administração SaaS, Planos e Backoffice Ped-On

- platform admin;
- tenants;
- unidades;
- planos;
- status;
- uso;
- suporte;
- bloqueio;
- auditoria;
- billing state inicialmente manual.

Critério: `COMMERCIAL_SAAS_READY`.

# FASE 6 — GROWTH & AUTOMATION

## Prompt 18 — Campanhas do Clube

- pontos em dobro;
- bônus;
- período;
- unidade;
- produtos elegíveis;
- segmentos.

- Ledger continua append-only.

## Prompt 19 — Cupons e Promoções

Separar claramente:

- `voucher de recompensa` ≠ `cupom promocional`.

Adicionar posteriormente:

- percentual;
- valor fixo;
- frete;
- produto;
- mínimo;
- validade;
- limites.

## Prompt 20 — Pagamentos Digitais

Princípio obrigatório: o restaurante recebe diretamente pelo PSP/adquirente.

Ped-On NÃO:

- custodia;
- faz split;
- repassa;
- mantém wallet;
- mantém saldo financeiro.

Ped-On apenas integra estados/webhooks de pagamentos externos.

## Prompt 21 — Zonas e Regras de Entrega

- bairros;
- CEP;
- raio;
- polígonos;
- tarifas;
- mínimo;
- ETA;
- indisponibilidade;
- frete grátis.

Sem roteirização nesta etapa.

# FASE 7 — SCALE & ECOSYSTEM

Planejamento futuro:

- Prompt 22 — Estoque e disponibilidade;
- Prompt 23 — Integrações fiscais;
- Prompt 24 — POS/ERP/API/Webhooks;
- Prompt 25 — Entregadores;
- Prompt 26 — Roteirização;
- Prompt 27 — Inteligência Artificial.

Esses prompts NÃO estão comprometidos para execução imediata. Devem ser reavaliados conforme uso
real e estratégia comercial.

# Marcos do produto

```
Core MVP — COMPLETED
↓ Pilot Ready — ACHIEVED (Prompt 11)
↓ Operation Ready
↓ Pilot Gate
↓ Commercial Ready
↓ Primeiros clientes pagantes
↓ Growth
↓ Scale
```
