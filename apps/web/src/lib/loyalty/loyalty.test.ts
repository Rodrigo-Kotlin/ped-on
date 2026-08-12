import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import {
  cpfSchema,
  clubEnrollSchema,
  clubLookupSchema,
  fetchLoyaltyMembersAdmin,
  fetchLoyaltyProgramAdmin,
  fetchPublicLoyaltyAccount,
  isValidCpf,
  LoyaltyAdminError,
  LoyaltyError,
  maskCpf,
  normalizeCpf,
  resolveLoyaltyIdentity,
  setLoyaltyProgramEnabled,
} from './loyalty';
import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';

const EDGE_URL = `${
  import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'
}/functions/v1/loyalty-cpf`;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'placeholder-key';

function edgeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const foundPayload = {
  found: true,
  membership_id: '99999999-9999-4999-8999-999999999999',
  customer: { name: 'Maria Silva', cpf_last2: '25' },
  account: { points_balance: 120, recovery_points: 0 },
  token: {
    access_token: 'a'.repeat(64),
    expires_at: '2026-08-11T14:00:00.000Z',
  },
};

describe('normalizeCpf / isValidCpf', () => {
  it('aceita CPF válido com pontuação', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(cpfSchema.safeParse('529.982.247-25').success).toBe(true);
  });

  it('rejeita dígitos repetidos e CPFs inválidos', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123.456.789-00')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
    expect(isValidCpf('abc')).toBe(false);
  });
});

describe('maskCpf', () => {
  it('mascara mantendo apenas os últimos 2 dígitos', () => {
    expect(maskCpf('25')).toBe('***.***.***-25');
  });
});

describe('schemas do Clube', () => {
  it('lookup exige CPF e telefone válidos', () => {
    expect(
      clubLookupSchema.safeParse({ cpf: '111.111.111-11', phone: '(11) 99999-9999' }).success,
    ).toBe(false);
    expect(clubLookupSchema.safeParse({ cpf: '529.982.247-25', phone: '123' }).success).toBe(false);
    expect(
      clubLookupSchema.safeParse({ cpf: '529.982.247-25', phone: '(11) 99999-9999' }).success,
    ).toBe(true);
  });

  it('enroll exige nome válido e consentimento', () => {
    const valid = {
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
      name: 'Maria Silva',
      consent: true,
    };
    expect(clubEnrollSchema.safeParse(valid).success).toBe(true);
    const noConsent = { ...valid, consent: false };
    const parsed = clubEnrollSchema.safeParse(noConsent);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('termos');
    }
    const shortName = { ...valid, name: 'M' };
    expect(clubEnrollSchema.safeParse(shortName).success).toBe(false);
  });
});

