import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

vi.mock('./orderAlertsSound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./orderAlertsSound')>();
  return { ...actual, createOrderChimeApi: vi.fn(actual.createOrderChimeApi) };
});

import {
  emitLastChannelStatus,
  emitSupabaseRealtime,
  resetSupabaseMock,
  supabaseMock,
} from '../../test/supabaseMock';
import { OrderSeenTracker, ORDER_ALERT_DISMISS_MS, ORDER_SEEN_LIMIT_PER_UNIT } from './orderAlerts';
import { createOrderChimeApi } from './orderAlertsSound';
import type { KdsOrder } from './orders';
import { useOperationalOrdersBridge } from './useOperationalOrdersBridge';
import type { OperationalOrdersBridgeState } from './useOperationalOrdersBridge';

const createdAt = '2026-08-10T14:00:00.000Z';

function kdsOrder(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: 'order-1',
    order_number: 1,
    status: 'new',
    service_mode: 'pickup',
    created_at: createdAt,
    status_updated_at: createdAt,
    estimated_minutes: 20,
    expected_at: '2026-08-10T14:30:00.000Z',
    items: [{ product_name: 'X-Burger', quantity: 1, note: null, options: [] }],
    ...overrides,
  };
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (value ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

interface BridgeHarness {
  view: {
    result: { current: OperationalOrdersBridgeState };
    rerender: (props: { unitId: string | null }) => void;
    unmount: () => void;
  };
  setUnitOrders: (unitId: string, orders: KdsOrder[]) => void;
  rejectKds: (shouldReject: boolean) => void;
}

function setupBridge(initialUnits: Record<string, KdsOrder[]>) {
  const state: Record<string, KdsOrder[]> = Object.fromEntries(
    Object.entries(initialUnits).map(([unitId, orders]) => [
      unitId,
      orders.map((order) => ({ ...order })),
    ]),
  );
  let kdsShouldReject = false;
  supabaseMock.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === 'get_kds_orders_minimal') {
      if (kdsShouldReject) {
        return Promise.reject(new Error('offline'));
      }
      const unitId = args?.p_unit_id as string;
      const orders = state[unitId] ?? [];
      return Promise.resolve({
        data: { unit: { id: unitId, name: 'Loja Centro' }, truncated: false, orders },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const view = renderHook(
    (props?: { unitId: string | null }) => useOperationalOrdersBridge(props?.unitId ?? 'unit-1'),
    { wrapper: Wrapper, initialProps: { unitId: 'unit-1' as string | null } },
  );

  return {
    view,
    setUnitOrders: (unitId: string, orders: KdsOrder[]) => {
      state[unitId] = orders.map((order) => ({ ...order }));
    },
    rejectKds: (shouldReject: boolean) => {
      kdsShouldReject = shouldReject;
    },
  } satisfies BridgeHarness;
}

describe('useOperationalOrdersBridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    setNavigatorOnline(true);
    setDocumentHidden(false);
    window.localStorage.clear();
    resetSupabaseMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hidrata o baseline sem alertar e mostra a contagem de novos na navegação', async () => {
    const { view } = setupBridge({
      'unit-1': [kdsOrder(), kdsOrder({ id: 'order-2', order_number: 2 })],
    });

    await waitFor(() => expect(view.result.current.newCount).toBe(2));
    expect(view.result.current.alert).toBeNull();
    expect(view.result.current.realtimeStatus).toBe('connecting');
  });

  it('alerta um novo pedido e agenda a dispensa automática dentro do intervalo', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const { view, setUnitOrders } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    setUnitOrders('unit-1', [kdsOrder(), kdsOrder({ id: 'order-2', order_number: 7 })]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));
    await waitFor(() => {
      expect(view.result.current.alert).toEqual({
        unitId: 'unit-1',
        count: 1,
        orderNumbers: [7],
      });
    });
    expect(view.result.current.newCount).toBe(2);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ORDER_ALERT_DISMISS_MS);
    const dismissCall = setTimeoutSpy.mock.calls.find((call) => call[1] === ORDER_ALERT_DISMISS_MS);
    expect(dismissCall).toBeDefined();
    act(() => {
      (dismissCall?.[0] as () => void)();
    });
    expect(view.result.current.alert).toBeNull();
  });

  it('agrupa novos pedidos em um único alerta de lote', async () => {
    const { view, setUnitOrders } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    setUnitOrders('unit-1', [
      kdsOrder(),
      kdsOrder({ id: 'order-2', order_number: 2 }),
      kdsOrder({ id: 'order-3', order_number: 3 }),
      kdsOrder({ id: 'order-4', order_number: 4 }),
    ]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));

    await waitFor(() => {
      expect(view.result.current.alert).toEqual({
        unitId: 'unit-1',
        count: 3,
        orderNumbers: [2, 3, 4],
      });
    });
    expect(view.result.current.newCount).toBe(4);
  });

  it('dispensa o alerta explicitamente', async () => {
    const { view, setUnitOrders } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    setUnitOrders('unit-1', [kdsOrder(), kdsOrder({ id: 'order-2', order_number: 7 })]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));
    await waitFor(() => expect(view.result.current.alert).not.toBeNull());

    act(() => view.result.current.dismissAlert());
    expect(view.result.current.alert).toBeNull();
  });

  it('troca de unidade faz baseline sem alerta em lote e zera a contagem', async () => {
    const { view, setUnitOrders } = setupBridge({
      'unit-1': [kdsOrder()],
      'unit-2': [kdsOrder({ id: 'o-2', order_number: 90 })],
    });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    setUnitOrders('unit-2', [
      kdsOrder({ id: 'o-2', order_number: 90 }),
      kdsOrder({ id: 'o-3', order_number: 91 }),
    ]);
    act(() => {
      view.rerender({ unitId: 'unit-2' });
    });

    await waitFor(() => expect(view.result.current.newCount).toBe(2));
    expect(view.result.current.alert).toBeNull();
  });

  it('volta online sem gerar alerta em lote para o que ocorreu offline', async () => {
    const { view, setUnitOrders, rejectKds } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    setNavigatorOnline(false);
    rejectKds(true);
    act(() => window.dispatchEvent(new Event('offline')));
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    setUnitOrders('unit-1', [kdsOrder(), kdsOrder({ id: 'order-2', order_number: 7 })]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));
    await waitFor(() => expect(view.result.current.newCount).toBe(1));
    expect(view.result.current.alert).toBeNull();

    setNavigatorOnline(true);
    rejectKds(false);
    act(() => window.dispatchEvent(new Event('online')));
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));

    await waitFor(() => expect(view.result.current.newCount).toBe(2));
    expect(view.result.current.alert).toBeNull();
  });

  it('mapeia falha de canal para degradado e reconecta fazendo resync sem alerta em lote', async () => {
    const { view, setUnitOrders } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));

    act(() => emitLastChannelStatus('CHANNEL_ERROR'));
    await waitFor(() => expect(view.result.current.realtimeStatus).toBe('degraded'));

    setUnitOrders('unit-1', [
      kdsOrder(),
      kdsOrder({ id: 'order-2', order_number: 7 }),
      kdsOrder({ id: 'order-3', order_number: 8 }),
    ]);
    act(() => emitSupabaseRealtime('UPDATE', { new: { id: 'order-2' } }));
    await waitFor(() => expect(view.result.current.alert).not.toBeNull());

    act(() => emitLastChannelStatus('SUBSCRIBED'));
    await waitFor(() => expect(view.result.current.realtimeStatus).toBe('connected'));

    act(() => view.result.current.dismissAlert());
    setUnitOrders('unit-1', [
      kdsOrder(),
      kdsOrder({ id: 'order-2', order_number: 7 }),
      kdsOrder({ id: 'order-3', order_number: 8 }),
      kdsOrder({ id: 'order-4', order_number: 9 }),
    ]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-4' } }));
    await waitFor(() => expect(view.result.current.newCount).toBe(4));
    expect(view.result.current.alert).toBeNull();
  });

  it('toca o som somente após opt-in explícito e emite um chime por lote', async () => {
    const chimeApi = { close: vi.fn(), play: vi.fn(() => true) };
    vi.mocked(createOrderChimeApi).mockReturnValue(chimeApi);
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime: () => undefined },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
          connect: () => undefined,
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const { view, setUnitOrders } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));
    expect(view.result.current.soundEnabled).toBe(false);

    act(() => view.result.current.toggleSound());
    expect(createOrderChimeApi).toHaveBeenCalledTimes(1);
    expect(view.result.current.soundEnabled).toBe(true);
    expect(view.result.current.soundUnavailable).toBe(false);

    setUnitOrders('unit-1', [kdsOrder(), kdsOrder({ id: 'order-2', order_number: 7 })]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));
    await waitFor(() => expect(view.result.current.alert).not.toBeNull());
    expect(chimeApi.play).toHaveBeenCalledTimes(1);

    act(() => view.result.current.toggleSound());
    expect(view.result.current.soundEnabled).toBe(false);
    expect(chimeApi.close).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('atualiza o seen em aba oculta sem alertar nem tocar som', async () => {
    const chimeApi = { close: vi.fn(), play: vi.fn(() => true) };
    vi.mocked(createOrderChimeApi).mockReturnValue(chimeApi);
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          frequency: { setValueAtTime: () => undefined },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
          connect: () => undefined,
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const { view, setUnitOrders } = setupBridge({ 'unit-1': [kdsOrder()] });
    await waitFor(() => expect(view.result.current.newCount).toBe(1));
    act(() => view.result.current.toggleSound());

    act(() => setDocumentHidden(true));
    setUnitOrders('unit-1', [kdsOrder(), kdsOrder({ id: 'order-2', order_number: 7 })]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-2' } }));
    await waitFor(() => expect(view.result.current.newCount).toBe(2));
    expect(view.result.current.alert).toBeNull();
    expect(chimeApi.play).not.toHaveBeenCalled();

    act(() => setDocumentHidden(false));
    setUnitOrders('unit-1', [
      kdsOrder(),
      kdsOrder({ id: 'order-2', order_number: 7 }),
      kdsOrder({ id: 'order-3', order_number: 8 }),
    ]);
    act(() => emitSupabaseRealtime('INSERT', { new: { id: 'order-3' } }));
    await waitFor(() => expect(view.result.current.newCount).toBe(3));
    expect(chimeApi.play).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('OrderSeenTracker', () => {
  it('limita o conjunto de vistos por unidade em FIFO', () => {
    const tracker = new OrderSeenTracker();
    for (let index = 0; index < ORDER_SEEN_LIMIT_PER_UNIT + 50; index += 1) {
      tracker.markSeen('unit-1', [`order-${index}`]);
    }
    expect(tracker.size('unit-1')).toBe(ORDER_SEEN_LIMIT_PER_UNIT);
    expect(tracker.has('unit-1', 'order-0')).toBe(false);
    expect(tracker.has('unit-1', `order-${ORDER_SEEN_LIMIT_PER_UNIT - 1}`)).toBe(true);
  });
});
