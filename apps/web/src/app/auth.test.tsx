import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderWithAuth } from '../test/auth';

vi.mock('../lib/supabase', () =>
  import('../test/supabaseMock').then((module) => ({
    supabase: module.supabaseMock,
  })),
);

import { resetSupabaseMock, supabaseMock } from '../test/supabaseMock';
import { AdminProvider } from '../lib/admin/AdminProvider';
import { useAdmin } from '../lib/admin/admin-context';
import { fetchLoyaltyMembersAdmin, loyaltyMembersPrefix, maskCpf } from '../lib/loyalty/loyalty';
import { AppPage } from '../pages/AppPage';
import { LoginPage } from '../pages/LoginPage';
import { SignupPage } from '../pages/SignupPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { GuestOnly, RequireAuth } from '../lib/auth/guards';

const sessionUser = {
  id: 'user-1',
  email: 'joao@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

function makeSession() {
  return {
    user: sessionUser,
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    expires_at: 9999999999,
    token_type: 'bearer',
  };
}

function PrivateSessionProbe() {
  const { organization, profile, role, selectedUnit } = useAdmin();
  const userId = profile?.id ?? '';
  const organizationId = organization?.id ?? '';
  const membersQuery = useQuery({
    queryKey: loyaltyMembersPrefix(userId, organizationId),
    queryFn: () => fetchLoyaltyMembersAdmin(organizationId, null),
    enabled: userId !== '' && organizationId !== '',
  });
  const member = membersQuery.data?.members[0];
  return (
    <div>
      <p>{organization?.name ?? 'sem organização'}</p>
      <p>{role ?? 'sem função'}</p>
      <p>{selectedUnit?.name ?? 'sem unidade'}</p>
      {member !== undefined && (
        <p>
          {member.name} {maskCpf(member.cpf_last2)} {member.points_balance} pontos
        </p>
      )}
    </div>
  );
}

describe('AuthProvider e guards', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('RequireAuth redireciona para /login quando não há sessão', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderWithAuth(
      <Routes>
        <Route
          path="/protegido"
          element={
            <RequireAuth>
              <div>conteúdo protegido</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>página de login</div>} />
      </Routes>,
      { initialEntries: ['/protegido'] },
    );

    expect(await screen.findByText('página de login')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument();
  });

  it('RequireAuth libera o conteúdo quando há sessão', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });

    renderWithAuth(
      <Routes>
        <Route
          path="/protegido"
          element={
            <RequireAuth>
              <div>conteúdo protegido</div>
            </RequireAuth>
          }
        />
      </Routes>,
      { initialEntries: ['/protegido'] },
    );

    expect(await screen.findByText('conteúdo protegido')).toBeInTheDocument();
  });

  it('GuestOnly redireciona usuário autenticado para /app', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });

    renderWithAuth(
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <div>página de login</div>
            </GuestOnly>
          }
        />
        <Route path="/app" element={<div>área do app</div>} />
      </Routes>,
      { initialEntries: ['/login'] },
    );

    expect(await screen.findByText('área do app')).toBeInTheDocument();
    expect(screen.queryByText('página de login')).not.toBeInTheDocument();
  });

  it('GuestOnly libera a página para visitante sem sessão', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderWithAuth(
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <div>página de login</div>
            </GuestOnly>
          }
        />
      </Routes>,
      { initialEntries: ['/login'] },
    );

    expect(await screen.findByText('página de login')).toBeInTheDocument();
  });

  it('remove todo dado privado de A antes da resposta da sessão B', async () => {
    let authCallback!: (event: string, session: ReturnType<typeof makeSession>) => void;
    let switched = false;
    let resolveAdminB!: (value: { data: unknown; error: null }) => void;
    const adminB = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveAdminB = resolve;
    });
    const userB = { ...sessionUser, id: 'user-2', email: 'ana@example.com' };
    const sessionB = { ...makeSession(), user: userB };
    const contextA = {
      profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
      organization: { id: 'org-a', name: 'Organização A' },
      role: 'owner',
      units: [{ id: 'unit-a', name: 'Unidade A', is_active: true }],
    };
    const contextB = {
      profile: { id: 'user-2', full_name: 'Ana', email: 'ana@example.com' },
      organization: { id: 'org-b', name: 'Organização B' },
      role: 'manager',
      units: [{ id: 'unit-b', name: 'Unidade B', is_active: true }],
    };
    window.localStorage.setItem('pedon:selectedUnitId', 'unit-a');
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    supabaseMock.auth.onAuthStateChange.mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_my_admin_context') {
        return switched ? adminB : Promise.resolve({ data: contextA, error: null });
      }
      if (name === 'get_loyalty_members_admin') {
        return Promise.resolve({
          data: {
            organization_id: switched ? 'org-b' : 'org-a',
            count: 1,
            has_more: false,
            next_cursor: null,
            members: [
              switched
                ? {
                    id: 'member-b',
                    cpf_last2: '44',
                    name: 'Membro B',
                    points_balance: '20',
                    recovery_points: '0',
                    total_earned: '20',
                    total_redeemed: '0',
                    total_reversed: '0',
                    member_since: '2026-08-11T00:00:00Z',
                  }
                : {
                    id: 'member-a',
                    cpf_last2: '25',
                    name: 'Membro A',
                    points_balance: '999',
                    recovery_points: '0',
                    total_earned: '999',
                    total_redeemed: '0',
                    total_reversed: '0',
                    member_since: '2026-08-10T00:00:00Z',
                  },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderWithAuth(
      <AdminProvider>
        <PrivateSessionProbe />
      </AdminProvider>,
    );

    expect(await screen.findByText('Organização A')).toBeInTheDocument();
    expect(await screen.findByText(/Membro A.*999 pontos/)).toHaveTextContent('***.***.***-25');

    switched = true;
    authCallback('SIGNED_IN', sessionB);

    await waitFor(() => {
      expect(screen.queryByText('Organização A')).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(
        /owner|Unidade A|Membro A|\*\*\*\.\*\*\*\.\*\*\*-25|999 pontos/,
      );
    });
    expect(window.localStorage.getItem('pedon:selectedUnitId')).toBeNull();

    resolveAdminB({ data: contextB, error: null });
    expect(await screen.findByText('Organização B')).toBeInTheDocument();
    expect(await screen.findByText(/Membro B.*20 pontos/)).toHaveTextContent('***.***.***-44');
  });
});

describe('LoginPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('preenche o formulário e chama signInWithPassword', async () => {
    const user = userEvent.setup();
    supabaseMock.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    renderWithAuth(<LoginPage />);

    await user.type(screen.getByLabelText('E-mail'), 'joao@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'joao@example.com',
      password: 'senha-segura',
    });
  });

  it('exibe erro do servidor quando login falha', async () => {
    const user = userEvent.setup();
    supabaseMock.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    renderWithAuth(<LoginPage />);

    await user.type(screen.getByLabelText('E-mail'), 'joao@example.com');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  });

  it('não envia quando o e-mail é inválido', async () => {
    const user = userEvent.setup();

    renderWithAuth(<LoginPage />);

    await user.type(screen.getByLabelText('E-mail'), 'nao-e-email');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(supabaseMock.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(await screen.findByText('Informe um e-mail válido')).toBeInTheDocument();
  });
});

