# PILOT-P01 — CATALOG DATA PACK + FINAL CATALOG MAPPING

> PILOT GATE — PARTE 2C-R3
> Mr. Burger — Oriximiná/PA
> MODO: DOCS / READ_ONLY / HUMAN-GATED
> REMOTE WRITES: NOT AUTHORIZED
> Executado: 2026-08-17

---

## A. PRECHECK

| Campo | Resultado |
| --- | --- |
| Branch | `main` |
| HEAD | `92a72bafd1a465e5259b773122bb6baaa86e4e8f` |
| origin/main | `92a72bafd1a465e5259b773122bb6baaa86e4e8f` |
| HEAD == origin/main | YES |
| Working tree | clean |
| Ultimo commit | `docs(pilot): record DEC-127 production deployment (DEC-128, Parte 2C-R1)` |
| Historico contem DEC-127 | YES |
| Historico contem Parte 2C-R1 | YES |
| Historico contem deployment production | YES |

**PRECHECK: PASS**

---

## B. CATALOG MODEL AUDIT

### B.1 Arquitetura

O catalogo usa arquitetura **dual-layer**:

- **Camada mutavel** (`catalog_*`): fonte de verdade editavel pelo admin
- **Camada imutavel** (`menu_version_*`): snapshot congelado no publish
- Todas as mutacoes via **RPCs PostgreSQL** (`SECURITY DEFINER`, `search_path=''`)
- Todos os valores monetarios: `numeric(12, 2)` — nunca float
- Multi-tenant com composite FK `(organization_id, unit_id, ...)`
- RLS habilitado com SELECT-only policies para `authenticated`

### B.2 Entidades do Catalogo

| Entidade | Tabela | Colunas-chave | Suportado? |
| --- | --- | --- | --- |
| CATEGORY | `catalog_categories` | id, name (1-80), sort_order, is_active | YES |
| PRODUCT | `catalog_products` | id, name (1-120), description (null/1-500), price (numeric(12,2), >0), sort_order, is_active, is_available | YES |
| OPTION GROUP | `catalog_product_option_groups` | id, name (1-80), kind, selection_mode, min_select, max_select, is_active, sort_order | YES |
| OPTION | `catalog_product_options` | id, name (1-80), price_delta (numeric(12,2)), is_active, is_available, sort_order | YES |
| PRICE | embutido em `catalog_products.price` e `catalog_product_options.price_delta` | — | YES |
| AVAILABILITY | `is_active` (estrutural) + `is_available` (operacional) | — | YES |
| VARIATION | `kind = 'variation'`, `selection_mode = 'single'`, `max_select = 1` | — | YES |
| ADDON | `kind = 'addon'`, qualquer mode, `price_delta >= 0` | — | YES |
| REMOVAL | `kind = 'removal'`, `selection_mode = 'multiple'`, `min_select = 0`, `price_delta = 0` | — | YES |
| PUBLICATION | `menu_versions` + `menu_version_*` + `menu_publications` | — | YES |

### B.3 Regras de Option Groups

| Kind | selection_mode | min_select | max_select | price_delta |
| --- | --- | --- | --- | --- |
| `variation` | `single` (forcado) | >= 0 | **= 1** (forcado) | Qualquer sinal (desconto permitido) |
| `addon` | `single` ou `multiple` | >= 0 | <= 50, >= min | **>= 0** (sem desconto) |
| `removal` | `multiple` (forcado) | **= 0** (forcado) | <= 50 | **= 0** (exato) |

### B.4 RPCs Disponiveis

**Catalogo base:**
- `get_unit_catalog_admin(unit_id)` — leitura
- `create_catalog_category(unit_id, name)` — cria categoria
- `update_catalog_category(category_id, name)` — renomeia
- `set_catalog_category_active(category_id, is_active)` — toggle
- `create_catalog_product(unit_id, category_id, name, description, price)` — cria produto
- `update_catalog_product(product_id, category_id, name, description, price)` — edita/move
- `set_catalog_product_active(product_id, is_active)` — toggle estrutural
- `set_catalog_product_available(product_id, is_available)` — toggle operacional

**Option groups:**
- `create_catalog_product_option_group(product_id, unit_id, name, kind, selection_mode, min, max)`
- `update_catalog_product_option_group(group_id, name, kind, selection_mode, min, max)`
- `set_catalog_product_option_group_active(group_id, is_active)`

**Options:**
- `create_catalog_product_option(group_id, name, price_delta)`
- `update_catalog_option(option_id, name, price_delta)`
- `set_catalog_product_option_active(option_id, is_active)`
- `set_catalog_product_option_available(option_id, is_available)`

**Publicacao:**
- `publish_unit_menu(unit_id)` — cria snapshot imutavel
- `get_unit_menu_publication_admin(unit_id)` — status
- `get_public_menu(slug)` — menu publico

### B.5 Migracoes Relacionadas

| # | Migracao | Escopo |
| --- | --- | --- |
| 6 | `20260810122401_catalog_base.sql` | categorias, produtos, 8 RPCs, RLS, locking |
| 7 | `20260810135051_menu_versioning_publication.sql` | versions, snapshots, publications |
| 8 | `20260810141000_menu_publication_slug_fix.sql` | fix slug |
| 20 | `20260814000000_prompt12_product_options.sql` | option groups, options, snapshots, 7 RPCs |
| 21 | `20260814010000_prompt12_final_hardening.sql` | single=>max=1, locks, live guard |
| 22 | `20260814020000_prompt12_remediation_a_hardening.sql` | unit lock, HIGH-1, HIGH-2 |
| 23 | `20260814100000_prompt13_backend_operational_core.sql` | orders v2, KDS |

