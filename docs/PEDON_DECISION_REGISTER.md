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

## Decisões em Aberto (OPEN)

Nenhuma decisão em aberto neste momento.
