import { screen } from '@testing-library/react';
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
});

describe('AppPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('mostra a organização, a unidade selecionada e o link de configuração', async () => {
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