### B.6 Testes

| Arquivo | Tipo | Status |
| --- | --- | --- |
| `supabase/tests/catalog_integrity.test.mjs` | DB integration | 123 PASS |
| `supabase/tests/product_options_integrity.test.mjs` | DB integration | 158 PASS |
| `supabase/tests/product_options_remediation_integrity.test.mjs` | DB integration | 65 PASS |
| `apps/web/src/lib/catalog/product-options.test.ts` | Vitest unit | PASS |
| `apps/web/src/components/catalog/option-groups-panel.test.tsx` | Vitest component | PASS |
| `apps/web/src/lib/menu/option-selection.test.ts` | Vitest unit | PASS |
| `apps/web/e2e/catalog.spec.ts` | Playwright E2E | PASS |
| `apps/web/e2e/prompt12-product-options.spec.ts` | Playwright E2E | PASS |

### B.7 Conclusao do Model Audit

O modelo existente e **suficiente** para representar todo o cardapio do Mr. Burger com:
- 4 categorias
- 49 produtos
- Variacoes (single-choice com preco diferenciado)
- Adicionais (com price_delta)
- Remocoes (com price_delta = 0)

**Nenhuma feature nova necessaria. Nenhuma abstracao inventada.**

---

## C. CATEGORY MAPPING

| # | sort_order | Nome | Produtos |
| --- | --- | --- | --- |
| 1 | 100 | TRADICIONAIS | 10 |
| 2 | 200 | ARTESANAIS | 14 |
| 3 | 300 | PORCOES | 10 |
| 4 | 400 | BEBIDAS | 15 |

**TOTAL CATEGORIES: 4**

---

## D. TRADITIONAL PRODUCTS (TRADICIONAIS)

| # | sort | id | Nome | Preco (R$) | centavos | Descricao | Obs | HC? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | T01 | Espoca Bode | 11,00 | 1100 | pao com molho, ovo, mortadela, picadinho, salada e batata-palha | nao acompanha molho na mesa | NO |
| 2 | 200 | T02 | Queijo Quente | 10,00 | 1000 | NAO INFORMADA | — | YES |
| 3 | 300 | T03 | Misto Quente | 10,00 | 1000 | NAO INFORMADA | — | YES |
| 4 | 400 | T04 | Hamburguer | 13,00 | 1300 | pao com molho, carne tradicional, apresuntado, salada e batata-palha | nao acompanha molho na mesa | NO |
| 5 | 500 | T05 | X-Burguer | 14,00 | 1400 | pao com molho, carne tradicional, queijo, apresuntado, salada e batata-palha | nao acompanha molho na mesa | NO |
| 6 | 600 | T06 | X-Salada | 16,00 | 1600 | pao tradicional, carne tradicional, ovo, queijo, apresuntado, salada e batata-palha | — | NO |
| 7 | 700 | T07 | X-Salsicha | 16,00 | 1600 | pao tradicional, ovo, queijo, apresuntado, salsicha, salada e batata-palha | — | NO |
| 8 | 800 | T08 | X-Calabresa | 16,00 | 1600 | pao tradicional, ovo, queijo, apresuntado, calabresa, salada e batata-palha | — | NO |
| 9 | 900 | T09 | X-Bacon Trad. | 18,00 | 1800 | pao tradicional, ovo, queijo, apresuntado, bacon, salada e batata-palha | — | NO |
| 10 | 1000 | T10 | X-Bacon c/ Calab. | 22,00 | 2200 | pao tradicional, ovo, queijo, apresuntado, bacon, calabresa, salada e batata-palha | — | NO |

**TOTAL TRADICIONAIS: 10**

---

## E. ARTISAN PRODUCTS (ARTESANAIS)

| # | sort | id | Nome | Preco (R$) | centavos | Descricao | HC? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | A01 | Hamburguer | 17,00 | 1700 | pao com gergelim, carne artesanal, apresuntado, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 2 | 200 | A02 | Burger Kids | 18,00 | 1800 | pao com gergelim, carne artesanal, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 3 | 300 | A03 | Mr. Salada | 23,00 | 2300 | pao com gergelim, carne artesanal, apresuntado, queijo, ovo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 4 | 400 | A04 | Mr. Salsicha | 27,00 | 2700 | pao com gergelim, carne artesanal, salsicha, file, apresuntado, molho barbecue, cheddar, batata-palha, salada e pao com molho | YES |
| 5 | 500 | A05 | Mr. Calabresa | 27,00 | 2700 | pao com gergelim, carne artesanal, calabresa, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 6 | 600 | A06 | Mr. Bacon | 27,00 | 2700 | pao com gergelim, carne artesanal, ovo, bacon, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 7 | 700 | A07 | Mr. File | 27,00 | 2700 | pao com gergelim, carne artesanal, ovo, file, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 8 | 800 | A08 | Mr. File c/ Calabresa ou Bacon | 33,00 | 3300 | pao com gergelim, carne artesanal, ovo, file, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | YES |
| 9 | 900 | A09 | Mr. Picanha | 27,00 | 2700 | pao com gergelim, carne artesanal, ovo, picanha, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 10 | 1000 | A10 | Mr. Picanha c/ Calabresa ou Bacon | 33,00 | 3300 | pao com gergelim, carne artesanal, ovo, picanha, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | YES |
| 11 | 1100 | A11 | Mr. Duplo | 31,00 | 3100 | pao com gergelim, 2 carnes artesanais, pao de forma, bacon, calabresa, ovo, apresuntado, queijo, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 12 | 1200 | A12 | Mr. Porrudo | 37,00 | 3700 | pao com gergelim, 3 carnes artesanais, bacon, ovo, apresuntado, molho barbecue, cheddar, batata-palha, salada e pao com molho | NO |
| 13 | 1300 | A13 | Mr. Nordestino | 36,00 | 3600 | NAO IDENTIFICADA NO CARDÁPIO | YES |
| 14 | 1400 | A14 | Mr. Tudo | 45,00 | 4500 | pao com gergelim, salada, batata-palha, molho barbecue, bacon, queijo, apresunto, salsicha, picanha, file, calabresa, 2 paes de forma, ovo, cheddar, carne artesanal e pao com molho | NO |

