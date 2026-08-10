import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { AuthProvider } from '../lib/auth/AuthProvider';
import type { AdminCatalog } from '../lib/catalog/catalog';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { CatalogoPage } from './CatalogoPage';

const unitOne = { id: 'unit-1', name: 'Loja Centro', is_active: true };
const unitTwo = { id: 'unit-2', name: 'Loja Norte', is_active: true };

function adminContext(role: 'owner' | 'manager' | 'operator' = 'owner', units = [unitOne]) {
  return {
    profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
    organization: { id: 'org-1', name: 'Cantina da Praça' },
    role,
    units,
  };
}

function catalog(overrides: Partial<AdminCatalog> = {}): AdminCatalog {
  return {
    unit: { id: unitOne.id, name: unitOne.name },
    can_manage: true,
    role: 'owner',
    categories: [],
    ...overrides,
  };
}

const fullCatalog = catalog({
  categories: [
    {
      id: 'category-1',
      name: 'Lanches',
      sort_order: 1,
      is_active: true,
      products: [
        {
          id: 'product-1',
          name: 'X-Salada',
          description: 'Pão, carne e salada',
          price: '29.90',
          sort_order: 1,
          is_active: true,
          is_available: true,
        },
      ],
    },
    {
      id: 'category-2',
      name: 'Bebidas',
      sort_order: 2,
      is_active: false,
      products: [],
    },
  ],
});

function renderCatalog({ shell = false }: { shell?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/catalogo']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  const ui = shell ? (
    <AuthProvider>
      <AdminProvider>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="catalogo" element={<CatalogoPage />} />
          </Route>
        </Routes>
      </AdminProvider>
    </AuthProvider>
  ) : (
    <AdminProvider>
      <CatalogoPage />
    </AdminProvider>
  );

  return { ...render(ui, { wrapper: Wrapper }), queryClient, invalidateSpy };
}

function mockRpc(options: {
  role?: 'owner' | 'manager' | 'operator';
  units?: (typeof unitOne)[];
  catalogs?: Record<string, AdminCatalog>;
  mutationError?: { code: string; message: string };
}) {
  const {
    role = 'owner',
    units = [unitOne],
    catalogs = { [unitOne.id]: fullCatalog },
    mutationError,
  } = options;
  supabaseMock.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    if (fn === 'get_my_admin_context') {
      return Promise.resolve({ data: adminContext(role, units), error: null });
    }
    if (fn === 'get_unit_catalog_admin') {
      return Promise.resolve({
        data: catalogs[String(args?.p_unit_id)],
        error: null,
      });
    }
    if (mutationError !== undefined) {
      return Promise.resolve({ data: null, error: mutationError });
    }
    return Promise.resolve({ data: { confirmed: true }, error: null });
  });
}

