import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import { AppShell } from '../components/AppShell';
import { AdminProvider } from '../lib/admin/AdminProvider';
import { RequireManageUnit } from '../lib/admin/guards';
import { AuthProvider } from '../lib/auth/AuthProvider';
import type { MenuPublicationAdmin } from '../lib/menu/menu';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { AppPage } from './AppPage';
import { CardapioPage } from './CardapioPage';

const unitOne = { id: 'unit-1', name: 'Loja Centro', is_active: true };

const publishedAt = '2026-08-10T12:00:00.000Z';
const publicPath = '/menu/abcdef1234567890abcdef12';

const notPublished: MenuPublicationAdmin = {
  unit: unitOne,
  publication: {
    exists: false,
    public_slug: null,
    public_path: null,
    published_at: null,
    updated_at: null,
  },
  current_version: null,
  history: [],
};

const published: MenuPublicationAdmin = {
  unit: unitOne,
  publication: {
    exists: true,
    public_slug: 'abcdef1234567890abcdef12',
    public_path: publicPath,
    published_at: publishedAt,
    updated_at: publishedAt,
  },
  current_version: {
    version_id: 'version-2',
    version_number: 2,
    created_at: publishedAt,
    category_count: 2,
    product_count: 4,
    is_current: true,
  },
  history: [
    {
      version_id: 'version-2',
      version_number: 2,
      created_at: publishedAt,
      category_count: 2,
      product_count: 4,
      is_current: true,
    },
    {
      version_id: 'version-1',
      version_number: 1,
      created_at: '2026-08-09T12:00:00.000Z',
      category_count: 1,
      product_count: 2,
      is_current: false,
    },
  ],
};

const publishResult = {
  version_id: 'version-3',
  version_number: 3,
  published_at: publishedAt,
  public_slug: 'abcdef1234567890abcdef12',
  public_path: publicPath,
  category_count: 2,
  product_count: 4,
};

function adminContext(role: 'owner' | 'manager' | 'operator' = 'owner') {
  return {
    profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
    organization: { id: 'org-1', name: 'Cantina da Praça' },
    role,
    units: [unitOne],
  };
}

function renderCardapio(
  options: {
    role?: 'owner' | 'manager' | 'operator';
    publication?: MenuPublicationAdmin;
    publishError?: { code: string; message: string };
  } = {},
) {
  const { role = 'owner', publication = notPublished, publishError } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let state = publication;

  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_my_admin_context') {
      return Promise.resolve({ data: adminContext(role), error: null });
    }
    if (fn === 'get_unit_menu_publication_admin') {
      return Promise.resolve({ data: state, error: null });
    }
    if (fn === 'publish_unit_menu') {
      if (publishError !== undefined) {
        return Promise.resolve({ data: null, error: publishError });
      }
      state = published;
      return Promise.resolve({ data: publishResult, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/cardapio']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  const ui = (
    <AuthProvider>
      <AdminProvider>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<AppPage />} />
            <Route
              path="cardapio"
              element={
                <RequireManageUnit>
                  <CardapioPage />
                </RequireManageUnit>
              }
            />
          </Route>
        </Routes>
      </AdminProvider>
    </AuthProvider>
  );

  return render(ui, { wrapper: Wrapper });
}

describe('CardapioPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('owner publica o primeiro cardápio e o status passa a publicado', async () => {
    const user = userEvent.setup();
    renderCardapio();

    expect(await screen.findByText('Este cardápio ainda não foi publicado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publicar cardápio' }));

    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('publish_unit_menu', { p_unit_id: 'unit-1' }),
    );
    expect(
      await screen.findByText('Cardápio publicado. A versão 3 está no ar.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Cardápio publicado e no ar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Link público do cardápio')).toHaveValue(
      `${window.location.origin}${publicPath}`,
    );
    expect(screen.getByRole('button', { name: 'Republicar cardápio' })).toBeInTheDocument();
  });

  it('exibe versão atual, link público e histórico ordenado', async () => {
    renderCardapio({ publication: published });

    expect(await screen.findByText('2 (2 categorias · 4 produtos)')).toBeInTheDocument();
    expect(screen.getByText('Versão atual:')).toBeInTheDocument();
    expect(screen.getByLabelText('Link público do cardápio')).toHaveValue(
      `${window.location.origin}${publicPath}`,
    );
    const historyList = screen.getByRole('list');
    expect(historyList).toHaveTextContent('Versão 2');
    expect(historyList).toHaveTextContent('Versão 1');
    expect(screen.getByText('Atual')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma versão publicada ainda.')).not.toBeInTheDocument();
  });

  it('republicação confirma antes de criar nova versão', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderCardapio({ publication: published });

    await screen.findByText('Cardápio publicado e no ar.');
    await user.click(screen.getByRole('button', { name: 'Republicar cardápio' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Publicar uma nova versão do cardápio?'),
    );
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('publish_unit_menu', { p_unit_id: 'unit-1' }),
    );
  });

  it('copia o link público para a área de transferência', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderCardapio({ publication: published });

    await screen.findByText('Cardápio publicado e no ar.');
    await user.click(screen.getByRole('button', { name: 'Copiar link' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${publicPath}`),
    );
    expect(await screen.findByRole('button', { name: 'Copiado!' })).toBeInTheDocument();
  });

  it('mapeia MENU_EMPTY para feedback amigável ao tentar publicar vazio', async () => {
    const user = userEvent.setup();
    renderCardapio({
      publishError: { code: 'P0001', message: 'PED31: MENU_EMPTY' },
    });

    await screen.findByText('Este cardápio ainda não foi publicado.');
    await user.click(screen.getByRole('button', { name: 'Publicar cardápio' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cardápio está vazio/);
  });

  it('mapeia PED73 para feedback amigável sem vazar detalhes da regra', async () => {
    const user = userEvent.setup();
    renderCardapio({
      publishError: {
        code: 'P0001',
        message: 'PED73: INVALID_SELECTION_RULE: must have at least one active option',
      },
    });

    await screen.findByText('Este cardápio ainda não foi publicado.');
    await user.click(screen.getByRole('button', { name: 'Publicar cardápio' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/grupo obrigatório não possui opções ativas suficientes/);
    expect(alert).not.toHaveTextContent('INVALID_SELECTION_RULE');
    expect(alert).not.toHaveTextContent('P0001');
  });

  it('manager com publicação existente vê o link e pode republicar', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderCardapio({ role: 'manager', publication: published });

    await screen.findByText('Cardápio publicado e no ar.');
    expect(screen.getByRole('link', { name: 'Cardápio' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Republicar cardápio' }));
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('publish_unit_menu', { p_unit_id: 'unit-1' }),
    );
  });

  it('operador é redirecionado para o app sem carregar a publicação', async () => {
    renderCardapio({ role: 'operator', publication: published });

    expect(await screen.findByText('Visão geral')).toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      'get_unit_menu_publication_admin',
      expect.anything(),
    );
    expect(screen.queryByText('Publicar cardápio')).not.toBeInTheDocument();
  });
});