**TOTAL ARTESANAIS: 14**

---

## F. PORTIONS (PORCOES)

| # | sort | id | Nome | Preco (R$) | centavos | Descricao | Mapeamento | HC? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | P01 | Batata Pequena | 15,00 | 1500 | batata frita porcao pequena | produto-base | NO |
| 2 | 200 | P02 | Batata (P) c/ Bacon | 22,00 | 2200 | batata frita porcao pequena com bacon | produto-base | NO |
| 3 | 300 | P03 | Batata (P) c/ Calabresa | 22,00 | 2200 | batata frita porcao pequena com calabresa | produto-base | NO |
| 4 | 400 | P04 | Batata (G) | 20,00 | 2000 | batata frita porcao grande | produto-base | NO |
| 5 | 500 | P05 | Batata (G) c/ Bacon | 28,00 | 2800 | batata frita porcao grande com bacon | produto-base | NO |
| 6 | 600 | P06 | Batata (G) c/ Calabresa | 28,00 | 2800 | batata frita porcao grande com calabresa | produto-base | NO |
| 7 | 700 | P07 | File c/ Fritas | 23,00 | 2300 | file com fritas | produto-base | NO |
| 8 | 800 | P08 | File c/ Fritas e Bacon | 28,00 | 2800 | file com fritas e bacon | produto-base | NO |
| 9 | 900 | P09 | File c/ Fritas e Calabresa | 28,00 | 2800 | file com fritas e calabresa | produto-base | NO |
| 10 | 1000 | P10 | File c/ Fritas, Bacon e Calabresa | 33,00 | 3300 | file com fritas, bacon e calabresa | produto-base | NO |

**TOTAL PORCOES: 10**

---

## G. BEVERAGES (BEBIDAS)

| # | sort | id | Nome | Preco (R$) | centavos | Descricao | Mapeamento | HC? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | B01 | Suco 300 ml | 7,00 | 700 | suco natural 300ml | produto-base | YES |
| 2 | 200 | B02 | Suco 400 ml | 8,00 | 800 | suco natural 400ml | produto-base | YES |
| 3 | 300 | B03 | Suco 500 ml | 9,00 | 900 | suco natural 500ml | produto-base | YES |
| 4 | 400 | B04 | Suco 1 L | 17,00 | 1700 | suco natural 1 litro | produto-base | YES |
| 5 | 500 | B05 | Coca Lata | 6,00 | 600 | refrigerante coca-cola lata | produto-base | NO |
| 6 | 600 | B06 | Fanta Lata | 6,00 | 600 | refrigerante fanta lata | produto-base | NO |
| 7 | 700 | B07 | Guarana Lata | 6,00 | 600 | refrigerante guarana lata | produto-base | NO |
| 8 | 800 | B08 | Bare 1 L | 8,00 | 800 | refrigerante bare 1 litro | produto-base | NO |
| 9 | 900 | B09 | Guarana 1 L | 9,00 | 900 | refrigerante guarana 1 litro | produto-base | NO |
| 10 | 1000 | B10 | Coca-Cola 1 L | 10,00 | 1000 | refrigerante coca-cola 1 litro | produto-base | NO |
| 11 | 1100 | B11 | Fanta 1 L | 10,00 | 1000 | refrigerante fanta 1 litro | produto-base | NO |
| 12 | 1200 | B12 | Coca-Cola 2 L | 15,00 | 1500 | refrigerante coca-cola 2 litros | produto-base | NO |
| 13 | 1300 | B13 | Fanta 2 L | 15,00 | 1500 | refrigerante fanta 2 litros | produto-base | NO |
| 14 | 1400 | B14 | Agua Mineral 350 ml | 4,00 | 400 | agua mineral 350ml | produto-base | NO |
| 15 | 1500 | B15 | Agua Mineral 500 ml | 5,00 | 500 | agua mineral 500ml | produto-base | NO |

**TOTAL BEBIDAS: 15**

---

## H. ADDONS (ADICIONAIS)

### H.1 Proteinas

| # | id | Nome | Preco (R$) | centavos | Tipo |
| --- | --- | --- | --- | --- | --- |
| 1 | AP01 | Carne artesanal | 7,00 | 700 | addon |
| 2 | AP02 | Carne tradicional | 6,00 | 600 | addon |
| 3 | AP03 | File | 7,00 | 700 | addon |
| 4 | AP04 | Picanha | 7,00 | 700 | addon |
| 5 | AP05 | Calabresa | 7,00 | 700 | addon |
| 6 | AP06 | Bacon | 6,00 | 600 | addon |
| 7 | AP07 | Salsicha | 6,00 | 600 | addon |

### H.2 Complementos

| # | id | Nome | Preco (R$) | centavos | Tipo |
| --- | --- | --- | --- | --- | --- |
| 8 | AC01 | Queijo | 6,00 | 600 | addon |
| 9 | AC02 | Apresuntado | 5,00 | 500 | addon |
| 10 | AC03 | Ovo | 4,00 | 400 | addon |
| 11 | AC04 | Cheddar | 6,00 | 600 | addon |
| 12 | AC05 | Barbecue | 5,00 | 500 | addon |
| 13 | AC06 | Maionese | 7,00 | 700 | addon |
| 14 | AC07 | Katchup | 7,00 | 700 | addon |

