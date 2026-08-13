import { useRegisterSW } from 'virtual:pwa-register/react';
import { useCriticalOperation } from '../lib/pwa/critical-operation';

export function PwaUpdatePrompt() {
  const { activeOperations } = useCriticalOperation();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const updateBlocked = activeOperations > 0;

  if (!offlineReady && !needRefresh) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-xl border border-pedon-navy/15 bg-white p-4 shadow-xl"
    >
      {needRefresh ? (
        <>
          <p className="font-semibold text-pedon-navy">
            Uma nova versão do Ped-On está disponível.
          </p>
          <p className="mt-1 text-sm text-pedon-text/70">
            {updateBlocked
              ? 'Conclua a operação em andamento para atualizar sem interromper seus dados.'
              : 'Atualize quando estiver em um ponto seguro. A página será recarregada uma vez.'}
          </p>
          <button
            type="button"
            disabled={updateBlocked}
            onClick={() => void updateServiceWorker(true)}
            className="mt-3 min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateBlocked ? 'Aguardando operação' : 'Atualizar agora'}
          </button>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-pedon-navy">Aplicativo pronto para uso offline.</p>
          <button
            type="button"
            onClick={() => setOfflineReady(false)}
            className="min-h-11 px-2 text-sm font-semibold text-pedon-navy underline"
          >
            Fechar
          </button>
        </div>
      )}
    </aside>
  );
}
