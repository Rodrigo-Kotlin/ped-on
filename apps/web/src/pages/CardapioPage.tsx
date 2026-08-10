import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../lib/admin/admin-context';
import { fetchUnitMenuPublication, publishUnitMenu } from '../lib/menu/menu';
import type { MenuPublicationVersion } from '../lib/menu/menu';

const primaryButtonClass =
  'min-h-11 rounded-md bg-pedon-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function publicationUrl(publicPath: string): string {
  return `${window.location.origin}${publicPath}`;
}

export function CardapioPage() {
  const { selectedUnit } = useAdmin();

  if (selectedUnit === null) {
    return (
      <p className="text-pedon-text/70">
        Selecione uma unidade para publicar o cardápio. Nenhuma unidade disponível ainda.
      </p>
    );
  }

  return <MenuPublicationForUnit unitId={selectedUnit.id} unitName={selectedUnit.name} />;
}

function MenuPublicationForUnit({ unitId, unitName }: { unitId: string; unitName: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['unit-menu-publication', unitId] as const;
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const publicationQuery = useQuery({
    queryKey,
    queryFn: () => fetchUnitMenuPublication(unitId),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishUnitMenu(unitId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey, exact: true });
      setFeedback({
        type: 'success',
        message: `Cardápio publicado. A versão ${result.version_number} está no ar.`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ type: 'error', message: error.message });
    },
  });

  async function handlePublish() {
    const publication = publicationQuery.data?.publication;
    if (publication?.exists === true) {
      const confirmed = window.confirm(
        'Publicar uma nova versão do cardápio? O link público permanece o mesmo e o histórico de versões é preservado.',
      );
      if (!confirmed) {
        return;
      }
    }
    setFeedback(null);
    publishMutation.mutate();
  }

  async function handleCopy(publicPath: string) {
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(publicationUrl(publicPath));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setCopied(false);
    }
  }

  const publication = publicationQuery.data?.publication;
  const currentVersion = publicationQuery.data?.current_version;
  const history = publicationQuery.data?.history ?? [];
  const publishing = publishMutation.isPending;

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          {unitName}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Cardápio</h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          Publique o cardápio da unidade e compartilhe o link público com seus clientes.
        </p>
      </header>

      {feedback !== null && (
        <p
          role={feedback.type === 'success' ? 'status' : 'alert'}
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {feedback.message}
        </p>
      )}

      <section
        aria-labelledby="publication-heading"
        className="mt-6 rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
      >
        <h3 id="publication-heading" className="font-semibold text-pedon-navy">
          Publicação
        </h3>

        {publicationQuery.isLoading && (
          <p className="mt-3 text-sm text-pedon-text/70" role="status">
            Carregando publicação da unidade…
          </p>
        )}

        {publicationQuery.isError && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Não foi possível carregar a publicação: {publicationQuery.error.message}
          </p>
        )}

        {publicationQuery.isSuccess && publication?.exists === false && (
          <div className="mt-3">
            <p role="status" className="text-sm text-pedon-text/80">
              Este cardápio ainda não foi publicado.
            </p>
            <p className="mt-2 text-sm text-pedon-text/70">
              Será publicada a versão atual do catálogo: categorias ativas com produtos ativos.
            </p>
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishing}
              className={`${primaryButtonClass} mt-3`}
            >
              {publishing ? 'Publicando…' : 'Publicar cardápio'}
            </button>
          </div>
        )}

        {publicationQuery.isSuccess && publication?.exists === true && (
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium text-emerald-800" role="status">
              Cardápio publicado e no ar.
            </p>
            {currentVersion !== null && currentVersion !== undefined && (
              <dl className="grid gap-1 text-sm text-pedon-text/80 sm:grid-cols-2">
                <div>
                  <dt className="inline font-medium text-pedon-text">Versão atual: </dt>
                  <dd className="inline">
                    {currentVersion.version_number} ({currentVersion.category_count} categorias ·{' '}
                    {currentVersion.product_count} produtos)
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium text-pedon-text">Publicado em: </dt>
                  <dd className="inline">{formatDateTime(publication.published_at ?? '')}</dd>
                </div>
              </dl>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="public-menu-url" className="sr-only">
                Link público do cardápio
              </label>
              <input
                id="public-menu-url"
                readOnly
                value={publicationUrl(publication.public_path ?? '')}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 flex-1 rounded-md border border-pedon-navy/20 bg-pedon-surface px-3 py-2 text-sm text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
              />
              <button
                type="button"
                onClick={() => {
                  if (publication.public_path !== null) {
                    void handleCopy(publication.public_path);
                  }
                }}
                className="min-h-11 rounded-md border border-pedon-navy/25 px-3 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5"
              >
                {copied ? 'Copiado!' : 'Copiar link'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishing}
              className={primaryButtonClass}
            >
              {publishing ? 'Republicando…' : 'Republicar cardápio'}
            </button>
          </div>
        )}
      </section>

      <section
        aria-labelledby="history-heading"
        className="mt-6 rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
      >
        <h3 id="history-heading" className="font-semibold text-pedon-navy">
          Histórico de versões
        </h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-pedon-text/70" role="status">
            Nenhuma versão publicada ainda.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((version: MenuPublicationVersion) => (
              <li
                key={version.version_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-pedon-navy/10 p-3"
              >
                <span className="font-medium text-pedon-navy">Versão {version.version_number}</span>
                {version.is_current && (
                  <span className="rounded-md bg-pedon-orange/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-pedon-orange">
                    Atual
                  </span>
                )}
                <span className="text-sm text-pedon-text/70">
                  {version.category_count} categorias · {version.product_count} produtos
                </span>
                <time dateTime={version.created_at} className="ml-auto text-xs text-pedon-text/50">
                  {formatDateTime(version.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