**TOTAL ADDONS: 14**

**Nota sobre grafia:** O cardapio usa "KATCHUP". Grafia original preservada. Classificacao: DISPLAY NAME HUMAN CONFIRMATION se houver intencao de corrigir para "KETCHUP".

---

## I. TOTAL BASE PRODUCTS

| Categoria | Quantidade |
| --- | --- |
| TRADICIONAIS | 10 |
| ARTESANAIS | 14 |
| PORCOES | 10 |
| BEBIDAS | 15 |
| **TOTAL BASE** | **49** |
| ADDONS | 14 |
| **TOTAL GERAL** | **63** |

---

## J. PRICE VALIDATION

Todos os precos foram extraidos diretamente do cardapio fornecido. Conversao para centavos (R$ -> integer):

| produto | R$ | centavos | OK? |
| --- | --- | --- | --- |
| Espoca Bode | 11,00 | 1100 | YES |
| Queijo Quente | 10,00 | 1000 | YES |
| Misto Quente | 10,00 | 1000 | YES |
| Hamburguer (trad) | 13,00 | 1300 | YES |
| X-Burguer | 14,00 | 1400 | YES |
| X-Salada | 16,00 | 1600 | YES |
| X-Salsicha | 16,00 | 1600 | YES |
| X-Calabresa | 16,00 | 1600 | YES |
| X-Bacon Trad. | 18,00 | 1800 | YES |
| X-Bacon c/ Calab. | 22,00 | 2200 | YES |
| Hamburguer (art) | 17,00 | 1700 | YES |
| Burger Kids | 18,00 | 1800 | YES |
| Mr. Salada | 23,00 | 2300 | YES |
| Mr. Salsicha | 27,00 | 2700 | YES |
| Mr. Calabresa | 27,00 | 2700 | YES |
| Mr. Bacon | 27,00 | 2700 | YES |
| Mr. File | 27,00 | 2700 | YES |
| Mr. File c/ Cal. ou Bacon | 33,00 | 3300 | YES |
| Mr. Picanha | 27,00 | 2700 | YES |
| Mr. Picanha c/ Cal. ou Bacon | 33,00 | 3300 | YES |
| Mr. Duplo | 31,00 | 3100 | YES |
| Mr. Porrudo | 37,00 | 3700 | YES |
| Mr. Nordestino | 36,00 | 3600 | YES |
| Mr. Tudo | 45,00 | 4500 | YES |
| Batata Pequena | 15,00 | 1500 | YES |
| Batata (P) c/ Bacon | 22,00 | 2200 | YES |
| Batata (P) c/ Calabresa | 22,00 | 2200 | YES |
| Batata (G) | 20,00 | 2000 | YES |
| Batata (G) c/ Bacon | 28,00 | 2800 | YES |
| Batata (G) c/ Calabresa | 28,00 | 2800 | YES |
| File c/ Fritas | 23,00 | 2300 | YES |
| File c/ Fritas e Bacon | 28,00 | 2800 | YES |
| File c/ Fritas e Calabresa | 28,00 | 2800 | YES |
| File c/ Fritas, Bacon e Calabresa | 33,00 | 3300 | YES |
| Suco 300 ml | 7,00 | 700 | YES |
| Suco 400 ml | 8,00 | 800 | YES |
| Suco 500 ml | 9,00 | 900 | YES |
| Suco 1 L | 17,00 | 1700 | YES |
| Coca Lata | 6,00 | 600 | YES |
| Fanta Lata | 6,00 | 600 | YES |
| Guarana Lata | 6,00 | 600 | YES |
| Bare 1 L | 8,00 | 800 | YES |
| Guarana 1 L | 9,00 | 900 | YES |
| Coca-Cola 1 L | 10,00 | 1000 | YES |
| Fanta 1 L | 10,00 | 1000 | YES |
| Coca-Cola 2 L | 15,00 | 1500 | YES |
| Fanta 2 L | 15,00 | 1500 | YES |
| Agua Mineral 350 ml | 4,00 | 400 | YES |
| Agua Mineral 500 ml | 5,00 | 500 | YES |
| Carne artesanal | 7,00 | 700 | YES |
| Carne tradicional | 6,00 | 600 | YES |
| File (adicional) | 7,00 | 700 | YES |
| Picanha | 7,00 | 700 | YES |
| Calabresa | 7,00 | 700 | YES |
| Bacon | 6,00 | 600 | YES |
| Salsicha | 6,00 | 600 | YES |
| Queijo | 6,00 | 600 | YES |
| Apresuntado | 5,00 | 500 | YES |
| Ovo | 4,00 | 400 | YES |
| Cheddar | 6,00 | 600 | YES |
| Barbecue | 5,00 | 500 | YES |
| Maionese | 7,00 | 700 | YES |
| Katchup | 7,00 | 700 | YES |

**PRICE VALIDATION: 63/63 PASS � ZERO ARREDONDAMENTOS, ZERO INFERENCIAS**

---

## K. OPTION GROUP MAPPING

### K.1 Variacoes Identificadas

**PRODUTO: SUCO (B01-B04)**

**DECISAO HC-12 — RESOLVIDA (Parte 2C-R3):** 4 produtos independentes, NAO variacao.

Sugores: NAO INFORMADOS. Nao criar option group, variation ou placeholder ficticio.

### K.2 Variacoes "Calabresa ou Bacon"

**DECISAO HC-06/HC-07 — RESOLVIDA (Parte 2C-R3):**

