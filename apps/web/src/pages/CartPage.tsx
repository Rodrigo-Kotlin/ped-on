import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useCart } from '../lib/cart/cart-context';
import {
  cartItemConfiguredUnitPriceCents,
  cartItemKey,
  cartSubtotalCents,
  isCartStale,
} from '../lib/cart/cart';
import type { CartItem } from '../lib/cart/cart';
import { formatBRL, multiplyCents } from '../lib/money';
import type { PublicMenuData } from '../lib/menu/menu';
import { publicMenuQueryOptions } from '../lib/menu/public-menu-query';

type OptionGroupInfo = { name: string; kind: 'variation' | 'addon' | 'removal' };

function buildGroupMap(menu: PublicMenuData | null): Map<string, OptionGroupInfo> {
  const map = new Map<string, OptionGroupInfo>();
  if (menu === null) return map;
  for (const category of menu.categories) {
    for (const product of category.products) {
      for (const group of product.option_groups ?? []) {
        map.set(group.id, { name: group.name, kind: group.kind });
      }
    }
  }
  return map;
}

function renderOptionLines(item: CartItem, groups: Map<string, OptionGroupInfo>) {
  const lines: Array<{ id: string; label: string }> = [];
  for (const option of item.options) {
    const group = groups.get(option.menu_group_id);
    if (group !== undefined) {
      if (group.kind === 'variation') {
        lines.push({ id: option.menu_option_id, label: `${group.name}: ${option.name}` });
      } else if (group.kind === 'addon') {
        lines.push({ id: option.menu_option_id, label: `+ ${option.name}` });
      } else {
        lines.push({ id: option.menu_option_id, label: option.name });
      }
    } else {
      lines.push({ id: option.menu_option_id, label: option.name });
    }
  }
  return lines;
}

export function CartPage() {
  const { publicSlug = '' } = useParams<{ publicSlug: string }>();
  const { cart, setQuantity, setNote, removeItem, clearCart } = useCart();
  const menuQuery = useQuery(publicMenuQueryOptions(publicSlug));
  const menu = menuQuery.data?.found ? menuQuery.data : null;
  const groupMap = useMemo(() => buildGroupMap(menu), [menu]);
  const currentVersion = menuQuery.data?.found === true ? menuQuery.data.menu.version_id : '';
  const stale = currentVersion !== '' && isCartStale(cart, currentVersion);
  const canOrder = menuQuery.data?.found === true && menuQuery.data.operation.can_order_now;
  const checkoutBlocked = cart.items.length === 0 || stale || !canOrder;

  function confirmClearCart() {
    if (window.confirm('Limpar o carrinho antigo e começar novamente com este cardápio?')) {
      clearCart();
    }
  }

  return (
    <div className="min-h-svh bg-pedon-surface px-4 py-5 text-pedon-text">
      <div className="mx-auto w-full max-w-lg">
        <Link
          to={`/menu/${publicSlug}`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-pedon-navy"
        >
          ← Voltar ao cardápio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-pedon-navy">Seu carrinho</h1>

        {menuQuery.isLoading && (
          <p role="status" className="mt-4 text-sm">
            Atualizando cardápio…
          </p>
        )}
        {menuQuery.isError && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            Não foi possível confirmar a disponibilidade do cardápio.
          </p>
        )}
        {stale && (
          <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              O cardápio mudou. Os itens e preços antigos foram preservados, mas este carrinho não
              pode ser enviado.
            </p>
            <button
              type="button"
              onClick={confirmClearCart}
              className="mt-3 min-h-11 rounded-md bg-pedon-navy px-4 py-2 text-sm font-semibold text-white"
            >
              Limpar e refazer carrinho
            </button>
          </div>
        )}
        {menuQuery.data?.found === true && !menuQuery.data.operation.can_order_now && (
          <p role="status" className="mt-4 rounded-md bg-white p-3 text-sm text-pedon-text/75">
            Pedidos indisponíveis no momento.
          </p>
        )}

        {cart.items.length === 0 ? (
          <div className="mt-8 rounded-lg bg-white p-6 text-center shadow-sm">
            <p className="text-pedon-text/70">Seu carrinho está vazio.</p>
            <Link
              to={`/menu/${publicSlug}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-pedon-orange px-4 py-2 font-semibold text-white"
            >
              Ver cardápio
            </Link>
          </div>
        ) : (
          <ul className="mt-5 space-y-4">
            {cart.items.map((item) => {
              const lineId = cartItemKey(item);
              const optionLines = renderOptionLines(item, groupMap);
              const configuredUnit = cartItemConfiguredUnitPriceCents(item);
              return (
                <li
                  key={lineId}
                  className="rounded-lg border border-pedon-navy/10 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-pedon-navy">{item.name}</h2>
                      {optionLines.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-sm text-pedon-text/70">
                          {optionLines.map((line) => (
                            <li key={line.id}>{line.label}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-sm text-pedon-text/70">
                        {formatBRL(configuredUnit)} cada
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold">
                      {formatBRL(multiplyCents(configuredUnit, item.quantity))}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center" aria-label={`Quantidade de ${item.name}`}>
                      <button
                        type="button"
                        onClick={() => setQuantity(lineId, item.quantity - 1)}
                        className="min-h-11 min-w-11 rounded-l-md border border-pedon-navy/20 text-xl"
                        aria-label={`Diminuir ${item.name}`}
                      >
                        −
                      </button>
                      <output
                        className="flex min-h-11 min-w-11 items-center justify-center border-y border-pedon-navy/20 font-semibold"
                        aria-live="polite"
                      >
                        {item.quantity}
                      </output>
                      <button
                        type="button"
                        onClick={() => setQuantity(lineId, item.quantity + 1)}
                        disabled={item.quantity >= 99}
                        className="min-h-11 min-w-11 rounded-r-md border border-pedon-navy/20 text-xl disabled:opacity-40"
                        aria-label={`Aumentar ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(lineId)}
                      className="min-h-11 px-2 text-sm font-semibold text-red-700"
                    >
                      Remover
                    </button>
                  </div>
                  <label htmlFor={`note-${lineId}`} className="mt-4 block text-sm font-medium">
                    Observação do item
                  </label>
                  <textarea
                    id={`note-${lineId}`}
                    value={item.note}
                    maxLength={300}
                    rows={2}
                    onChange={(event) => setNote(lineId, event.target.value)}
                    className="mt-1 w-full resize-y rounded-md border border-pedon-navy/20 px-3 py-2 text-base"
                  />
                  <p className="mt-1 text-right text-xs text-pedon-text/60">
                    {item.note.length}/300
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {cart.items.length > 0 && (
          <section
            aria-labelledby="cart-summary"
            className="mt-6 rounded-lg bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-4 text-lg font-bold text-pedon-navy">
              <h2 id="cart-summary">Subtotal estimado</h2>
              <p>{formatBRL(cartSubtotalCents(cart))}</p>
            </div>
            <p className="mt-2 text-sm text-pedon-text/65">
              O valor final será confirmado no envio do pedido.
            </p>
            {checkoutBlocked ? (
              <button
                type="button"
                disabled
                className="mt-4 min-h-12 w-full rounded-md bg-pedon-navy px-4 py-3 font-semibold text-white opacity-45"
              >
                Ir para checkout
              </button>
            ) : (
              <Link
                to={`/menu/${publicSlug}/checkout`}
                className="mt-4 flex min-h-12 w-full items-center justify-center rounded-md bg-pedon-orange px-4 py-3 font-semibold text-white"
              >
                Ir para checkout
              </Link>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
