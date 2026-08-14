import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { TrackingPage } from './TrackingPage';

function renderTracking() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/pedido/token']}>
          <Routes>
            <Route path="/pedido/:trackingToken" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<TrackingPage />, { wrapper: Wrapper });
}

describe('TrackingPage', () => {
  beforeEach(() => resetSupabaseMock());

  it('renderiza dados públicos, ETA e atualiza sob demanda sem PII/IDs', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({
      data: {
        found: true,
        organization: { name: 'Cantina' },
        unit: { name: 'Centro' },
        order: {
          order_number: 42,
          status: 'preparing',
          payment_status: 'pending',
          service_mode: 'delivery',
          payment_method: 'cash',
          subtotal: '29.90',
          delivery_fee: '6.50',
          total: '36.40',
          estimated_minutes: 40,
          created_at: '2026-08-10T12:00:00Z',
          status_updated_at: '2026-08-10T12:05:00Z',
          completed_at: null,
          cancelled_at: null,
          items: [
            {
              name: 'X-Salada',
              unit_price: '29.90',
              quantity: 1,
              line_total: '29.90',
              note: 'segredo que não pode aparecer',
              options: [
                {
                  group_name: 'Tamanho',
                  group_kind: 'variation',
                  option_name: 'Duplo',
                  price_delta: '5.00',
                },
                {
                  group_name: 'Adicionais',
                  group_kind: 'addon',
                  option_name: 'Bacon',
                  price_delta: '4.00',
                },
                {
                  group_name: 'Sem',
                  group_kind: 'removal',
                  option_name: 'Sem cebola',
                  price_delta: '0.00',
                },
              ],
            },
          ],
        },
      },
      error: null,
    });
    renderTracking();

    expect(await screen.findByRole('heading', { name: 'Pedido #42' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Em preparo');
    expect(screen.getByText('Previsão informada: cerca de 40 min')).toBeInTheDocument();
    expect(screen.getByText('R$ 36,40')).toBeInTheDocument();
    expect(screen.getByText('Tamanho: Duplo')).toBeInTheDocument();
    expect(screen.getByText('+ Bacon')).toBeInTheDocument();
    expect(screen.getByText('Sem cebola')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /customer|phone|organization_id|unit_id|tracking_token/,
    );
    expect(document.body).not.toHaveTextContent('segredo que não pode aparecer');
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
  });

  it('mostra found false sem inventar sucesso', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { found: false }, error: null });
    renderTracking();
    expect(
      await screen.findByRole('heading', { name: 'Pedido não encontrado' }),
    ).toBeInTheDocument();
  });

  it('mantém pedido simples antigo legível sem bloco de opções', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        found: true,
        organization: { name: 'Cantina' },
        unit: { name: 'Centro' },
        order: {
          order_number: 43,
          status: 'completed',
          payment_status: 'paid',
          service_mode: 'pickup',
          payment_method: 'pix',
          subtotal: '10.00',
          delivery_fee: '0.00',
          total: '10.00',
          estimated_minutes: null,
          created_at: '2026-08-10T12:00:00Z',
          status_updated_at: '2026-08-10T12:20:00Z',
          completed_at: '2026-08-10T12:20:00Z',
          cancelled_at: null,
          items: [
            { name: 'Suco', unit_price: '10.00', quantity: 1, line_total: '10.00', options: [] },
          ],
        },
      },
      error: null,
    });
    renderTracking();
    expect(await screen.findByText('Suco')).toBeInTheDocument();
    expect(screen.queryByText(/Tamanho:|\+ Bacon|Sem cebola/)).not.toBeInTheDocument();
  });
});
