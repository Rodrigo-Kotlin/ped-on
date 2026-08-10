import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { fetchPublicMenu, formatBRL } from '../lib/menu/menu';
import type { PublicMenuData } from '../lib/menu/menu';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function PublicMenuFound({ menu }: { menu: PublicMenuData }) {
  const acceptingOrders = menu.unit.is_active && menu.operation.accepting_orders;

  return (
    <div className="min-h-svh bg-pedon-surface text-pedon-text">
      <header className="border-b border-pedon-navy/10 bg-white px-4 py-5">
        <div className="mx-auto w-full max-w-md">
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
            {menu.organization.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-pedon-navy">{menu.unit.name}</h1>
          <p
            role="status"
            className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-medium ${
              acceptingOrders
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-pedon-surface text-pedon-text/70'
            }`}
          >
            {acceptingOrders ? 'Pedidos abertos agora' : 'Pedidos encerrados no momento'}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-6">
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
                    <li key={product.id} className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex flex-wrap items-center gap-2 font-medium text-pedon-navy">
                          {product.name}
                          {!product.is_available && (
                            <span className="rounded bg-pedon-surface px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-pedon-text/60">
                              Indisponível
                            </span>
                          )}
                        </p>
                        {product.description !== null && product.description !== '' && (
                          <p className="mt-0.5 text-sm text-pedon-text/70">{product.description}</p>
                        )}
                      </div>
                      <p className="shrink-0 font-medium text-pedon-text">
                        {formatBRL(product.price)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>

      <footer className="border-t border-pedon-navy/10 px-4 py-4">
        <p className="mx-auto w-full max-w-md text-center text-xs text-pedon-text/50">
          Cardápio atualizado em {formatDate(menu.menu.published_at)} · Ped-On
        </p>
      </footer>
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
        className="mt-6 rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white transition hover:bg-pedon-navy/90"
      >
        Voltar ao início
      </Link>
    </div>
  );
}

export function PublicMenuPage() {
  const { publicSlug } = useParams<{ publicSlug: string }>();

  const menuQuery = useQuery({
    queryKey: ['public-menu', publicSlug ?? ''],
    queryFn: () => fetchPublicMenu(publicSlug ?? ''),
    enabled: publicSlug !== undefined && publicSlug !== '',
  });

  if (menuQuery.isLoading) {
    return (
      <div
        className="flex min-h-svh items-center justify-center bg-pedon-surface"
        role="status"
        aria-live="polite"
      >
        <p className="text-pedon-text/60">Carregando cardápio…</p>
      </div>
    );
  }

  if (menuQuery.isError) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-pedon-surface px-4 text-center">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível carregar o cardápio: {menuQuery.error.message}
        </p>
        <Link
          to="/"
          className="mt-6 rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white transition hover:bg-pedon-navy/90"
        >
          Voltar ao início
        </Link>
      </div>
    );
  }

  if (menuQuery.data === undefined || menuQuery.data.found === false) {
    return <PublicMenuMissing />;
  }

  return <PublicMenuFound menu={menuQuery.data} />;
}