**PRODUTOS: Mr. File c/ Calabresa ou Bacon (A08) e Mr. Picanha c/ Calabresa ou Bacon (A10)**

Modelagem aprovada — UM produto com grupo de escolha obrigatoria:

```
OPTION GROUP (2 instancias — uma por produto):
  name: "Escolha o complemento"
  kind: variation
  selection_mode: single
  min_select: 1
  max_select: 1
  is_active: true

OPTIONS (por grupo):
  Calabresa — price_delta: 0
  Bacon — price_delta: 0
```

**Validacao tecnica confirmada:**
- Contrato suporta: `_validate_option_delta_by_kind` permite `price_delta = 0` para variacoes
- Constraint `catalog_product_option_groups_variation_check` garante `selection_mode = 'single'` e `max_select = 1`
- Preco minimo no publish: 3300 + 0 = 3300 >= 1 (PASS)
- Nao transformar em dois produtos separados
- Nao acrescentar preco
- Nao permitir selecionar ambos

---

## L. ADDON MAPPING

### L.1 Estrutura Proposta

Para cada produto que aceita adicionais, criar um OPTION GROUP:

`
OPTION GROUP (por produto):
  name: "Adicionais"
  kind: addon
  selection_mode: multiple
  min_select: 0
  max_select: 7 (quantidade total de addons disponiveis)
`

### L.2 Aplicabilidade dos Adicionais

O cardapio NAO informa quais adicionais podem ser usados em quais produtos.

**MATRIZ DE APLICABILIDADE � REQUIRES HUMAN DECISION:**

| Adicional | Tradicionais | Artesanais | Porcoes | Bebidas |
| --- | --- | --- | --- | --- |
| Carne artesanal (7,00) | ? | ? | ? | provavelmente NO |
| Carne tradicional (6,00) | ? | ? | ? | provavelmente NO |
| File (7,00) | ? | ? | ? | provavelmente NO |
| Picanha (7,00) | ? | ? | ? | provavelmente NO |
| Calabresa (7,00) | ? | ? | ? | provavelmente NO |
| Bacon (6,00) | ? | ? | ? | provavelmente NO |
| Salsicha (6,00) | ? | ? | ? | provavelmente NO |
| Queijo (6,00) | ? | ? | ? | provavelmente NO |
| Apresuntado (5,00) | ? | ? | ? | provavelmente NO |
| Ovo (4,00) | ? | ? | ? | provavelmente NO |
| Cheddar (6,00) | ? | ? | ? | provavelmente NO |
| Barbecue (5,00) | ? | ? | ? | provavelmente NO |
| Maionese (7,00) | ? | ? | ? | provavelmente NO |
| Katchup (7,00) | ? | ? | ? | provavelmente NO |

**DECISAO PENDENTE: HUMAN CONFIRMATION � para cada combinacao (adicional x categoria).**

### L.3 Recomendacao Inicial (simplificacao)

Se o responsavel humano nao quiser definir a matriz completa, uma abordagem conservadora:

- **TRADICIONAIS:** aceitar todos os adicionais de complementos (queijo, apresuntado, ovo, cheddar, barbecue, maionese, katchup) � NAO proteinas extras
- **ARTESANAIS:** aceitar todos os adicionais (protein + complementos)
- **PORCOES:** aceitar apenas complementos (queijo, cheddar, barbecue, maionese, katchup) � sem proteinas
- **BEBIDAS:** NENHUM adicional

Mas precisa de confirmacao humana antes de implementar.

---

## M. REMOVAL STRATEGY

### M.1 Analise

O cardapio lista ingredientes dos produtos, mas NAO especifica quais podem ser removidos.

O contrato de remocoes do catalogo:
`
OPTION GROUP:
  kind: removal
  selection_mode: multiple
  min_select: 0
  max_select: N (numero de ingredientes removiveis)
  price_delta para cada option: 0
`

### M.2 Recomendacao

**NAO criar remocoes automaticamente.** Justificativas:

1. Nem todos os ingredientes sao operacionalmente removiveis (ex.: pao em um sanduiche)
2. O cardapio nao lista quais sao removiveis
3. Criar 50+ opcoes "sem X" sem confirmacao humana gera ruido

**Se o responsavel humano desejar remocoes:**

Sugestao de ingredientes candidatos a remocao (por categoria):

| Ingrediente | Tradicionais | Artesanais | Porcoes |
| --- | --- | --- | --- |
| Ovo | potencialmente sim | potencialmente sim | � |
| Queijo | potencialmente sim | potencialmente sim | � |
| Apresuntado | potencialmente sim | potencialmente sim | � |
| Bacon | � | potencialmente sim | potencialmente sim |
| Calabresa | � | potencialmente sim | potencialmente sim |
| Salada | potencialmente sim | potencialmente sim | � |
| Batata-palha | potencialmente sim | potencialmente sim | � |
| Molho barbecue | � | potencialmente sim | � |
| Cheddar | � | potencialmente sim | � |

**DECISAO PENDENTE: HUMAN CONFIRMATION � quais ingredientes sao removiveis?**

### M.3 Para Produtos Especificos

**Mr. Salsicha (A04):** descricao inclui "file" � o material pode ter erro. Nao corrigir/remover por suposicao. Marcar para confirmacao.

**DECISAO PENDENTE: HUMAN CONFIRMATION � Mr. Salsicha realmente contem file?**

---

## N. HUMAN CONFIRMATIONS REQUIRED

### N.1 Descricoes Ausentes (NON-BLOCKING)

