import type { ReactNode } from 'react';

export type StateBlockKind = 'loading' | 'empty' | 'error';

export interface StateBlockProps {
  kind: StateBlockKind;
  title?: string;
  message?: ReactNode;
  retryLabel?: string;
  onRetry?: () => void;
}

export function StateBlock({
  kind,
  title,
  message,
  retryLabel = 'Tentar novamente',
  onRetry,
}: StateBlockProps) {
  if (kind === 'loading') {
    return (
      <p role="status" className="py-6 text-center text-pedon-text/60">
        Carregando…
      </p>
    );
  }

  if (kind === 'error') {
    return (
      <div role="alert" className="rounded-md bg-red-50 p-4 text-red-800">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        {message !== undefined && <p className="mt-1 text-sm">{message}</p>}
        {onRetry !== undefined && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-11 rounded-md border border-red-300 px-4 font-semibold transition hover:bg-red-100"
          >
            {retryLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
      {title !== undefined && <p className="font-semibold text-pedon-navy">{title}</p>}
      {message !== undefined && <p className="mt-1 text-sm text-pedon-text/70">{message}</p>}
    </div>
  );
}
