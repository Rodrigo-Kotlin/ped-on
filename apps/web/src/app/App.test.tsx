import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './router';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('App (roteamento)', () => {
  it('renderiza a identidade do Ped-On na rota raiz', () => {
    renderAt('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Ped-On' })).toBeInTheDocument();
    expect(screen.getByText('Gestão de Pedidos Inteligente')).toBeInTheDocument();
  });

  it('exibe a página de não encontrado para rota inexistente', () => {
    renderAt('/rota-inexistente');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  });
});