| # | Item | Campo | Status | Acao Necessaria |
| --- | --- | --- | --- | --- |
| HC-01 | Queijo Quente (T02) | description | MISSING | Fornecer descricao do produto (nullable — nao bloqueia) |
| HC-02 | Misto Quente (T03) | description | MISSING | Fornecer descricao do produto (nullable — nao bloqueia) |
| HC-03 | Mr. Nordestino (A13) | description | MISSING | Fornecer descricao do produto (nullable — nao bloqueia) |

### N.2 Conteudo Questionavel (NON-BLOCKING)

| # | Item | Campo | Status | Acao Necessaria |
| --- | --- | --- | --- | --- |
| HC-04 | Mr. Salsicha (A04) | description contem "file" | PRESERVE SOURCE | Confirmar se "file" e intencional ou erro (nao bloqueia) |
| HC-05 | Todos os sucos | sabores | NOT CONFIGURED | Informar sabores disponiveis ou confirmar genericos (nao bloqueia) |

### N.3 Opcoes Obrigatorias

| # | Item | Grupo | Status | Acao Necessaria |
| --- | --- | --- | --- | --- |
| HC-06 | Mr. File c/ Cal. ou Bacon (A08) | "Escolha o complemento" | **RESOLVED** | Variacao single-choice aprovada (Parte 2C-R3) |
| HC-07 | Mr. Picanha c/ Cal. ou Bacon (A10) | "Escolha o complemento" | **RESOLVED** | Variacao single-choice aprovada (Parte 2C-R3) |

### N.4 Adicionais (NON-BLOCKING)

| # | Item | Status | Acao Necessaria |
| --- | --- | --- | --- |
| HC-08 | Aplicabilidade dos adicionais | PENDING | Definir matriz adicional x categoria (nao bloqueia cadastro base) |
| HC-09 | Grafia "Katchup" | PENDING | Confirmar se mantem "KATCHUP" ou corrige para "KETCHUP" (nao bloqueia) |

### N.5 Remocoes (NON-BLOCKING)

| # | Item | Status | Acao Necessaria |
| --- | --- | --- | --- |
| HC-10 | Ingredientes removiveis | NOT CONFIGURED | Definir quais ingredientes podem ser removidos (nao bloqueia cadastro base) |

### N.6 Disponibilidade (NON-BLOCKING)

| # | Item | Status | Acao Necessaria |
| --- | --- | --- | --- |
| HC-11 | Disponibilidade inicial | PENDING | Confirmar que todos os itens comecam com is_available = true (nao bloqueia) |

### N.7 Mapeamento de Sucos

| # | Item | Status | Acao Necessaria |
| --- | --- | --- | --- |
| HC-12 | 4 produtos vs 1 produto + variacao | **RESOLVED** | 4 produtos independentes aprovados (Parte 2C-R3) |

### N.8 Resumo

**TOTAL HUMAN CONFIRMATIONS: 12**
- RESOLVED: 3 (HC-06, HC-07, HC-12)
- PENDING NON-BLOCKING: 9 (HC-01 through HC-05, HC-08 through HC-11)

**CATALOG MODEL BLOCKERS: ZERO**

Nenhuma confirmacao restante bloqueia o cadastro dos 49 produtos-base.

---

## O. CATALOG COMPLETENESS

| Metrica | Valor |
| --- | --- |
| TOTAL CATEGORIES | 4 |
| TOTAL BASE PRODUCTS | 49 |
| TOTAL COMPLETELY MAPPABLE | 49 |
| TOTAL WITH PENDING CONFIRMATION | 0 (blockers) + 9 (non-blocking) |
| TOTAL ADDONS | 14 |
| ADDITIONAL APPLICABILITY | PENDING (non-blocking) |
| OPTION GROUPS (variation — required) | 2 (A08, A10 — RESOLVED) |
| OPTION GROUPS (addon) | 0-16 (depende da aplicabilidade — non-blocking) |
| OPTION GROUPS (removal) | 0 (NOT CONFIGURED INITIALLY) |
| DESCRIPTIONS MISSING | 3 (nullable — non-blocking) |
| AMBIGUITIES | 1 (file em Mr. Salsicha — non-blocking) |
| CATALOG MODEL BLOCKERS | **ZERO** |

### Breakdown de Produtos com Pendencia

| Produto | Pendencia | Bloqueia cadastro? |
| --- | --- | --- |
| Queijo Quente (T02) | descricao ausente | description pode ser NULL � NAO bloqueia |
| Misto Quente (T03) | descricao ausente | description pode ser NULL � NAO bloqueia |
| Mr. Nordestino (A13) | descricao ausente | description pode ser NULL � NAO bloqueia |
| Mr. Salsicha (A04) | "file" na descricao | pode cadastrar como esta � NAO bloqueia |
| Mr. File c/ Cal. ou Bacon (A08) | variacao obrigatoria | **RESOLVED** (HC-06) |
| Mr. Picanha c/ Cal. ou Bacon (A10) | variacao obrigatoria | **RESOLVED** (HC-07) |
| Sucos (B01-B04) | modelagem | **RESOLVED** (HC-12) — 4 produtos independentes |
| Todos | aplicabilidade addons | NAO bloqueia cadastro base, bloqueia addons |
| Todos | remocoes | NAO bloqueia cadastro base |

---

## P. GATE 3

