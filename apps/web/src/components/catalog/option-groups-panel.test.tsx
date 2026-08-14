import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () =>
  import('../../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import type {
  CatalogProductOption,
  CatalogProductOptionGroup,
} from '../../lib/catalog/product-options';
import { mockFromQuery, resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import { OptionGroupsPanel } from './option-groups-panel';

function group(overrides: Partial<CatalogProductOptionGroup>): CatalogProductOptionGroup {
  return {
    id: 'g-1',
    organization_id: 'org-1',
    unit_id: 'unit-1',
    product_id: 'product-1',
    name: 'Tamanho',
    kind: 'variation',
    selection_mode: 'single',
    min_select: 1,
    max_select: 1,
    is_active: true,
    sort_order: 1,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

function option(overrides: Partial<CatalogProductOption>): CatalogProductOption {
  return {
    id: 'o-1',
    organization_id: 'org-1',
    unit_id: 'unit-1',
    product_id: 'product-1',
    group_id: 'g-1',
    name: 'Médio',
    price_delta: '0.00',
    is_active: true,
    is_available: true,
    sort_order: 1,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

const defaultGroups = [
  group({ id: 'g-1', name: 'Tamanho', kind: 'variation', sort_order: 1 }),
  group({
    id: 'g-2',
    name: 'Adicionais',
    kind: 'addon',
    selection_mode: 'multiple',
    min_select: 0,
    max_select: 3,
    sort_order: 2,
  }),
];

const defaultOptions = [
  option({ id: 'o-1', group_id: 'g-1', name: 'Médio', price_delta: '0.00', sort_order: 1 }),
  option({ id: 'o-2', group_id: 'g-1', name: 'Grande', price_delta: '4.00', sort_order: 2 }),
  option({
    id: 'o-3',
    group_id: 'g-2',
    name: 'Queijo extra',
    price_delta: '5.00',
    sort_order: 1,
    is_available: false,
  }),
];

const optionsKey = ['admin-catalog-options', 'unit-1', 'product-1'];

function renderPanel(
  options: {
    groups?: CatalogProductOptionGroup[];
    optionsList?: CatalogProductOption[];
    canManage?: boolean;
    from?: (table: string) => ReturnType<typeof mockFromQuery<unknown[]>>;
  } = {},
) {
  const { groups = defaultGroups, optionsList = defaultOptions, canManage = true, from } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const rpc = supabaseMock.rpc.mockResolvedValue({ data: { confirmed: true }, error: null });
  const rows = { catalog_product_option_groups: groups, catalog_product_options: optionsList };
  supabaseMock.from.mockImplementation((table: string) =>
    from
      ? from(table)
      : mockFromQuery({ data: rows[table as keyof typeof rows] ?? null, error: null }),
  );

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const utils = render(
    <OptionGroupsPanel
      unitId="unit-1"
      productId="product-1"
      productName="X-Salada"
      canManage={canManage}
      onClose={() => undefined}
    />,
    { wrapper: Wrapper },
  );

  return { ...utils, invalidateSpy, rpc };
}

async function waitForLoadedPanel() {
  return screen.findByText('Tamanho');
}

async function waitForLoadedEmptyPanel() {
  return screen.findByText('Este produto ainda não possui grupos de opções.');
}

async function openNewGroupForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Novo grupo' }));
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('OptionGroupsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSupabaseMock();
    setNavigatorOnline(true);
    onlineManager.setOnline(true);
  });

  it('mostra carregamento e depois os grupos e opções', async () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'X-Salada' })).toBeInTheDocument();
    expect(screen.getByText('Carregando opções do produto…')).toBeInTheDocument();

    expect(await waitForLoadedPanel()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Adicionais' })).toBeInTheDocument();
    expect(screen.getByText('Obrigatório — escolha 1')).toBeInTheDocument();
    expect(screen.getByText('Opcional — escolha até 3')).toBeInTheDocument();
    expect(screen.getByText('+ R$ 4,00')).toBeInTheDocument();
    expect(screen.getByText('Sem acréscimo')).toBeInTheDocument();
    expect(screen.getByText('INDISPONÍVEL')).toBeInTheDocument();
  });

  it('mostra o estado vazio e permite criar o primeiro grupo', async () => {
    renderPanel({ groups: [], optionsList: [] });

    expect(await waitForLoadedEmptyPanel()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo grupo' })).toBeInTheDocument();
  });

  it('mostra erro de carregamento com tentativa novamente', async () => {
    let failing = true;
    renderPanel({
      groups: [],
      optionsList: [],
      from: () =>
        mockFromQuery({
          data: null,
          error: failing ? { message: 'connection failed' } : null,
        }),
    });

    expect(
      await screen.findByText('Não foi possível carregar as opções: connection failed'),
    ).toBeInTheDocument();

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await waitForLoadedEmptyPanel()).toBeInTheDocument();
  });

  it('cria um grupo de variação com escolha única obrigatória', async () => {
    const user = userEvent.setup();
    const { rpc, invalidateSpy } = renderPanel({ groups: [], optionsList: [] });

    await waitForLoadedEmptyPanel();
    await openNewGroupForm();
    await user.selectOptions(screen.getByLabelText('Tipo'), 'variation');
    await user.type(screen.getByLabelText('Nome do grupo'), 'Tamanho');

    expect(screen.getByLabelText('Modo de seleção')).toBeDisabled();
    expect(screen.getByLabelText('Máximo')).toBeDisabled();
    expect(screen.getByLabelText('Máximo')).toHaveValue(1);
    expect(screen.getByLabelText('Mínimo')).toHaveValue(1);
    expect(
      screen.getByText('Obrigatório pelo contrato: variações usam escolha única.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option_group', {
        p_unit_id: 'unit-1',
        p_product_id: 'product-1',
        p_name: 'Tamanho',
        p_kind: 'variation',
        p_selection_mode: 'single',
        p_min_select: 1,
        p_max_select: 1,
      }),
    );
    expect(await screen.findByText('Grupo criado com sucesso.')).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: optionsKey, exact: true });
  });

  it('cria um grupo de adicionais com múltipla escolha opcional', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel({ groups: [], optionsList: [] });

    await waitForLoadedEmptyPanel();
    await openNewGroupForm();
    await user.type(screen.getByLabelText('Nome do grupo'), 'Adicionais');
    await user.clear(screen.getByLabelText('Máximo'));
    await user.type(screen.getByLabelText('Máximo'), '3');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option_group', {
        p_unit_id: 'unit-1',
        p_product_id: 'product-1',
        p_name: 'Adicionais',
        p_kind: 'addon',
        p_selection_mode: 'multiple',
        p_min_select: 0,
        p_max_select: 3,
      }),
    );
  });

  it('fixa o máximo em 1 para qualquer grupo de escolha única', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel({ groups: [], optionsList: [] });

    await waitForLoadedEmptyPanel();
    await openNewGroupForm();
    await user.type(screen.getByLabelText('Nome do grupo'), 'Molho principal');
    await user.selectOptions(screen.getByLabelText('Modo de seleção'), 'single');

    expect(screen.getByLabelText('Máximo')).toBeDisabled();
    expect(screen.getByLabelText('Máximo')).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option_group', {
        p_unit_id: 'unit-1',
        p_product_id: 'product-1',
        p_name: 'Molho principal',
        p_kind: 'addon',
        p_selection_mode: 'single',
        p_min_select: 0,
        p_max_select: 1,
      }),
    );
  });

  it('cria um grupo de remoções com mínimo fixo em 0 e sem acréscimo', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel({ groups: [], optionsList: [] });

    await waitForLoadedEmptyPanel();
    await openNewGroupForm();
    await user.selectOptions(screen.getByLabelText('Tipo'), 'removal');
    await user.type(screen.getByLabelText('Nome do grupo'), 'Retirar ingredientes');

    expect(screen.getByLabelText('Modo de seleção')).toBeDisabled();
    expect(screen.getByLabelText('Mínimo')).toBeDisabled();
    expect(screen.getByLabelText('Mínimo')).toHaveValue(0);

    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option_group', {
        p_unit_id: 'unit-1',
        p_product_id: 'product-1',
        p_name: 'Retirar ingredientes',
        p_kind: 'removal',
        p_selection_mode: 'multiple',
        p_min_select: 0,
        p_max_select: 5,
      }),
    );
  });

  it('rejeita mínimo maior que máximo e não chama a mutação', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel({ groups: [], optionsList: [] });

    await waitForLoadedEmptyPanel();
    await openNewGroupForm();
    await user.type(screen.getByLabelText('Nome do grupo'), 'Adicionais');
    await user.clear(screen.getByLabelText('Mínimo'));
    await user.type(screen.getByLabelText('Mínimo'), '3');
    await user.clear(screen.getByLabelText('Máximo'));
    await user.type(screen.getByLabelText('Máximo'), '2');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));

    expect(
      await screen.findByText('O mínimo não pode ser maior que o máximo.'),
    ).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('edita um grupo existente preservando a regra', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Editar grupo' })[1]!);
    const nameInput = screen.getByLabelText('Nome do grupo');
    await user.clear(nameInput);
    await user.type(nameInput, 'Extras');
    await user.clear(screen.getByLabelText('Máximo'));
    await user.type(screen.getByLabelText('Máximo'), '4');
    await user.click(screen.getByRole('button', { name: 'Salvar grupo' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('update_catalog_product_option_group', {
        p_group_id: 'g-2',
        p_name: 'Extras',
        p_kind: 'addon',
        p_selection_mode: 'multiple',
        p_min_select: 0,
        p_max_select: 4,
      }),
    );
    expect(await screen.findByText('Grupo atualizado com sucesso.')).toBeInTheDocument();
  });

  it('cria opção com preço positivo em grupo de adicionais', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Nova opção' })[1]!);
    await user.type(screen.getByLabelText('Nome da opção'), 'Queijo extra');
    const priceInput = screen.getByLabelText('Preço adicional (R$)');
    await user.clear(priceInput);
    await user.type(priceInput, '5,00');
    await user.click(screen.getByRole('button', { name: 'Criar opção' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option', {
        p_group_id: 'g-2',
        p_name: 'Queijo extra',
        p_price_delta: '5.00',
      }),
    );
    expect(await screen.findByText('Opção criada com sucesso.')).toBeInTheDocument();
  });

  it('cria opção com desconto (preço negativo) em grupo de variação', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Nova opção' })[0]!);
    await user.type(screen.getByLabelText('Nome da opção'), 'Grande');
    const priceInput = screen.getByLabelText('Preço adicional (R$)');
    await user.clear(priceInput);
    await user.type(priceInput, '-3,00');
    await user.click(screen.getByRole('button', { name: 'Criar opção' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option', {
        p_group_id: 'g-1',
        p_name: 'Grande',
        p_price_delta: '-3.00',
      }),
    );
  });

  it('rejeita preço negativo em adicional e não chama a mutação', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Nova opção' })[1]!);
    await user.type(screen.getByLabelText('Nome da opção'), 'Molho');
    const priceInput = screen.getByLabelText('Preço adicional (R$)');
    await user.clear(priceInput);
    await user.type(priceInput, '-1,00');
    await user.click(screen.getByRole('button', { name: 'Criar opção' }));

    expect(await screen.findByText('Adicionais não podem ter preço negativo.')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cria opção em grupo de remoção sempre sem acréscimo', async () => {
    const user = userEvent.setup();
    const removalGroups = [
      ...defaultGroups,
      group({
        id: 'g-3',
        name: 'Retirar ingredientes',
        kind: 'removal',
        selection_mode: 'multiple',
        min_select: 0,
        max_select: 5,
        sort_order: 3,
      }),
    ];
    const { rpc } = renderPanel({ groups: removalGroups });

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Nova opção' })[2]!);
    expect(screen.getByLabelText('Preço adicional (remoção sem acréscimo)')).toHaveValue(
      'Sem acréscimo',
    );
    await user.type(screen.getByLabelText('Nome da opção'), 'Sem cebola');
    await user.click(screen.getByRole('button', { name: 'Criar opção' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_catalog_product_option', {
        p_group_id: 'g-3',
        p_name: 'Sem cebola',
        p_price_delta: '0.00',
      }),
    );
  });

  it('edita uma opção existente', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Editar' })[2]!);
    const nameInput = screen.getByLabelText('Nome da opção');
    await user.clear(nameInput);
    await user.type(nameInput, 'Extra queijo');
    const priceInput = screen.getByLabelText('Preço adicional (R$)');
    await user.clear(priceInput);
    await user.type(priceInput, '6,00');
    await user.click(screen.getByRole('button', { name: 'Salvar opção' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('update_catalog_product_option', {
        p_option_id: 'o-3',
        p_name: 'Extra queijo',
        p_price_delta: '6.00',
      }),
    );
    expect(await screen.findByText('Opção atualizada com sucesso.')).toBeInTheDocument();
  });

  it('desativa um grupo após confirmação', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Desativar grupo' })[1]!);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_catalog_product_option_group_active', {
        p_group_id: 'g-2',
        p_is_active: false,
      }),
    );
    expect(await screen.findByText('Grupo desativado com sucesso.')).toBeInTheDocument();
  });

  it('desativa uma opção', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getAllByRole('button', { name: 'Desativar' })[1]!);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_catalog_product_option_active', {
        p_option_id: 'o-2',
        p_is_active: false,
      }),
    );
    expect(await screen.findByText('Opção desativada com sucesso.')).toBeInTheDocument();
  });

  it('alterna a disponibilidade de uma opção', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel();

    await waitForLoadedPanel();
    await user.click(screen.getByRole('button', { name: 'Indisponível: Médio' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_catalog_product_option_available', {
        p_option_id: 'o-1',
        p_is_available: false,
      }),
    );
    expect(await screen.findByText('Opção marcada como indisponível.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Disponível: Queijo extra' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_catalog_product_option_available', {
        p_option_id: 'o-3',
        p_is_available: true,
      }),
    );
    expect(await screen.findByText('Opção marcada como disponível.')).toBeInTheDocument();
  });

  it('operador visualiza mas não altera estrutura', async () => {
    renderPanel({ canManage: false });

    expect(
      await screen.findByText(
        'Como operador, você pode visualizar os grupos e alterar apenas a disponibilidade das opções.',
      ),
    ).toBeInTheDocument();
    await waitForLoadedPanel();
    expect(screen.queryByRole('button', { name: 'Novo grupo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar grupo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova opção' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Indisponível: Médio' })).toBeEnabled();
  });

  it('offline informa conectividade e pausa todas as mutações', async () => {
    renderPanel();

    await waitForLoadedPanel();

    setNavigatorOnline(false);
    window.dispatchEvent(new Event('offline'));

    expect(
      await screen.findByText(
        'Você está offline. A edição de grupos e opções está pausada até a conexão ser restabelecida.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo grupo' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Editar grupo' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Nova opção' })).toHaveLength(2);
    for (const button of screen.getAllByRole('button', { name: 'Nova opção' })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Indisponível: Médio' })).toBeDisabled();
  });

  it('expõe erro amigável confirmado pelo servidor', async () => {
    const user = userEvent.setup();
    const { rpc } = renderPanel({ groups: [], optionsList: [] });
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED73', message: 'PED73: invalid rule' },
    });

    await waitForLoadedEmptyPanel();
    await openNewGroupForm();
    await user.type(screen.getByLabelText('Nome do grupo'), 'X');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));

    const alertElement = await screen.findByRole('alert');
    expect(alertElement).toHaveTextContent(
      'A regra de seleção é inválida para este tipo de grupo.',
    );
  });
});
