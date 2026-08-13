import { renderWithProviders } from '@pedon/test-utils';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import { PilotReadinessPanel } from './PilotReadinessPanel';

const readiness = {
  organization_id: 'org-1',
  ready: false,
  blocking_ok: 1,
  blocking_total: 3,
  checked_at: '2026-08-13T10:00:00Z',
  checks: [
    {
      code: 'ORG_NAME',
      label: 'Nome da organização',
      ok: true,
      blocking: true,
      detail: 'Definido.',
    },
    {
      code: 'ACTIVE_UNIT',
      label: 'Unidade ativa',
      ok: false,
      blocking: true,
      detail: 'Nenhuma unidade ativa.',
    },
    {
      code: 'LOYALTY',
      label: 'Fidelidade',
      ok: false,
      blocking: false,
      detail: 'Opcional antes do piloto.',
    },
  ],
  units_summary: [],
};

describe('PilotReadinessPanel', () => {
  beforeEach(() => resetSupabaseMock());

  it('exibe verificações derivadas e o resumo de bloqueio', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: readiness, error: null });

    renderWithProviders(<PilotReadinessPanel organizationId="org-1" ownerActions />);

    expect(
      await screen.findByRole('heading', { name: 'Prontidão para piloto' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Em preparação (1 de 3)')).toBeInTheDocument();
    expect(screen.getByText('Nome da organização')).toBeInTheDocument();
    expect(screen.getByText('Unidade ativa')).toBeInTheDocument();
    expect(screen.getByText('Fidelidade')).toBeInTheDocument();
    expect(screen.getByText('Opcional antes do piloto.')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_org_pilot_readiness', {
      p_organization_id: 'org-1',
    });
  });

  it('indica que está pronto para piloto quando ready=true', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { ...readiness, ready: true, blocking_ok: 3, blocking_total: 3 },
      error: null,
    });

    renderWithProviders(<PilotReadinessPanel organizationId="org-1" />);

    expect(await screen.findByText('Pronto para piloto')).toBeInTheDocument();
  });

  it('oferece navegação para as telas de preparo', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: readiness, error: null });

    renderWithProviders(<PilotReadinessPanel organizationId="org-1" ownerActions />);

    await screen.findByRole('heading', { name: 'Prontidão para piloto' });
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'href',
      '/app/configuracoes',
    );
    expect(screen.getByRole('link', { name: 'Equipe' })).toHaveAttribute('href', '/app/equipe');
    expect(screen.getByRole('link', { name: 'Diagnóstico' })).toHaveAttribute(
      'href',
      '/app/diagnostico',
    );
  });

  it('não oferece ações owner-only para manager', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: readiness, error: null });

    renderWithProviders(<PilotReadinessPanel organizationId="org-1" />);

    await screen.findByRole('heading', { name: 'Prontidão para piloto' });
    expect(screen.queryByRole('link', { name: 'Equipe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Diagnóstico' })).not.toBeInTheDocument();
  });

  it('mostra erro quando a RPC falha', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PED69', message: 'FORBIDDEN' },
    });

    renderWithProviders(<PilotReadinessPanel organizationId="org-1" />);

    expect(
      await screen.findByText('Não foi possível verificar a prontidão para piloto.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há verificações', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { ...readiness, checks: [] }, error: null });

    renderWithProviders(<PilotReadinessPanel organizationId="org-1" />);

    expect(await screen.findByText('Sem informações de prontidão.')).toBeInTheDocument();
  });
});