describe('resolveLoyaltyIdentity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chama a Edge Function com headers e corpo corretos e retorna o contrato', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(edgeResponse(200, foundPayload));

    const result = await resolveLoyaltyIdentity({
      publicSlug: 'abcdef1234567890abcdef12',
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    });

    expect(result).toEqual(foundPayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(EDGE_URL);
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    const headers = init?.headers as Record<string, string>;
    expect(headers.apikey).toBe(PUBLISHABLE_KEY);
    expect(headers.Authorization).toBe(`Bearer ${PUBLISHABLE_KEY}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      public_slug: 'abcdef1234567890abcdef12',
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    });
  });

  it('inclui name no modo enroll', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(edgeResponse(200, foundPayload));

    await resolveLoyaltyIdentity({
      publicSlug: 'abcdef1234567890abcdef12',
      mode: 'enroll',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
      name: 'Maria Silva',
      consent: true,
    });

    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: 'enroll',
      phone: '(11) 99999-9999',
      name: 'Maria Silva',
      consent: true,
    });
  });

  it.each([
    [422, { error: { code: 'INVALID_CPF', message: 'CPF invalido' } }, 'CPF inválido'],
    [422, { error: { code: 'INVALID_PHONE', message: 'Telefone invalido' } }, 'telefone válido'],
    [422, { error: { code: 'INVALID_NAME', message: 'Nome invalido' } }, 'Revise seu nome'],
    [403, { error: { code: 'IDENTITY_NOT_CONFIRMED' } }, 'confirmar os dados'],
    [422, { error: { code: 'CONSENT_REQUIRED' } }, 'aceitar os termos'],
    [429, { error: { code: 'RATE_LIMITED' } }, 'Muitas tentativas'],
    [
      403,
      { error: { code: 'LOYALTY_UNAVAILABLE', message: 'indisponivel' } },
      'indisponível para este cardápio',
    ],
    [404, { error: { code: 'INVALID_SLUG', message: 'slug' } }, 'Cardápio não encontrado'],
  ])('mapeia erro HTTP %i para mensagem amigável', async (status, body, fragment) => {
    vi.mocked(fetch).mockResolvedValue(edgeResponse(status, body));
    const error = await resolveLoyaltyIdentity({
      publicSlug: 'abcdef1234567890abcdef12',
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoyaltyError);
    expect((error as LoyaltyError).message).toContain(fragment);
  });

  it('lança erro de rede quando o fetch falha', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await resolveLoyaltyIdentity({
      publicSlug: 'abcdef1234567890abcdef12',
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoyaltyError);
    expect((error as LoyaltyError).isNetworkError).toBe(true);
    expect((error as LoyaltyError).message).toContain('conexão');
  });

  it('rejeita resposta found sem token opaco válido', async () => {
    vi.mocked(fetch).mockResolvedValue(
      edgeResponse(200, { ...foundPayload, token: { ...foundPayload.token, access_token: 'x' } }),
    );
    const error = await resolveLoyaltyIdentity({
      publicSlug: 'abcdef1234567890abcdef12',
      mode: 'lookup',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoyaltyError);
    expect((error as LoyaltyError).code).toBe('UPSTREAM_ERROR');
  });
});

describe('fetchPublicLoyaltyAccount', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('consulta o saldo via RPC anon com o token efêmero', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        found: true,
        organization: { name: 'Cantina' },
        customer: { name: 'Maria Silva', cpf_last2: '25' },
        account: { points_balance: 150, recovery_points: 0, updated_at: '2026-08-11T13:00:00Z' },
        statement: [],
      },
      error: null,
    });

    const result = await fetchPublicLoyaltyAccount('b'.repeat(64));

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_loyalty_account', {
      p_access_token: 'b'.repeat(64),
    });
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.account.points_balance).toBe(150);
    }
  });

  it('lança erro amigável em falha de rede do RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const error = await fetchPublicLoyaltyAccount('b'.repeat(64)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LoyaltyError);
    expect((error as LoyaltyError).message).toContain('atualizar o saldo');
  });

  it('valida a resposta pública da conta e preserva vouchers ativos', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        found: true,
        organization: { name: 'Cantina' },
        customer: { name: null, cpf_last2: '25' },
        account: { points_balance: 70, recovery_points: 0, updated_at: '2026-08-11T13:00:00Z' },
        statement: [],
        vouchers: [
          {
            code: 'ABCD-EF12-3456-7890',
            reward_name: 'Café grátis',
            points_cost: '80',
            issued_at: '2026-08-11T12:00:00Z',
          },
        ],
      },
      error: null,
    });

    const result = await fetchPublicLoyaltyAccount('b'.repeat(64));
    expect(result.found && result.vouchers[0]?.code).toBe('ABCD-EF12-3456-7890');
  });

  it('rejeita resposta pública da conta fora do contrato', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { found: true, account: {} }, error: null });
    await expect(fetchPublicLoyaltyAccount('b'.repeat(64))).rejects.toBeInstanceOf(LoyaltyError);
  });
});

describe('clientes administrativos do Clube', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('fetchLoyaltyProgramAdmin chama RPC com organization_id', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        organization_id: 'org-1',
        program: null,
        stats: { members_count: 0, total_earned: 0, total_reversed: 0 },
      },
      error: null,
    });
    const result = await fetchLoyaltyProgramAdmin('org-1');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_loyalty_program_admin', {
      p_organization_id: 'org-1',
    });
    expect(result.program).toBeNull();
  });

  it('setLoyaltyProgramEnabled chama RPC com o estado desejado', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { organization_id: 'org-1' }, error: null });
    await setLoyaltyProgramEnabled('org-1', true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_loyalty_program_enabled', {
      p_organization_id: 'org-1',
      p_enabled: true,
    });
  });

  it('fetchLoyaltyMembersAdmin chama RPC com cursor opcional', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { organization_id: 'org-1', count: 1, has_more: false, next_cursor: null, members: [] },
      error: null,
    });
    await fetchLoyaltyMembersAdmin('org-1', null);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_loyalty_members_admin', {
      p_organization_id: 'org-1',
      p_limit: 50,
      p_cursor: null,
    });
  });

  it.each([
    ['PED10', 'sessão expirou'],
    ['PED11', 'proprietário'],
    ['PED53', 'Inconsistência interna'],
  ])('mapeia erro admin %s para mensagem amigável', async (code, fragment) => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code, message: 'DB_ERROR' },
    });
    const error = await fetchLoyaltyProgramAdmin('org-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoyaltyAdminError);
    expect((error as LoyaltyAdminError).message).toContain(fragment);
  });

  it('usa mensagem de fallback para erros desconhecidos', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code: 'PED99', message: 'x' } });
    const error = await fetchLoyaltyProgramAdmin('org-1').catch((caught: unknown) => caught);
    expect((error as LoyaltyAdminError).message).toContain('Não foi possível carregar o Clube');
  });
});
