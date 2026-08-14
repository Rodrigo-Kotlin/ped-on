import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCart } from '../lib/cart/cart-context';
import { cartQuantity, cartSubtotalCents, isCartStale } from '../lib/cart/cart';
import { formatBRL } from '../lib/money';
import { publicMenuQueryOptions } from '../lib/menu/public-menu-query';
import type { PublicMenuData, PublicMenuProduct } from '../lib/menu/menu';
import { ProductCustomizer } from '../components/public-menu/ProductCustomizer';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function PublicMenuFound({ menu, publicSlug }: { menu: PublicMenuData; publicSlug: string }) {
  const { cart, addItem, clearCart } = useCart();
  const [customizing, setCustomizing] = useState<PublicMenuProduct | null>(null);
  const stale = isCartStale(cart, menu.menu.version_id);
  const quantity = cartQuantity(cart);

  function confirmClearCart() {
    if (window.confirm('Limpar o carrinho antigo e começar novamente com este cardápio?')) {
      clearCart();
    }
  }

  return (
    <div className="min-h-svh bg-pedon-surface pb-24 text-pedon-text">
      <header className="border-b border-pedon-navy/10 bg-white px-4 py-5">
        <div className="mx-auto w-full max-w-lg">
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
            {menu.organization.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-pedon-navy">{menu.unit.name}</h1>
          <p
            role="status"
            className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-medium ${
              menu.operation.can_order_now
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-pedon-surface text-pedon-text/70'
            }`}
          >
            {menu.operation.can_order_now
              ? 'Pedidos abertos agora'
              : 'Pedidos indisponíveis no momento.'}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg px-4 py-6">
        {stale && (
          <div role="alert" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              O cardápio mudou. Seu carrinho antigo foi preservado e precisa ser refeito.
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

        {menu.loyalty.enabled && (
          <Link
            to={`/clube/${publicSlug}`}
            className="mt-6 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-pedon-orange/40 bg-orange-50 p-4 text-sm transition hover:bg-orange-100"
          >
            <span>
              <span className="block font-bold text-pedon-navy">Clube Ped-On</span>
              <span className="block text-pedon-text/70">
                Ganhe pontos nas suas compras e acompanhe seu saldo.
              </span>
            </span>
            <span className="shrink-0 font-semibold text-pedon-orange">Ver saldo →</span>
          </Link>
        )}

        {menu.categories.length === 0 ? (
          <p role="status" className="text-pedon-text/70">
            Este cardápio ainda não tem itens publicados.
          </p>
        ) : (
          menu.categories.map((category) => {
            const headingId = `public-category-${category.id}`;
            return (
              <section key={category.id} aria-labelledby={headingId} className="mt-8 first:mt-0">
                <h2
                  id={headingId}
                  className="border-b border-pedon-navy/15 pb-2 text-lg font-bold text-pedon-navy"
                >
                  {category.name}
                </h2>
                <ul className="mt-3 space-y-3">
                  {category.products.map((product) => (
                    <li
                      key={product.id}
                      className="rounded-lg border border-pedon-navy/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-pedon-navy">
                            {product.name}
                            {!product.is_available && (
                              <span className="rounded bg-pedon-surface px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-pedon-text/60">
                                Indisponível
                              </span>
                            )}
                          </p>
                          {product.description !== null && product.description !== '' && (
                            <p className="mt-1 text-sm text-pedon-text/70">{product.description}</p>
                          )}
                        </div>
                        <p className="shrink-0 font-semibold text-pedon-text">
                          {formatBRL(product.price)}
                        </p>
                      </div>
                      {product.is_available &&
                        menu.operation.can_order_now &&
                        !stale &&
                        product.is_configurable !== false &&
                        ((product.option_groups?.length ?? 0) > 0 ? (
                          <button
                            type="button"
                            onClick={() => setCustomizing(product)}
                            className="mt-3 min-h-11 w-full rounded-md border border-pedon-orange px-4 py-2 text-sm font-semibold text-pedon-orange transition hover:bg-orange-50"
                            aria-label={`Personalizar ${product.name}`}
                          >
                            Personalizar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              addItem(menu.menu.version_id, {
                                menu_item_id: product.id,
                                name: product.name,
                                unit_price: product.price,
                                options: [],
                              })
                            }
                            className="mt-3 min-h-11 w-full rounded-md border border-pedon-orange px-4 py-2 text-sm font-semibold text-pedon-orange transition hover:bg-orange-50"
                            aria-label={`Adicionar ${product.name}`}
                          >
                            Adicionar
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <footer className="border-t border-pedon-navy/10 px-4 py-4">
        <p className="mx-auto w-full max-w-lg text-center text-xs text-pedon-text/50">
          Cardápio atualizado em {formatDate(menu.menu.published_at)} · Ped-On
        </p>
      </footer>

      {quantity > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-pedon-navy/10 bg-white/95 p-3 backdrop-blur">
          <Link
            to={`/menu/${publicSlug}/carrinho`}
            className="mx-auto flex min-h-12 w-full max-w-lg items-center justify-between rounded-lg bg-pedon-orange px-4 py-3 font-semibold text-white shadow-lg"
          >
            <span>Ver carrinho ({quantity})</span>
            <span>{formatBRL(cartSubtotalCents(cart))}</span>
          </Link>
        </div>
      )}

      {customizing !== null && (
        <ProductCustomizer
          product={customizing}
          versionId={menu.menu.version_id}
          onClose={() => setCustomizing(null)}
        />
      )}
    </div>
  );
}

function PublicMenuMissing() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-pedon-surface px-4 text-center">
      <h1 className="text-2xl font-bold text-pedon-navy">Cardápio não encontrado</h1>
      <p className="mt-2 max-w-sm text-sm text-pedon-text/70">
        O link que você acessou não existe ou a publicação foi removida.
      </p>
      <Link
        to="/"
        className="mt-6 min-h-11 rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white"
      >
        Voltar ao início
      </Link>
    </div>
  );
}

export function PublicMenuPage() {
  const { publicSlug = '' } = useParams<{ publicSlug: string }>();
  const menuQuery = useQuery(publicMenuQueryOptions(publicSlug));

  if (menuQuery.isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
        <p className="text-pedon-text/60">Carregando cardápio…</p>
      </div>
    );
  }
  if (menuQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center px-4 text-center">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível carregar o cardápio: {menuQuery.error.message}
        </p>
      </div>
    );
  }
  if (menuQuery.data === undefined || menuQuery.data.found === false) return <PublicMenuMissing />;
  return <PublicMenuFound menu={menuQuery.data} publicSlug={publicSlug} />;
}