describe('SignupPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('envia signUp quando as senhas coincidem', async () => {
    const user = userEvent.setup();
    supabaseMock.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    renderWithAuth(<SignupPage />);

    await user.type(screen.getByLabelText('E-mail'), 'maria@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura');
    await user.type(screen.getByLabelText('Confirme a senha'), 'senha-segura');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(supabaseMock.auth.signUp).toHaveBeenCalledWith({
      email: 'maria@example.com',
      password: 'senha-segura',
    });
  });

  it('mostra mensagem de confirmação de e-mail quando session é null', async () => {
    const user = userEvent.setup();
    supabaseMock.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    renderWithAuth(<SignupPage />);

    await user.type(screen.getByLabelText('E-mail'), 'maria@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura');
    await user.type(screen.getByLabelText('Confirme a senha'), 'senha-segura');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByRole('heading', { name: 'Confirme seu e-mail' })).toBeInTheDocument();
  });

  it('não envia quando as senhas não coincidem', async () => {
    const user = userEvent.setup();

    renderWithAuth(<SignupPage />);

    await user.type(screen.getByLabelText('E-mail'), 'maria@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura');
    await user.type(screen.getByLabelText('Confirme a senha'), 'outra-senha');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(supabaseMock.auth.signUp).not.toHaveBeenCalled();
    expect(await screen.findByText('As senhas não coincidem')).toBeInTheDocument();
  });
});

