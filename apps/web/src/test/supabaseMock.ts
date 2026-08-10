import { vi } from 'vitest';

type RealtimeCallback = (payload: { new?: Record<string, unknown> }) => void;
interface RealtimeRegistration {
  channel: MockRealtimeChannel;
  event: string;
  callback: RealtimeCallback;
}

interface MockRealtimeChannel {
  name: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

const realtimeRegistrations: RealtimeRegistration[] = [];

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
  const mock = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  };
  mock.channel.mockImplementation((name: string) => {
    const channel: MockRealtimeChannel = {
      name,
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    channel.on.mockImplementation(
      (_type: string, filter: { event: string }, callback: RealtimeCallback) => {
        realtimeRegistrations.push({ channel, event: filter.event, callback });
        return channel;
      },
    );
    channel.subscribe.mockImplementation(() => channel);
    return channel;
  });
  mock.removeChannel.mockImplementation(async (channel: MockRealtimeChannel) => {
    for (let index = realtimeRegistrations.length - 1; index >= 0; index -= 1) {
      if (realtimeRegistrations[index]?.channel === channel) realtimeRegistrations.splice(index, 1);
    }
    return 'ok';
  });
  return mock;
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

export const supabaseMock = createSupabaseMock();

export function emitSupabaseRealtime(
  event: 'INSERT' | 'UPDATE',
  payload: { new?: Record<string, unknown> },
) {
  realtimeRegistrations
    .filter((registration) => registration.event === event)
    .forEach((registration) => registration.callback(payload));
}

export function resetSupabaseMock() {
  vi.clearAllMocks();
  realtimeRegistrations.splice(0);
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
  supabaseMock.channel.mockImplementation((name: string) => {
    const channel: MockRealtimeChannel = {
      name,
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    channel.on.mockImplementation(
      (_type: string, filter: { event: string }, callback: RealtimeCallback) => {
        realtimeRegistrations.push({ channel, event: filter.event, callback });
        return channel;
      },
    );
    channel.subscribe.mockImplementation(() => channel);
    return channel;
  });
  supabaseMock.removeChannel.mockImplementation(async (channel: MockRealtimeChannel) => {
    for (let index = realtimeRegistrations.length - 1; index >= 0; index -= 1) {
      if (realtimeRegistrations[index]?.channel === channel) realtimeRegistrations.splice(index, 1);
    }
    return 'ok';
  });
}
