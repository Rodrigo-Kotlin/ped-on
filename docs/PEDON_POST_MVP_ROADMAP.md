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

Estado: `READY_FOR_REAUDIT`. O HEAD técnico
`925f7d94adea4c0c2cef9a1017270269960817aa` possui CI, backend isolado, E2E, Supabase e Cloudflare
convergentes. Este checkpoint não declara automaticamente `PILOT_READY`.

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

Critério futuro: `PILOT_READY`. O `ready=true` calculado para uma organização não substitui os gates
de release do projeto.

## Prompt 12 — Produtos, Variações e Adicionais

Estado: `NOT STARTED`.

Objetivos:

- grupos de opções;
- variações;
- adicionais;
- remoções;
- min/max;
- seleção única/múltipla;
- preço adicional;
- snapshots corretos no pedido.

Critério: `MENU_COMMERCIALLY_USABLE`.

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
↓ Pilot Ready
↓ Operation Ready
↓ Pilot Gate
↓ Commercial Ready
↓ Primeiros clientes pagantes
↓ Growth
↓ Scale
```
