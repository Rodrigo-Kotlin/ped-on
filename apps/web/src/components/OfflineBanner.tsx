import { useOnline } from '../lib/offline/useOnline';

export function OfflineBanner() {
  const online = useOnline();

  if (online) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
    >
      Sem conexão com a internet. As informações exibidas podem estar desatualizadas e operações que
      exigem conexão estão pausadas até a conexão ser restabelecida.
    </div>
  );
}
