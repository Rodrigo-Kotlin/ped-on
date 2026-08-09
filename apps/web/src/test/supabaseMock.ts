import { vi } from 'vitest';

export interface QueryResult<T> {
  data: T | null;
  error: unknown;
}

export function mockFromQuery<T>(result: QueryResult<T>) {
  const chain: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.select.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.maybeSingle.mockImplementation(async () => result);
  return chain;
}

export function createSupabaseMock() {
  return {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

export const supabaseMock = createSupabaseMock();

export function resetSupabaseMock() {
  vi.clearAllMocks();
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  supabaseMock.auth.signInWithPassword.mockResolvedValue({
    data: { user: null, session: null },
    error: null,
  });
  supabaseMock.auth.signUp.mockResolvedValue({
    data: { user: null, session: null },
    error: null,
  });
  supabaseMock.auth.signOut.mockResolvedValue({ error: null });
  supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
  supabaseMock.from.mockImplementation(() => mockFromQuery({ data: null, error: null }));
}
