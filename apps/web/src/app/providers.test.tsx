import { useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from './providers';

function QueryProbe() {
  const query = useQuery({
    queryKey: ['provider-probe'],
    queryFn: async () => 'resposta-da-query',
  });

  return <p>{query.data ?? 'carregando'}</p>;
}

describe('AppProviders', () => {
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
});
