import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminContext } from './admin-context';
import type { AdminContextValue } from './admin-context';
import { RequireOwner } from './guards';

function contextValue(overrides: Partial<AdminContextValue>): AdminContextValue {
  return {
    adminStatus: 'ready',
    error: null,
    profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
    organization: { id: 'org-1', name: 'Cantina' },
    role: 'owner',
    units: [],
    selectedUnit: null,
    canManageUnit: true,
    selectUnit: vi.fn(),
    refresh: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderGuarded(value: AdminContextValue, children: ReactNode) {
  return render(
    <AdminContext.Provider value={value}>
      <MemoryRouter initialEntries={['/app/clube']}>
        <Routes>
          <Route path="/app" element={<p>Painel</p>} />
          <Route path="/app/clube" element={<RequireOwner>{children}</RequireOwner>} />
        </Routes>
      </MemoryRouter>
    </AdminContext.Provider>,
  );
}

describe('RequireOwner', () => {
  it('renderiza o conteúdo para o proprietário', () => {
    renderGuarded(contextValue({ role: 'owner' }), <p>Conteúdo do Clube</p>);

    expect(screen.getByText('Conteúdo do Clube')).toBeInTheDocument();
  });

  it('redireciona para /app quando o perfil não é owner', () => {
    renderGuarded(contextValue({ role: 'manager' }), <p>Conteúdo do Clube</p>);

    expect(screen.getByText('Painel')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo do Clube')).not.toBeInTheDocument();
  });

  it('mostra carregamento enquanto o contexto não está pronto', () => {
    renderGuarded(contextValue({ adminStatus: 'loading' }), <p>Conteúdo do Clube</p>);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
    expect(screen.queryByText('Conteúdo do Clube')).not.toBeInTheDocument();
  });
});