describe('OnboardingPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('chama a RPC complete_onboarding com o nome da organização', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    renderWithAuth(<OnboardingPage />);

    await user.type(screen.getByLabelText('Nome da organização'), 'Cantina da Praça');
    await user.click(screen.getByRole('button', { name: 'Criar organização' }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith('complete_onboarding', {
      p_organization_name: 'Cantina da Praça',
    });
  });

  it('exibe convites pendentes e aceita o convite', async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_pending_member_invites') {
        return Promise.resolve({
          data: [
            {
              id: 'inv-1',
              organization_id: 'org-9',
              organization_name: 'Restaurante do Lado',
              role: 'manager',
              created_at: '2026-08-10T00:00:00Z',
              expires_at: '2026-08-17T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (fn === 'accept_org_member_invite') {
        return Promise.resolve({
          data: { organization_id: 'org-9', role: 'manager', accepted: true },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderWithAuth(<OnboardingPage />);

    expect(await screen.findByText('Restaurante do Lado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceitar convite' }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith('accept_org_member_invite', {
        p_invite_id: 'inv-1',
      });
    });
  });

  it('exibe mensagem amigável quando o convite expirou', async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_pending_member_invites') {
        return Promise.resolve({
          data: [
            {
              id: 'inv-1',
              organization_id: 'org-9',
              organization_name: 'Restaurante do Lado',
              role: 'manager',
              created_at: '2026-08-01T00:00:00Z',
              expires_at: '2026-08-08T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (fn === 'accept_org_member_invite') {
        return Promise.resolve({
          data: null,
          error: { code: 'PED87', message: 'expired invite' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderWithAuth(<OnboardingPage />);

    await screen.findByText('Restaurante do Lado');
    await user.click(screen.getByRole('button', { name: 'Aceitar convite' }));

    expect(await screen.findByText('Convite expirado.')).toBeInTheDocument();
  });

  it('não mostra a seção de convites quando não há convites', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });

    renderWithAuth(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.queryByText('Você foi convidado(a)')).not.toBeInTheDocument();
    });
  });
});

describe('AppPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSupabaseMock();
  });

  it('mostra a organização, a unidade selecionada e o link de configuração', async () => {
    window.localStorage.setItem('pedon:selectedUnitId', 'unit-invalida');
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: {
        profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
        organization: { id: 'org-1', name: 'Cantina da Praça' },
        role: 'owner',
        units: [{ id: 'unit-1', name: 'Loja Centro', is_active: true }],
      },
      error: null,
    });

    renderWithAuth(
      <AdminProvider>
        <AppPage />
      </AdminProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Cantina da Praça' })).toBeInTheDocument();
    expect(screen.getByText('Loja Centro')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir configurações' })).toHaveAttribute(
      'href',
      '/app/configuracoes',
    );
    await waitFor(() => expect(window.localStorage.getItem('pedon:selectedUnitId')).toBeNull());
  });

  it('preserva unidade válida durante a hidratação inicial da sessão', async () => {
    window.localStorage.setItem('pedon:selectedUnitId', 'unit-2');
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: {
        profile: { id: 'user-1', full_name: 'João', email: 'joao@example.com' },
        organization: { id: 'org-1', name: 'Cantina da Praça' },
        role: 'owner',
        units: [
          { id: 'unit-1', name: 'Loja Centro', is_active: true },
          { id: 'unit-2', name: 'Loja Norte', is_active: true },
        ],
      },
      error: null,
    });

    renderWithAuth(
      <AdminProvider>
        <AppPage />
      </AdminProvider>,
    );

    expect(await screen.findByText('Loja Norte')).toBeInTheDocument();
    expect(window.localStorage.getItem('pedon:selectedUnitId')).toBe('unit-2');
  });

  it('cai para estado vazio quando o contexto administrativo falha', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'erro de banco' } });

    renderWithAuth(
      <AdminProvider>
        <AppPage />
      </AdminProvider>,
    );

    expect(await screen.findByText('Nenhuma unidade disponível.')).toBeInTheDocument();
  });
});