describe('CatalogoPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('exibe loading, usa a selectedUnit e apresenta o estado vazio', async () => {
    let resolveCatalog!: (value: { data: AdminCatalog; error: null }) => void;
    const pendingCatalog = new Promise<{ data: AdminCatalog; error: null }>((resolve) => {
      resolveCatalog = resolve;
    });
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext(), error: null });
      }
      if (fn === 'get_unit_catalog_admin') {
        return pendingCatalog;
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderCatalog();

    expect(await screen.findByRole('status')).toHaveTextContent('Carregando catálogo da unidade');
    expect(screen.getByText('Loja Centro')).toBeInTheDocument();

    resolveCatalog({ data: catalog(), error: null });

    expect(
      await screen.findByRole('heading', { name: 'Nenhuma categoria cadastrada.' }),
    ).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_catalog_admin', {
      p_unit_id: 'unit-1',
    });
  });

  it('apresenta estados profissionais de erro e ausência de unidade', async () => {
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext(), error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'PED12', message: 'PED12' } });
    });

    const firstRender = renderCatalog();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unidade não encontrada');
    firstRender.unmount();

    resetSupabaseMock();
    mockRpc({ units: [], catalogs: {} });
    renderCatalog();
    expect(
      await screen.findByRole('heading', { name: 'Nenhuma unidade selecionada' }),
    ).toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('get_unit_catalog_admin', expect.anything());
  });

  it('owner cria e edita categoria, confirma desativação e invalida somente a query da unidade', async () => {
    const user = userEvent.setup();
    mockRpc({ catalogs: { [unitOne.id]: fullCatalog } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { invalidateSpy } = renderCatalog();

    await screen.findByRole('heading', { name: 'Lanches' });
    await user.click(screen.getByRole('button', { name: 'Nova categoria' }));
    await user.type(screen.getByLabelText('Nome da categoria'), '  Sobremesas  ');
    await user.click(screen.getByRole('button', { name: 'Criar categoria' }));

    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('create_catalog_category', {
        p_unit_id: 'unit-1',
        p_name: 'Sobremesas',
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin-catalog', 'unit-1'],
      exact: true,
    });

    await user.click(screen.getAllByRole('button', { name: 'Editar categoria' })[0]!);
    const categoryName = screen.getByLabelText('Nome da categoria');
    await user.clear(categoryName);
    await user.type(categoryName, 'Hambúrgueres');
    await user.click(screen.getByRole('button', { name: 'Salvar categoria' }));
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('update_catalog_category', {
        p_category_id: 'category-1',
        p_name: 'Hambúrgueres',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Desativar categoria' }));
    expect(confirmSpy).toHaveBeenCalledWith('Desativar a categoria “Lanches”?');
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_category_active', {
        p_category_id: 'category-1',
        p_is_active: false,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Ativar categoria' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_category_active', {
        p_category_id: 'category-2',
        p_is_active: true,
      }),
    );
  });

  it('mapeia conflito de categoria PED23 para feedback amigável', async () => {
    const user = userEvent.setup();
    mockRpc({
      catalogs: { [unitOne.id]: catalog() },
      mutationError: { code: 'P0001', message: 'PED23: duplicate category' },
    });
    renderCatalog();

    await screen.findByRole('heading', { name: 'Nenhuma categoria cadastrada.' });
    await user.click(screen.getByRole('button', { name: 'Criar primeira categoria' }));
    await user.type(screen.getByLabelText('Nome da categoria'), 'Lanches');
    await user.click(screen.getByRole('button', { name: 'Criar categoria' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma categoria com esse nome nesta unidade.',
    );
  });

  it('cria produto com preço BR canônico e valida limites sem cálculo em ponto flutuante', async () => {
    const user = userEvent.setup();
    mockRpc({ catalogs: { [unitOne.id]: fullCatalog } });
    renderCatalog();

    await screen.findByRole('heading', { name: 'Lanches' });
    await user.click(screen.getByRole('button', { name: 'Novo produto em Bebidas' }));
    await user.type(screen.getByLabelText('Nome do produto'), 'Suco');
    await user.type(screen.getByLabelText('Preço (R$)'), '29,90');
    await user.click(screen.getByRole('button', { name: 'Criar produto' }));

    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('create_catalog_product', {
        p_unit_id: 'unit-1',
        p_category_id: 'category-2',
        p_name: 'Suco',
        p_description: null,
        p_price: '29.90',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Novo produto em Bebidas' }));
    await user.type(screen.getByLabelText('Nome do produto'), 'Inválido');
    await user.type(screen.getByLabelText('Preço (R$)'), '1e3');
    await user.click(screen.getByRole('button', { name: 'Criar produto' }));
    expect(await screen.findByText('Não use notação exponencial no preço.')).toBeInTheDocument();
  });

  it('edita e move produto, altera active com confirmação e availability sem confirmação', async () => {
    const user = userEvent.setup();
    mockRpc({ catalogs: { [unitOne.id]: fullCatalog } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderCatalog();

    await screen.findByRole('heading', { name: 'X-Salada' });
    await user.click(screen.getByRole('button', { name: 'Editar X-Salada' }));
    await user.selectOptions(screen.getByLabelText('Categoria'), 'category-2');
    await user.clear(screen.getByLabelText('Nome do produto'));
    await user.type(screen.getByLabelText('Nome do produto'), 'X-Salada especial');
    await user.clear(screen.getByLabelText('Preço (R$)'));
    await user.type(screen.getByLabelText('Preço (R$)'), '31');
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));

    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('update_catalog_product', {
        p_product_id: 'product-1',
        p_category_id: 'category-2',
        p_name: 'X-Salada especial',
        p_description: 'Pão, carne e salada',
        p_price: '31.00',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Desativar produto' }));
    expect(confirmSpy).toHaveBeenCalledWith('Desativar o produto “X-Salada”?');
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_product_active', {
        p_product_id: 'product-1',
        p_is_active: false,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Marcar como indisponível/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(supabaseMock.rpc).toHaveBeenCalledWith('set_catalog_product_available', {
        p_product_id: 'product-1',
        p_is_available: false,
      }),
    );
  });

  it('exibe controles completos ao manager e restringe operator somente à availability', async () => {
    mockRpc({ role: 'manager', catalogs: { [unitOne.id]: fullCatalog } });
    const managerRender = renderCatalog({ shell: true });

    await screen.findByRole('heading', { name: 'X-Salada' });
    expect(screen.getByRole('link', { name: 'Catálogo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova categoria' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar X-Salada' })).toBeInTheDocument();
    managerRender.unmount();

    resetSupabaseMock();
    mockRpc({
      role: 'operator',
      catalogs: {
        [unitOne.id]: catalog({ ...fullCatalog, can_manage: false, role: 'operator' }),
      },
    });
    renderCatalog({ shell: true });

    await screen.findByRole('heading', { name: 'X-Salada' });
    expect(screen.getByRole('link', { name: 'Catálogo' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Como operador, você pode alterar apenas a disponibilidade dos produtos.',
    );
    expect(screen.queryByRole('button', { name: 'Nova categoria' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar X-Salada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desativar produto' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Marcar como indisponível/ })).toBeInTheDocument();
  });

  it('troca a query key com a unidade sem manter conteúdo visual da unidade anterior', async () => {
    const user = userEvent.setup();
    let resolveSecond!: (value: { data: AdminCatalog; error: null }) => void;
    const secondCatalog = new Promise<{ data: AdminCatalog; error: null }>((resolve) => {
      resolveSecond = resolve;
    });
    supabaseMock.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
      if (fn === 'get_my_admin_context') {
        return Promise.resolve({ data: adminContext('owner', [unitOne, unitTwo]), error: null });
      }
      if (fn === 'get_unit_catalog_admin' && args?.p_unit_id === 'unit-1') {
        return Promise.resolve({ data: fullCatalog, error: null });
      }
      if (fn === 'get_unit_catalog_admin') {
        return secondCatalog;
      }
      return Promise.resolve({ data: { confirmed: true }, error: null });
    });
    renderCatalog({ shell: true });

    await screen.findByRole('heading', { name: 'X-Salada' });
    await user.selectOptions(screen.getByLabelText('Selecionar unidade'), 'unit-2');

    expect(await screen.findByText('Carregando catálogo da unidade…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'X-Salada' })).not.toBeInTheDocument();
    resolveSecond({
      data: catalog({
        unit: { id: unitTwo.id, name: unitTwo.name },
        categories: [
          {
            id: 'category-3',
            name: 'Massas',
            sort_order: 1,
            is_active: true,
            products: [],
          },
        ],
      }),
      error: null,
    });

    expect(await screen.findByRole('heading', { name: 'Massas' })).toBeInTheDocument();
    expect(screen.getAllByText('Loja Norte')).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_unit_catalog_admin', {
      p_unit_id: 'unit-2',
    });
    expect(within(screen.getByRole('main')).queryByText('X-Salada')).not.toBeInTheDocument();
  });
});
