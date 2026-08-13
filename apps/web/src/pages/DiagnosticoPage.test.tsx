import { renderWithProviders } from '@pedon/test-utils';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { AdminProvider } from '../lib/admin/AdminProvider';
import { buildMetadata } from '../lib/build-info/buildMetadata';
import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { DiagnosticoPage } from './DiagnosticoPage';

const adminContext = {
  profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
  organization: { id: 'org-1', name: 'Cantina da Praça' },
  role: 'owner',
  units: [
    { id: 'unit-1', name: 'Loja Centro', is_active: true },
    { id: 'unit-2', name: 'Loja Norte', is_active: false },
  ],
};

const readiness = {
  organization_id: 'org-1',
  ready: false,
  blocking_ok: 3,
  blocking_total: 5,
  checked_at: '2026-08-13T10:00:00Z',
  checks: [],
  units_summary: [
    {
      unit_id: 'unit-1',
      name: 'Loja Centro',
      is_active: true,
      op_configured: true,
      hours_ok: true,
      payment_ok: true,
      catalog_ok: false,
      menu_published: false,
    },
    {
      unit_id: 'unit-2',
      name: 'Loja Norte',
      is_active: false,
      op_configured: false,
      hours_ok: false,
      payment_ok: false,
      catalog_ok: false,
      menu_published: false,
    },
  ],
};

function mockRpc() {
  supabaseMock.rpc.mockImplementation((fn: string) => {
    if (fn === 'get_my_admin_context') return Promise.resolve({ data: adminContext, error: null });
    if (fn === 'get_org_pilot_readiness') return Promise.resolve({ data: readiness, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function renderDiagnostico() {
  return renderWithProviders(
    <AdminProvider>
      <DiagnosticoPage />
    </AdminProvider>,
    { initialEntries: ['/app/diagnostico'] },
  );
}

describe('DiagnosticoPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('exibe a versão, revisão e build sem credenciais', async () => {
    mockRpc();
    renderDiagnostico();

    expect(await screen.findByText('Versão da aplicação')).toBeInTheDocument();
    expect(screen.getByText(buildMetadata.version)).toBeInTheDocument();
    expect(screen.getByText('Revisão (commit)')).toBeInTheDocument();
    expect(screen.getByText('Build gerado em')).toBeInTheDocument();
  });

  it('exibe sessão e contexto administrativo', async () => {
    mockRpc();
    renderDiagnostico();

    await screen.findByText('Proprietário');
    expect(screen.getByText('João')).toBeInTheDocument();
    expect(screen.getByText('Cantina da Praça')).toBeInTheDocument();
    expect(screen.getByText('Unidades')).toBeInTheDocument();
    expect(screen.getAllByText('Loja Centro').length).toBeGreaterThanOrEqual(1);
  });

  it('reporta conectividade OK após o round-trip', async () => {
    mockRpc();
    renderDiagnostico();

    expect(await screen.findByText(/Conexão OK\. Última verificação às/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar verificação' })).toBeInTheDocument();
  });

  it('mostra a prontidão derivada por unidade com pré-requisitos', async () => {
    mockRpc();
    renderDiagnostico();

    expect(
      await screen.findByText('Em preparação (3 de 5 verificações concluídas).'),
    ).toBeInTheDocument();
    expect(screen.getByText('configuração · horários · pagamento')).toBeInTheDocument();
    expect(screen.getByText('inativa')).toBeInTheDocument();
    expect(screen.getByText('sem pré-requisitos concluídos')).toBeInTheDocument();
  });

  it('indica pronto para piloto quando ready=true', async () => {
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_admin_context')
        return Promise.resolve({ data: adminContext, error: null });
      if (fn === 'get_org_pilot_readiness') {
        return Promise.resolve({
          data: { ...readiness, ready: true, blocking_ok: 5, blocking_total: 5 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderDiagnostico();

    expect(await screen.findByText('Pronto para piloto.')).toBeInTheDocument();
  });

  it('não exibe credenciais, segredos ou PII de clientes', async () => {
    mockRpc();
    renderDiagnostico();

    await screen.findByText('Versão da aplicação');
    expect(screen.queryByText(/password|secret|token\b|jwt|cpf|telefone|voucher/i)).toBeNull();
    expect(screen.queryByText('joao@example.com')).toBeNull();
  });
});
