import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CriticalOperationProvider, useCriticalOperation } from '../lib/pwa/critical-operation';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const pwaState = vi.hoisted(() => ({
  offlineReady: false,
  needRefresh: false,
  setOfflineReady: vi.fn(),
  updateServiceWorker: vi.fn(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [pwaState.offlineReady, pwaState.setOfflineReady],
    needRefresh: [pwaState.needRefresh, vi.fn()],
    updateServiceWorker: pwaState.updateServiceWorker,
  }),
}));

function renderPrompt(children?: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CriticalOperationProvider>
        <PwaUpdatePrompt />
        {children}
      </CriticalOperationProvider>
    </QueryClientProvider>,
  );
}

function DeferredCriticalOperation({ operation }: { operation: () => Promise<void> }) {
  const { runCriticalOperation } = useCriticalOperation();
  return (
    <button type="button" onClick={() => void runCriticalOperation(operation)}>
      Iniciar operação direta
    </button>
  );
}

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    pwaState.offlineReady = false;
    pwaState.needRefresh = false;
    pwaState.setOfflineReady.mockReset();
    pwaState.updateServiceWorker.mockReset();
  });

  it('fica oculto quando não há evento do service worker', () => {
    renderPrompt();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('oferece aplicar a nova versão somente por ação explícita', () => {
    pwaState.needRefresh = true;
    renderPrompt();

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));

    expect(pwaState.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('permite fechar o aviso de disponibilidade offline', () => {
    pwaState.offlineReady = true;
    renderPrompt();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(pwaState.setOfflineReady).toHaveBeenCalledWith(false);
  });

  it('bloqueia a atualização durante checkout ou redemption em andamento', async () => {
    pwaState.needRefresh = true;
    let resolveOperation = () => {};
    const operation = () => new Promise<void>((resolve) => (resolveOperation = resolve));
    renderPrompt(<DeferredCriticalOperation operation={operation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar operação direta' }));
    expect(await screen.findByRole('button', { name: 'Aguardando operação' })).toBeDisabled();

    await act(async () => resolveOperation());
    expect(await screen.findByRole('button', { name: 'Atualizar agora' })).toBeEnabled();
  });

  it('mantém o bloqueio independente do cache do React Query', async () => {
    pwaState.needRefresh = true;
    let resolveOperation = () => {};
    const operation = () => new Promise<void>((resolve) => (resolveOperation = resolve));
    renderPrompt(<DeferredCriticalOperation operation={operation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar operação direta' }));
    expect(await screen.findByRole('button', { name: 'Aguardando operação' })).toBeDisabled();

    await act(async () => resolveOperation());
    expect(await screen.findByRole('button', { name: 'Atualizar agora' })).toBeEnabled();
  });
});
