import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalOrderStatus } from './OperationalOrderStatus';

function renderStatus(props: Partial<Parameters<typeof OperationalOrderStatus>[0]> = {}) {
  const dismissAlert = vi.fn();
  const onToggleSound = vi.fn();
  const onViewKitchen = vi.fn();
  const onViewOrders = vi.fn();
  render(
    <OperationalOrderStatus
      realtimeStatus="connected"
      alert={null}
      dismissAlert={dismissAlert}
      soundEnabled={false}
      soundUnavailable={false}
      onToggleSound={onToggleSound}
      onViewKitchen={onViewKitchen}
      onViewOrders={onViewOrders}
      {...props}
    />,
  );
  return { dismissAlert, onToggleSound, onViewKitchen, onViewOrders };
}

describe('OperationalOrderStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra a mensagem de tempo real degradado com role=status', () => {
    renderStatus({ realtimeStatus: 'degraded' });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Tempo real indisponível. Atualização periódica continua ativa.',
    );
  });

  it('exibe alerta de lote com ações de navegação e fechar', async () => {
    const user = userEvent.setup();
    const { dismissAlert, onViewKitchen, onViewOrders } = renderStatus({
      alert: { unitId: 'unit-1', count: 3, orderNumbers: [2, 3, 4] },
    });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('3 novos pedidos recebidos.');

    await user.click(screen.getByRole('button', { name: 'Ver cozinha' }));
    expect(onViewKitchen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Ver pedidos' }));
    expect(onViewOrders).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Fechar alerta' }));
    expect(dismissAlert).toHaveBeenCalledTimes(1);
  });

  it('mostra o número quando há um único pedido novo', () => {
    renderStatus({ alert: { unitId: 'unit-1', count: 1, orderNumbers: [7] } });
    expect(screen.getByRole('status')).toHaveTextContent('Novo pedido #7 recebido.');
  });

  it('alterna o som com aria-pressed e o clique dispara o toggle', async () => {
    const user = userEvent.setup();
    const { onToggleSound } = renderStatus({ soundEnabled: true });

    const toggle = screen.getByRole('button', { name: 'Silenciar som' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(onToggleSound).toHaveBeenCalledTimes(1);
  });

  it('informa quando o som não está disponível no navegador', () => {
    renderStatus({ soundUnavailable: true });
    expect(screen.getByRole('status')).toHaveTextContent('Som indisponível neste navegador.');
    expect(screen.queryByRole('button', { name: /som/i })).not.toBeInTheDocument();
  });
});