`
CATALOG DATA: STRUCTURED
CATALOG MAPPING: VALIDATED
CATALOG AMBIGUITIES: IDENTIFIED AND RESOLVED (BLOCKERS)
CATALOG COMPLETENESS: 100% (49/49 mapeaveis, ZERO blockers)

GATE 3 STATUS: READY_FOR_ENTRY

CATALOG MODEL BLOCKERS: ZERO

NON-BLOCKING CONTENT PENDING: YES
  HC-01/HC-02/HC-03 — descricoes ausentes (nullable)
  HC-04 — "file" em Mr. Salsicha
  HC-05 — sabores dos sucos
  HC-08 — aplicabilidade addons
  HC-09 — grafia Katchup
  HC-10 — remocoes
  HC-11 — disponibilidade inicial

PRODUCTION ENTRY: NOT STARTED
PUBLICATION: NOT AUTHORIZED
`

---

## Q. FINAL PILOT-P01 REMOTE WRITE PLAN

### Q.1 Estado Conhecido

| Entidade | Estado | Acao |
| --- | --- | --- |
| Organization "Mr. Burger" | EXISTS | NAO criar |
| Owner (PILOT-P01-OWNER) | EXISTS, role owner | NAO criar |
| Unit "Unidade principal" | EXISTS | RENOMEAR para Matriz |
| Operator (PILOT-P01-OPERATOR-01) | NAO existe | CRIAR via convite |
| Auth users | 1 existente | +1 via convite |
| Invites | 0 | +1 (owner -> operator) |
| Memberships | 1 (owner) | +1 after acceptance |
| Unit assignments | 1 (owner) | +1 after acceptance |

### Q.2 Write Sequence Proposta

`
FASE 0 � VALIDACAO PRE-ESCRITA
  [ ] Revalidar estado de producao (read-only)
  [ ] Confirmar HC-06, HC-07, HC-12 (blockers)

FASE 1 � UNIDADE
  [ ] Renomear "Unidade principal" -> "Matriz" (update_unit, owner-only)
  [ ] Configurar horarios (ter-dom 18:00-23:59, seg fechado)
  [ ] Configurar delivery (taxa R$ 5,00, minimo R$ 20,00, ETA 30-50 min)
  [ ] Configurar pickup (ENABLED)
  [ ] Configurar pagamentos (pix, credit, debit, cash)

FASE 2 � OPERADOR
  [ ] Owner cria convite para PILOT-P01-OPERATOR-01 (role: operator)
  [ ] Operator faz signup/login
  [ ] Operator aceita convite
  [ ] Owner atribui Matriz ao operator (assign_unit_to_member)
  [ ] Validar RBAC

FASE 3 � CATEGORIAS
  [ ] create_catalog_category: TRADICIONAIS (sort 100)
  [ ] create_catalog_category: ARTESANAIS (sort 200)
  [ ] create_catalog_category: PORCOES (sort 300)
  [ ] create_catalog_category: BEBIDAS (sort 400)

FASE 4 � PRODUTOS TRADICIONAIS
  [ ] create_catalog_product x 10

FASE 5 � PRODUTOS ARTESANAIS
  [ ] create_catalog_product x 14
  [ ] create_catalog_product_option_group: "Complemento" (variation) x 2 (A08, A10)

FASE 6 � PORCOES
  [ ] create_catalog_product x 10

FASE 7 � BEBIDAS
  [ ] create_catalog_product x 15

FASE 8 � OPCOES/ADICIONAIS (apos decisao humana)
  [ ] create_catalog_product_option_group: "Adicionais" (addon) por produto
  [ ] create_catalog_product_option x N por grupo

FASE 9 � REMOCOES (se decidido)
  [ ] create_catalog_product_option_group: "Remocoes" (removal) por produto
  [ ] create_catalog_product_option x N por grupo

FASE 10 � PUBLICACAO
  [ ] Revisar catalogo completo
  [ ] publish_unit_menu(unit_id)
  [ ] Validar menu publico

FASE 11 � TREINAMENTO
  [ ] Treinar owner (catalogo, pedidos, equipe)
  [ ] Treinar operator (Central de Pedidos, KDS, status)
  [ ] Treinar cozinha (KDS)
`

### Q.3 Contagem de Writes

| Entidade | Quantidade |
| --- | --- |
| Unit renames | 1 |
| Unit config updates | 5 (horarios, delivery, pickup, pagamentos, accepting_orders) |
| Invites | 1 |
| Unit assignments | 1 |
| Categories | 4 |
| Products | 49 |
| Option groups (variation — required) | 2 (A08, A10) |
| Options (variation — required) | 4 (Calabresa + Bacon x 2) |
| Option groups (addon) | 0 initially (PENDING human applicability) |
| Options (addon) | 0 initially (PENDING human applicability) |
| Option groups (removal) | 0 initially (NOT CONFIGURED) |
| Options (removal) | 0 initially (NOT CONFIGURED) |
| Publications | 1 |
| **TOTAL MINIMO** | **64** |
| **TOTAL COM ADICIONAIS** | **64 + addon groups/options** |

### Q.4 Seguranca

- Tenant isolation: preservada (composite FKs + RLS)
- Owner/operator roles: mantidas
- Sem manager no primeiro ciclo
- Sem conta compartilhada
- Sem admin-created Auth user (convite via email verificado)
- Membership only after acceptance
- Unit access only after assignment
- Sem PII no Git
- Sem secrets
- Somente fluxo oficial (UI + RPCs security definer)

---

## R. PRODUCT IMAGE CAPABILITY AUDIT

### R.1 Existing Support

**CASE C: PRODUCT IMAGE SUPPORT � NOT IMPLEMENTED**

Zero product image infrastructure at every level:

- **Database:** No image columns in catalog_products or any other table. No storage buckets. No storage policies.
- **Backend:** No image upload edge functions. No storage configuration.
- **Frontend:** No image upload components. No image display components. No <img> tags for products.
- **Types/Schemas:** No image fields in any TypeScript interface (CatalogProduct, PublicMenuProduct, etc.).
- **File naming:** No files related to images, uploads, media, thumbnails, or attachments.

