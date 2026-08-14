import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartStorageKey } from '../lib/cart/cart';
import { AppProviders } from './providers';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import { resetSupabaseMock } from '../test/supabaseMock';

function QueryProbe() {
  const query = useQuery({
    queryKey: ['provider-probe'],
    queryFn: async () => 'resposta-da-query',
  });

  return <p>{query.data ?? 'carregando'}</p>;
}

describe('AppProviders', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('renderiza os filhos sem quebrar', () => {
    render(
      <AppProviders>
        <p>filho renderizado</p>
      </AppProviders>,
    );

    expect(screen.getByText('filho renderizado')).toBeInTheDocument();
  });

  it('permite que hooks do TanStack Query funcionem', async () => {
    render(
      <AppProviders>
        <QueryProbe />
      </AppProviders>,
    );

    expect(await screen.findByText('resposta-da-query')).toBeInTheDocument();
  });

  it('saneia carrinhos legados no bootstrap, independentemente da rota', async () => {
    const legacyWithNote = JSON.stringify({
      slug: 'abc',
      menuVersionId: 'version-1',
      items: [
        { menu_item_id: 'item-1', name: 'Lanche', unit_price: '10.10', quantity: 3, note: 'PII' },
      ],
    });
    window.localStorage.setItem(cartStorageKey('abc'), legacyWithNote);

    render(
      <AppProviders>
        <p>bootstrap</p>
      </AppProviders>,
    );

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(cartStorageKey('abc'))!).items[0].note,
      ).toBeUndefined(),
    );
  });
});
