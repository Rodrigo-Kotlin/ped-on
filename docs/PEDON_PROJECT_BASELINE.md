# PED-ON — Project Baseline

> Memória técnica oficial do projeto.
> Todo trabalho futuro deve ler este documento e os demais documentos de continuidade antes de qualquer alteração.

## 1. Identidade do Produto

| Campo | Valor |
|---|---|
| Nome comercial | Ped-On |
| Slogan | Gestão de Pedidos Inteligente |
| Tipo | PWA SaaS multiempresa para restaurantes, hamburguerias, lanchonetes e estabelecimentos semelhantes |
| Moeda oficial | BRL |

## 2. Objetivo do Core MVP

Construir um fluxo funcional completo, no seguinte encadeamento:

```
proprietário
→ organização
→ unidade
→ catálogo
→ publicação
→ cardápio público
→ carrinho
→ checkout
→ pedido idempotente
→ Central de Pedidos
→ conclusão
→ fidelidade
→ pontos
→ recompensa
→ voucher
```

## 3. Princípios Arquiteturais (Invariantes)

Estes princípios são **invariantes** e não podem ser violados:

- PostgreSQL/Supabase é a fonte única da verdade.
- `organization_id` representa o tenant.
- `unit_id` representa o escopo operacional.
- Nenhuma organização acessa dados de outra.
- Acesso entre unidades depende de autorização.
- Frontend nunca utiliza `service_role`.
- Interface escondida não representa autorização.
- RLS deve negar por padrão.
- Valores críticos são calculados no servidor.
- Totais recebidos do navegador não são confiáveis.
- Pedidos e resgates devem ser idempotentes.
- Operações críticas devem ser transacionais.
- Realtime é mecanismo de atualização, não fonte da verdade.
- Ações críticas exigem conexão.
- Nenhuma operação crítica deve simular sucesso offline.
- Ações críticas devem gerar histórico auditável.
- Dados pessoais devem ser minimizados.
- CPF não poderá ser utilizado como senha.
- Nenhum secret pode ser armazenado no Git.
- Acessibilidade e responsividade são requisitos obrigatórios.

## 4. Regra Monetária

- Moeda oficial: BRL.
- Preços exibidos em reais.
- Persistência: `PostgreSQL numeric(12,2)` ou precisão equivalente aprovada.
- Nunca utilizar `float`/`double` para persistência ou cálculo financeiro.
- Cálculos autoritativos no servidor.
- Frontend apenas apresenta valores formatados.
- Valores monetários não serão tratados como "centavos" na UX ou nos contratos funcionais.

## 5. Não Intermediação Financeira

O Ped-On **não**:

- recebe dinheiro em nome do restaurante;
- custodia valores;
- executa split;
- liquida pedidos;
- realiza repasses;
- mantém carteira;
- mantém saldo financeiro;
- oferece saque;
- antecipa recebíveis;
- atua como instituição financeira.

Pode registrar somente **estados e modalidades operacionais** de pagamento externo.

## 6. Escopo — Core MVP

- Autenticação administrativa;
- Organizações;
- Unidades;
- RBAC mínimo;
- Configuração operacional;
- Categorias;
- Produtos simples;
- Preços em reais;
- Menu versionado;
- Publicação;
- Cardápio público;
- Carrinho;
- Checkout;
- Pedidos;
- Idempotência;
- Central de Pedidos;
- Realtime;
- Clientes;
- Clube Ped-On;
- CPF protegido;
- Ledger de pontos;
- Extrato;
- Recompensas;
- Vouchers;
- PWA;
- RLS;
- Auditoria básica;
- Testes;
- CI/CD;
- Observabilidade essencial.

## 7. Fora do Core MVP

- Pagamentos digitais;
- Carteira financeira;
- Split;
- Repasses;
- Marketplace;
- Entregadores;
- Roteirização;
- Cálculo avançado de frete;
- Caixa/POS;
- Relatórios avançados;
- Variantes complexas;
- Adicionais complexos;
- WhatsApp;
- Integrações fiscais;
- Inteligência artificial;
- Assinatura SaaS automatizada;
- Campanhas avançadas;
- Multiplicadores avançados;
- Níveis complexos de fidelidade.

## 8. Branding Base

Fundação inicial da identidade visual (apenas documentação nesta fase).

| Token | Cor |
|---|---|
| Navy principal | `#081B2E` |
| Laranja principal | `#FB5904` |
| Laranja secundário | `#FD8317` |
| Fundo neutro inicial | `#F5F7F9` |
| Texto principal | `#101827` |

Regras de branding nesta fase:

- Não implementar ainda o design system completo.
- Não inventar novas cores de marca sem necessidade.
- Não alterar a identidade visual oficial sem decisão registrada no `PEDON_DECISION_REGISTER.md`.

## 9. Convenções Oficiais

| Item | Convenção |
|---|---|
| Nome comercial | Ped-On |
| Nome do repositório | `ped-on` |
| Namespace interno | `pedon` |
| Banco PostgreSQL | `snake_case` |
| TypeScript | `camelCase` para variáveis/funções; `PascalCase` para componentes/tipos/classes quando aplicável |
| Arquivos React | convenção consistente a ser documentada (definida em etapa posterior) |
| Migrations | timestamp + descrição objetiva |
| Commits | pequenos, atômicos e descritivos |

## 10. Stack Planejada

- TypeScript estrito;
- pnpm + pnpm workspaces;
- Arquitetura modular (monorepo);
- Git + GitHub;
- Cloudflare Pages;
- Supabase (PostgreSQL + RLS);
- PWA;
- Documentação versionada junto ao código.