Products in Ped-On are purely text-based: name + description + price.

### R.2 Schema

No image_url, image_path, photo, 	humbnail, media, or product_image column exists in:
- catalog_products (14 columns, all accounted for)
- menu_version_products (12 columns, all accounted for)
- Any other table in any migration

### R.3 Storage

Zero Supabase Storage infrastructure:
- No storage.buckets definitions
- No storage.objects references
- No storage policies
- No bucket creation in any migration

### R.4 Security

No storage-related security policies. No upload/download policies. No role-based storage access.

### R.5 Admin UI

No image upload components in:
- pps/web/src/pages/CatalogoPage.tsx (759 lines � purely text/number fields)
- pps/web/src/components/catalog/option-groups-panel.tsx
- pps/web/src/components/catalog/group-editor.tsx
- pps/web/src/components/catalog/option-editor.tsx

### R.6 Public Menu

No image display in:
- pps/web/src/lib/menu/menu.ts (types have no image field)
- Public menu pages (no <img>, <picture>, or <Image> components)

### R.7 Current Limitations

- No way to associate images with products
- No way to upload images from admin UI
- No way to display images in public menu
- No way to display images in customer-facing pages

### R.8 Minimal Product Image Plan (if desired)

**Architecture:**
- 1 primary photo per product
- Storage: Supabase Storage bucket product-images
- Database: store image_url (text, nullable) in catalog_products
- Security: tenant-scoped (organization_id/unit_id path)
- Upload: owner/manager only (can_manage_unit)
- Public menu: read-only via public URL
- Fallback: placeholder visual when no photo

**Impact:**
- MIGRATION: YES (add image_url column + storage bucket + policies)
- STORAGE BUCKET: YES
- STORAGE POLICIES: YES
- FRONTEND: YES (upload in admin, display in public menu)
- PUBLIC MENU: YES
- TESTS: YES

**Formats:** JPG / PNG / WebP. No SVG. Max 5MB recommended.

### R.9 PILOT IMPACT

**PILOT NECESSITY: RECOMMENDED**

Fotos sao RECOMENDADAS para o piloto, mas NAO devem bloquear o cadastro do catalogo. O cardapio do Mr. Burger pode ser cadastrado 100% em modo texto.

**Se desejar implementar para o piloto:**
- Requer: migration nova, storage bucket, storage policies, frontend upload/display
- Requer: separata do catalogo (nao incluir nesta execucao READ_ONLY)

---

## S. STRUCTURAL CHANGES

`
CODE: ZERO
DATABASE STRUCTURE: ZERO
REMOTE WRITES: ZERO
MIGRATIONS: ZERO
RPC: ZERO
RLS: ZERO
EDGE: ZERO
SW: ZERO
`

Nenhuma feature nova. Nenhuma migracao. Nenhuma alteracao estrutural.

Se o catalogo atual NAO for capaz de representar um requisito:
- registrar finding
- NAO implementar

---

## T. LOCAL DB

`
LOCAL DB REBUILD: NOT RUN � BY DESIGN / NO LOCAL DOCKER
LOCAL DB TESTS: NOT RUN � BY DESIGN / NO LOCAL DOCKER
`

---

## U. GIT

`
Branch: main
HEAD: 92a72bafd1a465e5259b773122bb6baaa86e4e8f
origin/main: 92a72bafd1a465e5259b773122bb6baaa86e4e8f
HEAD == origin/main: YES
Working tree: clean
`

Apenas docs alterados neste execucao:
- docs/PILOT_P01_CATALOG_DATA_PACK.md (novo)

---

## V. CHECKPOINT

```
PILOT_GATE                    — IN PROGRESS
PILOT_ONBOARDING              — IN PROGRESS
PILOT_PARTICIPANT_01          — ONBOARDING PLANNED
PILOT_OPERATION               — NOT STARTED
PROMPT 14                     — NOT STARTED

DEC-127 PRODUCTION            — DEPLOYED AND VERIFIED
MEMBER ONBOARDING FINDING     — RESOLVED IN PRODUCTION
PRODUCTION MIGRATIONS         — 24/24

PILOT-P01 REMOTE WRITES       — NOT AUTHORIZED

CATALOG DATA                  — STRUCTURED
CATALOG MAPPING               — VALIDATED
CATALOG AMBIGUITIES           — RESOLVED (BLOCKERS)
CATALOG COMPLETENESS          — 100% (49/49, ZERO blockers)

GATE 3                        — READY_FOR_ENTRY
CATALOG MODEL BLOCKERS        — ZERO

PRODUCT IMAGE CAPABILITY      — CASE C (NOT IMPLEMENTED)
```

---

## W. NEXT HUMAN GATE

```
TARGET ENVIRONMENT:
PRODUCTION

CATALOG:
READY_FOR_ENTRY

CATALOG MODEL BLOCKERS:
ZERO

PILOT-P01 REMOTE WRITES:
NOT AUTHORIZED

READY FOR FINAL REMOTE WRITE AUTHORIZATION

AWAITING HUMAN DECISION:
AUTHORIZE PILOT-P01 REMOTE WRITES IN PRODUCTION
```

Non-blocking items pendentes (nao bloqueiam autorizacao de escrita):
- HC-01/HC-02/HC-03 — descricoes ausentes
- HC-04 — "file" em Mr. Salsicha
- HC-05 — sabores dos sucos
- HC-08 — aplicabilidade addons
- HC-09 — grafia Katchup
- HC-10 — remocoes
- HC-11 — disponibilidade inicial

Nenhuma escrita remota executada. Nenhuma feature nova implementada.
